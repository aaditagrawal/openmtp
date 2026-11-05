import Foundation

#if canImport(Darwin)
  import Darwin
#else
  import Glibc
#endif

/// File-manager operations on an open MTP session: listing, path resolution and transfers.
///
/// Not thread-safe by itself beyond the session lock; `MTPClient` provides the async,
/// queue-confined facade the UI uses.
public final class MTPDevice: @unchecked Sendable {
  public enum ListingStrategy: String, Sendable, CaseIterable {
    /// GetObjectPropList when the device advertises it, falling back per directory.
    case automatic
    /// One GetObjectPropList round trip per directory.
    case propertyList
    /// GetObjectHandles plus one GetObjectInfo per child (what go-mtpx does today).
    case objectInfo
  }

  public let session: MTPSession
  public let info: DeviceInfo
  public var listingStrategy: ListingStrategy = .automatic

  private var propertyListBroken = false
  private var cache: [DirectoryKey: [MTPObject]] = [:]

  private struct DirectoryKey: Hashable {
    var storage: UInt32
    var parent: UInt32
  }

  /// Reads DeviceInfo (sessionless) and opens session 1.
  public init(transport: MTPTransport) throws {
    session = MTPSession(transport: transport)
    info = try session.getDeviceInfo()
    try session.openSession()
  }

  public func close() {
    session.closeSession()
    session.transport.close()
  }

  public func storages() throws -> [StorageInfo] {
    try session.getStorageIDs()
      // Android reports unmounted/locked storages with the low 16 bits zero.
      .filter { $0 & 0xFFFF != 0 }
      .map { try session.getStorageInfo($0) }
  }

  // MARK: Listing

  public func children(storage: UInt32, parent: UInt32 = MTPHandle.root, refresh: Bool = false)
    throws -> [MTPObject]
  {
    let key = DirectoryKey(storage: storage, parent: parent)
    if !refresh, let hit = session.exclusive({ cache[key] }) { return hit }
    let listed = try session.exclusive { () throws -> [MTPObject] in
      if usePropertyList {
        do {
          return try childrenViaPropertyList(storage: storage, parent: parent)
        } catch let MTPError.response(code, _)
          where listingStrategy == .automatic
          && [
            ResponseCode.operationNotSupported, .parameterNotSupported, .invalidObjectPropCode,
            .specificationByGroupUnsupported, .specificationByDepthUnsupported,
          ].contains(code)
        {
          propertyListBroken = true
        }
      }
      return try childrenViaObjectInfo(storage: storage, parent: parent)
    }
    session.exclusive { cache[key] = listed }
    return listed
  }

  private var usePropertyList: Bool {
    switch listingStrategy {
    case .propertyList: true
    case .objectInfo: false
    case .automatic: !propertyListBroken && info.supports(.getObjectPropList)
    }
  }

  func childrenViaPropertyList(storage: UInt32, parent: UInt32) throws -> [MTPObject] {
    let isRoot = parent == MTPHandle.root
    let list = try session.getObjectPropList(handle: isRoot ? 0 : parent, depth: 1)
    var result = [MTPObject]()
    for (handle, props) in list.grouped() where handle != parent {
      guard let name = props[.objectFileName]?.stringValue,
        let rawFormat = props[.objectFormat]?.uint64,
        let rawStorage = props[.storageID]?.uint64,
        let rawParent = props[.parentObject]?.uint64
      else {
        // Missing identity is not permission to assume folder membership.
        let entry = try object(handle)
        let matches =
          isRoot ? (entry.parent == 0 || entry.parent == MTPHandle.root) : entry.parent == parent
        if entry.storageID == storage, matches { result.append(entry) }
        continue
      }
      guard let listedStorage = UInt32(exactly: rawStorage),
        let listedParent = UInt32(exactly: rawParent),
        let format = UInt16(exactly: rawFormat)
      else {
        throw MTPError.protocolDesync("object property value exceeds its identifier range")
      }
      guard listedStorage == storage,
        isRoot ? (listedParent == 0 || listedParent == MTPHandle.root) : listedParent == parent
      else { continue }
      let isDirectory = format == ObjectFormat.association
      result.append(
        MTPObject(
          handle: handle,
          storageID: storage,
          parent: parent,
          name: try validatedFilename(name),
          format: format,
          size: isDirectory ? 0 : props[.objectSize]?.uint64,
          modified: props[.dateModified]?.stringValue.flatMap { MTPDate.parse($0) }
        ))
    }
    return result
  }

