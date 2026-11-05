import Foundation
import Testing

@testable import MTPCore
@testable import MTPSimulation

private func pattern(_ count: Int, seed: UInt8 = 7) -> Data {
  var d = Data(count: count)
  d.withUnsafeMutableBytes { buf in
    var x = seed
    for i in 0..<count {
      x = x &* 31 &+ 17
      buf[i] = x
    }
  }
  return d
}

private func openDevice(_ sim: SimulatedDevice, transferSize: Int = 1 << 20) throws -> MTPDevice {
  let device = try MTPDevice(transport: sim)
  device.session.transferSize = transferSize
  return device
}

@Suite("Codec")
struct CodecTests {
  @Test func stringRoundTrip() throws {
    for s in ["", "a", "Camera", "Ünïcødé 📷", String(repeating: "x", count: 254)] {
      var w = ByteWriter()
      try w.string(s)
      var r = ByteReader(w.data)
      #expect(try r.string() == s)
      #expect(r.isAtEnd)
    }
  }

  @Test func emptyStringIsOneZeroByte() throws {
    var w = ByteWriter()
    try w.string("")
    #expect(w.data == Data([0]))
  }

  @Test func overlongStringIsRejected() {
    var w = ByteWriter()
    #expect(throws: MTPError.self) { try w.string(String(repeating: "x", count: 255)) }
  }

  @Test func truncatedReadsThrow() {
    var r = ByteReader(Data([1, 2, 3]))
    #expect(throws: MTPError.self) { try r.u32() }
  }

  @Test func objectInfoRoundTrip() throws {
    var oi = ObjectInfo()
    oi.storageID = 0x10001
    oi.objectFormat = ObjectFormat.association
    oi.compressedSize = 0xFFFF_FFFF
    oi.parentObject = 42
    oi.filename = "Screenshots"
    oi.dateModified = "20261102T101500"
    #expect(try ObjectInfo(decoding: oi.encoded()) == oi)
  }

  @Test func zonelessDatesUseTheHostZone() throws {
    let ist = TimeZone(identifier: "Asia/Kolkata")!
    let local = try #require(MTPDate.parse("20261102T101500", localZone: ist))
    let utc = try #require(MTPDate.parse("20261102T044500Z", localZone: ist))
    let offset = try #require(MTPDate.parse("20261102T101500+0530", localZone: .gmt))
    #expect(local == utc)
    #expect(offset == utc)
    #expect(MTPDate.format(local, localZone: ist) == "20261102T101500")
    #expect(MTPDate.parse("garbage") == nil)
  }

  @Test func fractionalSecondsParse() throws {
    let a = try #require(MTPDate.parse("20260101T000000.5Z"))
    let b = try #require(MTPDate.parse("20260101T000000Z"))
    #expect(a.timeIntervalSince(b) == 0.5)
  }
}

@Suite("Transactions")
struct TransactionTests {
  @Test func deviceInfoAndStorages() throws {
    let sim = SimulatedDevice()
    let device = try openDevice(sim)
    #expect(device.info.model == "Pixel Sim")
    #expect(device.info.isAndroid)
    #expect(device.info.supports(.getObjectPropList))
    let storages = try device.storages()
    #expect(storages.map(\.id) == [sim.storageID])  // unmounted storage filtered
    #expect(storages.first?.displayName == "Internal shared storage")
    #expect(sim.violations.isEmpty)
  }

  @Test func staleSessionIsReopened() throws {
    let sim = SimulatedDevice()
    _ = try openDevice(sim)  // leaves the session open, like a crashed host
    let second = try openDevice(sim)
    #expect(try second.storages().count == 1)
    #expect(sim.violations.isEmpty, "\(sim.violations)")
  }

  @Test(arguments: [false, true])
  func listingStrategiesAgree(propList: Bool) throws {
    let sim = SimulatedDevice()
    sim.supportsPropertyList = propList
    let dcim = sim.add("DCIM", directory: true)
    let camera = sim.add("Camera", parent: dcim, directory: true)
    for i in 0..<300 { sim.add("IMG_\(i).jpg", parent: camera, contents: pattern(i)) }
    sim.add("Download", directory: true)

    let device = try openDevice(sim)
    let root = try device.children(storage: sim.storageID)
    #expect(Set(root.map(\.name)) == ["DCIM", "Download"])
    #expect(root.allSatisfy { $0.isDirectory })

    let photos = try device.children(storage: sim.storageID, parent: camera)
    #expect(photos.count == 300)
    #expect(photos.first(where: { $0.name == "IMG_299.jpg" })?.size == 299)
    #expect(photos.allSatisfy { $0.parent == camera && $0.modified != nil })
    #expect(sim.violations.isEmpty)

    if propList {
      #expect(sim.operationCounts[.getObjectInfo, default: 0] == 0)
      #expect(sim.operationCounts[.getObjectPropList] == 2)
    } else {
      #expect(sim.operationCounts[.getObjectInfo] == 302)
    }
  }

