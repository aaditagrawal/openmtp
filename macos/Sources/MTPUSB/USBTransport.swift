import Foundation
import IOKit
import IOKit.usb
import IOUSBHost
import MTPCore

/// A USB interface that looks like MTP: the PTP still-image class (6/1/1) or Android's
/// vendor-specific MTP function (0xFF/0xFF/0x00, verified by its "MTP" interface string on open).
public struct USBMTPCandidate: Sendable, Hashable, Identifiable {
  public let registryID: UInt64
  public let vendorID: Int
  public let productID: Int
  public let manufacturer: String
  public let product: String
  public let serialNumber: String
  public let locationID: Int
  public let interfaceNumber: Int
  public let isPTPClass: Bool
  /// Process currently holding the interface open, from the registry ("pid 412, ptpcamerad").
  public let exclusiveOwner: String?

  public var id: UInt64 { registryID }
  public var displayName: String {
    let name = [manufacturer, product].filter { !$0.isEmpty }.joined(separator: " ")
    return name.isEmpty ? String(format: "USB %04X:%04X", vendorID, productID) : name
  }
}

public enum USBTransportError: Error, CustomStringConvertible, Sendable {
  case disconnected
  case busy(owner: String?)
  case notMTP(String)
  case missingEndpoints
  case io(String, code: Int32)

  public var description: String {
    switch self {
    case .disconnected:
      "The device was disconnected."
    case .busy(let owner):
      "Another process has the phone's MTP interface open"
        + (owner.map { " (\($0))" } ?? "")
        + ". Quit Image Capture, Photos import, Android File Transfer or the Electron OpenMTP, "
        + "or retry with seize to ask the owner to release it."
    case .notMTP(let why):
      "Not an MTP interface: \(why)"
    case .missingEndpoints:
      "The interface lacks bulk IN/OUT endpoints."
    case .io(let what, let code):
      "\(what) failed: \(String(format: "0x%08X", UInt32(bitPattern: code)))"
    }
  }
}

enum IOReturnCode {
  static let noDevice = Int32(bitPattern: 0xE000_02C0)
  static let exclusiveAccess = Int32(bitPattern: 0xE000_02C5)
  static let aborted = Int32(bitPattern: 0xE000_02EB)
  static let timeout = Int32(bitPattern: 0xE000_02D6)
  static let notResponding = Int32(bitPattern: 0xE000_02ED)
  static let pipeStalled = Int32(bitPattern: 0xE000_4051)
  static let usbPipeStalled = Int32(bitPattern: 0xE000_5000)
}

/// USB 2.0 string descriptor zero is a bounded array of little-endian LANGIDs,
/// rather than a text string. Other string indices are read in a reported language.
enum USBInterfaceIdentification {
  static func languageIDs(from descriptor: Data) throws -> [UInt16] {
    guard descriptor.count >= 4, descriptor[descriptor.startIndex + 1] == 3 else {
      throw USBTransportError.notMTP("the supported-language descriptor is invalid")
    }
    let length = Int(descriptor[descriptor.startIndex])
    guard length >= 4, length <= descriptor.count, length.isMultiple(of: 2) else {
      throw USBTransportError.notMTP("the supported-language descriptor is truncated")
    }
    var reader = ByteReader(Data(descriptor.prefix(length).dropFirst(2)))
    var result = [UInt16]()
    var seen = Set<UInt16>()
    while !reader.isAtEnd {
      let language = try reader.u16()
      if language != 0, seen.insert(language).inserted { result.append(language) }
    }
    guard !result.isEmpty else {
      throw USBTransportError.notMTP("the device reports no string languages")
    }
    return result
  }

  static func mtpName(
    index: Int, languageDescriptor: () throws -> Data,
    string: (Int, UInt16) throws -> String
  ) throws -> String {
    guard index != 0 else {
      throw USBTransportError.notMTP("the vendor-specific interface has no name")
    }
    let languages = try languageIDs(from: languageDescriptor())
    for language in languages {
      if let name = try? string(index, language),
        name.localizedCaseInsensitiveContains("MTP")
      {
        return name
      }
    }
    throw USBTransportError.notMTP("no reported language identifies the interface as MTP")
  }
}

