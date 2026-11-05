import Foundation
import Testing

@testable import MTPCore
@testable import MTPSimulation

private final class TreeProgressRecorder: @unchecked Sendable {
  private let lock = NSLock()
  private var entries: [TreeTransferProgress] = []
  func add(_ value: TreeTransferProgress) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    let first = entries.isEmpty
    entries.append(value)
    return first
  }
  var last: TreeTransferProgress? {
    lock.lock()
    defer { lock.unlock() }
    return entries.last
  }
}

private final class FailedUploadTransport: MTPTransport {
  let device = SimulatedDevice()
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
        throw MTPError.transport("Simulated upload interruption")
      }
    }
    try device.bulkWrite(data, timeout: timeout)
  }
  func close() { device.close() }
}

private final class ObservedDeleteTransport: MTPTransport {
  let device = SimulatedDevice()
  var onDelete: (() -> Void)?
  var onCommand: ((OperationCode) -> Void)?
  var maxPacketSize: Int { device.maxPacketSize }
  func bulkRead(maxLength: Int, timeout: TimeInterval) throws -> Data {
    try device.bulkRead(maxLength: maxLength, timeout: timeout)
  }
  func bulkWrite(_ data: Data, timeout: TimeInterval) throws {
    try device.bulkWrite(data, timeout: timeout)
    if data.count >= 12 {
      var reader = ByteReader(data)
      _ = try reader.u32()
      if try reader.u16() == ContainerType.command.rawValue {
        let operation = OperationCode(rawValue: try reader.u16())
        onCommand?(operation)
        if operation == .deleteObject { onDelete?() }
      }
    }
  }
  func close() { device.close() }
}

