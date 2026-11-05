import Foundation
import MTPCore
import Testing

@testable import MTPSimulation
@testable import OpenMTPMac

private final class SlowQueueUploadTransport: MTPTransport {
  let device = SimulatedDevice()
  private let lock = NSLock()
  private var writes = 0
  private var streaming = false
  var streamedWrites: Int {
    lock.lock()
    defer { lock.unlock() }
    return writes
  }
  var maxPacketSize: Int { device.maxPacketSize }
  func bulkRead(maxLength: Int, timeout: TimeInterval) throws -> Data {
    try device.bulkRead(maxLength: maxLength, timeout: timeout)
  }
  func bulkWrite(_ data: Data, timeout: TimeInterval) throws {
    if data.count >= 12 {
      var reader = ByteReader(data)
      _ = try reader.u32()
      if try reader.u16() == ContainerType.data.rawValue,
        try reader.u16() == OperationCode.sendObject.rawValue
      {
        streaming = true
      }
    }
    try device.bulkWrite(data, timeout: timeout)
    if streaming {
      lock.lock()
      writes += 1
      lock.unlock()
      // Give MainActor time to press Cancel after bytes actually enter
      // the transport, rather than canceling only a queued async task.
      Thread.sleep(forTimeInterval: 0.003)
    }
  }
  func close() { device.close() }
}

