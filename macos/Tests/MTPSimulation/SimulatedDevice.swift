import Foundation
import MTPCore

/// An in-memory Android-like MTP responder behind a packet-accurate USB bulk model.
///
/// It enforces host-side rules a real device depends on (IN buffers in whole packets, no
/// premature short packets in an OUT data phase, zero-length packets on packet
/// boundaries, sequential transaction IDs) and records violations in `violations`.
final class SimulatedDevice: MTPTransport {
  struct Node {
    var handle: UInt32
    var parent: UInt32  // 0 = storage root, as Android reports it
    var name: String
    var isDirectory: Bool
    var contents = Data()
    var modified = "20260102T030405"
  }

  // Behaviour switches.
  var maxPacketSize = 512
  var supportsPropertyList = true
  var supportsFilenameRename = true
  var forcedResponses: [OperationCode: ResponseCode] = [:]
  /// Send each data container's 12-byte header as its own packet (MTP 1.1 Appendix H).
  var splitHeader = false
  /// Report 0xFFFFFFFF as the data length of GetObject payloads at least this large.
  var unknownLengthThreshold = Int.max
  /// Behave like the Linux xHCI quirk: no ZLP after a packet-aligned data container.
  var omitZLP = false
  /// Fake metadata independent of payload allocation, for 64-bit/truncation tests.
  var reportedSizes: [UInt32: UInt64] = [:]
  var omitObjectSizes = false
  var omitListingIdentity = false
  var propertyListAllObjects = false

  let storageID: UInt32 = 0x0001_0001
  private(set) var nodes: [UInt32: Node] = [:]
  private var nextHandle: UInt32 = 1

  private(set) var violations: [String] = []
  private(set) var operationCounts: [OperationCode: Int] = [:]
  private(set) var inTransfers = 0
  private(set) var outTransfers = 0

  private var inPackets: [Data] = []
  private var sessionOpen = false
  private var expectedTID: UInt32 = 0

  private enum RxState {
    case command
    case data(
      op: OperationCode, params: [UInt32], tid: UInt32, length: UInt32, payload: Data,
      headerSeen: Bool)
    case zlp
  }

  private var rx: RxState = .command
  private var pendingSendHandle: UInt32?

  init() {}

  @discardableResult
  func add(
    _ name: String, parent: UInt32 = 0, directory: Bool = false, contents: Data = Data(),
    modified: String = "20260102T030405"
  ) -> UInt32 {
    let h = nextHandle
    nextHandle += 1
    nodes[h] = Node(
      handle: h, parent: parent, name: name, isDirectory: directory, contents: contents,
      modified: modified)
    return h
  }

  func children(of parent: UInt32) -> [Node] {
    nodes.values.filter { $0.parent == parent }.sorted { $0.handle < $1.handle }
  }

  // MARK: MTPTransport

  func bulkWrite(_ data: Data, timeout _: TimeInterval) throws {
    outTransfers += 1
    switch rx {
    case .zlp:
      if !data.isEmpty { violations.append("missing ZLP after packet-aligned data container") }
      rx = .command
      if data.isEmpty { return }
      try handleCommand(data)
    case .command:
      try handleCommand(data)
    case .data(let op, let params, let tid, var length, var payload, var headerSeen):
      var bytes = data
      if !headerSeen {
        guard bytes.count >= 12 else {
          violations.append("data header split below 12 bytes")
          return
        }
        var r = ByteReader(bytes)
        length = try r.u32()
        let type = try r.u16()
        let code = try r.u16()
        let dtid = try r.u32()
        if type != ContainerType.data.rawValue || code != op.rawValue || dtid != tid {
          violations.append("bad data header type \(type) code \(code) tid \(dtid)")
        }
        bytes = Data(bytes.dropFirst(12))
        headerSeen = true
      }
      payload.append(bytes)
      let short = data.count % maxPacketSize != 0
      let total = 12 + payload.count
      let complete = length == 0xFFFF_FFFF ? short : total >= Int(length)
      if complete {
        if length != 0xFFFF_FFFF, total != Int(length) {
          violations.append("data phase overran: \(total) vs \(length)")
        }
        rx = data.count % maxPacketSize == 0 ? .zlp : .command
        respond(to: op, params: params, tid: tid, incoming: payload)
      } else {
        let loneHeader = splitHeader && data.count == 12 && payload.isEmpty
        if short, !loneHeader {
          violations.append("premature short packet in data phase (\(data.count) bytes)")
        }
        rx = .data(
          op: op, params: params, tid: tid, length: length, payload: payload, headerSeen: headerSeen
        )
      }
    }
  }

  func bulkRead(maxLength: Int, timeout _: TimeInterval) throws -> Data {
    inTransfers += 1
    if maxLength % maxPacketSize != 0 {
      violations.append("IN buffer \(maxLength) is not a packet multiple")
    }
    guard !inPackets.isEmpty else { throw MTPError.timeout }
    var out = Data()
    while let packet = inPackets.first, out.count + packet.count <= maxLength {
      inPackets.removeFirst()
      out.append(packet)
      if packet.count < maxPacketSize || out.count == maxLength { break }
    }
    return out
  }