public enum USBDiscovery {
  public static func candidates() -> [USBMTPCandidate] {
    var iterator: io_iterator_t = 0
    guard
      IOServiceGetMatchingServices(
        kIOMainPortDefault, IOServiceMatching("IOUSBHostInterface"), &iterator) == KERN_SUCCESS
    else {
      return []
    }
    defer { IOObjectRelease(iterator) }
    var result = [USBMTPCandidate]()
    while true {
      let service = IOIteratorNext(iterator)
      guard service != 0 else { break }
      defer { IOObjectRelease(service) }
      if let candidate = candidate(for: service) { result.append(candidate) }
    }
    return result.sorted {
      ($0.locationID, $0.interfaceNumber) < ($1.locationID, $1.interfaceNumber)
    }
  }

  static func candidate(for service: io_service_t) -> USBMTPCandidate? {
    let cls = intProperty(service, "bInterfaceClass", parents: false)
    let sub = intProperty(service, "bInterfaceSubClass", parents: false)
    let proto = intProperty(service, "bInterfaceProtocol", parents: false)
    let isPTP = cls == 6 && sub == 1 && proto == 1
    let isAndroidMTP = cls == 0xFF && sub == 0xFF && proto == 0
    guard isPTP || isAndroidMTP else { return nil }

    var entryID: UInt64 = 0
    IORegistryEntryGetRegistryEntryID(service, &entryID)
    return USBMTPCandidate(
      registryID: entryID,
      vendorID: intProperty(service, "idVendor") ?? 0,
      productID: intProperty(service, "idProduct") ?? 0,
      manufacturer: stringProperty(service, "kUSBVendorString") ?? stringProperty(
        service, "USB Vendor Name") ?? "",
      product: stringProperty(service, "kUSBProductString") ?? stringProperty(
        service, "USB Product Name") ?? "",
      serialNumber: stringProperty(service, "kUSBSerialNumberString") ?? stringProperty(
        service, "USB Serial Number") ?? "",
      locationID: intProperty(service, "locationID") ?? 0,
      interfaceNumber: intProperty(service, "bInterfaceNumber", parents: false) ?? 0,
      isPTPClass: isPTP,
      exclusiveOwner: stringProperty(service, "UsbExclusiveOwner", parents: false)
    )
  }

  static func service(for registryID: UInt64) -> io_service_t {
    IOServiceGetMatchingService(kIOMainPortDefault, IORegistryEntryIDMatching(registryID))
  }

  private static func property(_ service: io_service_t, _ key: String, parents: Bool) -> AnyObject?
  {
    let options =
      parents ? IOOptionBits(kIORegistryIterateRecursively | kIORegistryIterateParents) : 0
    return IORegistryEntrySearchCFProperty(
      service, kIOServicePlane, key as CFString, kCFAllocatorDefault, options)
  }

  static func intProperty(_ service: io_service_t, _ key: String, parents: Bool = true) -> Int? {
    (property(service, key, parents: parents) as? NSNumber)?.intValue
  }

  static func stringProperty(_ service: io_service_t, _ key: String, parents: Bool = true)
    -> String?
  {
    property(service, key, parents: parents) as? String
  }
}

/// MTP over IOUSBHost: no libusb, no kernel extension, no entitlement for a non-sandboxed app.
public final class USBMTPTransport: MTPTransport, @unchecked Sendable {
  public let candidate: USBMTPCandidate
  public let maxPacketSize: Int
  public let maxOutPacketSize: Int
  private let interface: IOUSBHostInterface
  private let bulkIn: IOUSBHostPipe
  private let bulkOut: IOUSBHostPipe
  private var closed = false

