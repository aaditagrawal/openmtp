import Foundation
import Testing

@testable import OpenMTPMac

private final class DiscoveryRequestCounter: @unchecked Sendable {
  private let lock = NSLock()
  private var count = 0
  var value: Int {
    lock.lock()
    defer { lock.unlock() }
    return count
  }
  func record() {
    lock.lock()
    count += 1
    lock.unlock()
  }
}

private final class DiscoveryReleaseProtocol: URLProtocol, @unchecked Sendable {
  static let requests = DiscoveryRequestCounter()
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.requests.record()
    let response = HTTPURLResponse(
      url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data("[]".utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

@Suite("Beta discovery honors automatic check preferences")
@MainActor
struct NativeUpdateSchedulingTests {
  private func waitUntil(_ predicate: () -> Bool) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(5))
    while !predicate(), ContinuousClock.now < deadline {
      try await Task.sleep(for: .milliseconds(5))
    }
    try #require(predicate(), "The discovery request did not reach the expected state.")
  }

  @Test func disabledLaunchStartsNoRequestsAndEnablingStartsPeriodicRequests() async throws {
    let scheduler = NativePrereleaseDiscoveryScheduler(interval: .milliseconds(10))
    var requests = 0
    let refresh: @MainActor @Sendable () async -> Void = {
      requests += 1
      await Task.yield()
    }
    scheduler.configure(
      automaticallyChecks: false, includePrereleases: true, isConfigured: true, refresh: refresh)
    try await Task.sleep(for: .milliseconds(40))
    #expect(requests == 0)
    scheduler.configure(
      automaticallyChecks: true, includePrereleases: true, isConfigured: true, refresh: refresh)
    try await waitUntil { requests >= 2 }
    scheduler.configure(
      automaticallyChecks: false, includePrereleases: true, isConfigured: true, refresh: refresh)
    let stoppedAt = requests
    try await Task.sleep(for: .milliseconds(40))
    #expect(requests == stoppedAt)
  }

  @Test func disablingCancelsAnInflightRefreshWithoutRestartingUnchangedPreferences() async throws {
    let scheduler = NativePrereleaseDiscoveryScheduler(interval: .milliseconds(10))
    var requests = 0
    var cancellations = 0
    let refresh: @MainActor @Sendable () async -> Void = {
      requests += 1
      do { try await Task.sleep(for: .seconds(3600)) } catch { cancellations += 1 }
    }
    scheduler.configure(
      automaticallyChecks: true, includePrereleases: true, isConfigured: true, refresh: refresh)
    try await waitUntil { requests == 1 }
    scheduler.configure(
      automaticallyChecks: true, includePrereleases: true, isConfigured: true, refresh: refresh)
    try await Task.sleep(for: .milliseconds(30))
    #expect(requests == 1 && cancellations == 0)
    scheduler.configure(
      automaticallyChecks: false, includePrereleases: true, isConfigured: true, refresh: refresh)
    try await waitUntil { cancellations == 1 }
    try await Task.sleep(for: .milliseconds(30))
    #expect(requests == 1)
  }

  @Test func explicitCheckStillMakesItsReleaseRequestWithAutomaticChecksDisabled() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [DiscoveryReleaseProtocol.self]
    let session = URLSession(configuration: configuration)
    defer { session.invalidateAndCancel() }
    let service = NativeUpdateService(
      currentVersion: "4.0.0-beta.1", architecture: "arm64", session: session)
    service.start(
      automaticallyChecks: false, automaticallyInstalls: false, includePrereleases: true)
    let before = DiscoveryReleaseProtocol.requests.value
    await service.check(includePrereleases: true)
    #expect(DiscoveryReleaseProtocol.requests.value == before + 1)
    #expect(service.state == .upToDate)
  }
}
