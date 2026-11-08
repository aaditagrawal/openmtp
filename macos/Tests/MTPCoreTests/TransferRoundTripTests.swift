import Foundation
import Testing

@testable import MTPCore
@testable import MTPSimulation

/// Guards the per-file protocol cost of tree transfers and the safety checks that
/// replaced the dropped up-front revalidation.
@Suite("Tree transfer round trips")
struct TransferRoundTripTests {
  private func directory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "round-trips-\(UUID())", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private func delta(
    _ before: [OperationCode: Int], _ after: [OperationCode: Int], _ op: OperationCode
  )
    -> Int
  { after[op, default: 0] - before[op, default: 0] }

  @Test func newFileDownloadsUseOneObjectInfoEach() throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let sim = SimulatedDevice()
    let folder = sim.add("photos", directory: true)
    for i in 0..<20 { _ = sim.add("IMG_\(i).jpg", parent: folder, contents: Data([UInt8(i)])) }
    let device = try MTPDevice(transport: sim)
    let plan = try device.planDownload([try device.object(folder)], to: root)
    let before = sim.operationCounts
    let summary = try device.execute(plan, policy: .replace)
    #expect(summary.copiedFiles == 20)
    #expect(delta(before, sim.operationCounts, .getObject) == 20)
    // One revalidation per file before commit, plus one for the folder.
    #expect(delta(before, sim.operationCounts, .getObjectInfo) <= 22)
  }

  @Test func newFileUploadsListTheDestinationOncePerFile() throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let source = root.appendingPathComponent("photos", isDirectory: true)
    try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
    for i in 0..<20 {
      try Data([UInt8(i)]).write(to: source.appendingPathComponent("IMG_\(i).jpg"))
    }
    let sim = SimulatedDevice()
    let device = try MTPDevice(transport: sim)
    let plan = try device.planUpload([source], storage: sim.storageID)
    let before = sim.operationCounts
    let summary = try device.execute(plan, policy: .replace)
    #expect(summary.copiedFiles == 20)
    let listings =
      delta(before, sim.operationCounts, .getObjectPropList)
      + delta(before, sim.operationCounts, .getObjectHandles)
    // One commit-time namespace check per file, plus the folder's own check.
    #expect(listings <= 21)
    #expect(sim.nodes.values.filter { $0.name.hasPrefix(".openmtp-") }.isEmpty)
  }

  @Test func sourceRemovedAfterPlanningIsReportedAndNotCommitted() throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let sim = SimulatedDevice()
    let handle = sim.add("gone.jpg", contents: Data([1, 2, 3]))
    let device = try MTPDevice(transport: sim)
    let object = try device.object(handle)
    let plan = try device.planDownload([object], to: root)
    try device.delete(object)
    do {
      _ = try device.execute(plan, policy: .replace)
      Issue.record("The copy should fail")
    } catch TreeTransferError.sourceChanged {}
    #expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent("gone.jpg").path))
    let leftovers = try FileManager.default.contentsOfDirectory(atPath: root.path)
    #expect(leftovers.isEmpty)
  }

  @Test func nameTakenAfterPlanningKeepsTheOtherFile() throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let source = root.appendingPathComponent("photo.jpg")
    try Data([1, 2, 3]).write(to: source)
    let sim = SimulatedDevice()
    let device = try MTPDevice(transport: sim)
    let plan = try device.planUpload([source], storage: sim.storageID)
    let other = sim.add("photo.jpg", contents: Data([9]))
    do {
      _ = try device.execute(plan, policy: .replace)
      Issue.record("The copy should fail")
    } catch TreeTransferError.destinationChanged {}
    #expect(sim.nodes[other]?.contents == Data([9]))
    #expect(sim.nodes.values.filter { $0.name.hasPrefix(".openmtp-") }.isEmpty)
  }
}