  func childrenViaObjectInfo(storage: UInt32, parent: UInt32) throws -> [MTPObject] {
    try session.getObjectHandles(storage: storage, parent: parent).compactMap {
      let entry = try object($0)
      return entry.storageID == storage && entry.parent == parent ? entry : nil
    }
  }

  /// GetObjectInfo for one handle, with a 64-bit size lookup for objects >= 4 GiB.
  public func object(_ handle: UInt32, fallbackParent: UInt32? = nil) throws -> MTPObject {
    let oi = try session.getObjectInfo(handle)
    var size: UInt64? = UInt64(oi.compressedSize)
    let isDirectory = oi.objectFormat == ObjectFormat.association
    if isDirectory {
      size = 0
    } else if oi.compressedSize == 0xFFFF_FFFF {
      do {
        size = try session.getObjectPropValue(handle, .objectSize, type: .uint64).uint64
      } catch MTPError.response {
        // Older devices may not expose ObjectSize. Never treat the sentinel as
        // a known length. Transport/protocol errors still propagate.
        size = nil
      }
    }
    // Android reports storage-root objects with zero. Never infer a nested
    // parent from the requested listing or a previous object snapshot.
    let parent = oi.parentObject == 0 ? MTPHandle.root : oi.parentObject
    return MTPObject(
      handle: handle, storageID: oi.storageID, parent: parent,
      name: try validatedFilename(oi.filename),
      format: oi.objectFormat, size: size, modified: MTPDate.parse(oi.dateModified)
    )
  }

