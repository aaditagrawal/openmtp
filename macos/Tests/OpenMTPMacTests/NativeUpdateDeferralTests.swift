import Foundation
import Testing

@testable import OpenMTPMac

@Suite("Update installation waits for file transfers")
@MainActor
struct NativeUpdateDeferralTests {
  @Test func pendingInstallWaitsUntilEveryCopyIsIdleAndRunsOnce() {
    let service = NativeUpdateService(currentVersion: "4.0.0", architecture: "arm64")
    var queuedCopy = true
    var promisedExport = true
    var installations = 0
    service.hasActiveTransfers = { queuedCopy || promisedExport }
    #expect(service.postponeInstallationIfBusy { installations += 1 })
    #expect(service.state == .waitingForTransfers)
    #expect(!service.resumeDeferredInstallationIfIdle())
    queuedCopy = false
    #expect(!service.resumeDeferredInstallationIfIdle())
    #expect(installations == 0)
    promisedExport = false
    #expect(service.resumeDeferredInstallationIfIdle())
    #expect(installations == 1)
    #expect(!service.resumeDeferredInstallationIfIdle())
    #expect(installations == 1)
  }

  @Test func idleInstallIsNotInterceptedAndAbortedContinuationCannotRun() {
    let service = NativeUpdateService(currentVersion: "4.0.0", architecture: "arm64")
    var busy = false
    var installations = 0
    service.hasActiveTransfers = { busy }
    #expect(!service.postponeInstallationIfBusy { installations += 1 })
    #expect(installations == 0)  // Returning false leaves the invocation to Sparkle.
    busy = true
    #expect(service.postponeInstallationIfBusy { installations += 1 })
    service.cancelDeferredInstallation()
    busy = false
    #expect(!service.resumeDeferredInstallationIfIdle())
    #expect(installations == 0)
  }

  @Test func deferredInstallResumesAutomaticallyAfterTransfersFinish() async throws {
    let service = NativeUpdateService(currentVersion: "4.0.0", architecture: "arm64")
    var busy = true
    var installations = 0
    service.hasActiveTransfers = { busy }
    #expect(service.postponeInstallationIfBusy { installations += 1 })
    #expect(installations == 0)
    busy = false
    for _ in 0..<30 where installations == 0 { try await Task.sleep(for: .milliseconds(20)) }
    #expect(installations == 1)
    service.cancelDeferredInstallation()
  }
}