  func close() {}

  // MARK: Device logic

  private func handleCommand(_ data: Data) throws {
    var r = ByteReader(data)
    let length = try r.u32()
    let type = try r.u16()
    let op = OperationCode(rawValue: try r.u16())
    let tid = try r.u32()
    guard type == ContainerType.command.rawValue, Int(length) == data.count else {
      violations.append("malformed command container")
      return
    }
    var params = [UInt32]()
    while r.remaining >= 4 { params.append(try r.u32()) }
    operationCounts[op, default: 0] += 1

    // GetDeviceInfo is valid outside a session (tid 0), and a new host process
    // cannot know a stale session's counter when it sends CloseSession.
    if sessionOpen, ![.openSession, .getDeviceInfo, .closeSession].contains(op) {
      if tid != expectedTID { violations.append("\(op) tid \(tid), expected \(expectedTID)") }
      expectedTID = tid &+ 1
    }

    switch op {
    case .sendObjectInfo, .sendObject, .setObjectPropValue:
      rx = .data(op: op, params: params, tid: tid, length: 0, payload: Data(), headerSeen: false)
    default:
      respond(to: op, params: params, tid: tid, incoming: nil)
    }
  }

  private func respond(to op: OperationCode, params: [UInt32], tid: UInt32, incoming: Data?) {
    func reply(
      _ code: ResponseCode, _ responseParams: [UInt32] = [], data: Data? = nil,
      unknownLength: Bool = false
    ) {
      if let data {
        queue(type: .data, code: op.rawValue, tid: tid, payload: data, unknownLength: unknownLength)
      }
      var w = ByteWriter()
      for parameter in responseParams { w.u32(parameter) }
      queue(type: .response, code: code.rawValue, tid: tid, payload: w.data, unknownLength: false)
    }

    if let code = forcedResponses[op] { return reply(code) }
    switch op {
    case .getDeviceInfo:
      reply(.ok, data: deviceInfo())
    case .openSession:
      if sessionOpen { return reply(.sessionAlreadyOpen) }
      sessionOpen = true
      expectedTID = 1
      reply(.ok)
    case .closeSession:
      sessionOpen = false
      reply(.ok)
    case .getStorageIDs:
      var w = ByteWriter()
      w.u32Array([storageID, 0x0002_0000])  // second storage is unmounted
      reply(.ok, data: w.data)
    case .getStorageInfo:
      var w = ByteWriter()
      w.u16(3)
      w.u16(2)
      w.u16(0)
      w.u64(128 << 30)
      w.u64(64 << 30)
      w.u32(0xFFFF_FFFF)
      try! w.string("Internal shared storage")
      try! w.string("")
      reply(.ok, data: w.data)
    case .getObjectHandles:
      let parent = params[2] == MTPHandle.root ? 0 : params[2]
      var w = ByteWriter()
      w.u32Array(children(of: parent).map(\.handle))
      reply(.ok, data: w.data)
    case .getObjectInfo:
      guard let n = nodes[params[0]] else { return reply(.invalidObjectHandle) }
      reply(.ok, data: try! objectInfo(n).encoded())
    case .getObjectPropValue:
      guard let n = nodes[params[0]] else { return reply(.invalidObjectHandle) }
      var w = ByteWriter()
      switch ObjectProperty(rawValue: UInt16(params[1])) {
      case .objectSize:
        guard !omitObjectSizes else { return reply(.invalidObjectPropCode) }
        w.u64(reportedSizes[n.handle] ?? UInt64(n.contents.count))
      case .objectFileName: try! w.string(n.name)
      default: return reply(.invalidObjectPropCode)
      }
      reply(.ok, data: w.data)
    case .getObjectPropList:
      guard supportsPropertyList else { return reply(.operationNotSupported) }
      let handle = params[0]
      let depth = params[4]
      guard depth <= 1 else { return reply(.specificationByDepthUnsupported) }
      var list = [Node]()
      // Android includes the object itself.
      if handle != 0, let n = nodes[handle] { list.append(n) }
      if handle == 0 || depth == 1 { list += children(of: handle == 0 ? 0 : handle) }
      reply(
        .ok,
        data: propertyList(
          propertyListAllObjects ? nodes.values.sorted { $0.handle < $1.handle } : list))
    case .getObject:
      guard let n = nodes[params[0]] else { return reply(.invalidObjectHandle) }
      reply(.ok, data: n.contents, unknownLength: n.contents.count >= unknownLengthThreshold)
    case .androidGetPartialObject64:
      guard let n = nodes[params[0]] else { return reply(.invalidObjectHandle) }
      let offset = Int(UInt64(params[1]) | UInt64(params[2]) << 32)
      let end = min(n.contents.count, offset + Int(params[3]))
      let slice = offset < end ? n.contents.subdata(in: offset..<end) : Data()
      reply(.ok, [UInt32(slice.count)], data: slice)
    case .sendObjectInfo:
      guard let incoming, let oi = try? ObjectInfo(decoding: incoming) else {
        return reply(.invalidParameter)
      }
      let parent = params[1] == MTPHandle.root ? 0 : params[1]
      let h = add(
        oi.filename, parent: parent, directory: oi.objectFormat == ObjectFormat.association)
      if !oi.dateModified.isEmpty { nodes[h]?.modified = oi.dateModified }
      pendingSendHandle = oi.objectFormat == ObjectFormat.association ? nil : h
      reply(.ok, [storageID, params[1], h])
    case .sendObject:
      guard let h = pendingSendHandle else { return reply(.generalError) }
      nodes[h]?.contents = incoming ?? Data()
      pendingSendHandle = nil
      reply(.ok)
    case .setObjectPropValue:
      guard supportsFilenameRename else { return reply(.operationNotSupported) }
      guard nodes[params[0]] != nil, let incoming else { return reply(.invalidObjectHandle) }
      var r = ByteReader(incoming)
      nodes[params[0]]?.name = (try? r.string()) ?? ""
      reply(.ok)
    case .deleteObject:
      guard nodes[params[0]] != nil else { return reply(.invalidObjectHandle) }
      deleteRecursively(params[0])
      reply(.ok)
    default:
      reply(.operationNotSupported)
    }
  }

