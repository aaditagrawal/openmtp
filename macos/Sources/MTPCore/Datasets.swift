import Foundation

public enum MTPError: Error, Sendable, CustomStringConvertible, Equatable {
  case response(ResponseCode, operation: OperationCode)
  case truncatedDataset(needed: Int, available: Int)
  case stringTooLong(String)
  /// The host and device disagree about the transaction state. The session must be reopened.
  case protocolDesync(String)
  case unexpectedData(OperationCode)
  case timeout
  case cancelled
  case sessionClosed
  case notFound(String)
  case transport(String)

  public var description: String {
    switch self {
    case .response(let code, let op): "\(op) failed: \(code)"
    case .truncatedDataset(let needed, let available):
      "truncated dataset (needed \(needed) bytes, have \(available))"
    case .stringTooLong(let s): "MTP strings are limited to 254 UTF-16 units: \(s.prefix(40))…"
    case .protocolDesync(let why): "protocol desync: \(why)"
    case .unexpectedData(let op): "unexpected data phase for \(op)"
    case .timeout: "USB transfer timed out"
    case .cancelled: "cancelled"
    case .sessionClosed: "session is closed"
    case .notFound(let path): "not found: \(path)"
    case .transport(let why): why
    }
  }

  /// Errors after which the transaction stream can no longer be trusted.
  public var invalidatesSession: Bool {
    switch self {
    case .protocolDesync, .unexpectedData, .timeout, .transport, .cancelled: true
    default: false
    }
  }
}

public struct DeviceInfo: Sendable, Equatable {
  public var standardVersion: UInt16
  public var vendorExtensionID: UInt32
  public var vendorExtensionVersion: UInt16
  public var vendorExtensionDesc: String
  public var functionalMode: UInt16
  public var operationsSupported: Set<UInt16>
  public var eventsSupported: [UInt16]
  public var devicePropertiesSupported: [UInt16]
  public var captureFormats: [UInt16]
  public var playbackFormats: [UInt16]
  public var manufacturer: String
  public var model: String
  public var deviceVersion: String
  public var serialNumber: String

  public func supports(_ op: OperationCode) -> Bool { operationsSupported.contains(op.rawValue) }
  public var isAndroid: Bool { vendorExtensionDesc.contains("android.com") }

  public init(decoding data: Data) throws {
    var r = ByteReader(data)
    standardVersion = try r.u16()
    vendorExtensionID = try r.u32()
    vendorExtensionVersion = try r.u16()
    vendorExtensionDesc = try r.string()
    functionalMode = try r.u16()
    operationsSupported = Set(try r.u16Array())
    eventsSupported = try r.u16Array()
    devicePropertiesSupported = try r.u16Array()
    captureFormats = try r.u16Array()
    playbackFormats = try r.u16Array()
    manufacturer = try r.string()
    model = try r.string()
    deviceVersion = try r.string()
    serialNumber = try r.string()
  }
}

public struct StorageInfo: Sendable, Equatable, Identifiable {
  public var id: UInt32
  public var storageType: UInt16
  public var filesystemType: UInt16
  public var accessCapability: UInt16
  public var maxCapacity: UInt64
  public var freeSpaceInBytes: UInt64
  public var freeSpaceInObjects: UInt32
  public var storageDescription: String
  public var volumeIdentifier: String

  public var isReadOnly: Bool { accessCapability != 0 }
  public var displayName: String {
    storageDescription.isEmpty ? volumeIdentifier : storageDescription
  }

  public init(id: UInt32, decoding data: Data) throws {
    self.id = id
    var r = ByteReader(data)
    storageType = try r.u16()
    filesystemType = try r.u16()
    accessCapability = try r.u16()
    maxCapacity = try r.u64()
    freeSpaceInBytes = try r.u64()
    freeSpaceInObjects = try r.u32()
    storageDescription = try r.string()
    volumeIdentifier = try r.string()
  }
}

/// PTP ObjectInfo dataset (ISO 15740 §5.5.2).
public struct ObjectInfo: Sendable, Equatable {
  public var storageID: UInt32 = 0
  public var objectFormat: UInt16 = ObjectFormat.undefined
  public var protectionStatus: UInt16 = 0
  /// 0xFFFFFFFF when the object is 4 GiB or larger; query `ObjectProperty.objectSize` then.
  public var compressedSize: UInt32 = 0
  public var thumbFormat: UInt16 = 0
  public var thumbCompressedSize: UInt32 = 0
  public var thumbPixWidth: UInt32 = 0
  public var thumbPixHeight: UInt32 = 0
  public var imagePixWidth: UInt32 = 0
  public var imagePixHeight: UInt32 = 0
  public var imageBitDepth: UInt32 = 0
  public var parentObject: UInt32 = 0
  public var associationType: UInt16 = 0
  public var associationDesc: UInt32 = 0
  public var sequenceNumber: UInt32 = 0
  public var filename: String = ""
  public var dateCreated: String = ""
  public var dateModified: String = ""
  public var keywords: String = ""

  public init() {}

  public init(decoding data: Data) throws {
    var r = ByteReader(data)
    storageID = try r.u32()
    objectFormat = try r.u16()
    protectionStatus = try r.u16()
    compressedSize = try r.u32()
    thumbFormat = try r.u16()
    thumbCompressedSize = try r.u32()
    thumbPixWidth = try r.u32()
    thumbPixHeight = try r.u32()
    imagePixWidth = try r.u32()
    imagePixHeight = try r.u32()
    imageBitDepth = try r.u32()
    parentObject = try r.u32()
    associationType = try r.u16()
    associationDesc = try r.u32()
    sequenceNumber = try r.u32()
    filename = try r.string()
    dateCreated = try r.string()
    dateModified = try r.string()
    keywords = try r.string()
  }

