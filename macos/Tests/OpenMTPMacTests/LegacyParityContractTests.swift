import Foundation
import MTPCore
import Testing

@testable import MTPSimulation

private struct LegacySmartSyncFixture: Decodable {
  struct Case: Decodable {
    let name: String
    let direction: String
    let localTimestamp: Double
    let remoteTimestamp: String
    let sourceSize: Int
    let destinationSize: Int?
    let copies: Bool
  }
  struct Tree: Decodable {
    let sourceFiles: [String]
    let emptyDirectories: [String]
    let destinationOnlyFiles: [String]
  }
  let baselineCommit: String
  let sources: [String]
  let cases: [Case]
  let tree: Tree

  static func load() throws -> Self {
    let url = try #require(
      Bundle.module.url(
        forResource: "legacy-smart-sync", withExtension: "json", subdirectory: "Fixtures"))
    return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
  }
}

@Suite("Preserved Electron transfer contracts")
struct LegacyParityContractTests {
  private func directory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "legacy-parity-\(UUID())")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  @Test func legacyTimestampDecisionsDriveActualNativeTransfers() throws {
    let fixture = try LegacySmartSyncFixture.load()
    for item in fixture.cases {
      let directory = try directory()
      defer { try? FileManager.default.removeItem(at: directory) }
      let local = directory.appendingPathComponent("photo.jpg")
      let source = Data(repeating: 0x53, count: item.sourceSize)
      let old = item.destinationSize.map { Data(repeating: 0x44, count: $0) }
      let sim = SimulatedDevice()
      let isUpload = item.direction == "upload"
      if isUpload {
        try source.write(to: local)
        if let old { sim.add("photo.jpg", contents: old, modified: item.remoteTimestamp) }
      } else {
        sim.add("photo.jpg", contents: source, modified: item.remoteTimestamp)
        if let old { try old.write(to: local) }
      }
      if FileManager.default.fileExists(atPath: local.path) {
        try FileManager.default.setAttributes(
          [.modificationDate: Date(timeIntervalSince1970: item.localTimestamp)],
          ofItemAtPath: local.path)
      }
      let device = try MTPDevice(transport: sim)
      let plan =
        isUpload
        ? try device.planUpload([local], storage: sim.storageID)
        : try device.planDownload(
          device.children(storage: sim.storageID, refresh: true), to: directory)
      let summary = try device.execute(plan, policy: .smartSync)
      #expect(summary.copiedFiles == (item.copies ? 1 : 0), Comment(rawValue: item.name))
      #expect(summary.skippedFiles == (item.copies ? 0 : 1), Comment(rawValue: item.name))
      #expect(
        summary.bytes == (item.copies ? UInt64(source.count) : 0), Comment(rawValue: item.name))
      let actual =
        isUpload ? try #require(sim.children(of: 0).first?.contents) : try Data(contentsOf: local)
      #expect(actual == (item.copies ? source : old), Comment(rawValue: item.name))
      #expect(
        sim.operationCounts[isUpload ? .sendObject : .getObject, default: 0]
          == (item.copies ? 1 : 0), Comment(rawValue: item.name))
      #expect(sim.violations.isEmpty, Comment(rawValue: item.name))
    }
  }

  @Test func legacyNestedGroupingKeepsRepeatedNamesAndDestinationExtras() throws {
    let fixture = try LegacySmartSyncFixture.load()
    let destination = try directory()
    defer { try? FileManager.default.removeItem(at: destination) }
    let sim = SimulatedDevice()
    let root = sim.add("selection", directory: true)
    var folders: [String: UInt32] = ["": root]
    func remoteFolder(_ path: String) -> UInt32 {
      if let handle = folders[path] { return handle }
      let parent = (path as NSString).deletingLastPathComponent
      let handle = sim.add(
        (path as NSString).lastPathComponent, parent: remoteFolder(parent), directory: true)
      folders[path] = handle
      return handle
    }
    for path in fixture.tree.sourceFiles {
      let parent = remoteFolder((path as NSString).deletingLastPathComponent)
      sim.add((path as NSString).lastPathComponent, parent: parent, contents: Data(path.utf8))
    }
    for path in fixture.tree.emptyDirectories { _ = remoteFolder(path) }
    let localRoot = destination.appendingPathComponent("selection")
    for path in fixture.tree.destinationOnlyFiles {
      let url = localRoot.appendingPathComponent(path)
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try Data("keep this user file".utf8).write(to: url)
    }
    let device = try MTPDevice(transport: sim)
    let plan = try device.planDownload(device.children(storage: sim.storageID), to: destination)
    #expect(
      Set(plan.extras.filter { !$0.isDirectory }.map(\.relativePath))
        == Set(fixture.tree.destinationOnlyFiles.map { "selection/" + $0 }))
    let summary = try device.execute(plan, policy: .smartSync)
    #expect(summary.copiedFiles == fixture.tree.sourceFiles.count)
    for path in fixture.tree.sourceFiles {
      #expect(try Data(contentsOf: localRoot.appendingPathComponent(path)) == Data(path.utf8))
    }
    for path in fixture.tree.destinationOnlyFiles {
      #expect(
        try String(contentsOf: localRoot.appendingPathComponent(path), encoding: .utf8)
          == "keep this user file")
    }
    for path in fixture.tree.emptyDirectories {
      #expect(
        try localRoot.appendingPathComponent(path).resourceValues(forKeys: [.isDirectoryKey])
          .isDirectory == true)
    }
    #expect(sim.violations.isEmpty)
  }
}
