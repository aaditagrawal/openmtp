import Foundation
import Testing

@testable import OpenMTPMac

private actor ExportDownloadGate {
  private var started = false
  private var releaseContinuation: CheckedContinuation<Void, Never>?
  private var startContinuation: CheckedContinuation<Void, Never>?
  func suspend() async {
    await withCheckedContinuation { continuation in
      releaseContinuation = continuation
      started = true
      startContinuation?.resume()
      startContinuation = nil
    }
  }
  func waitUntilStarted() async {
    if started { return }
    await withCheckedContinuation { startContinuation = $0 }
  }
  func release() {
    releaseContinuation?.resume()
    releaseContinuation = nil
  }
}

@Suite("Native export lifecycle")
@MainActor
struct ExportLifecycleTests {
  private func directory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "export-lifecycle-\(UUID())")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }
  private func request(_ gate: ExportDownloadGate) -> NativeFileIntegration.RemoteFile {
    NativeFileIntegration.RemoteFile(
      name: "preview.jpg", isDirectory: false, identity: "test:preview", byteCount: 3
    ) { directory, _ in
      await gate.suspend()
      let result = directory.appendingPathComponent("preview.jpg")
      try Data([1, 2, 3]).write(to: result)
      return result
    }
  }

  @Test func fulfillmentIsActiveUntilThePromisedFileCommits() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = NativeExportStore(root: root.appendingPathComponent("cache"))
    let integration = NativeFileIntegration(store: store)
    let gate = ExportDownloadGate()
    let file = request(gate)
    let destination = root.appendingPathComponent("Finder name.jpg")
    let task = Task {
      try await store.fulfill(file, at: destination, progress: Progress(totalUnitCount: 3))
    }
    await gate.waitUntilStarted()
    #expect(integration.hasActiveTransfers)
    #expect(!FileManager.default.fileExists(atPath: destination.path))
    await gate.release()
    try await task.value
    #expect(!integration.hasActiveTransfers)
    #expect(try Data(contentsOf: destination) == Data([1, 2, 3]))
  }

  @Test func closingAnInFlightPreviewCancelsAndCleansItsCache() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let integration = NativeFileIntegration(store: NativeExportStore(root: root))
    let gate = ExportDownloadGate()
    let file = request(gate)
    let task = Task { try await integration.preview(remoteFiles: [file]) }
    await gate.waitUntilStarted()
    #expect(integration.isPreviewLoading && integration.hasActiveTransfers)
    integration.closePreview()
    #expect(!integration.isPreviewLoading && integration.hasActiveTransfers)
    await gate.release()
    await #expect(throws: CancellationError.self) { try await task.value }
    #expect(!integration.hasActiveTransfers)
    #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
  }

  @Test func aNewLocalPreviewSupersedesTheOlderRemoteRequest() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let integration = NativeFileIntegration(store: NativeExportStore(root: root))
    let gate = ExportDownloadGate()
    let file = request(gate)
    let task = Task { try await integration.preview(remoteFiles: [file]) }
    await gate.waitUntilStarted()
    // Empty local selection avoids opening a panel in the test runner while
    // exercising the same cancellation path as a newly selected local file.
    integration.preview(localURLs: [])
    await gate.release()
    await #expect(throws: CancellationError.self) { try await task.value }
    #expect(!integration.isPreviewLoading && !integration.hasActiveTransfers)
    #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
  }
}