  public func encoded() throws -> Data {
    var w = ByteWriter(capacity: 128)
    w.u32(storageID)
    w.u16(objectFormat)
    w.u16(protectionStatus)
    w.u32(compressedSize)
    w.u16(thumbFormat)
    w.u32(thumbCompressedSize)
    w.u32(thumbPixWidth)
    w.u32(thumbPixHeight)
    w.u32(imagePixWidth)
    w.u32(imagePixHeight)
    w.u32(imageBitDepth)
    w.u32(parentObject)
    w.u16(associationType)
    w.u32(associationDesc)
    w.u32(sequenceNumber)
    try w.string(filename)
    try w.string(dateCreated)
    try w.string(dateModified)
    try w.string(keywords)
    return w.data
  }
}

/// A decoded property value from GetObjectPropValue or GetObjectPropList.
public enum PropertyValue: Sendable, Equatable {
  case int(Int64)
  case uint(UInt64)
  case wide(Data)  // 128-bit values, little-endian
  case string(String)
  case array([PropertyValue])

  public var uint64: UInt64? {
    switch self {
    case .uint(let v): v
    case .int(let v): v >= 0 ? UInt64(v) : nil
    default: nil
    }
  }

  public var stringValue: String? {
    if case .string(let s) = self { return s }
    return nil
  }

  static func decode(type rawType: UInt16, from r: inout ByteReader) throws -> PropertyValue {
    if rawType & 0x4000 != 0, let element = DataType(rawValue: rawType & ~0x4000) {
      let count = Int(try r.u32())
      guard let size = element.scalarSize, count * size <= r.remaining else {
        throw MTPError.truncatedDataset(needed: count, available: r.remaining)
      }
      return .array(try (0..<count).map { _ in try decodeScalar(element, from: &r) })
    }
    guard let type = DataType(rawValue: rawType) else {
      throw MTPError.protocolDesync("unknown property data type \(hex(rawType))")
    }
    return try decodeScalar(type, from: &r)
  }

  private static func decodeScalar(_ type: DataType, from r: inout ByteReader) throws
    -> PropertyValue
  {
    switch type {
    case .int8: .int(Int64(Int8(bitPattern: try r.u8())))
    case .uint8: .uint(UInt64(try r.u8()))
    case .int16: .int(Int64(Int16(bitPattern: try r.u16())))
    case .uint16: .uint(UInt64(try r.u16()))
    case .int32: .int(Int64(Int32(bitPattern: try r.u32())))
    case .uint32: .uint(UInt64(try r.u32()))
    case .int64: .int(Int64(bitPattern: try r.u64()))
    case .uint64: .uint(try r.u64())
    case .int128, .uint128: .wide(Data(try r.take(16)))
    case .string: .string(try r.string())
    }
  }
}

/// GetObjectPropList response: a flat list of (handle, property, value) triples.
public struct ObjectPropList: Sendable {
  public struct Element: Sendable, Equatable {
    public var handle: UInt32
    public var property: ObjectProperty
    public var value: PropertyValue
  }

  public var elements: [Element]

  public init(decoding data: Data) throws {
    var r = ByteReader(data)
    let count = Int(try r.u32())
    // Each element is at least 9 bytes (handle, code, type, 1-byte value).
    guard count <= r.remaining / 9 + 1 else {
      throw MTPError.truncatedDataset(needed: count * 9, available: r.remaining)
    }
    var elements = [Element]()
    elements.reserveCapacity(count)
    for _ in 0..<count {
      let handle = try r.u32()
      let code = try r.u16()
      let type = try r.u16()
      let value = try PropertyValue.decode(type: type, from: &r)
      elements.append(
        Element(handle: handle, property: ObjectProperty(rawValue: code), value: value))
    }
    self.elements = elements
  }

  /// Groups the flat list by handle, preserving the device's order.
  public func grouped() -> [(handle: UInt32, properties: [ObjectProperty: PropertyValue])] {
    var order = [UInt32]()
    var map = [UInt32: [ObjectProperty: PropertyValue]]()
    for e in elements {
      if map[e.handle] == nil { order.append(e.handle) }
      map[e.handle, default: [:]][e.property] = e.value
    }
    return order.map { ($0, map[$0]!) }
  }
}

/// A file or folder on the device, independent of how it was listed.
public struct MTPObject: Sendable, Hashable, Identifiable {
  public var handle: UInt32
  public var storageID: UInt32
  public var parent: UInt32
  public var name: String
  public var format: UInt16
  /// Exact payload length, including zero. Nil means metadata did not supply a size.
  /// This is independent of the data container's 0xFFFFFFFF transport length.
  public var size: UInt64?
  public var modified: Date?

  public var id: UInt32 { handle }
  public var isDirectory: Bool { format == ObjectFormat.association }

  public init(
    handle: UInt32, storageID: UInt32, parent: UInt32, name: String, format: UInt16, size: UInt64?,
    modified: Date?
  ) {
    self.handle = handle
    self.storageID = storageID
    self.parent = parent
    self.name = name
    self.format = format
    self.size = size
    self.modified = modified
  }
}
