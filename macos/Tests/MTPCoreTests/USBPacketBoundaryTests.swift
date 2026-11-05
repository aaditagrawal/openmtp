import Foundation
import Testing

@testable import MTPCore
@testable import MTPSimulation

/// A host/device pair with distinct legal full-speed IN/OUT packet sizes. It
/// withholds the response until an aligned OUT data phase receives its ZLP.
private final class AsymmetricPacketTransport: MTPTransport {
  let maxPacketSize: Int
  let maxOutPacketSize: Int
  private var inbound = [Data]()
  private var activeTransaction: UInt32 = 0
  private var receiving = false
  private var waitingForZLP = false
  private var dataPhase = Data()
  private(set) var payload = Data()
  private(set) var dataWrites = [Int]()
  private(set) var readLengths = [Int]()
  var primeSplitHeader = false

  init(input: Int, output: Int) {
    maxPacketSize = input
    maxOutPacketSize = output
  }
  func bulkWrite(_ data: Data, timeout: TimeInterval) throws {
    if receiving || waitingForZLP {
      dataWrites.append(data.count)
      if waitingForZLP {
        guard data.isEmpty else { throw MTPError.protocolDesync("missing OUT ZLP") }
        waitingForZLP = false
        queueResponse()
        return
      }
      dataPhase.append(data)
      let header = try ContainerHeader(dataPhase)
      guard dataPhase.count <= Int(header.length) else {
        throw MTPError.protocolDesync("outgoing data overran its container")
      }
      if dataPhase.count < Int(header.length) {
        let loneHeader = primeSplitHeader && dataPhase.count == 12
        guard data.count.isMultiple(of: maxOutPacketSize) || loneHeader else {
          throw MTPError.protocolDesync("premature short OUT packet")
        }
        return
      }
      payload = Data(dataPhase.dropFirst(12))
      receiving = false
      waitingForZLP = data.count.isMultiple(of: maxOutPacketSize)
      if !waitingForZLP { queueResponse() }
      return
    }
    let command = try ContainerHeader(data)
    activeTransaction = command.transactionID
    if command.code == OperationCode.sendObject.rawValue {
      receiving = true
      dataPhase = Data()
    } else if command.code == OperationCode.getObject.rawValue, primeSplitHeader {
      var header = ByteWriter()
      header.u32(16)
      header.u16(ContainerType.data.rawValue)
      header.u16(command.code)
      header.u32(activeTransaction)
      inbound.append(header.data)
      inbound.append(Data([1, 2, 3, 4]))
      queueResponse()
    } else {
      queueResponse()
    }
  }
  private func queueResponse() {
    var response = ByteWriter()
    response.u32(12)
    response.u16(ContainerType.response.rawValue)
    response.u16(ResponseCode.ok.rawValue)
    response.u32(activeTransaction)
    inbound.append(response.data)
  }
  func bulkRead(maxLength: Int, timeout: TimeInterval) throws -> Data {
    readLengths.append(maxLength)
    guard maxLength.isMultiple(of: maxPacketSize), !inbound.isEmpty else {
      throw MTPError.timeout
    }
    return inbound.removeFirst()
  }
  func close() {}
}

@Suite("Directional USB packet boundaries")
struct USBPacketBoundaryTests {
  @Test(arguments: [false, true])
  func uploadsTerminateAtTheOUTBoundaryWhenINHasLargerPackets(split: Bool) throws {
    let transport = AsymmetricPacketTransport(input: 64, output: 8)
    let session = MTPSession(transport: transport)
    session.transferSize = 100
    try session.openSession()
    if split {
      transport.primeSplitHeader = true
      try session.getObject(1, sink: { _ in }, expectedSize: 4)
      #expect(session.separateHeader)
    }
    let payload = Data(repeating: 0xA5, count: split ? 32 : 20)
    try session.transact(.sendObject, send: .bytes(payload))
    #expect(transport.payload == payload)
    #expect(transport.dataWrites.last == 0)
    #expect(!session.isBroken)
    #expect(transport.readLengths.allSatisfy { $0.isMultiple(of: 64) })
  }

  @Test func chunkRoundingUsesOUTWhileReadBuffersRemainINAligned() throws {
    let transport = AsymmetricPacketTransport(input: 64, output: 16)
    let session = MTPSession(transport: transport)
    session.transferSize = 65
    try session.openSession()
    let payload = Data(repeating: 0xC3, count: 84)
    try session.transact(.sendObject, send: .bytes(payload))
    #expect(transport.payload == payload)
    #expect(transport.dataWrites == [80, 16, 0])
    #expect(transport.readLengths.allSatisfy { $0 == 128 })
  }

  @Test func unknownSizeWithoutItsRequiredZLPFailsBeforeAtomicCommit() throws {
    let sim = SimulatedDevice()
    let bytes = Data(repeating: 0x4B, count: 512 * 40 - 12)
    sim.add("unknown.bin", contents: bytes)
    let device = try MTPDevice(transport: sim)
    var object = try #require(try device.children(storage: sim.storageID).first)
    object.size = nil
    sim.unknownLengthThreshold = 0
    sim.omitZLP = true
    device.session.transferSize = 64 * 1024
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "unknown-boundary-\(UUID())", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: directory) }
    let destination = directory.appendingPathComponent("unknown.bin")
    let original = Data("keep the original".utf8)
    try original.write(to: destination)
    #expect(throws: MTPError.self) { try device.download(object, to: destination) }
    #expect(device.session.isBroken)
    #expect(try Data(contentsOf: destination) == original)
    #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path) == ["unknown.bin"])
  }

  @Test func unknownSizeWithZLPKeepsResponseLookingBytesInsideTheFile() throws {
    let sim = SimulatedDevice()
    sim.unknownLengthThreshold = 0
    var payload = Data(repeating: 0x5A, count: 512 * 40 - 24)
    var tail = ByteWriter()
    tail.u32(12)
    tail.u16(ContainerType.response.rawValue)
    tail.u16(ResponseCode.ok.rawValue)
    tail.u32(1)
    payload.append(tail.data)
    let handle = sim.add("response-looking-tail.bin", contents: payload)
    let session = MTPSession(transport: sim)
    session.transferSize = 64 * 1024
    try session.openSession()
    var received = Data()
    try session.getObject(handle, sink: { received.append($0) })
    #expect(received == payload)
    #expect(!session.isBroken)
    #expect(try session.getStorageIDs().contains(sim.storageID))
    #expect(sim.violations.isEmpty)
  }
}
