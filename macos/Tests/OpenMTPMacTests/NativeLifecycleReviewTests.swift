import AppKit
import Foundation
import MTPCore
import Testing
import UniformTypeIdentifiers

@testable import MTPSimulation
@testable import OpenMTPMac

private actor ReviewDownloadGate {
  private var started = false
  private var start: CheckedContinuation<Void, Never>?
  private var finish: CheckedContinuation<Void, Never>?
  func suspend() async {
    await withCheckedContinuation { continuation in
      finish = continuation
      started = true
      start?.resume()
      start = nil
    }
  }
  func waitUntilStarted() async {
    if started { return }
    await withCheckedContinuation { start = $0 }
  }
  func signalStarted() {
    started = true
    start?.resume()
    start = nil
  }
  func release() {
    finish?.resume()
    finish = nil
  }
}

private final class ReviewUploadTransport: MTPTransport, @unchecked Sendable {
  let device = SimulatedDevice()
  private let lock = NSLock()
  private let gate = DispatchSemaphore(value: 0)
  private var started = false
  var payloadStarted: Bool {
    lock.lock()
    defer { lock.unlock() }
    return started
  }
  var maxPacketSize: Int { device.maxPacketSize }
  func bulkRead(maxLength: Int, timeout: TimeInterval) throws -> Data {
    try device.bulkRead(maxLength: maxLength, timeout: timeout)
  }
  func bulkWrite(_ data: Data, timeout: TimeInterval) throws {
    try device.bulkWrite(data, timeout: timeout)
    guard data.count >= 12 else { return }
    var reader = ByteReader(data)
    _ = try reader.u32()
    guard try reader.u16() == ContainerType.data.rawValue,
      try reader.u16() == OperationCode.sendObject.rawValue
    else { return }
    lock.lock()
    started = true
    lock.unlock()
    if gate.wait(timeout: .now() + 5) == .timedOut { throw MTPError.timeout }
  }
  func release() { gate.signal() }
  func close() { device.close() }
}

