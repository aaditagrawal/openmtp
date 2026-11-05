import Foundation

/// Little-endian writer for MTP datasets.
public struct ByteWriter: Sendable {
  public private(set) var data = Data()
  public init(capacity: Int = 64) { data.reserveCapacity(capacity) }

  public mutating func u8(_ v: UInt8) { data.append(v) }
  public mutating func u16(_ v: UInt16) {
    withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) }
  }
  public mutating func u32(_ v: UInt32) {
    withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) }
  }
  public mutating func u64(_ v: UInt64) {
    withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) }
  }
  public mutating func bytes(_ d: Data) { data.append(d) }

  /// MTP string: u8 character count including the NUL terminator, then UTF-16LE.
  /// An empty string is a single zero byte. Strings are limited to 254 code units.
  public mutating func string(_ s: String) throws {
    let units = Array(s.utf16)
    if units.isEmpty {
      u8(0)
      return
    }
    guard units.count < 255 else { throw MTPError.stringTooLong(s) }
    u8(UInt8(units.count + 1))
    for unit in units { u16(unit) }
    u16(0)
  }

  public mutating func u16Array(_ values: [UInt16]) {
    u32(UInt32(values.count))
    for value in values { u16(value) }
  }

  public mutating func u32Array(_ values: [UInt32]) {
    u32(UInt32(values.count))
    for value in values { u32(value) }
  }
}

/// Little-endian bounds-checked reader for MTP datasets.
public struct ByteReader: Sendable {
  public let data: Data
  public private(set) var offset: Int

  public init(_ data: Data) {
    self.data = data
    self.offset = data.startIndex
  }

  public var remaining: Int { data.endIndex - offset }
  public var isAtEnd: Bool { remaining == 0 }

  mutating func take(_ n: Int) throws -> Data {
    guard n >= 0, remaining >= n else {
      throw MTPError.truncatedDataset(needed: n, available: remaining)
    }
    defer { offset += n }
    return data[offset..<offset + n]
  }

  private mutating func integer<T: FixedWidthInteger>(_: T.Type) throws -> T {
    let size = MemoryLayout<T>.size
    guard remaining >= size else {
      throw MTPError.truncatedDataset(needed: size, available: remaining)
    }
    var value: T = 0
    for i in 0..<size {
      value |= T(data[offset + i]) << (8 * i)
    }
    offset += size
    return value
  }

  public mutating func u8() throws -> UInt8 { try integer(UInt8.self) }
  public mutating func u16() throws -> UInt16 { try integer(UInt16.self) }
  public mutating func u32() throws -> UInt32 { try integer(UInt32.self) }
  public mutating func u64() throws -> UInt64 { try integer(UInt64.self) }
  public mutating func skip(_ n: Int) throws { _ = try take(n) }

  public mutating func string() throws -> String {
    let count = Int(try u8())
    if count == 0 { return "" }
    var units = [UInt16]()
    units.reserveCapacity(count)
    for _ in 0..<count { units.append(try u16()) }
    if units.last == 0 { units.removeLast() }
    return String(decoding: units, as: UTF16.self)
  }

  public mutating func u16Array() throws -> [UInt16] {
    let count = Int(try u32())
    guard count * 2 <= remaining else {
      throw MTPError.truncatedDataset(needed: count * 2, available: remaining)
    }
    return try (0..<count).map { _ in try u16() }
  }

  public mutating func u32Array() throws -> [UInt32] {
    let count = Int(try u32())
    guard count * 4 <= remaining else {
      throw MTPError.truncatedDataset(needed: count * 4, available: remaining)
    }
    return try (0..<count).map { _ in try u32() }
  }
}

/// MTP date strings: "YYYYMMDDThhmmss[.s][Z|+hhmm|-hhmm]".
///
/// Android emits local wall time without a zone suffix
/// (frameworks/av/media/mtp/MtpUtils.cpp), so zone-less values are interpreted in
/// `localZone`. This matches the fork's go-mtpfs patch that fixed the +05:30 shift.
public enum MTPDate {
  public static func parse(_ s: String, localZone: TimeZone = .current) -> Date? {
    guard s.count >= 15 else { return nil }
    let chars = Array(s.utf8)
    func num(_ range: Range<Int>) -> Int? {
      guard range.upperBound <= chars.count else { return nil }
      var v = 0
      for c in chars[range] {
        guard c >= 48, c <= 57 else { return nil }
        v = v * 10 + Int(c - 48)
      }
      return v
    }
    guard chars[8] == UInt8(ascii: "T"),
      let year = num(0..<4), let month = num(4..<6), let day = num(6..<8),
      let hour = num(9..<11), let minute = num(11..<13), let second = num(13..<15)
    else { return nil }

    var idx = 15
    var fraction = 0.0
    if idx < chars.count, chars[idx] == UInt8(ascii: ".") {
      idx += 1
      var scale = 0.1
      while idx < chars.count, chars[idx] >= 48, chars[idx] <= 57 {
        fraction += Double(chars[idx] - 48) * scale
        scale /= 10
        idx += 1
      }
    }

    var zone = localZone
    if idx < chars.count {
      switch chars[idx] {
      case UInt8(ascii: "Z"):
        zone = TimeZone(secondsFromGMT: 0)!
        idx += 1
      case UInt8(ascii: "+"), UInt8(ascii: "-"):
        guard let hh = num(idx + 1..<idx + 3), let mm = num(idx + 3..<idx + 5) else { return nil }
        let sign = chars[idx] == UInt8(ascii: "-") ? -1 : 1
        guard let z = TimeZone(secondsFromGMT: sign * (hh * 3600 + mm * 60)) else { return nil }
        zone = z
        idx += 5
      default:
        return nil
      }
    }
    guard idx == chars.count else { return nil }

    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let comps = DateComponents(
      year: year, month: month, day: day, hour: hour, minute: minute, second: second)
    return calendar.date(from: comps).map { $0.addingTimeInterval(fraction) }
  }

  /// Formats in local wall time without a suffix, as Android expects.
  public static func format(_ date: Date, localZone: TimeZone = .current) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = localZone
    let c = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
    return String(
      format: "%04d%02d%02dT%02d%02d%02d", c.year!, c.month!, c.day!, c.hour!, c.minute!, c.second!)
  }
}