@Suite("Native transfer queue")
@MainActor
struct TransferQueueTests {
  private func directory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "transfer-queue-\(UUID())")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }
  private func file(_ name: String, in directory: URL, data: Data = Data("new".utf8)) throws -> URL
  {
    let url = directory.appendingPathComponent(name)
    try data.write(to: url)
    return url
  }
  private func waitUntil(_ predicate: () -> Bool) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(5))
    while !predicate(), ContinuousClock.now < deadline {
      try await Task.sleep(for: .milliseconds(5))
    }
    try #require(predicate(), "The transfer queue did not reach the expected state.")
  }

  @Test func conflictCancellationDrainsBeforeRetryAndNeverTouchesOriginal() async throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let local = try file("same.txt", in: source)
    let sim = SimulatedDevice()
    let original = sim.add("same.txt", contents: Data("original".utf8))
    let model = AppModel(
      client: MTPClient(device: try MTPDevice(transport: sim)), storage: sim.storageID,
      settings: WorkspaceSettings(defaults: nil))
    #expect(model.upload([local]))
    try await waitUntil { model.pendingConflict != nil }
    let job = try #require(model.transfers.first)
    #expect(!model.canRetryTransfer(job.id))
    model.retryTransfer(job.id)
    #expect(model.transfers.first?.state == .waiting)
    model.cancelTransfer(job.id)
    model.cancelTransfer(job.id)
    #expect(model.transfers.first?.state == .cancelling)
    #expect(!model.canRetryTransfer(job.id))
    model.clearFinishedTransfers()
    #expect(model.transfers.count == 1)
    model.retryTransfer(job.id)
    #expect(model.transfers.first?.state == .cancelling)
    try await waitUntil { model.transfers.first?.state == .cancelled }
    #expect(model.canRetryTransfer(job.id))
    #expect(sim.nodes[original]?.contents == Data("original".utf8))
    #expect(sim.operationCounts[.sendObjectInfo, default: 0] == 0)

    model.retryTransfer(job.id)
    try await waitUntil { model.pendingConflict?.jobID == job.id }
    model.resolveConflict(.skip)
    try await waitUntil { model.transfers.first?.state == .completed }
    let finished = try #require(model.transfers.first)
    #expect(finished.completedFiles == 1 && finished.skippedFiles == 1)
    #expect(finished.done == 0 && finished.total == 0)
    #expect(sim.nodes[original]?.contents == Data("original".utf8))
  }

  @Test func cancelingConflictAllowsNextQueuedJobToComplete() async throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let first = try file("same.txt", in: source)
    let second = try file("second.txt", in: source)
    let sim = SimulatedDevice()
    let original = sim.add("same.txt", contents: Data("original".utf8))
    let model = AppModel(
      client: MTPClient(device: try MTPDevice(transport: sim)), storage: sim.storageID,
      settings: WorkspaceSettings(defaults: nil))
    #expect(model.upload([first]) && model.upload([second]))
    try await waitUntil { model.pendingConflict != nil }
    model.resolveConflict(nil)
    try await waitUntil { model.transfers.count == 2 && model.transfers.allSatisfy(\.finished) }
    #expect(model.transfers.map(\.state) == [.cancelled, .completed])
    #expect(sim.nodes[original]?.contents == Data("original".utf8))
    #expect(sim.children(of: 0).first { $0.name == "second.txt" }?.contents == Data("new".utf8))
    #expect(sim.violations.isEmpty)
  }

  @Test func healthyPreflightFailureDoesNotBlockNextJob() async throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let removed = try file("removed.txt", in: source)
    let valid = try file("valid.txt", in: source)
    let sim = SimulatedDevice()
    let model = AppModel(
      client: MTPClient(device: try MTPDevice(transport: sim)), storage: sim.storageID,
      settings: WorkspaceSettings(defaults: nil))
    #expect(model.upload([removed]) && model.upload([valid]))
    try FileManager.default.removeItem(at: removed)
    try await waitUntil { model.transfers.count == 2 && model.transfers.allSatisfy(\.finished) }
    #expect(model.transfers.map(\.state) == [.failed, .completed])
    #expect(model.connection == .connected)
    #expect(sim.children(of: 0).map(\.name) == ["valid.txt"])
  }

  @Test func streamingCancellationDisconnectsAndPreservesQueuedJobForRetry() async throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let first = try file("large.bin", in: source, data: Data(repeating: 4, count: 100_000))
    let next = try file("next.txt", in: source)
    let transport = SlowQueueUploadTransport()
    let device = try MTPDevice(transport: transport)
    device.session.transferSize = 1024
    let model = AppModel(
      client: MTPClient(device: device), storage: transport.device.storageID,
      settings: WorkspaceSettings(defaults: nil))
    #expect(model.upload([first]) && model.upload([next]))
    try await waitUntil { transport.streamedWrites > 0 }
    let id = try #require(model.transfers.first?.id)
    model.cancelTransfer(id)
    try await waitUntil {
      model.connection == .noDevice && model.transfers.first?.state == .cancelled
    }
    #expect(device.session.isBroken)
    #expect(model.transfers.last?.state == .waiting)
    #expect(model.transfers.last?.error?.contains("Reconnect") == true)
    #expect(model.transfers.first?.error?.contains("Recovery copies") == true)
    #expect(
      !transport.device.nodes.values.contains { $0.name == "next.txt" || $0.name == "large.bin" })
  }

  @Test func disconnectDuringConflictNeverExecutesTheCapturedPlan() async throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let local = try file("same.txt", in: source)
    let sim = SimulatedDevice()
    let original = sim.add("same.txt", contents: Data("original".utf8))
    let model = AppModel(
      client: MTPClient(device: try MTPDevice(transport: sim)), storage: sim.storageID,
      settings: WorkspaceSettings(defaults: nil))
    #expect(model.upload([local]))
    try await waitUntil { model.pendingConflict != nil }
    await model.disconnect()
    model.resolveConflict(.replace)
    try await waitUntil { model.transfers.first?.finished == true }
    #expect(model.transfers.first?.state == .cancelled)
    #expect(sim.nodes[original]?.contents == Data("original".utf8))
    #expect(sim.operationCounts[.sendObjectInfo, default: 0] == 0)
  }

  @Test func confirmedExtrasCleanupSurvivesLateSheetDismissal() async throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let folder = source.appendingPathComponent("Folder")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
    _ = try file("new.txt", in: folder)
    let sim = SimulatedDevice()
    let remoteFolder = sim.add("Folder", directory: true)
    let extra = sim.add("extra.txt", parent: remoteFolder, contents: Data([1]))
    let model = AppModel(
      client: MTPClient(device: try MTPDevice(transport: sim)), storage: sim.storageID,
      settings: WorkspaceSettings(defaults: nil))
    #expect(model.upload([folder]))
    try await waitUntil { model.pendingConflict?.extrasCount == 1 }
    model.resolveConflict(.smartSync, removeExtras: true)
    model.resolveConflict(nil)  // SwiftUI's sheet-dismiss binding can arrive late.
    try await waitUntil { model.transfers.first?.finished == true }
    #expect(model.transfers.first?.state == .completed)
    #expect(sim.nodes[extra] == nil)
    #expect(
      sim.children(of: remoteFolder).first { $0.name == "new.txt" }?.contents == Data("new".utf8))
  }
}
