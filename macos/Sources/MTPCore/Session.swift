import Foundation

/// A USB bulk-pipe pair (plus optional control pipe) that speaks the PTP/MTP USB still-image class.
///
/// Semantics match a real USB host controller: a bulk IN transfer completes when a
/// short (or zero-length) packet arrives or the buffer fills; a bulk OUT transfer whose
/// length is a multiple of `maxPacketSize` needs a separate zero-length write to end a container.
public protocol MTPTransport: AnyObject {
  /// wMaxPacketSize of the bulk endpoints: 512 on USB 2, 1024 on USB 3.
  var maxPacketSize: Int { get }
  /// One bulk OUT transfer. `Data()` sends a zero-length packet.
  func bulkWrite(_ data: Data, timeout: TimeInterval) throws
  /// One bulk IN transfer of at most `maxLength` bytes; `maxLength` is a multiple of `maxPacketSize`.
  func bulkRead(maxLength: Int, timeout: TimeInterval) throws -> Data
  /// PTP class-specific Cancel Request (0x64) for `transactionID`, best effort.
  func cancelTransaction(_ transactionID: UInt32) throws
  func close()
}

extension MTPTransport {
  public func cancelTransaction(_: UInt32) throws {}
}

/// An outgoing data phase. `read(n)` returns up to `n` bytes; an empty result before
/// `count` bytes were produced is an error.
public struct MTPOutgoingData {
  public let count: UInt64
  public let read: (Int) throws -> Data

  public init(count: UInt64, read: @escaping (Int) throws -> Data) {
    self.count = count
    self.read = read
  }

  public static func bytes(_ data: Data) -> MTPOutgoingData {
    var offset = 0
    return MTPOutgoingData(count: UInt64(data.count)) { n in
      let end = min(offset + n, data.count)
      defer { offset = end }
      return data.subdata(in: offset..<end)
    }
  }
}

public struct MTPResponse: Sendable, Equatable {
  public var code: ResponseCode
  public var transactionID: UInt32
  public var parameters: [UInt32]
}

/// Progress callback: total payload bytes moved so far. Throw to cancel.
public typealias MTPProgress = (UInt64) throws -> Void

/// The MTP transaction engine: command, optional data phase, response.
///
/// Compared with the go-mtpfs engine behind the Electron app, data phases use large
/// bulk transfers (`transferSize`, default 1 MiB, instead of 16 KiB), stream directly to
/// the caller and tolerate split headers, stray zero-length packets, unknown (>4 GiB)
/// lengths and responses that arrive in the same transfer as the tail of a data phase.
///
/// Calls are serialized with a recursive lock; use `exclusive` to keep multi-transaction
/// sequences (SendObjectInfo + SendObject) adjacent.
public final class MTPSession: @unchecked Sendable {
  public let transport: MTPTransport
  public var timeout: TimeInterval = 10
  /// Preferred size of a single bulk transfer. Rounded up to a packet multiple.
  public var transferSize: Int = 1 << 20

  public private(set) var isOpen = false
  /// Set after a desync, timeout or cancellation. Reopen the device to recover.
  public private(set) var isBroken = false
  /// The device sent a header-only first packet (MTP 1.1 Appendix H); mirror it when sending.
  public private(set) var separateHeader = false

  private var sessionID: UInt32 = 0
  private var nextTransactionID: UInt32 = 0
  private var pending = Data()
  private var lastReadWasShort = true
  private let lock = NSRecursiveLock()

  public init(transport: MTPTransport) {
    self.transport = transport
  }

  public func exclusive<T>(_ body: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try body()
  }

  // MARK: Sessions

  public func openSession(id: UInt32 = 1) throws {
    try exclusive {
      nextTransactionID = 0
      do {
        _ = try transact(.openSession, [id])
      } catch MTPError.response(.sessionAlreadyOpen, _) {
        // A previous host process left the session open: close it and start over.
        isOpen = true
        sessionID = id
        _ = try? transact(.closeSession)
        nextTransactionID = 0
        _ = try transact(.openSession, [id])
      }
      sessionID = id
      isOpen = true
      nextTransactionID = 1
    }
  }

  public func closeSession() {
    exclusive {
      guard isOpen else { return }
      _ = try? transact(.closeSession)
      isOpen = false
      sessionID = 0
      nextTransactionID = 0
    }
  }

  // MARK: Transactions

