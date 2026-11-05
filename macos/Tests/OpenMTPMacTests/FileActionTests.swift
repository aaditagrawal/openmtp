import Foundation
import MTPCore
import Testing

@testable import MTPSimulation
@testable import OpenMTPMac

@Suite("Native file actions")
@MainActor
struct FileActionTests {
  private func model(_ sim: SimulatedDevice) async throws -> AppModel {
    let model = AppModel(
      client: MTPClient(device: try MTPDevice(transport: sim)), storage: sim.storageID)
    await model.reload()
    return model
  }

  @Test func confirmationUsesCapturedSelection() async throws {
    let sim = SimulatedDevice()
    let a = sim.add("first.txt")
    let b = sim.add("second.txt")
    let model = try await model(sim)
    model.selection = [a]
    model.requestDeletion()
    let request = try #require(model.pendingDeletion)
    #expect(request.title.contains("first.txt"))
    #expect(request.message.contains("permanently deleted"))
    #expect(sim.operationCounts[.deleteObject, default: 0] == 0)
    model.selection = [b]
    await model.confirmDeletion(request)
    #expect(sim.nodes[a] == nil)
    #expect(sim.nodes[b] != nil)
    #expect(model.selection == [b])
  }

  @Test func contextMenuUsesContextItemsAndCancelDoesNothing() async throws {
    let sim = SimulatedDevice()
    let a = sim.add("selected")
    let b = sim.add("context clicked")
    let model = try await model(sim)
    model.selection = [a]
    model.requestDeletion([b])
    #expect(model.pendingDeletion?.objects.map(\.id) == [b])
    model.pendingDeletion = nil  // The alert's Cancel/dismiss action.
    #expect(sim.operationCounts[.deleteObject, default: 0] == 0)
    #expect(sim.nodes.count == 2)
  }

  @Test func navigationChangeCancelsCapturedDeletion() async throws {
    let sim = SimulatedDevice()
    let a = sim.add("file")
    let folder = sim.add("folder", directory: true)
    let model = try await model(sim)
    model.requestDeletion([a])
    let request = try #require(model.pendingDeletion)
    model.open(try #require(model.entries.first { $0.id == folder }))
    await model.confirmDeletion(request)
    #expect(sim.nodes[a] != nil)
    #expect(sim.operationCounts[.deleteObject, default: 0] == 0)
    #expect(model.errorMessage?.contains("cancelled") == true)
  }

  @Test func navigationChangeCancelsRenameAndFolderCreation() async throws {
    let sim = SimulatedDevice()
    let file = sim.add("original.txt")
    let folder = sim.add("folder", directory: true)
    let model = try await model(sim)
    model.activePane = .phone
    model.selection = [file]
    model.beginRename()
    model.browser.renameText = "renamed.txt"
    model.beginNewFolder()
    model.browser.newFolderName = "New Folder"
    model.open(try #require(model.entries.first { $0.id == folder }))
    model.commitRename()
    #expect(model.errorMessage?.contains("cancelled") == true)
    #expect(sim.nodes[file]?.name == "original.txt")
    model.errorMessage = nil
    model.commitNewFolder()
    #expect(model.errorMessage?.contains("cancelled") == true)
    #expect(sim.operationCounts[.sendObjectInfo, default: 0] == 0)
  }

  @Test func differentConnectionCannotReuseCapturedHandles() async throws {
    let firstSim = SimulatedDevice()
    let secondSim = SimulatedDevice()
    let a = firstSim.add("first phone")
    let b = secondSim.add("second phone")
    #expect(a == b)
    let first = try await model(firstSim)
    let second = try await model(secondSim)
    first.requestDeletion([a])
    let request = try #require(first.pendingDeletion)
    await second.confirmDeletion(request)
    #expect(firstSim.nodes[a] != nil)
    #expect(secondSim.nodes[b] != nil)
    #expect(second.errorMessage?.contains("cancelled") == true)
  }

  @Test func modifiedSortUsesDatesInBothDirections() async throws {
    let sim = SimulatedDevice()
    let newest = sim.add("a-new", modified: "20260101T000000Z")
    let oldest = sim.add("z-old", modified: "20200101T000000Z")
    let unknown = sim.add("middle", modified: "invalid")
    let folder = sim.add("folder", directory: true)
    let model = try await model(sim)
    model.sortOrder = [KeyPathComparator(\MTPObject.modified, order: .forward)]
    #expect(model.sortedEntries.map(\.id) == [folder, unknown, oldest, newest])
    model.sortOrder = [KeyPathComparator(\MTPObject.modified, order: .reverse)]
    #expect(model.sortedEntries.map(\.id) == [folder, newest, oldest, unknown])
  }

  @Test func invalidSelectionIsRejectedBeforeAnyUpload() async throws {
    let sim = SimulatedDevice()
    let model = try await model(sim)
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(
      "upload-selection-\(UUID())")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let file = dir.appendingPathComponent("regular.txt")
    try Data([1]).write(to: file)
    let folder = dir.appendingPathComponent("folder", isDirectory: false)  // No trailing slash.
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
    #expect(!folder.hasDirectoryPath)
    // Recursive mixed file/folder selections now use the tree planner.
    #expect(throws: MTPError.self) {
      try MTPDevice(transport: SimulatedDevice()).upload(folder, storage: sim.storageID)
    }

    let link = dir.appendingPathComponent("folder-link")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: folder)
    #expect(!model.upload([file, link]))
    #expect(!model.upload([file, dir.appendingPathComponent("missing")]))
    #expect(model.transfers.isEmpty)
    #expect(sim.operationCounts[.sendObjectInfo, default: 0] == 0)
    try UploadPreflight.validate([file])
  }
}