@Suite("Recursive transfers")
struct TreeTransferTests {
  private func directory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "tree-transfer-\(UUID())")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }
  private func file(
    _ name: String, in directory: URL, contents: String = "payload", modified: Date? = nil
  ) throws -> URL {
    let url = directory.appendingPathComponent(name)
    try Data(contents.utf8).write(to: url)
    if let modified {
      try FileManager.default.setAttributes([.modificationDate: modified], ofItemAtPath: url.path)
    }
    return url
  }
  private func roots(_ device: MTPDevice, _ sim: SimulatedDevice) throws -> [MTPObject] {
    try device.children(storage: sim.storageID, refresh: true)
  }

  @Test func recursiveDownloadPreservesFoldersNamesAndTimestamps() throws {
    let sim = SimulatedDevice()
    let root = sim.add("Photos", directory: true)
    let a = sim.add("A", parent: root, directory: true)
    let b = sim.add("B", parent: root, directory: true)
    sim.add("Empty", parent: root, directory: true)
    sim.add("same.jpg", parent: a, contents: Data("first".utf8), modified: "20200102T030405Z")
    sim.add("same.jpg", parent: b, contents: Data("second".utf8))
    let device = try MTPDevice(transport: sim)
    let destination = try directory()
    defer { try? FileManager.default.removeItem(at: destination) }
    let plan = try device.planDownload(roots(device, sim), to: destination)
    #expect(plan.fileCount == 2 && plan.totalBytes == 11 && plan.conflicts.isEmpty)
    let summary = try device.execute(plan, policy: .ask)
    #expect(summary.copiedFiles == 2 && summary.bytes == 11)
    #expect(
      try String(
        contentsOf: destination.appendingPathComponent("Photos/A/same.jpg"), encoding: .utf8)
        == "first")
    #expect(
      try String(
        contentsOf: destination.appendingPathComponent("Photos/B/same.jpg"), encoding: .utf8)
        == "second")
    #expect(
      FileManager.default.fileExists(
        atPath: destination.appendingPathComponent("Photos/Empty").path))
    let attrs = try FileManager.default.attributesOfItem(
      atPath: destination.appendingPathComponent("Photos/A/same.jpg").path)
    #expect(attrs[.modificationDate] as? Date == MTPDate.parse("20200102T030405Z"))
    #expect(sim.violations.isEmpty)
  }

  @Test func recursiveUploadIncludesEmptyDirectories() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let root = source.appendingPathComponent("Photos")
    try FileManager.default.createDirectory(
      at: root.appendingPathComponent("Empty"), withIntermediateDirectories: true)
    let nested = root.appendingPathComponent("Nested")
    try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: false)
    _ = try file("same.txt", in: root, contents: "top")
    _ = try file("same.txt", in: nested, contents: "nested")
    let folderModified = try #require(MTPDate.parse("20200102T030405Z"))
    try FileManager.default.setAttributes(
      [.modificationDate: folderModified], ofItemAtPath: root.path)
    let sim = SimulatedDevice()
    let device = try MTPDevice(transport: sim)
    let plan = try device.planUpload([root], storage: sim.storageID)
    let summary = try device.execute(plan, policy: .ask)
    let folder = try #require(sim.children(of: 0).first { $0.name == "Photos" })
    #expect(MTPDate.parse(folder.modified) == folderModified)
    let children = sim.children(of: folder.handle)
    #expect(children.contains { $0.name == "Empty" && $0.isDirectory })
    #expect(children.first { $0.name == "same.txt" }?.contents == Data("top".utf8))
    let nestedNode = try #require(children.first { $0.name == "Nested" })
    #expect(sim.children(of: nestedNode.handle).first?.contents == Data("nested".utf8))
    #expect(summary.copiedFiles == 2 && summary.bytes == 9)
    #expect(!sim.nodes.values.contains { $0.name.hasPrefix(".openmtp-") })
    #expect(sim.violations.isEmpty)
  }

  @Test(arguments: [CopyConflictPolicy.skip, .replace, .keepBoth])
  func downloadConflictPolicies(policy: CopyConflictPolicy) throws {
    let sim = SimulatedDevice()
    sim.add("same.txt", contents: Data("new".utf8))
    let device = try MTPDevice(transport: sim)
    let destination = try directory()
    defer { try? FileManager.default.removeItem(at: destination) }
    let original = try file("same.txt", in: destination, contents: "original")
    let plan = try device.planDownload(roots(device, sim), to: destination)
    #expect(plan.conflicts.count == 1)
    #expect(throws: TreeTransferError.self) { _ = try device.execute(plan, policy: .ask) }
    #expect(sim.operationCounts[.getObject, default: 0] == 0)
    let recorder = TreeProgressRecorder()
    let summary = try device.execute(plan, policy: policy, progress: { _ = recorder.add($0) })
    #expect(
      try String(contentsOf: original, encoding: .utf8) == (policy == .replace ? "new" : "original")
    )
    if policy == .keepBoth {
      #expect(
        try String(contentsOf: destination.appendingPathComponent("same copy.txt"), encoding: .utf8)
          == "new")
    }
    #expect(summary.skippedFiles == (policy == .skip ? 1 : 0))
    #expect(summary.bytes == (policy == .skip ? 0 : 3))
    #expect(recorder.last?.totalBytes == (policy == .skip ? 0 : 3))
  }

  @Test(arguments: [CopyConflictPolicy.skip, .replace, .keepBoth])
  func uploadConflictPolicies(policy: CopyConflictPolicy) throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let local = try file("same.txt", in: source, contents: "new")
    let sim = SimulatedDevice()
    let old = sim.add("same.txt", contents: Data("original".utf8))
    let device = try MTPDevice(transport: sim)
    let plan = try device.planUpload([local], storage: sim.storageID)
    let summary = try device.execute(plan, policy: policy)
    if policy == .replace {
      #expect(sim.nodes[old] == nil)
      #expect(sim.children(of: 0).first?.contents == Data("new".utf8))
    } else {
      #expect(sim.nodes[old]?.contents == Data("original".utf8))
    }
    if policy == .keepBoth {
      #expect(
        sim.children(of: 0).first { $0.name == "same copy.txt" }?.contents == Data("new".utf8))
    }
    #expect(summary.skippedFiles == (policy == .skip ? 1 : 0))
    #expect(!sim.nodes.values.contains { $0.name.hasPrefix(".openmtp-") })
    #expect(sim.violations.isEmpty)
  }

  @Test func smartSyncSkipsMatchingFilesAndKeepsExtras() throws {
    let sim = SimulatedDevice()
    let folder = sim.add("Folder", directory: true)
    sim.add("same.txt", parent: folder, contents: Data("same".utf8), modified: "20200101T000000Z")
    sim.add("new.txt", parent: folder, contents: Data("new".utf8))
    let device = try MTPDevice(transport: sim)
    let destination = try directory()
    defer { try? FileManager.default.removeItem(at: destination) }
    let target = destination.appendingPathComponent("Folder")
    try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false)
    _ = try file(
      "same.txt", in: target, contents: "same", modified: MTPDate.parse("20200101T000000Z"))
    _ = try file("extra.txt", in: target, contents: "keep")
    let plan = try device.planDownload(roots(device, sim), to: destination)
    #expect(plan.extras.map(\.relativePath) == ["Folder/extra.txt"])
    let summary = try device.execute(plan, policy: .smartSync)
    #expect(summary.copiedFiles == 1 && summary.skippedFiles == 1 && summary.bytes == 3)
    #expect(
      try String(contentsOf: target.appendingPathComponent("extra.txt"), encoding: .utf8) == "keep")
    #expect(sim.operationCounts[.getObject] == 1)
  }

  @Test func skipExistingFolderSkipsItsEntireSelection() throws {
    let sim = SimulatedDevice()
    let destination = try directory()
    defer { try? FileManager.default.removeItem(at: destination) }
    let folder = sim.add("Folder", directory: true)
    sim.add("file", parent: folder, contents: Data([1]))
    try FileManager.default.createDirectory(
      at: destination.appendingPathComponent("Folder"), withIntermediateDirectories: false)
    let device = try MTPDevice(transport: sim)
    let summary = try device.execute(
      device.planDownload(roots(device, sim), to: destination), policy: .skip)
    #expect(summary.skippedFiles == 1 && summary.copiedFiles == 0 && summary.bytes == 0)
    #expect(sim.operationCounts[.getObject, default: 0] == 0)
  }

  @Test func keepBothCopiesWholeFoldersRatherThanSkippingTheirChildren() throws {
    let destination = try directory()
    let source = try directory()
    defer {
      try? FileManager.default.removeItem(at: destination)
      try? FileManager.default.removeItem(at: source)
    }
    let sim = SimulatedDevice()
    let folder = sim.add("Folder", directory: true)
    sim.add("file.txt", parent: folder, contents: Data("phone".utf8))
    let device = try MTPDevice(transport: sim)
    try FileManager.default.createDirectory(
      at: destination.appendingPathComponent("Folder"), withIntermediateDirectories: false)
    _ = try file(
      "file.txt", in: destination.appendingPathComponent("Folder"), contents: "local original")
    let summary = try device.execute(
      device.planDownload(roots(device, sim), to: destination), policy: .keepBoth)
    #expect(summary.copiedFiles == 1 && summary.skippedFiles == 0)
    #expect(
      try String(
        contentsOf: destination.appendingPathComponent("Folder copy/file.txt"), encoding: .utf8)
        == "phone")
    #expect(
      try String(contentsOf: destination.appendingPathComponent("Folder/file.txt"), encoding: .utf8)
        == "local original")

    let uploadFolder = source.appendingPathComponent("Folder")
    try FileManager.default.createDirectory(at: uploadFolder, withIntermediateDirectories: false)
    _ = try file("file.txt", in: uploadFolder, contents: "Mac")
    _ = try device.execute(
      device.planUpload([uploadFolder], storage: sim.storageID), policy: .keepBoth)
    let copy = try #require(sim.children(of: 0).first { $0.name == "Folder copy" })
    #expect(sim.children(of: copy.handle).first?.contents == Data("Mac".utf8))
    #expect(sim.children(of: folder).first?.contents == Data("phone".utf8))
  }

  @Test func replacingTypeClashesStagesCompleteTreesAndPreservesExtras() throws {
    let destination = try directory()
    let source = try directory()
    defer {
      try? FileManager.default.removeItem(at: destination)
      try? FileManager.default.removeItem(at: source)
    }
    let sim = SimulatedDevice()
    let folder = sim.add("Folder", directory: true)
    sim.add("file", parent: folder, contents: Data("inside".utf8))
    let device = try MTPDevice(transport: sim)
    _ = try file("Folder", in: destination, contents: "existing file")
    let plan = try device.planDownload(roots(device, sim), to: destination)
    #expect(throws: TreeTransferError.self) { _ = try device.execute(plan, policy: .smartSync) }
    _ = try device.execute(plan, policy: .replace)
    #expect(
      try String(contentsOf: destination.appendingPathComponent("Folder/file"), encoding: .utf8)
        == "inside")

    let uploadFolder = source.appendingPathComponent("Photo")
    try FileManager.default.createDirectory(at: uploadFolder, withIntermediateDirectories: false)
    _ = try file("file", in: uploadFolder, contents: "uploaded")
    let old = sim.add("Photo", contents: Data("old file".utf8))
    _ = try device.execute(
      device.planUpload([uploadFolder], storage: sim.storageID), policy: .replace)
    #expect(sim.nodes[old] == nil)
    let replacement = try #require(sim.children(of: 0).first { $0.name == "Photo" })
    #expect(replacement.isDirectory)
    #expect(sim.children(of: replacement.handle).first?.contents == Data("uploaded".utf8))
    #expect(!sim.nodes.values.contains { $0.name.hasPrefix(".openmtp-") })
  }

  @Test func sourceAndDestinationChangesFailClosed() throws {
    let source = try directory()
    let destination = try directory()
    defer {
      try? FileManager.default.removeItem(at: source)
      try? FileManager.default.removeItem(at: destination)
    }
    let local = try file("file", in: source, contents: "before")
    let sim = SimulatedDevice()
    let device = try MTPDevice(transport: sim)
    let upload = try device.planUpload([local], storage: sim.storageID)
    try Data("after-longer".utf8).write(to: local)
    #expect(throws: TreeTransferError.self) { _ = try device.execute(upload, policy: .replace) }
    #expect(sim.operationCounts[.sendObjectInfo, default: 0] == 0)

    sim.add("remote", contents: Data("download".utf8))
    let plan = try device.planDownload(roots(device, sim), to: destination)
    _ = try file("remote", in: destination, contents: "created after planning")
    #expect(throws: TreeTransferError.self) { _ = try device.execute(plan, policy: .replace) }
    #expect(
      try String(contentsOf: destination.appendingPathComponent("remote"), encoding: .utf8)
        == "created after planning")
  }

  @Test func destinationEditedDuringStreamingIsPreserved() throws {
    let destination = try directory()
    defer { try? FileManager.default.removeItem(at: destination) }
    let target = try file("file", in: destination, contents: "old")
    let sim = SimulatedDevice()
    sim.add("file", contents: Data(repeating: 7, count: 20_000))
    let device = try MTPDevice(transport: sim)
    device.session.transferSize = 1024
    let plan = try device.planDownload(roots(device, sim), to: destination)
    let recorder = TreeProgressRecorder()
    #expect(throws: TreeTransferError.self) {
      _ = try device.execute(
        plan, policy: .replace,
        progress: { value in
          if recorder.add(value) { try Data("user edit during copy".utf8).write(to: target) }
        })
    }
    #expect(try String(contentsOf: target, encoding: .utf8) == "user edit during copy")
    #expect(try FileManager.default.contentsOfDirectory(atPath: destination.path) == ["file"])
  }

  @Test func cancellationBreaksSessionWithoutReplacingDestination() throws {
    let destination = try directory()
    defer { try? FileManager.default.removeItem(at: destination) }
    let target = try file("file", in: destination, contents: "old")
    let sim = SimulatedDevice()
    sim.add("file", contents: Data(repeating: 7, count: 30_000))
    let device = try MTPDevice(transport: sim)
    device.session.transferSize = 1024
    let plan = try device.planDownload(roots(device, sim), to: destination)
    let token = TransferCancellationToken()
    #expect(throws: MTPError.cancelled) {
      _ = try device.execute(
        plan, policy: .replace, cancellation: token, progress: { _ in token.cancel() })
    }
    #expect(device.session.isBroken)
    #expect(try String(contentsOf: target, encoding: .utf8) == "old")
    #expect(try FileManager.default.contentsOfDirectory(atPath: destination.path) == ["file"])
  }

  @Test func failedUploadKeepsOriginalAndReportsRecoveryName() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let local = try file("file", in: source, contents: "new")
    let transport = FailedUploadTransport()
    let old = transport.device.add("file", contents: Data("old".utf8))
    let device = try MTPDevice(transport: transport)
    let plan = try device.planUpload([local], storage: transport.device.storageID)
    let token = TransferCancellationToken()
    #expect(throws: TreeTransferError.self) {
      _ = try device.execute(plan, policy: .replace, cancellation: token)
    }
    #expect(transport.device.nodes[old]?.contents == Data("old".utf8))
    #expect(transport.device.nodes[old]?.name == "file")
    #expect(device.session.isBroken && !token.recoveryPaths.isEmpty)
  }

  @Test func failedBackupCleanupRetainsBothCompleteCopies() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let local = try file("file", in: source, contents: "new complete copy")
    let sim = SimulatedDevice()
    let old = sim.add("file", contents: Data("original".utf8))
    let device = try MTPDevice(transport: sim)
    let plan = try device.planUpload([local], storage: sim.storageID)
    sim.forcedResponses[.deleteObject] = .accessDenied
    let token = TransferCancellationToken()
    #expect(throws: TreeTransferError.self) {
      _ = try device.execute(plan, policy: .replace, cancellation: token)
    }
    #expect(sim.nodes[old]?.contents == Data("original".utf8))
    #expect(sim.nodes[old]?.name.hasPrefix(".openmtp-previous-") == true)
    #expect(
      sim.children(of: 0).first { $0.name == "file" }?.contents == Data("new complete copy".utf8))
    #expect(token.recoveryPaths.count == 1 && token.recoveryPaths[0].contains(".openmtp-previous-"))
    #expect(!device.session.isBroken && sim.violations.isEmpty)
  }

  @Test func extrasCleanupRequiresSuccessfulSmartSyncAndPreservesFolders() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let folder = source.appendingPathComponent("Folder")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
    _ = try file("new.txt", in: folder, contents: "new")
    let sim = SimulatedDevice()
    let remoteFolder = sim.add("Folder", directory: true)
    let extraFolder = sim.add("Extra folder", parent: remoteFolder, directory: true)
    let empty = sim.add("Empty", parent: extraFolder, directory: true)
    let extra = sim.add("extra.txt", parent: extraFolder, contents: Data("extra".utf8))
    let device = try MTPDevice(transport: sim)
    let plan = try device.planUpload([folder], storage: sim.storageID)
    #expect(plan.extras.map(\.relativePath) == ["Folder/Extra folder/extra.txt"])
    #expect(throws: TreeTransferError.self) { _ = try device.removeExtras(from: plan) }
    _ = try device.execute(plan, policy: .replace)
    #expect(throws: TreeTransferError.self) { _ = try device.removeExtras(from: plan) }
    // A fresh plan sees the finished copy and reviews exactly the same extra.
    let sync = try device.planUpload([folder], storage: sim.storageID)
    _ = try device.execute(sync, policy: .smartSync)
    let unreviewed = sim.add("created-after-review.txt", parent: extraFolder, contents: Data([9]))
    #expect(try device.removeExtras(from: sync) == 1)
    #expect(sim.nodes[extra] == nil)
    #expect(
      sim.nodes[extraFolder] != nil && sim.nodes[empty] != nil && sim.nodes[unreviewed] != nil)
    #expect(sim.children(of: remoteFolder).contains { $0.name == "new.txt" })
    #expect(try device.removeExtras(from: sync) == 0)
  }

  @Test func extrasCleanupRejectsStaleFilesAndMovedParents() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let folder = source.appendingPathComponent("Folder")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
    let sim = SimulatedDevice()
    let device = try MTPDevice(transport: sim)
    let remoteFolder = sim.add("Folder", directory: true)
    let extra = sim.add("extra.txt", parent: remoteFolder, contents: Data([1]))
    let plan = try device.planUpload([folder], storage: sim.storageID)
    _ = try device.execute(plan, policy: .smartSync)
    var extraObject = try device.object(extra)
    try device.rename(extraObject, to: "edited.txt")
    #expect(throws: TreeTransferError.self) { _ = try device.removeExtras(from: plan) }
    #expect(sim.nodes[extra] != nil)
    extraObject.name = "edited.txt"
    try device.rename(extraObject, to: "extra.txt")
    let parent = try device.object(remoteFolder)
    try device.rename(parent, to: "Moved")
    #expect(throws: TreeTransferError.self) { _ = try device.removeExtras(from: plan) }
    #expect(sim.nodes[extra] != nil)
    let other = try MTPDevice(transport: SimulatedDevice())
    #expect(throws: TreeTransferError.self) { _ = try other.removeExtras(from: plan) }
  }

  @Test func extrasCleanupCanResumeAfterCancellationWithoutDeletingNewFiles() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let folder = source.appendingPathComponent("Folder")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
    let transport = ObservedDeleteTransport()
    let device = try MTPDevice(transport: transport)
    let remoteFolder = transport.device.add("Folder", directory: true)
    let first = transport.device.add("a.txt", parent: remoteFolder, contents: Data([1]))
    let second = transport.device.add("b.txt", parent: remoteFolder, contents: Data([2]))
    let plan = try device.planUpload([folder], storage: transport.device.storageID)
    _ = try device.execute(plan, policy: .smartSync)
    let token = TransferCancellationToken()
    transport.onDelete = { token.cancel() }
    #expect(throws: MTPError.cancelled) {
      _ = try device.removeExtras(from: plan, cancellation: token)
    }
    #expect(transport.device.nodes[first] == nil && transport.device.nodes[second] != nil)
    transport.onDelete = nil
    let newlyCreated = transport.device.add("a.txt", parent: remoteFolder, contents: Data([3]))
    #expect(try device.removeExtras(from: plan) == 1)
    #expect(transport.device.nodes[second] == nil && transport.device.nodes[newlyCreated] != nil)
    #expect(transport.device.violations.isEmpty)
  }

  @Test func failedOrCanceledSyncNeverAllowsCleanup() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let folder = source.appendingPathComponent("Folder")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
    _ = try file("new.txt", in: folder)
    let transport = FailedUploadTransport()
    let device = try MTPDevice(transport: transport)
    let remoteFolder = transport.device.add("Folder", directory: true)
    let extra = transport.device.add("extra.txt", parent: remoteFolder)
    let plan = try device.planUpload([folder], storage: transport.device.storageID)
    #expect(throws: TreeTransferError.self) { _ = try device.execute(plan, policy: .smartSync) }
    #expect(throws: TreeTransferError.self) { _ = try device.removeExtras(from: plan) }
    #expect(transport.device.nodes[extra] != nil)

    let sim = SimulatedDevice()
    let healthy = try MTPDevice(transport: sim)
    let destination = sim.add("Folder", directory: true)
    let retained = sim.add("extra.txt", parent: destination)
    let canceled = try healthy.planUpload([folder], storage: sim.storageID)
    let token = TransferCancellationToken()
    token.cancel()
    #expect(throws: MTPError.cancelled) {
      _ = try healthy.execute(canceled, policy: .smartSync, cancellation: token)
    }
    #expect(throws: TreeTransferError.self) { _ = try healthy.removeExtras(from: canceled) }
    #expect(sim.nodes[retained] != nil)
  }

  @Test func localExtrasCleanupRejectsReplacedAncestors() throws {
    let destination = try directory()
    defer { try? FileManager.default.removeItem(at: destination) }
    let target = destination.appendingPathComponent("Folder")
    try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false)
    let extra = try file("extra.txt", in: target)
    let sim = SimulatedDevice()
    sim.add("Folder", directory: true)
    let device = try MTPDevice(transport: sim)
    let plan = try device.planDownload(roots(device, sim), to: destination)
    _ = try device.execute(plan, policy: .smartSync)
    let moved = destination.appendingPathComponent("Moved")
    try FileManager.default.moveItem(at: target, to: moved)
    try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false)
    // Preserve the reviewed file's own inode, size and timestamp. Only its
    // captured parent identity distinguishes this replacement destination.
    try FileManager.default.moveItem(at: moved.appendingPathComponent("extra.txt"), to: extra)
    #expect(throws: TreeTransferError.self) { _ = try device.removeExtras(from: plan) }
    #expect(FileManager.default.fileExists(atPath: extra.path))
  }

  @Test func unknownSizesForceCopyAndRemainIndeterminate() throws {
    let destination = try directory()
    defer { try? FileManager.default.removeItem(at: destination) }
    let sim = SimulatedDevice()
    sim.omitObjectSizes = true
    sim.add("file.txt", contents: Data("new".utf8), modified: "20200101T000000Z")
    let target = try file(
      "file.txt", in: destination, contents: "old", modified: MTPDate.parse("20200101T000000Z"))
    let device = try MTPDevice(transport: sim)
    let plan = try device.planDownload(roots(device, sim), to: destination)
    #expect(plan.totalBytes == nil && plan.conflicts.first?.sourceSize == nil)
    let recorder = TreeProgressRecorder()
    let summary = try device.execute(plan, policy: .smartSync, progress: { _ = recorder.add($0) })
    #expect(summary.copiedFiles == 1 && summary.skippedFiles == 0 && summary.bytes == 3)
    #expect(recorder.last?.totalBytes == nil)
    #expect(try String(contentsOf: target, encoding: .utf8) == "new")
  }

  @Test func sixtyFourBitPlansDetectTruncationWithoutOverwriting() throws {
    let destination = try directory()
    defer { try? FileManager.default.removeItem(at: destination) }
    let target = try file("large.bin", in: destination, contents: "original")
    let sim = SimulatedDevice()
    let handle = sim.add("large.bin", contents: Data([1, 2]))
    sim.reportedSizes[handle] = 0x1_0000_0025
    let device = try MTPDevice(transport: sim)
    let plan = try device.planDownload(roots(device, sim), to: destination)
    #expect(plan.totalBytes == 0x1_0000_0025)
    #expect(throws: MTPError.self) { _ = try device.execute(plan, policy: .replace) }
    #expect(try String(contentsOf: target, encoding: .utf8) == "original")
    #expect(try FileManager.default.contentsOfDirectory(atPath: destination.path) == ["large.bin"])
  }

  @Test func invalidSelectionNeverAcceptsOnlyItsValidItems() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let valid = try file("valid.txt", in: source)
    let link = source.appendingPathComponent("link")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: valid)
    let sim = SimulatedDevice()
    let device = try MTPDevice(transport: sim)
    #expect(throws: TreeTransferError.self) {
      _ = try device.planUpload([valid, link], storage: sim.storageID)
    }
    #expect(sim.operationCounts[.sendObjectInfo, default: 0] == 0 && sim.nodes.isEmpty)
    sim.add("duplicate", contents: Data([1]))
    sim.add("duplicate", contents: Data([2]))
    let objects = try roots(device, sim)
    #expect(throws: TreeTransferError.self) { _ = try device.planDownload(objects, to: source) }
    #expect(sim.operationCounts[.getObject, default: 0] == 0)
  }

  @Test func caseInsensitiveMatchesNeverBecomeDeletionExtras() throws {
    let destination = try directory()
    defer { try? FileManager.default.removeItem(at: destination) }
    let sensitive =
      try destination.resourceValues(forKeys: [.volumeSupportsCaseSensitiveNamesKey])
      .volumeSupportsCaseSensitiveNames ?? false
    if sensitive { return }
    let folder = destination.appendingPathComponent("Folder")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
    _ = try file(
      "PHOTO.jpg", in: folder, contents: "same", modified: MTPDate.parse("20200101T000000Z"))
    let sim = SimulatedDevice()
    let remote = sim.add("Folder", directory: true)
    sim.add("photo.jpg", parent: remote, contents: Data("same".utf8), modified: "20200101T000000Z")
    let device = try MTPDevice(transport: sim)
    let plan = try device.planDownload(roots(device, sim), to: destination)
    #expect(plan.extras.isEmpty && plan.conflicts.count == 2)
    let summary = try device.execute(plan, policy: .smartSync)
    #expect(summary.skippedFiles == 1 && summary.bytes == 0)
    #expect(try device.removeExtras(from: plan) == 0)
    #expect(
      try String(contentsOf: folder.appendingPathComponent("PHOTO.jpg"), encoding: .utf8) == "same")
  }

  @Test func cancellationStopsPreflightBetweenMetadataRequests() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let folder = source.appendingPathComponent("Folder")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
    _ = try file("file.txt", in: folder)
    let transport = ObservedDeleteTransport()
    let device = try MTPDevice(transport: transport)
    let token = TransferCancellationToken()
    transport.onCommand = { operation in
      if operation == .getObjectHandles || operation == .getObjectPropList { token.cancel() }
    }
    #expect(throws: MTPError.cancelled) {
      _ = try device.planUpload([folder], storage: transport.device.storageID, cancellation: token)
    }
    #expect(transport.device.operationCounts[.sendObjectInfo, default: 0] == 0)
    #expect(!device.session.isBroken && transport.device.violations.isEmpty)
  }

  @Test func basicUploadDevicesCopyNewFilesAndKeepBothFolderTrees() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let direct = try file("direct.txt", in: source, contents: "direct")
    let fresh = try file("fresh.txt", in: source, contents: "new file")
    let folder = source.appendingPathComponent("Folder")
    try FileManager.default.createDirectory(
      at: folder.appendingPathComponent("Empty"), withIntermediateDirectories: true)
    _ = try file("nested.txt", in: folder, contents: "nested")
    let sim = SimulatedDevice()
    sim.supportsFilenameRename = false
    let originalFolder = sim.add("Folder", directory: true)
    let original = sim.add("retained.txt", parent: originalFolder, contents: Data("original".utf8))
    let device = try MTPDevice(transport: sim)
    #expect(!device.info.supports(.setObjectPropValue))
    // Establish the basic protocol behavior that the tree UI must preserve.
    _ = try device.upload(direct, storage: sim.storageID)
    let copied = try device.execute(
      device.planUpload([fresh, folder], storage: sim.storageID), policy: .replace)
    #expect(copied.copiedFiles == 2 && copied.bytes == 14)
    #expect(sim.children(of: 0).first { $0.name == "fresh.txt" }?.contents == Data("new file".utf8))
    #expect(sim.children(of: originalFolder).contains { $0.name == "nested.txt" })
    #expect(sim.nodes[original]?.contents == Data("original".utf8))
    _ = try device.execute(
      device.planUpload([folder], storage: sim.storageID), policy: .keepBoth)
    let kept = try #require(sim.children(of: 0).first { $0.name == "Folder copy" })
    #expect(
      sim.children(of: kept.handle).first { $0.name == "nested.txt" }?.contents
        == Data("nested".utf8))
    #expect(sim.children(of: kept.handle).contains { $0.name == "Empty" && $0.isDirectory })
    #expect(sim.operationCounts[.setObjectPropValue, default: 0] == 0)
    #expect(!sim.nodes.values.contains { $0.name.hasPrefix(".openmtp-") })
    #expect(sim.violations.isEmpty)
  }

  @Test(arguments: [CopyConflictPolicy.replace, .smartSync])
  func basicUploadReplacementFailsBeforeAnyPayload(policy: CopyConflictPolicy) throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let fresh = try file("new.txt", in: source)
    let replacement = try file("existing.txt", in: source, contents: "replacement")
    let sim = SimulatedDevice()
    sim.supportsFilenameRename = false
    let original = sim.add("existing.txt", contents: Data("original".utf8))
    let device = try MTPDevice(transport: sim)
    let plan = try device.planUpload([fresh, replacement], storage: sim.storageID)
    #expect(throws: TreeTransferError.self) { _ = try device.execute(plan, policy: policy) }
    #expect(sim.operationCounts[.sendObjectInfo, default: 0] == 0)
    #expect(sim.nodes.count == 1 && sim.nodes[original]?.contents == Data("original".utf8))
    let summary = try device.execute(plan, policy: .keepBoth)
    #expect(summary.copiedFiles == 2)
    #expect(sim.nodes[original]?.contents == Data("original".utf8))
    #expect(
      sim.children(of: 0).first { $0.name == "existing copy.txt" }?.contents
        == Data("replacement".utf8))
  }

  @Test(arguments: [false, true])
  func basicUploadTypeClashesFailBeforeAnyWrite(sourceIsDirectory: Bool) throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let selected = source.appendingPathComponent("clash")
    if sourceIsDirectory {
      try FileManager.default.createDirectory(at: selected, withIntermediateDirectories: false)
      _ = try file("child", in: selected)
    } else {
      _ = try file("clash", in: source)
    }
    let sim = SimulatedDevice()
    sim.supportsFilenameRename = false
    let original = sim.add("clash", directory: !sourceIsDirectory, contents: Data("keep".utf8))
    let device = try MTPDevice(transport: sim)
    let plan = try device.planUpload([selected], storage: sim.storageID)
    #expect(throws: TreeTransferError.self) { _ = try device.execute(plan, policy: .replace) }
    #expect(sim.operationCounts[.sendObjectInfo, default: 0] == 0)
    #expect(sim.nodes.count == 1 && sim.nodes[original]?.contents == Data("keep".utf8))
  }

  @Test(arguments: [ResponseCode.operationNotSupported, .invalidObjectPropCode])
  func advertisedButUnsupportedRenameRetriesOnlyNewFiles(code: ResponseCode) throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let fresh = try file("fresh.txt", in: source, contents: "new")
    let sim = SimulatedDevice()
    sim.forcedResponses[.setObjectPropValue] = code
    let device = try MTPDevice(transport: sim)
    #expect(device.info.supports(.setObjectPropValue))
    let progress = TreeProgressRecorder()
    let summary = try device.execute(
      device.planUpload([fresh], storage: sim.storageID), policy: .ask,
      progress: { _ = progress.add($0) })
    #expect(summary.copiedFiles == 1 && summary.bytes == 6)
    #expect(progress.last?.completedBytes == 6 && progress.last?.totalBytes == 6)
    #expect(sim.operationCounts[.sendObject] == 2)
    #expect(sim.children(of: 0).count == 1 && sim.children(of: 0).first?.name == "fresh.txt")
    #expect(sim.children(of: 0).first?.contents == Data("new".utf8))
    let replacement = try file("existing.txt", in: source, contents: "replacement")
    let original = sim.add("existing.txt", contents: Data("original".utf8))
    let before = sim.operationCounts[.sendObject, default: 0]
    #expect(throws: MTPError.self) {
      _ = try device.execute(
        device.planUpload([replacement], storage: sim.storageID), policy: .replace)
    }
    #expect(sim.operationCounts[.sendObject] == before + 1)
    #expect(
      sim.nodes[original]?.name == "existing.txt"
        && sim.nodes[original]?.contents == Data("original".utf8))
    #expect(!sim.nodes.values.contains { $0.name.hasPrefix(".openmtp-") })
    #expect(sim.violations.isEmpty)
  }

  @Test func unsupportedRenameCleanupFailureDoesNotRetryPayload() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let fresh = try file("fresh.txt", in: source)
    let sim = SimulatedDevice()
    sim.forcedResponses[.setObjectPropValue] = .operationNotSupported
    sim.forcedResponses[.deleteObject] = .accessDenied
    let device = try MTPDevice(transport: sim)
    let token = TransferCancellationToken()
    #expect(throws: TreeTransferError.self) {
      _ = try device.execute(
        device.planUpload([fresh], storage: sim.storageID), policy: .ask, cancellation: token)
    }
    #expect(sim.operationCounts[.sendObject] == 1)
    #expect(sim.nodes.count == 1 && sim.children(of: 0).first?.name.hasPrefix(".openmtp-") == true)
    #expect(token.recoveryPaths.count == 1)
  }

  @Test func renameAccessDeniedNeverTriggersACompatibilityRetry() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let fresh = try file("fresh.txt", in: source)
    let sim = SimulatedDevice()
    sim.forcedResponses[.setObjectPropValue] = .accessDenied
    let device = try MTPDevice(transport: sim)
    #expect(throws: MTPError.self) {
      _ = try device.execute(device.planUpload([fresh], storage: sim.storageID), policy: .ask)
    }
    #expect(sim.operationCounts[.sendObject] == 1 && sim.nodes.isEmpty)
  }

  @Test func basicUploadCancellationRetainsOnlyItsOwnRecoveryLocation() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let fresh = try file("fresh.bin", in: source, contents: String(repeating: "x", count: 30_000))
    let sim = SimulatedDevice()
    sim.supportsFilenameRename = false
    let original = sim.add("original.txt", contents: Data("original".utf8))
    let device = try MTPDevice(transport: sim)
    device.session.transferSize = 1024
    let token = TransferCancellationToken()
    #expect(throws: MTPError.cancelled) {
      _ = try device.execute(
        device.planUpload([fresh], storage: sim.storageID), policy: .ask, cancellation: token,
        progress: { _ in token.cancel() })
    }
    #expect(device.session.isBroken && token.recoveryPaths.count == 1)
    #expect(token.recoveryPaths.first?.contains("fresh.bin") == true)
    #expect(sim.nodes[original]?.contents == Data("original".utf8))
  }

  @Test func basicUploadSourceChangeCleansTheCreatedHandle() throws {
    let source = try directory()
    defer { try? FileManager.default.removeItem(at: source) }
    let fresh = try file("fresh.txt", in: source, contents: "new")
    let sim = SimulatedDevice()
    sim.supportsFilenameRename = false
    let original = sim.add("original.txt", contents: Data("original".utf8))
    let device = try MTPDevice(transport: sim)
    let recorder = TreeProgressRecorder()
    let token = TransferCancellationToken()
    #expect(throws: TreeTransferError.self) {
      _ = try device.execute(
        device.planUpload([fresh], storage: sim.storageID), policy: .ask, cancellation: token,
        progress: { value in
          if recorder.add(value) { try Data("changed source".utf8).write(to: fresh) }
        })
    }
    #expect(!device.session.isBroken && token.recoveryPaths.isEmpty)
    #expect(sim.nodes.count == 1 && sim.nodes[original]?.contents == Data("original".utf8))
    #expect(sim.violations.isEmpty)
  }

  @Test func symlinksAndOtherDevicePlansAreRejectedBeforeWrites() throws {
    let source = try directory()
    let destination = try directory()
    defer {
      try? FileManager.default.removeItem(at: source)
      try? FileManager.default.removeItem(at: destination)
    }
    let folder = source.appendingPathComponent("folder")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
    try FileManager.default.createSymbolicLink(
      at: folder.appendingPathComponent("cycle"), withDestinationURL: folder)
    let sim = SimulatedDevice()
    let device = try MTPDevice(transport: sim)
    #expect(throws: TreeTransferError.self) {
      _ = try device.planUpload([folder], storage: sim.storageID)
    }
    #expect(sim.operationCounts[.sendObjectInfo, default: 0] == 0)
    sim.add("file", contents: Data([1]))
    let plan = try device.planDownload(roots(device, sim), to: destination)
    let other = try MTPDevice(transport: SimulatedDevice())
    #expect(throws: TreeTransferError.self) { _ = try other.execute(plan, policy: .replace) }
  }
}