  @discardableResult
  public func transact(
    _ op: OperationCode,
    _ params: [UInt32] = [],
    send: MTPOutgoingData? = nil,
    receive: ((Data) throws -> Void)? = nil,
    expectedReceiveSize: UInt64? = nil,
    progress: MTPProgress? = nil
  ) throws -> MTPResponse {
    precondition(params.count <= 5, "MTP commands carry at most five parameters")
    precondition(send == nil || receive == nil, "a transaction has at most one data phase")
    return try exclusive {
      guard !isBroken else { throw MTPError.sessionClosed }
      let tid = nextTransactionID
      if isOpen || op == .openSession { nextTransactionID &+= 1 }
      do {
        return try run(
          op, params, tid: tid, send: send, receive: receive,
          expectedReceiveSize: expectedReceiveSize, progress: progress)
      } catch let error as MTPError where error == .cancelled {
        try? transport.cancelTransaction(tid)
        isBroken = true
        throw error
      } catch let error as MTPError {
        if error.invalidatesSession { isBroken = true }
        throw error
      } catch is CancellationError {
        try? transport.cancelTransaction(tid)
        isBroken = true
        throw MTPError.cancelled
      } catch {
        // Anything else came from the transport or a sink (e.g. disk full).
        isBroken = true
        throw error
      }
    }
  }

  private var packetSize: Int { max(transport.maxPacketSize, 64) }

  private func roundedTransfer(_ n: Int) -> Int {
    let p = packetSize
    return max(p, (n + p - 1) / p * p)
  }

  private func run(
    _ op: OperationCode,
    _ params: [UInt32],
    tid: UInt32,
    send: MTPOutgoingData?,
    receive: ((Data) throws -> Void)?,
    expectedReceiveSize: UInt64?,
    progress: MTPProgress?
  ) throws -> MTPResponse {
    // Command phase.
    var cmd = ByteWriter(capacity: 32)
    cmd.u32(UInt32(12 + 4 * params.count))
    cmd.u16(ContainerType.command.rawValue)
    cmd.u16(op.rawValue)
    cmd.u32(tid)
    for parameter in params { cmd.u32(parameter) }
    try transport.bulkWrite(cmd.data, timeout: timeout)

    if let send {
      try sendData(op, tid: tid, send, progress: progress)
    }

    // Optional data phase from the device, then the response.
    var buffer = try nextContainerStart()
    var header = try ContainerHeader(buffer)
    var unexpectedData = false
    if header.type == ContainerType.data.rawValue {
      guard header.code == op.rawValue else {
        throw MTPError.protocolDesync(
          "data container for \(OperationCode(rawValue: header.code)) during \(op)")
      }
      unexpectedData = receive == nil
      try receiveData(
        header: header, first: buffer, sink: receive ?? { _ in }, expectedSize: expectedReceiveSize,
        progress: progress)
      buffer = try nextContainerStart()
      header = try ContainerHeader(buffer)
    }

    guard header.type == ContainerType.response.rawValue else {
      throw MTPError.protocolDesync("expected a response container, got type \(header.type)")
    }
    let length = Int(header.length)
    guard length >= 12, length <= 12 + 4 * 5 else {
      throw MTPError.protocolDesync("response length \(length)")
    }
    var emptyReads = 0
    while buffer.count < length {
      let more = try read(transferSize)
      if more.isEmpty {
        emptyReads += 1
        if emptyReads > 2 { throw MTPError.protocolDesync("truncated response") }
      }
      buffer.append(more)
    }
    var r = ByteReader(Data(buffer.prefix(length)))
    try r.skip(12)
    var responseParams = [UInt32]()
    while r.remaining >= 4 { responseParams.append(try r.u32()) }
    pending = Data(buffer.dropFirst(length))

    let response = MTPResponse(
      code: ResponseCode(rawValue: header.code), transactionID: header.transactionID,
      parameters: responseParams)
    if isOpen, op != .openSession, header.transactionID != tid {
      throw MTPError.protocolDesync("transaction ID \(header.transactionID), expected \(tid)")
    }
    if unexpectedData { throw MTPError.unexpectedData(op) }
    guard response.code == .ok else { throw MTPError.response(response.code, operation: op) }
    return response
  }

  // MARK: Data phases