  @Test func propertyListUsesFarFewerRoundTrips() throws {
    func roundTrips(_ strategy: MTPDevice.ListingStrategy) throws -> Int {
      let sim = SimulatedDevice()
      for i in 0..<1000 { sim.add("f\(i)", contents: pattern(8)) }
      let device = try openDevice(sim)
      device.listingStrategy = strategy
      let before = sim.operationCounts.values.reduce(0, +)
      #expect(try device.children(storage: sim.storageID).count == 1000)
      return sim.operationCounts.values.reduce(0, +) - before
    }
    #expect(try roundTrips(.propertyList) == 1)
    #expect(try roundTrips(.objectInfo) == 1001)
  }

  @Test func pathResolutionListsEachDirectoryOnce() throws {
    let sim = SimulatedDevice()
    let dcim = sim.add("DCIM", directory: true)
    let camera = sim.add("Camera", parent: dcim, directory: true)
    for i in 0..<50 { sim.add("noise\(i)", parent: dcim) }
    let target = sim.add("IMG.jpg", parent: camera, contents: pattern(10))
    let device = try openDevice(sim)
    #expect(
      try device.resolve(storage: sim.storageID, path: "/DCIM/Camera/IMG.jpg")?.handle == target)
    #expect(try device.resolve(storage: sim.storageID, path: "/dcim/camera")?.handle == camera)
    #expect(sim.operationCounts[.getObjectPropList] == 3)  // root, DCIM, Camera — then cached
    #expect(throws: MTPError.notFound("/DCIM/Nope")) {
      try device.resolve(storage: sim.storageID, path: "/DCIM/Nope")
    }
  }

  @Test(arguments: [
    (size: 0, split: false, zlp: true),
    (size: 1, split: false, zlp: true),
    (size: 500, split: false, zlp: true),  // 512-byte container: ZLP boundary
    (size: 1 << 20, split: false, zlp: true),
    (size: (1 << 20) - 12, split: false, zlp: true),  // exactly one transfer
    (size: 3_000_001, split: false, zlp: true),
    (size: 3_000_001, split: true, zlp: true),
    (size: 512 * 40 - 12, split: false, zlp: false),  // xHCI: no ZLP after aligned data
    (size: 512 * 40, split: true, zlp: true),
  ])
  func downloadIsByteExact(size: Int, split: Bool, zlp: Bool) throws {
    let sim = SimulatedDevice()
    sim.splitHeader = split
    sim.omitZLP = !zlp
    let payload = pattern(size)
    sim.add("blob.bin", contents: payload)
    let device = try openDevice(sim, transferSize: 256 * 1024)
    let obj = try #require(try device.children(storage: sim.storageID).first)

    var received = Data()
    try device.session.getObject(obj.handle, sink: { received.append($0) })
    #expect(received == payload)
    // The session must still be usable afterwards.
    #expect(try device.storages().count == 1)
    #expect(sim.violations.isEmpty)
    #expect(device.session.separateHeader == split)
  }

  @Test func unknownLengthDataPhaseReadsToShortPacket() throws {
    let sim = SimulatedDevice()
    sim.unknownLengthThreshold = 0
    let payload = pattern(700_000)
    let h = sim.add("huge.mkv", contents: payload)
    let device = try openDevice(sim, transferSize: 64 * 1024)
    var received = Data()
    try device.session.getObject(h, sink: { received.append($0) })
    #expect(received == payload)
    #expect(try device.storages().count == 1)
    #expect(sim.violations.isEmpty)
  }

  @Test func largerBuffersReduceSimulatedBulkReadCalls() throws {
    func inTransfers(_ transferSize: Int) throws -> Int {
      let sim = SimulatedDevice()
      let h = sim.add("v.mp4", contents: pattern(8 << 20))
      let device = try openDevice(sim, transferSize: transferSize)
      let before = sim.inTransfers
      try device.session.getObject(h, sink: { _ in })
      return sim.inTransfers - before
    }
    // Both runs use this Swift engine. Counts include the data phase and response,
    // not individual USB packets. No Go code or hardware is exercised here.
    let smallBuffer = try inTransfers(16 * 1024)
    let largeBuffer = try inTransfers(1 << 20)
    #expect(smallBuffer == 514)
    #expect(largeBuffer == 10)
  }

  @Test func partialObject64Reads() throws {
    let sim = SimulatedDevice()
    let payload = pattern(100_000)
    let h = sim.add("v.mp4", contents: payload)
    let device = try openDevice(sim)
    var chunk = Data()
    let n = try device.session.getPartialObject64(
      h, offset: 40_000, length: 5000, sink: { chunk.append($0) })
    #expect(n == 5000)
    #expect(chunk == payload.subdata(in: 40_000..<45_000))
  }

  @Test func protocolErrorsAreTyped() throws {
    let sim = SimulatedDevice()
    let device = try openDevice(sim)
    #expect(throws: MTPError.response(.invalidObjectHandle, operation: .getObjectInfo)) {
      try device.session.getObjectInfo(999)
    }
    // A device error is not a desync: the session stays usable.
    #expect(!device.session.isBroken)
    #expect(try device.storages().count == 1)
  }

  @Test func cancellationBreaksTheSession() throws {
    let sim = SimulatedDevice()
    let h = sim.add("v.mp4", contents: pattern(4 << 20))
    let device = try openDevice(sim, transferSize: 64 * 1024)
    #expect(throws: MTPError.cancelled) {
      try device.session.getObject(
        h, sink: { _ in }, progress: { if $0 > 1 << 20 { throw CancellationError() } })
    }
    #expect(device.session.isBroken)
  }
}