  public init(_ candidate: USBMTPCandidate, seize: Bool = false) throws {
    self.candidate = candidate
    let service = USBDiscovery.service(for: candidate.registryID)
    guard service != 0 else { throw USBTransportError.disconnected }
    defer { IOObjectRelease(service) }

    do {
      interface = try IOUSBHostInterface(
        __ioService: service,
        options: seize ? [.deviceSeize] : [],
        queue: nil,
        interestHandler: nil
      )
    } catch let error as NSError {
      let code = Int32(truncatingIfNeeded: error.code)
      if code == IOReturnCode.exclusiveAccess {
        throw USBTransportError.busy(
          owner: USBDiscovery.stringProperty(service, "UsbExclusiveOwner", parents: false))
      }
      throw USBTransportError.io("opening the USB interface", code: code)
    }

    do {
      let descriptor = interface.interfaceDescriptor
      if !candidate.isPTPClass {
        let index = Int(descriptor.pointee.iInterface)
        let namedInterface = interface
        _ = try USBInterfaceIdentification.mtpName(
          index: index,
          languageDescriptor: { try USBMTPTransport.languageDescriptor(from: namedInterface) },
          string: { index, language in
            String(try namedInterface.__string(with: index, languageID: Int(language)))
          })
      }

      var inAddress: Int?
      var outAddress: Int?
      var inPacket: Int?
      var outPacket: Int?
      let configuration = interface.configurationDescriptor
      var current: UnsafePointer<IOUSBDescriptorHeader>? = nil
      while let endpoint = IOUSBGetNextEndpointDescriptor(configuration, descriptor, current) {
        let e = endpoint.pointee
        if e.bmAttributes & 0x03 == 0x02 {  // bulk
          if e.bEndpointAddress & 0x80 != 0 {
            inAddress = Int(e.bEndpointAddress)
            inPacket = Int(e.wMaxPacketSize & 0x07FF)
          } else {
            outAddress = Int(e.bEndpointAddress)
            outPacket = Int(e.wMaxPacketSize & 0x07FF)
          }
        }
        current = UnsafeRawPointer(endpoint).assumingMemoryBound(to: IOUSBDescriptorHeader.self)
      }
      guard let inAddress, let outAddress, let inPacket, inPacket > 0,
        let outPacket, outPacket > 0
      else { throw USBTransportError.missingEndpoints }
      maxPacketSize = inPacket
      maxOutPacketSize = outPacket
      bulkIn = try interface.copyPipe(withAddress: inAddress)
      bulkOut = try interface.copyPipe(withAddress: outAddress)
    } catch {
      interface.destroy()
      throw error
    }
  }

  deinit { close() }

  private static func languageDescriptor(from interface: IOUSBHostInterface) throws -> Data {
    // Standard device GET_DESCRIPTOR(STRING, index 0), USB 2.0 9.4.3/9.6.7.
    guard let buffer = NSMutableData(length: 255) else {
      throw USBTransportError.notMTP("cannot allocate a string-language descriptor")
    }
    let request = IOUSBDeviceRequest(
      bmRequestType: 0x80, bRequest: 6, wValue: 3 << 8,
      wIndex: 0, wLength: UInt16(buffer.length))
    var transferred = 0
    try interface.__send(
      request, data: buffer, bytesTransferred: &transferred, completionTimeout: 5)
    guard transferred >= 0, transferred <= buffer.length else {
      throw USBTransportError.notMTP("invalid string-language transfer length")
    }
    return Data(bytes: buffer.bytes, count: transferred)
  }

  public func bulkWrite(_ data: Data, timeout: TimeInterval) throws {
    let buffer = NSMutableData(data: data)
    var transferred = 0
    do {
      try bulkOut.__sendIORequest(
        with: buffer, bytesTransferred: &transferred, completionTimeout: timeout)
    } catch let error as NSError {
      throw mapped(error, "bulk OUT", pipe: bulkOut)
    }
    guard transferred == data.count else {
      throw MTPError.transport("bulk OUT sent \(transferred) of \(data.count) bytes")
    }
  }