  private func sendData(
    _ op: OperationCode, tid: UInt32, _ source: MTPOutgoingData, progress: MTPProgress?
  ) throws {
    let total = 12 + source.count
    var header = ByteWriter(capacity: 12)
    header.u32(total > 0xFFFF_FFFF ? 0xFFFF_FFFF : UInt32(total))
    header.u16(ContainerType.data.rawValue)
    header.u16(op.rawValue)
    header.u32(tid)

    // Every transfer except the last is a whole number of packets, so the device
    // never sees a premature short packet.
    let chunk = roundedTransfer(transferSize)
    var remaining = source.count
    var sent: UInt64 = 0
    var buffer: Data
    var lastTransferLength = 0
    if separateHeader {
      try transport.bulkWrite(header.data, timeout: timeout)
      lastTransferLength = 12
      buffer = Data()
    } else {
      buffer = header.data
    }
    buffer.reserveCapacity(chunk)

    while true {
      while buffer.count < chunk, remaining > 0 {
        let want = Int(min(UInt64(chunk - buffer.count), remaining))
        let piece = try source.read(want)
        guard !piece.isEmpty else {
          throw MTPError.transport("upload source ended \(remaining) bytes early")
        }
        buffer.append(piece)
        remaining -= UInt64(piece.count)
      }
      if buffer.isEmpty { break }
      try transport.bulkWrite(buffer, timeout: timeout)
      lastTransferLength = buffer.count
      sent = source.count - remaining
      try progress?(sent)
      buffer.removeAll(keepingCapacity: true)
      if remaining == 0 { break }
    }
    // A container that ends exactly on a packet boundary needs a zero-length packet.
    // (A lone separate header is a 12-byte short packet and already terminates.)
    if lastTransferLength % packetSize == 0, !(separateHeader && source.count == 0) {
      try transport.bulkWrite(Data(), timeout: timeout)
    }
  }

  private func receiveData(
    header: ContainerHeader, first: Data, sink: (Data) throws -> Void, expectedSize: UInt64?,
    progress: MTPProgress?
  ) throws {
    var received: UInt64 = 0
    func deliver(_ d: Data) throws {
      guard !d.isEmpty else { return }
      try sink(d)
      received += UInt64(d.count)
      try progress?(received)
    }

    let firstPayload = Data(first.dropFirst(12))
    if header.length == 0xFFFF_FFFF {
      // Unknown length (objects >= 4 GiB): read until a short transfer ends the container.
      try deliver(firstPayload)
      // The header-only short packet starts a split-header data phase. It
      // does not end the payload. A known empty object has no payload to read.
      var short = lastReadWasShort && !(separateHeader && first.count == 12 && expectedSize != 0)
      while !short {
        let d = try read(transferSize)
        try deliver(d)
        short = lastReadWasShort
      }
      return
    }

    guard header.length >= 12 else { throw MTPError.protocolDesync("data length \(header.length)") }
    var remaining = Int(header.length) - 12
    if first.count == 12, remaining > 0, lastReadWasShort {
      separateHeader = true
    }
    let take = min(firstPayload.count, remaining)
    try deliver(firstPayload.prefix(take))
    pending = Data(firstPayload.dropFirst(take))
    remaining -= take

    var emptyReads = 0
    while remaining > 0 {
      let d = try read(min(transferSize, remaining))
      if d.isEmpty {
        emptyReads += 1
        if emptyReads > 2 {
          throw MTPError.protocolDesync(
            "device stopped \(remaining) bytes before the end of the data phase")
        }
        continue
      }
      let n = min(d.count, remaining)
      try deliver(n == d.count ? d : d.prefix(n))
      if d.count > n { pending.append(d.dropFirst(n)) }
      remaining -= n
    }
  }

  // MARK: Bulk IN

  private func read(_ n: Int) throws -> Data {
    let size = roundedTransfer(n)
    let d = try transport.bulkRead(maxLength: size, timeout: timeout)
    lastReadWasShort = d.count < size
    return d
  }

  /// Returns at least 12 bytes beginning at a container boundary, skipping stray
  /// zero-length packets (a ZLP that ended the previous data phase).
  private func nextContainerStart() throws -> Data {
    var buffer = pending
    pending = Data()
    var emptyReads = 0
    while buffer.count < 12 {
      let d = try read(transferSize)
      if d.isEmpty {
        emptyReads += 1
        if emptyReads > 3 { throw MTPError.protocolDesync("no container from device") }
        continue
      }
      buffer.append(d)
    }
    return buffer
  }
}

struct ContainerHeader {
  var length: UInt32
  var type: UInt16
  var code: UInt16
  var transactionID: UInt32

  init(_ data: Data) throws {
    var r = ByteReader(Data(data.prefix(12)))
    length = try r.u32()
    type = try r.u16()
    code = try r.u16()
    transactionID = try r.u32()
  }
}
