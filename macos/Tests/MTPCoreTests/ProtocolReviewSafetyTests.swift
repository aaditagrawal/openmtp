import Foundation
import Testing

@testable import MTPCore
@testable import MTPSimulation

@Suite("Protocol review regressions")
struct ProtocolReviewSafetyTests {
  private func directory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "protocol-review-\(UUID())")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  @Test(arguments: ["20260101T000000Zjunk", "20260101T000000+0000junk"])
  func invalidDateSuffixCannotMakeSmartSyncSkipChangedBytes(date: String) throws {
    let sim = SimulatedDevice()
    sim.add("file.txt", contents: Data("new".utf8), modified: date)
    let device = try MTPDevice(transport: sim)
    let object = try #require(try device.children(storage: sim.storageID).first)
    let local = try directory()
    defer { try? FileManager.default.removeItem(at: local) }
    let destination = local.appendingPathComponent("file.txt")
    try Data("old".utf8).write(to: destination)
    let modified = try #require(MTPDate.parse("20260101T000000Z"))
    try FileManager.default.setAttributes(
      [.modificationDate: modified], ofItemAtPath: destination.path)
    let plan = try device.planDownload([object], to: local)
    let result = try device.execute(plan, policy: .smartSync)
    #expect(result.copiedFiles == 1)
    #expect(try Data(contentsOf: destination) == Data("new".utf8))
  }

  @Test func objectInfoListingsReuseMetadataAndKeepStorageAndParentScope() throws {
    let sim = SimulatedDevice()
    let first = sim.add("First", directory: true)
    let second = sim.add("Second", directory: true)
    let rootFile = sim.add("root.txt")
    let wanted = sim.add("wanted.txt", parent: first)
    sim.add("elsewhere.txt", parent: second)
    let otherStorage = sim.add("another-storage.txt", parent: first)
    sim.objectInfoStorageIDs[otherStorage] = 0x0002_0001
    sim.objectHandlesAllObjects = true
    let device = try MTPDevice(transport: sim)
    device.listingStrategy = .objectInfo
    #expect(try device.children(storage: sim.storageID, parent: first).map(\.handle) == [wanted])
    #expect(
      Set(try device.children(storage: sim.storageID).map(\.handle)) == [first, second, rootFile])
    #expect(sim.operationCounts[.getObjectInfo] == sim.nodes.count * 2)
    #expect(sim.operationCounts[.getObjectHandles] == 2)
    #expect(try device.object(rootFile, fallbackParent: first).parent == MTPHandle.root)
    #expect(sim.violations.isEmpty)
  }

  @Test(arguments: ["", ".", "..", "nested/file", "name\0suffix"])
  func invalidMutationNamesNeverReachThePhone(name: String) throws {
    let sim = SimulatedDevice()
    let handle = sim.add("keep.txt")
    let device = try MTPDevice(transport: sim)
    let object = try device.object(handle)
    #expect(throws: MTPError.self) { try device.rename(object, to: name) }
    #expect(throws: MTPError.self) {
      _ = try device.makeDirectory(name, storage: sim.storageID)
    }
    let local = try directory()
    defer { try? FileManager.default.removeItem(at: local) }
    let source = local.appendingPathComponent("source.txt")
    try Data("payload".utf8).write(to: source)
    #expect(throws: MTPError.self) {
      _ = try device.upload(source, storage: sim.storageID, name: name)
    }
    #expect(sim.nodes[handle]?.name == "keep.txt")
    #expect(sim.operationCounts[.setObjectPropValue, default: 0] == 0)
    #expect(sim.operationCounts[.sendObjectInfo, default: 0] == 0)
    #expect(!device.session.isBroken)
  }

  @Test func descriptorOpenRejectsASymlinkInstalledAfterPreflight() throws {
    let local = try directory()
    defer { try? FileManager.default.removeItem(at: local) }
    let source = local.appendingPathComponent("selected.txt")
    let privateFile = local.appendingPathComponent("private.txt")
    try Data("selected".utf8).write(to: source)
    try Data("private contents".utf8).write(to: privateFile)
    try UploadPreflight.validate([source])
    try FileManager.default.removeItem(at: source)
    try FileManager.default.createSymbolicLink(at: source, withDestinationURL: privateFile)
    #expect(throws: MTPError.self) { _ = try UploadPreflight.openRegularFile(source) }
    let sim = SimulatedDevice()
    let device = try MTPDevice(transport: sim)
    #expect(throws: MTPError.self) { _ = try device.upload(source, storage: sim.storageID) }
    #expect(sim.nodes.isEmpty)
    #expect(sim.operationCounts[.sendObjectInfo, default: 0] == 0)
  }

  @Test func uploadKeepsDescriptorBytesAndMetadataWhenThePathIsReplaced() throws {
    let local = try directory()
    defer { try? FileManager.default.removeItem(at: local) }
    let source = local.appendingPathComponent("selected.txt")
    let original = local.appendingPathComponent("original.txt")
    let privateFile = local.appendingPathComponent("private.txt")
    let payload = Data("selected bytes".utf8)
    try payload.write(to: source)
    try Data("different private contents".utf8).write(to: privateFile)
    let modified = Date(timeIntervalSince1970: 1_790_000_000)
    try FileManager.default.setAttributes([.modificationDate: modified], ofItemAtPath: source.path)
    let sim = SimulatedDevice()
    let device = try MTPDevice(transport: sim)
    let handle = try device.upload(
      source, storage: sim.storageID,
      onCreated: { _ in
        try! FileManager.default.moveItem(at: source, to: original)
        try! FileManager.default.createSymbolicLink(at: source, withDestinationURL: privateFile)
      })
    #expect(sim.nodes[handle]?.contents == payload)
    #expect(sim.nodes[handle]?.modified == MTPDate.format(modified))
    #expect(sim.violations.isEmpty)
  }
}