@Suite("Native review lifecycle regressions")
@MainActor
struct NativeLifecycleReviewTests {
  private struct WaitExpired: Error {}
  private func directory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "native-review-\(UUID())")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url.standardizedFileURL.resolvingSymlinksInPath()
  }
  private func waitUntil(_ condition: () -> Bool) async throws {
    let deadline = ProcessInfo.processInfo.systemUptime + 10
    while !condition() {
      if ProcessInfo.processInfo.systemUptime > deadline { throw WaitExpired() }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
  }
  private func file(_ name: String, bytes: Data = Data([1, 2, 3]), in directory: URL) throws -> URL
  {
    let url = directory.appendingPathComponent(name)
    try bytes.write(to: url)
    return url
  }
  private func provider(_ url: URL, name: String? = nil) -> NSItemProvider {
    let provider = NSItemProvider()
    provider.suggestedName = name ?? url.lastPathComponent
    provider.registerFileRepresentation(
      forTypeIdentifier: UTType.data.identifier, fileOptions: [], visibility: .ownProcess
    ) {
      completion in
      completion(url, false, nil)
      return nil
    }
    return provider
  }
  private func model(
    _ sim: SimulatedDevice, integration: NativeFileIntegration, defaults: UserDefaults? = nil
  ) throws -> AppModel {
    AppModel(
      client: MTPClient(device: try MTPDevice(transport: sim)), storage: sim.storageID,
      settings: WorkspaceSettings(defaults: defaults), fileIntegration: integration)
  }
  private func remote(_ name: String, gate: ReviewDownloadGate? = nil, failing: Bool = false)
    -> NativeFileIntegration.RemoteFile
  {
    NativeFileIntegration.RemoteFile(
      name: name, isDirectory: false, identity: "review:\(name)", byteCount: 3
    ) {
      directory, _ in
      if let gate { await gate.suspend() }
      if failing { throw CocoaError(.fileReadUnknown) }
      let url = directory.appendingPathComponent(name)
      try Data([1, 2, 3]).write(to: url)
      return url
    }
  }

  @Test func pruningScansBeyondTheFirstThousandAndPreservesRetryOwnership() throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = NativeExportStore(root: root)
    for _ in 0..<1_030 { _ = try store.directory(identity: "old preview") }
    let owned = try store.incomingDirectory()
    let user = try file("keep-user-file", in: root)
    store.prune(olderThan: .distantFuture, preserving: [owned])
    #expect(
      Set(try FileManager.default.contentsOfDirectory(atPath: root.path)) == [
        owned.directory.lastPathComponent, user.lastPathComponent,
      ])
    #expect(store.ownsIncoming(owned))
  }

  @Test func memoryOnlyModelsDoNotRunStartupCacheMaintenance() throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = NativeExportStore(root: root)
    let stale = try store.directory(identity: "old preview")
    try FileManager.default.setAttributes(
      [.creationDate: Date().addingTimeInterval(-10 * 86400)], ofItemAtPath: stale.path)
    _ = try model(SimulatedDevice(), integration: NativeFileIntegration(store: store))
    #expect(FileManager.default.fileExists(atPath: stale.path))
  }

  @Test(arguments: [false, true])
  func unsuccessfulMultiFilePreviewsRemoveEarlierMaterializations(cancelled: Bool) async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let integration = NativeFileIntegration(store: NativeExportStore(root: root))
    let gate = ReviewDownloadGate()
    let task = Task {
      try await integration.preview(remoteFiles: [
        remote("first.jpg"), remote("second.jpg", gate: gate, failing: !cancelled),
      ])
    }
    await gate.waitUntilStarted()
    #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).count == 2)
    if cancelled { integration.closePreview() }
    await gate.release()
    do {
      try await task.value
      Issue.record("The preview should have failed or been cancelled")
    } catch {}
    #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
  }

  @Test func completedProviderUploadsRemoveOnlyTheirOwnedCopies() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let original = try file("source.bin", in: root)
    let cache = root.appendingPathComponent("cache")
    let integration = NativeFileIntegration(store: NativeExportStore(root: cache))
    let sim = SimulatedDevice()
    let model = try model(sim, integration: integration)
    #expect(model.receiveDrop([provider(original, name: "copy.bin")], into: .phone))
    try await waitUntil { model.transfers.first?.state == .completed && !model.hasInFlightWork }
    #expect(sim.children(of: 0).first { $0.name == "copy.bin" }?.contents == Data([1, 2, 3]))
    #expect(model.transfers.first?.ownedIncoming == nil)
    #expect(try FileManager.default.contentsOfDirectory(atPath: cache.path).isEmpty)
    #expect(try Data(contentsOf: original) == Data([1, 2, 3]))
  }

  @Test func rejectedProviderCopiesAreRemovedWithoutFollowingTheirLinks() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let original = try file("original", in: root)
    let link = root.appendingPathComponent("source-link")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: original)
    let cache = root.appendingPathComponent("cache")
    let integration = NativeFileIntegration(store: NativeExportStore(root: cache))
    let sim = SimulatedDevice()
    let model = try model(sim, integration: integration)
    #expect(model.receiveDrop([provider(link)], into: .phone))
    try await waitUntil { !model.dropInProgress }
    #expect(model.transfers.isEmpty && sim.nodes.isEmpty)
    #expect(model.errorMessage?.contains("Nothing was uploaded") == true)
    #expect(try FileManager.default.contentsOfDirectory(atPath: cache.path).isEmpty)
    #expect(try Data(contentsOf: original) == Data([1, 2, 3]))
  }

  @Test(arguments: [false, true])
  func retryableProviderJobsKeepPersistedSourcesUntilSuccessfulRetry(cancelled: Bool) async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let original = try file("source.bin", in: root)
    let cache = root.appendingPathComponent("cache")
    let store = NativeExportStore(root: cache)
    let integration = NativeFileIntegration(store: store)
    let suite = "openmtp.native-review.\(UUID())"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let sim = SimulatedDevice()
    if cancelled {
      sim.add("copy.bin", contents: Data([9]))
    } else {
      sim.forcedResponses[.sendObject] = .accessDenied
    }
    let model = try model(sim, integration: integration, defaults: defaults)
    #expect(model.receiveDrop([provider(original, name: "copy.bin")], into: .phone))
    if cancelled {
      try await waitUntil { model.pendingConflict != nil }
      model.cancelTransfer(try #require(model.transfers.first?.id))
    }
    let expected = cancelled ? AppModel.Transfer.State.cancelled : .failed
    try await waitUntil { model.transfers.first?.state == expected && !model.hasInFlightWork }
    let owner = try #require(model.transfers.first?.ownedIncoming?.first)
    #expect(store.ownsIncoming(owner))
    let savedSource = try #require(model.transfers.first?.sourcePaths.first)
    #expect(try Data(contentsOf: URL(fileURLWithPath: savedSource)) == Data([1, 2, 3]))
    try FileManager.default.setAttributes(
      [.creationDate: Date().addingTimeInterval(-10 * 86400)], ofItemAtPath: owner.directory.path)
    let restored = AppModel(
      settings: WorkspaceSettings(defaults: defaults), fileIntegration: integration)
    #expect(restored.transfers.first?.state == expected)
    #expect(restored.transfers.first?.ownedIncoming?.first == owner)
    #expect(store.ownsIncoming(owner))
    sim.forcedResponses[.sendObject] = nil
    let job = try #require(model.transfers.first)
    model.retryTransfer(job.id)
    if cancelled {
      try await waitUntil { model.pendingConflict != nil }
      model.resolveConflict(.replace)
    }
    try await waitUntil { model.transfers.first?.state == .completed && !model.hasInFlightWork }
    #expect(!FileManager.default.fileExists(atPath: owner.directory.path))
    #expect(sim.children(of: 0).first { $0.name == "copy.bin" }?.contents == Data([1, 2, 3]))
    #expect(try Data(contentsOf: original) == Data([1, 2, 3]))
  }

  @Test func temporaryLookingUserSourcesNeverGrantCleanupOwnership() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let userDirectory = root.appendingPathComponent(".openmtp-export-0123456789abcdef-\(UUID())")
    try FileManager.default.createDirectory(at: userDirectory, withIntermediateDirectories: false)
    let userFile = try file("user.bin", in: userDirectory)
    let store = NativeExportStore(root: root.appendingPathComponent("cache"))
    #expect(
      store.cleanupIncoming([NativeIncomingOwnership(directory: userDirectory, identifier: UUID())])
        .isEmpty)
    let sim = SimulatedDevice()
    let model = try model(sim, integration: NativeFileIntegration(store: store))
    #expect(model.upload([userFile]))
    try await waitUntil { model.transfers.first?.state == .completed && !model.hasInFlightWork }
    #expect(try Data(contentsOf: userFile) == Data([1, 2, 3]))
    #expect(model.transfers.first?.ownedIncoming == nil)
  }

  @Test func quitWaitsForCancelledFinderExportCleanup() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let destination = root.appendingPathComponent("Finder copy.jpg")
    let store = NativeExportStore(root: root.appendingPathComponent("cache"))
    let integration = NativeFileIntegration(store: store)
    let model = try model(SimulatedDevice(), integration: integration)
    let gate = ReviewDownloadGate()
    let export = Task {
      try await store.fulfill(
        remote("source.jpg", gate: gate), at: destination, progress: Progress())
    }
    await gate.waitUntilStarted()
    let quit = Task { await model.prepareForTermination(timeout: 5) }
    try await waitUntil { model.isTerminating }
    #expect(model.hasInFlightWork && integration.hasActiveTransfers)
    await gate.release()
    do {
      try await export.value
      Issue.record("The cancelled export should not commit")
    } catch {}
    #expect(await quit.value)
    #expect(!model.hasInFlightWork && !integration.hasActiveTransfers)
    #expect(!FileManager.default.fileExists(atPath: destination.path))
    #expect(
      !(try FileManager.default.contentsOfDirectory(atPath: root.path)).contains {
        $0.hasPrefix(".openmtp-export-")
      })
  }

  @Test func quitCancelsConflictsAndNeverWaitsForQueuedJobs() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let first = try file("existing.bin", in: root)
    let second = try file("queued.bin", in: root)
    let sim = SimulatedDevice()
    let old = sim.add("existing.bin", contents: Data("original".utf8))
    let model = try model(
      sim,
      integration: NativeFileIntegration(
        store: NativeExportStore(root: root.appendingPathComponent("cache"))))
    #expect(model.upload([first]))
    try await waitUntil { model.pendingConflict != nil }
    #expect(model.upload([second]))
    #expect(await model.prepareForTermination(timeout: 2))
    #expect(model.pendingConflict == nil && !model.hasInFlightWork)
    #expect(model.transfers.allSatisfy { $0.state == .cancelled })
    #expect(sim.operationCounts[.sendObject, default: 0] == 0)
    #expect(sim.nodes[old]?.contents == Data("original".utf8))
  }

  @Test func quitWaitsForTheUploadWorkerToPersistCancellationRecovery() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let fresh = try file("new.bin", bytes: Data(repeating: 1, count: 30_000), in: root)
    let transport = ReviewUploadTransport()
    transport.device.supportsFilenameRename = false
    let original = transport.device.add("original.bin", contents: Data([9]))
    let model = AppModel(
      client: MTPClient(device: try MTPDevice(transport: transport)),
      storage: transport.device.storageID, settings: WorkspaceSettings(defaults: nil),
      fileIntegration: NativeFileIntegration(
        store: NativeExportStore(root: root.appendingPathComponent("cache"))))
    #expect(model.upload([fresh]))
    try await waitUntil { transport.payloadStarted }
    let quit = Task { await model.prepareForTermination(timeout: 3) }
    try await waitUntil { model.isTerminating }
    #expect(model.hasInFlightWork)
    transport.release()
    #expect(await quit.value)
    #expect(!model.hasInFlightWork && model.transfers.first?.state == .cancelled)
    #expect(model.transfers.first?.error?.contains("Recovery copies:") == true)
    let saved = try #require(model.settings.store.data(forKey: "workspace.transferJobs"))
    let recovered = try JSONDecoder().decode([AppModel.Transfer].self, from: saved)
    #expect(
      recovered.first?.state == .cancelled
        && recovered.first?.error?.contains("Recovery copies:") == true)
    #expect(transport.device.nodes[original]?.contents == Data([9]))
  }

  @Test func quitCancelsAnIncomingProviderThatNeverCompletes() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let gate = ReviewDownloadGate()
    let provider = NSItemProvider()
    provider.suggestedName = "never-arrives.bin"
    provider.registerFileRepresentation(
      forTypeIdentifier: UTType.data.identifier, fileOptions: [], visibility: .ownProcess
    ) {
      _ in
      Task { await gate.signalStarted() }
      return Progress(totalUnitCount: 1)
    }
    let model = try model(
      SimulatedDevice(), integration: NativeFileIntegration(store: NativeExportStore(root: root)))
    #expect(model.receiveDrop([provider], into: .phone))
    await gate.waitUntilStarted()
    #expect(model.dropInProgress && model.hasInFlightWork)
    #expect(await model.prepareForTermination(timeout: 2))
    #expect(!model.dropInProgress && !model.hasInFlightWork)
    #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
  }

  @Test func aStalledExportCancelsQuitRatherThanExitingBeforeCleanup() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = NativeExportStore(root: root)
    let model = try model(SimulatedDevice(), integration: NativeFileIntegration(store: store))
    let gate = ReviewDownloadGate()
    let export = Task {
      try await store.materialize(remote("stalled.jpg", gate: gate), progress: Progress())
    }
    await gate.waitUntilStarted()
    #expect(!(await model.prepareForTermination(timeout: 0.03)))
    #expect(!model.isTerminating && model.hasInFlightWork)
    #expect(model.errorMessage?.contains("stayed open") == true)
    await gate.release()
    do {
      try await export.value
      Issue.record("The old export should remain cancelled")
    } catch {}
    #expect(!model.hasInFlightWork)
    let next = try await store.materialize(remote("next.jpg"), progress: Progress())
    #expect(try Data(contentsOf: next) == Data([1, 2, 3]))
  }

  @Test func hiddenMacPaneCannotKeepAnActiveDestructiveSelection() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let original = try file("keep.bin", in: root)
    let model = try model(
      SimulatedDevice(),
      integration: NativeFileIntegration(
        store: NativeExportStore(root: root.appendingPathComponent("cache"))))
    model.navigateLocal(to: root)
    try await waitUntil { model.localEntries.contains { $0.name == original.lastPathComponent } }
    model.activePane = .local
    model.localSelection = [
      try #require(model.localEntries.first { $0.name == original.lastPathComponent }?.id)
    ]
    model.settings.showLocalPane = false
    #expect(model.activePane == .phone && model.localSelection.isEmpty)
    model.activePane = .local
    #expect(model.activePane == .phone && model.activeSelectionCount == 0)
    model.requestActiveDeletion()
    #expect(model.pendingDeletion == nil && FileManager.default.fileExists(atPath: original.path))
  }

  @Test func gridContextActionsPreserveBothPanesSelectedSets() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let local = [try file("one.bin", in: root), try file("two.bin", in: root)]
    let sim = SimulatedDevice()
    let first = sim.add("one.bin")
    let second = sim.add("two.bin")
    let outside = sim.add("outside.bin")
    let model = try model(
      sim,
      integration: NativeFileIntegration(
        store: NativeExportStore(root: root.appendingPathComponent("cache"))))
    await model.reload()
    model.selection = [first, second]
    let targets = model.contextSelectionIDs(clicked: String(first), in: .phone)
    #expect(model.applyContextSelection(targets, in: .phone))
    model.requestActiveDeletion()
    #expect(Set(model.pendingDeletion?.objects.map(\.id) ?? []) == [first, second])
    model.pendingDeletion = nil
    #expect(
      model.applyContextSelection(
        model.contextSelectionIDs(clicked: String(outside), in: .phone), in: .phone))
    model.requestActiveDeletion()
    #expect(model.pendingDeletion?.objects.map(\.id) == [outside])
    model.navigateLocal(to: root)
    try await waitUntil {
      model.localEntries.filter { ["one.bin", "two.bin"].contains($0.name) }.count == 2
    }
    let listedLocal = model.localEntries.filter { local.map(\.lastPathComponent).contains($0.name) }
      .map(\.url)
    model.localSelection = Set(listedLocal)
    #expect(
      model.applyContextSelection(
        model.contextSelectionIDs(clicked: listedLocal[0].absoluteString, in: .local), in: .local))
    #expect(Set(model.selectedLocalFiles.map(\.name)) == ["one.bin", "two.bin"])
  }

  @Test func legacyMigrationCommitsTheWholeProfileAndKeepsExistingNativeValues() throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let legacy = root.appendingPathComponent("settings.json")
    let original = try JSONSerialization.data(withJSONObject: [
      "appThemeMode": "dark", "showLocalPane": true, "hideHiddenFiles": ["local": false],
      "enableBackgroundAutoUpdate": true,
    ])
    try original.write(to: legacy)
    let profile = root.appendingPathComponent("native-settings.json")
    try JSONSerialization.data(withJSONObject: ["workspace.showLocalPane": false]).write(
      to: profile)
    let store = WorkspacePreferenceStore(
      defaults: nil, legacyDirectory: root, profileDirectory: root)
    #expect(store.string(forKey: "workspace.appearance") == "dark")
    #expect(!store.bool(forKey: "workspace.showLocalPane"))
    #expect(
      store.bool(forKey: "workspace.showHiddenLocal")
        && store.bool(forKey: "workspace.autoInstallUpdates"))
    let saved = try #require(
      JSONSerialization.jsonObject(with: Data(contentsOf: profile)) as? [String: Any])
    #expect(
      saved["workspace.migrated"] as? Bool == true
        && saved["workspace.appearance"] as? String == "dark")
    #expect(saved["workspace.autoInstallUpdates"] as? Bool == true)
    #expect(try Data(contentsOf: legacy) == original)
  }
}