  private func deleteRecursively(_ h: UInt32) {
    for child in children(of: h) { deleteRecursively(child.handle) }
    nodes[h] = nil
  }

  private func queue(
    type: ContainerType, code: UInt16, tid: UInt32, payload: Data, unknownLength: Bool
  ) {
    var w = ByteWriter()
    let total = 12 + payload.count
    w.u32(unknownLength ? 0xFFFF_FFFF : UInt32(total))
    w.u16(type.rawValue)
    w.u16(code)
    w.u32(tid)
    var container = w.data
    if splitHeader, type == .data {
      inPackets.append(container)
      container = Data()
    }
    container.append(payload)
    var offset = 0
    while offset < container.count {
      let end = min(offset + maxPacketSize, container.count)
      inPackets.append(container.subdata(in: offset..<end))
      offset = end
    }
    let alignedLength = splitHeader && type == .data ? payload.count : total
    if alignedLength > 0, alignedLength % maxPacketSize == 0, !omitZLP {
      inPackets.append(Data())
    }
  }

  private func deviceInfo() -> Data {
    var w = ByteWriter()
    w.u16(100)
    w.u32(6)
    w.u16(100)
    try! w.string("microsoft.com: 1.0; android.com: 1.0;")
    w.u16(0)
    var ops: [UInt16] = [
      0x1001, 0x1002, 0x1003, 0x1004, 0x1005, 0x1007, 0x1008, 0x1009, 0x100B,
      0x100C, 0x100D, 0x9803, 0x95C1,
    ]
    if supportsFilenameRename { ops.append(0x9804) }
    if supportsPropertyList { ops.append(0x9805) }
    w.u16Array(ops)
    w.u16Array([0x4002, 0x4003])
    w.u16Array([])
    w.u16Array([])
    w.u16Array([0x3000, 0x3001])
    try! w.string("Google")
    try! w.string("Pixel Sim")
    try! w.string("1.0")
    try! w.string("SIM123")
    return w.data
  }

  private func objectInfo(_ n: Node) -> ObjectInfo {
    var oi = ObjectInfo()
    oi.storageID = storageID
    oi.objectFormat = n.isDirectory ? ObjectFormat.association : ObjectFormat.undefined
    let size = reportedSizes[n.handle] ?? UInt64(n.contents.count)
    oi.compressedSize = omitObjectSizes || size >= 0xFFFF_FFFF ? 0xFFFF_FFFF : UInt32(size)
    oi.parentObject = n.parent
    oi.associationType = n.isDirectory ? AssociationType.genericFolder : 0
    oi.filename = n.name
    oi.dateModified = n.modified
    return oi
  }

  private func propertyList(_ list: [Node]) -> Data {
    var w = ByteWriter()
    w.u32(UInt32(list.count * (7 - (omitObjectSizes ? 1 : 0) - (omitListingIdentity ? 2 : 0))))
    for n in list {
      func head(_ p: ObjectProperty, _ t: DataType) {
        w.u32(n.handle)
        w.u16(p.rawValue)
        w.u16(t.rawValue)
      }
      if !omitListingIdentity {
        head(.storageID, .uint32)
        w.u32(storageID)
      }
      head(.objectFormat, .uint16)
      w.u16(n.isDirectory ? ObjectFormat.association : ObjectFormat.undefined)
      if !omitObjectSizes {
        head(.objectSize, .uint64)
        w.u64(reportedSizes[n.handle] ?? UInt64(n.contents.count))
      }
      head(.objectFileName, .string)
      try! w.string(n.name)
      head(.dateModified, .string)
      try! w.string(n.modified)
      if !omitListingIdentity {
        head(.parentObject, .uint32)
        w.u32(n.parent)
      }
      head(.persistentUID, .uint128)
      w.u64(UInt64(n.handle))
      w.u64(0)
    }
    return w.data
  }
}