  private func validatedFilename(_ name: String) throws -> String {
    guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\0") else {
      throw MTPError.protocolDesync("invalid object filename \(name.debugDescription)")
    }
    return name
  }

  /// Resolves "/DCIM/Camera" one directory listing per component (cached), instead of
  /// one GetObjectPropValue per sibling per component.
  public func resolve(storage: UInt32, path: String) throws -> MTPObject? {
    var parent = MTPHandle.root
    var current: MTPObject?
    for component in path.split(separator: "/", omittingEmptySubsequences: true).map(String.init) {
      let entries = try children(storage: storage, parent: parent)
      guard
        let match = entries.first(where: { $0.name == component })
          ?? entries.first(where: { $0.name.caseInsensitiveCompare(component) == .orderedSame })
      else { throw MTPError.notFound(path) }
      current = match
      parent = match.handle
    }
    return current
  }

  public func invalidate(storage: UInt32, parent: UInt32) {
    session.exclusive {
      _ = cache.removeValue(forKey: DirectoryKey(storage: storage, parent: parent))
    }
  }

  // MARK: Transfers

  /// Streams an object into `destination`, through a sibling temporary file that is
  /// renamed into place only after the byte count matches and the file is synced.
  public func download(_ object: MTPObject, to destination: URL, progress: MTPProgress? = nil)
    throws
  {
    let fm = FileManager.default
    guard destination.isFileURL, !object.isDirectory else {
      throw MTPError.transport("Downloads require a file and a local destination.")
    }
    // mkstemp atomically creates an exclusive, mode-0600 sibling on the same
    // filesystem. Never remove a deterministic path that another copy may own.
    var template = Array(
      destination.deletingLastPathComponent()
        .appendingPathComponent(".openmtp-XXXXXX").path.utf8CString)
    let fd = template.withUnsafeMutableBufferPointer { mkstemp($0.baseAddress!) }
    guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    let partialPath = template.withUnsafeBufferPointer { String(cString: $0.baseAddress!) }
    let partial = URL(fileURLWithPath: partialPath)
    let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    defer {
      try? handle.close()
      // Only this transfer's file, including after a failed commit.
      try? fm.removeItem(at: partial)
    }
    var written: UInt64 = 0
    try session.getObject(
      object.handle,
      sink: { chunk in
        try handle.write(contentsOf: chunk)
        written += UInt64(chunk.count)
      }, expectedSize: object.size, progress: progress)
    if let expected = object.size, written != expected {
      throw MTPError.transport("received \(written) of \(expected) bytes for \(object.name)")
    }
    try handle.synchronize()
    try handle.close()
    if let modified = object.modified {
      try? fm.setAttributes([.modificationDate: modified], ofItemAtPath: partial.path)
    }
    // POSIX rename commits atomically, replacing an existing file or symlink
    // without a delete-first gap. Failure leaves the destination in place.
    let result = partial.path.withCString { source in
      destination.path.withCString { target in
        #if canImport(Darwin)
          Darwin.rename(source, target)
        #else
          Glibc.rename(source, target)
        #endif
      }
    }
    guard result == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
  }

  /// Uploads a regular file. Returns the new object's handle.
  @discardableResult
  public func upload(
    _ source: URL, storage: UInt32, parent: UInt32 = MTPHandle.root, name: String? = nil,
    onCreated: ((UInt32) -> Void)? = nil, progress: MTPProgress? = nil
  ) throws -> UInt32 {
    let opened = try UploadPreflight.openRegularFile(source)
    let file = opened.file
    defer { try? file.close() }
    let size = opened.size
    var oi = ObjectInfo()
    oi.storageID = storage
    oi.objectFormat = ObjectFormat.undefined
    oi.compressedSize = size >= 0xFFFF_FFFF ? 0xFFFF_FFFF : UInt32(size)
    oi.parentObject = parent == MTPHandle.root ? 0 : parent
    oi.filename = try validatedFilename(name ?? source.lastPathComponent)
    oi.dateModified = MTPDate.format(opened.modified)
    let handle = try session.exclusive {
      // SendObject must directly follow its SendObjectInfo.
      let created = try session.sendObjectInfo(storage: storage, parent: parent, oi)
      // Record ownership before streaming can fail; this callback must not send
      // another transaction between SendObjectInfo and SendObject.
      onCreated?(created.handle)
      try session.sendObject(
        MTPOutgoingData(count: size) { try file.read(upToCount: $0) ?? Data() }, progress: progress)
      return created.handle
    }
    invalidate(storage: storage, parent: parent)
    return handle
  }

  @discardableResult
  public func makeDirectory(
    _ name: String, storage: UInt32, parent: UInt32 = MTPHandle.root, modified: Date? = nil
  ) throws -> UInt32 {
    var oi = ObjectInfo()
    oi.storageID = storage
    oi.objectFormat = ObjectFormat.association
    oi.associationType = AssociationType.genericFolder
    oi.parentObject = parent == MTPHandle.root ? 0 : parent
    oi.filename = try validatedFilename(name)
    if let modified { oi.dateModified = MTPDate.format(modified) }
    let created = try session.sendObjectInfo(storage: storage, parent: parent, oi)
    invalidate(storage: storage, parent: parent)
    return created.handle
  }

  public func delete(_ object: MTPObject) throws {
    try session.deleteObject(object.handle)
    invalidate(storage: object.storageID, parent: object.parent)
    if object.isDirectory { invalidate(storage: object.storageID, parent: object.handle) }
  }

  public func rename(_ object: MTPObject, to newName: String) throws {
    let name = try validatedFilename(newName)
    try session.setObjectPropValue(object.handle, .objectFileName, string: name)
    invalidate(storage: object.storageID, parent: object.parent)
  }
}