@Suite("File operations")
struct FileOperationTests {
  private func tempDir() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "mtpcore-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  @Test(arguments: [0, 511, 500, 1 << 20, (1 << 20) - 12, 2_500_000])
  func uploadThenDownloadRoundTrips(size: Int) throws {
    let sim = SimulatedDevice()
    let device = try openDevice(sim, transferSize: 256 * 1024)
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let payload = pattern(size, seed: 3)
    let source = dir.appendingPathComponent("in.bin")
    try payload.write(to: source)
    let modified = Date(timeIntervalSince1970: 1_790_000_000)
    try FileManager.default.setAttributes([.modificationDate: modified], ofItemAtPath: source.path)

    let folder = try device.makeDirectory("Backup", storage: sim.storageID)
    let handle = try device.upload(source, storage: sim.storageID, parent: folder)
    #expect(sim.nodes[handle]?.contents == payload)
    #expect(sim.violations.isEmpty)

    let listed = try #require(try device.children(storage: sim.storageID, parent: folder).first)
    #expect(listed.name == "in.bin")
    #expect(listed.size == UInt64(size))
    #expect(listed.modified == modified)

    let out = dir.appendingPathComponent("out.bin")
    var lastProgress: UInt64 = 0
    try device.download(listed, to: out, progress: { lastProgress = $0 })
    #expect(try Data(contentsOf: out) == payload)
    #expect(lastProgress == UInt64(size))
    let mtime =
      try FileManager.default.attributesOfItem(atPath: out.path)[.modificationDate] as? Date
    #expect(mtime == modified)
    #expect(
      try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted() == [
        "in.bin", "out.bin",
      ])
  }

  @Test func separateHeaderDevicesGetSeparateHeadersBack() throws {
    let sim = SimulatedDevice()
    sim.splitHeader = true
    sim.add("seed", contents: pattern(2000))
    let device = try openDevice(sim)
    let seed = try #require(try device.children(storage: sim.storageID).first)
    try device.session.getObject(seed.handle, sink: { _ in })
    #expect(device.session.separateHeader)

    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let source = dir.appendingPathComponent("up.bin")
    try pattern(5000).write(to: source)
    let h = try device.upload(source, storage: sim.storageID)
    #expect(sim.nodes[h]?.contents == pattern(5000))
    #expect(sim.violations.isEmpty)
  }

  @Test func renameAndDeleteInvalidateTheCache() throws {
    let sim = SimulatedDevice()
    let dir = sim.add("Music", directory: true)
    sim.add("a.mp3", parent: dir, contents: pattern(10))
    let device = try openDevice(sim)
    let music = try #require(try device.resolve(storage: sim.storageID, path: "/Music"))
    try device.rename(music, to: "Tunes")
    #expect(try device.children(storage: sim.storageID).map(\.name) == ["Tunes"])
    let tunes = try #require(try device.children(storage: sim.storageID).first)
    try device.delete(tunes)
    #expect(try device.children(storage: sim.storageID).isEmpty)
    #expect(sim.nodes.isEmpty)  // Android deletes folders recursively
  }

  @Test func failedDownloadLeavesNoPartialFile() throws {
    let sim = SimulatedDevice()
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let device = try openDevice(sim)
    let ghost = MTPObject(
      handle: 77, storageID: sim.storageID, parent: MTPHandle.root, name: "ghost", format: 0x3000,
      size: 5, modified: nil)
    #expect(throws: MTPError.self) {
      try device.download(ghost, to: dir.appendingPathComponent("ghost"))
    }
    #expect(try FileManager.default.contentsOfDirectory(atPath: dir.path).isEmpty)
  }
}