  public func bulkRead(maxLength: Int, timeout: TimeInterval) throws -> Data {
    guard let buffer = NSMutableData(length: maxLength) else {
      throw MTPError.transport("out of memory")
    }
    var transferred = 0
    do {
      try bulkIn.__sendIORequest(
        with: buffer, bytesTransferred: &transferred, completionTimeout: timeout)
    } catch let error as NSError {
      throw mapped(error, "bulk IN", pipe: bulkIn)
    }
    return Data(bytes: buffer.bytes, count: transferred)
  }

  /// PTP class Cancel Request: bmRequestType 0x21, bRequest 0x64, data = 0x4001 + transaction ID.
  public func cancelTransaction(_ transactionID: UInt32) throws {
    var w = ByteWriter()
    w.u16(0x4001)
    w.u32(transactionID)
    let payload = NSMutableData(data: w.data)
    let request = IOUSBDeviceRequest(
      bmRequestType: 0x21, bRequest: 0x64, wValue: 0,
      wIndex: UInt16(candidate.interfaceNumber), wLength: UInt16(payload.length)
    )
    var transferred = 0
    try? bulkIn.__abort(with: .synchronous)
    try? bulkOut.__abort(with: .synchronous)
    try interface.__send(
      request, data: payload, bytesTransferred: &transferred, completionTimeout: 2)
  }

  public func close() {
    guard !closed else { return }
    closed = true
    interface.destroy()
  }

  private func mapped(_ error: NSError, _ what: String, pipe: IOUSBHostPipe) -> Error {
    let code = Int32(truncatingIfNeeded: error.code)
    switch code {
    case IOReturnCode.timeout:
      try? pipe.__abort(with: .synchronous)
      return MTPError.timeout
    case IOReturnCode.pipeStalled, IOReturnCode.usbPipeStalled:
      try? pipe.clearStall()
      return MTPError.transport("\(what) stalled")
    case IOReturnCode.noDevice, IOReturnCode.notResponding, IOReturnCode.aborted:
      return USBTransportError.disconnected
    default:
      return USBTransportError.io(what, code: code)
    }
  }
}

/// Publishes the candidate list whenever an MTP-looking interface appears or disappears.
public final class USBHotplugMonitor: @unchecked Sendable {
  private let queue = DispatchQueue(label: "openmtp.usb.hotplug")
  private var port: IONotificationPortRef?
  private var iterators: [io_iterator_t] = []
  private let onChange: @Sendable ([USBMTPCandidate]) -> Void

  public init(onChange: @escaping @Sendable ([USBMTPCandidate]) -> Void) {
    self.onChange = onChange
  }

  public func start() {
    queue.async { [self] in
      guard port == nil, let port = IONotificationPortCreate(kIOMainPortDefault) else { return }
      self.port = port
      IONotificationPortSetDispatchQueue(port, queue)
      let context = Unmanaged.passUnretained(self).toOpaque()
      let callback: IOServiceMatchingCallback = { context, iterator in
        // Drain the iterator to re-arm the notification.
        while case let s = IOIteratorNext(iterator), s != 0 { IOObjectRelease(s) }
        guard let context else { return }
        let monitor = Unmanaged<USBHotplugMonitor>.fromOpaque(context).takeUnretainedValue()
        monitor.onChange(USBDiscovery.candidates())
      }
      for type in [kIOFirstMatchNotification, kIOTerminatedNotification] {
        var iterator: io_iterator_t = 0
        IOServiceAddMatchingNotification(
          port, type, IOServiceMatching("IOUSBHostInterface"), callback, context, &iterator)
        while case let s = IOIteratorNext(iterator), s != 0 { IOObjectRelease(s) }
        iterators.append(iterator)
      }
      onChange(USBDiscovery.candidates())
    }
  }

  public func stop() {
    queue.sync {
      for iterator in iterators { IOObjectRelease(iterator) }
      iterators.removeAll()
      if let port { IONotificationPortDestroy(port) }
      port = nil
    }
  }

  deinit { stop() }
}
