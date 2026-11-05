import Foundation
import Sparkle
import Testing

@testable import OpenMTPMac

@Suite("Update installation waits for file transfers")
@MainActor
struct NativeUpdateDeferralTests {
  @Test func newerBuildCannotDowngradeAReleaseOrABetaToAnOlderStableCore() throws {
    func item(_ version: String, channel: String? = nil) throws -> SUAppcastItem {
      var dictionary: [String: Any] = [
        "title": version,
        "enclosure": [
          "url":
            "https://github.com/aaditagrawal/openmtp/releases/download/v\(version)/OpenMTP.zip",
          "sparkle:version": "9999", "sparkle:shortVersionString": version,
          "length": "1", "type": "application/octet-stream",
        ],
      ]
      if let channel { dictionary["sparkle:channel"] = channel }
      return try #require(SUAppcastItem(dictionary: dictionary))
    }
    let stable = NativeUpdateService(currentVersion: "4.1.0", architecture: "arm64")
    #expect(throws: NSError.self) { try stable.validateSemanticUpdate(item("4.0.2")) }
    #expect(throws: NSError.self) {
      try stable.validateSemanticUpdate(item("4.1.0", channel: "beta"))
    }
    try stable.validateSemanticUpdate(item("4.1.1"))
    let beta = NativeUpdateService(currentVersion: "4.2.0-beta.1", architecture: "arm64")
    #expect(throws: NSError.self) { try beta.validateSemanticUpdate(item("4.1.1")) }
    try beta.validateSemanticUpdate(item("4.2.0"))
  }

  @Test func automaticInstallOnQuitNeverRequestsARestartWhenCopiesFinish() throws {
    let service = NativeUpdateService(currentVersion: "4.0.0", architecture: "arm64")
    var busy = true
    var installations = 0
    service.hasActiveTransfers = { busy }
    let controller = SPUStandardUpdaterController(
      startingUpdater: false, updaterDelegate: nil, userDriverDelegate: nil)
    let item = try #require(
      SUAppcastItem(dictionary: [
        "title": "4.0.1",
        "enclosure": [
          "url": "https://github.com/aaditagrawal/openmtp/releases/download/v4.0.1/OpenMTP.zip",
          "sparkle:version": "2", "length": "1", "type": "application/octet-stream",
        ],
      ]))
    #expect(
      !service.updater(
        controller.updater, willInstallUpdateOnQuit: item,
        immediateInstallationBlock: { installations += 1 }))
    busy = false
    #expect(!service.resumeDeferredInstallationIfIdle())
    #expect(installations == 0)
  }

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
