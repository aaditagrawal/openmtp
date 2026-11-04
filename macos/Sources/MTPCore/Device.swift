import Foundation

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

    public func children(storage: UInt32, parent: UInt32 = MTPHandle.root, refresh: Bool = false) throws -> [MTPObject] {
        let key = DirectoryKey(storage: storage, parent: parent)
        if !refresh, let hit = session.exclusive({ cache[key] }) { return hit }
        let listed = try session.exclusive { () throws -> [MTPObject] in
            if usePropertyList {
                do {
                    return try childrenViaPropertyList(storage: storage, parent: parent)
                } catch let MTPError.response(code, _) where listingStrategy == .automatic {
                    // e.g. OperationNotSupported or SpecificationByDepthUnsupported.
                    _ = code
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
            if let s = props[.storageID]?.uint64, UInt32(truncatingIfNeeded: s) != storage { continue }
            if let p = props[.parentObject]?.uint64.map({ UInt32(truncatingIfNeeded: $0) }) {
                let matches = isRoot ? (p == 0 || p == MTPHandle.root) : p == parent
                if !matches { continue }
            }
            guard let name = props[.objectFileName]?.stringValue,
                  let format = props[.objectFormat]?.uint64
            else {
                // Incomplete property set: fetch this one object the slow way.
                result.append(try object(handle, fallbackParent: parent))
                continue
            }
            let isDirectory = UInt16(truncatingIfNeeded: format) == ObjectFormat.association
            result.append(MTPObject(
                handle: handle,
                storageID: storage,
                parent: parent,
                name: name,
                format: UInt16(truncatingIfNeeded: format),
                size: isDirectory ? 0 : props[.objectSize]?.uint64 ?? 0,
                modified: props[.dateModified]?.stringValue.flatMap { MTPDate.parse($0) }
            ))
        }
        return result
    }

    func childrenViaObjectInfo(storage: UInt32, parent: UInt32) throws -> [MTPObject] {
        try session.getObjectHandles(storage: storage, parent: parent).map {
            try object($0, fallbackParent: parent)
        }
    }

    /// GetObjectInfo for one handle, with a 64-bit size lookup for objects >= 4 GiB.
    public func object(_ handle: UInt32, fallbackParent: UInt32? = nil) throws -> MTPObject {
        let oi = try session.getObjectInfo(handle)
        var size = UInt64(oi.compressedSize)
        let isDirectory = oi.objectFormat == ObjectFormat.association
        if isDirectory {
            size = 0
        } else if oi.compressedSize == 0xFFFF_FFFF {
            size = try session.getObjectPropValue(handle, .objectSize, type: .uint64).uint64 ?? size
        }
        let parent = oi.parentObject == 0 ? (fallbackParent ?? MTPHandle.root) : oi.parentObject
        return MTPObject(
            handle: handle, storageID: oi.storageID, parent: parent, name: oi.filename,
            format: oi.objectFormat, size: size, modified: MTPDate.parse(oi.dateModified)
        )
    }

    /// Resolves "/DCIM/Camera" one directory listing per component (cached), instead of
    /// one GetObjectPropValue per sibling per component.
    public func resolve(storage: UInt32, path: String) throws -> MTPObject? {
        var parent = MTPHandle.root
        var current: MTPObject?
        for component in path.split(separator: "/", omittingEmptySubsequences: true).map(String.init) {
            let entries = try children(storage: storage, parent: parent)
            guard let match = entries.first(where: { $0.name == component })
                ?? entries.first(where: { $0.name.caseInsensitiveCompare(component) == .orderedSame })
            else { throw MTPError.notFound(path) }
            current = match
            parent = match.handle
        }
        return current
    }

    public func invalidate(storage: UInt32, parent: UInt32) {
        session.exclusive { _ = cache.removeValue(forKey: DirectoryKey(storage: storage, parent: parent)) }
    }

    // MARK: Transfers

    /// Streams an object into `destination`, through a sibling temporary file that is
    /// renamed into place only after the byte count matches and the file is synced.
    public func download(_ object: MTPObject, to destination: URL, progress: MTPProgress? = nil) throws {
        let fm = FileManager.default
        let partial = destination.deletingLastPathComponent()
            .appendingPathComponent(".\(destination.lastPathComponent).openmtp-partial")
        try? fm.removeItem(at: partial)
        guard fm.createFile(atPath: partial.path, contents: nil) else {
            throw MTPError.transport("cannot create \(partial.path)")
        }
        var written: UInt64 = 0
        do {
            let handle = try FileHandle(forWritingTo: partial)
            defer { try? handle.close() }
            try session.getObject(object.handle, sink: { chunk in
                try handle.write(contentsOf: chunk)
                written += UInt64(chunk.count)
            }, progress: progress)
            if object.size != 0, object.size < 0xFFFF_FFFF, written != object.size {
                throw MTPError.transport("received \(written) of \(object.size) bytes for \(object.name)")
            }
            try handle.synchronize()
        } catch {
            try? fm.removeItem(at: partial)
            throw error
        }
        if let modified = object.modified {
            try? fm.setAttributes([.modificationDate: modified], ofItemAtPath: partial.path)
        }
        if fm.fileExists(atPath: destination.path) {
            _ = try fm.replaceItemAt(destination, withItemAt: partial)
        } else {
            try fm.moveItem(at: partial, to: destination)
        }
    }

    /// Uploads a regular file. Returns the new object's handle.
    @discardableResult
    public func upload(_ source: URL, storage: UInt32, parent: UInt32 = MTPHandle.root, name: String? = nil, progress: MTPProgress? = nil) throws -> UInt32 {
        let attributes = try FileManager.default.attributesOfItem(atPath: source.path)
        let size = (attributes[.size] as? NSNumber)?.uint64Value ?? 0
        var oi = ObjectInfo()
        oi.storageID = storage
        oi.objectFormat = ObjectFormat.undefined
        oi.compressedSize = size >= 0xFFFF_FFFF ? 0xFFFF_FFFF : UInt32(size)
        oi.parentObject = parent == MTPHandle.root ? 0 : parent
        oi.filename = name ?? source.lastPathComponent
        if let modified = attributes[.modificationDate] as? Date {
            oi.dateModified = MTPDate.format(modified)
        }
        let file = try FileHandle(forReadingFrom: source)
        defer { try? file.close() }
        let handle = try session.exclusive {
            // SendObject must directly follow its SendObjectInfo.
            let created = try session.sendObjectInfo(storage: storage, parent: parent, oi)
            try session.sendObject(MTPOutgoingData(count: size) { try file.read(upToCount: $0) ?? Data() }, progress: progress)
            return created.handle
        }
        invalidate(storage: storage, parent: parent)
        return handle
    }

    @discardableResult
    public func makeDirectory(_ name: String, storage: UInt32, parent: UInt32 = MTPHandle.root) throws -> UInt32 {
        var oi = ObjectInfo()
        oi.storageID = storage
        oi.objectFormat = ObjectFormat.association
        oi.associationType = AssociationType.genericFolder
        oi.parentObject = parent == MTPHandle.root ? 0 : parent
        oi.filename = name
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
        try session.setObjectPropValue(object.handle, .objectFileName, string: newName)
        invalidate(storage: object.storageID, parent: object.parent)
    }
}
