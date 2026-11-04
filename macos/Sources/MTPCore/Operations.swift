import Foundation

/// Typed wrappers for individual MTP operations.
public extension MTPSession {
    private func collect(_ op: OperationCode, _ params: [UInt32] = []) throws -> (MTPResponse, Data) {
        var data = Data()
        let response = try transact(op, params, receive: { data.append($0) })
        return (response, data)
    }

    func getDeviceInfo() throws -> DeviceInfo {
        try DeviceInfo(decoding: collect(.getDeviceInfo).1)
    }

    func getStorageIDs() throws -> [UInt32] {
        var r = ByteReader(try collect(.getStorageIDs).1)
        return try r.u32Array()
    }

    func getStorageInfo(_ storageID: UInt32) throws -> StorageInfo {
        try StorageInfo(id: storageID, decoding: collect(.getStorageInfo, [storageID]).1)
    }

    /// `parent`: `MTPHandle.root` for the storage root, 0 for every object on the storage.
    func getObjectHandles(storage: UInt32, format: UInt32 = 0, parent: UInt32) throws -> [UInt32] {
        var r = ByteReader(try collect(.getObjectHandles, [storage, format, parent]).1)
        return try r.u32Array()
    }

    func getObjectInfo(_ handle: UInt32) throws -> ObjectInfo {
        try ObjectInfo(decoding: collect(.getObjectInfo, [handle]).1)
    }

    func getObjectPropValue(_ handle: UInt32, _ property: ObjectProperty, type: DataType) throws -> PropertyValue {
        var r = ByteReader(try collect(.getObjectPropValue, [handle, UInt32(property.rawValue)]).1)
        return try PropertyValue.decode(type: type.rawValue, from: &r)
    }

    func setObjectPropValue(_ handle: UInt32, _ property: ObjectProperty, string: String) throws {
        var w = ByteWriter()
        try w.string(string)
        try transact(.setObjectPropValue, [handle, UInt32(property.rawValue)], send: .bytes(w.data))
    }

    /// GetObjectPropList. Android supports depth 0 (the object) and 1 (the object plus its
    /// children); handle 0 with depth 1 lists the root of every storage.
    func getObjectPropList(handle: UInt32, format: UInt32 = 0, property: UInt32 = 0xFFFF_FFFF, group: UInt32 = 0, depth: UInt32) throws -> ObjectPropList {
        try ObjectPropList(decoding: collect(.getObjectPropList, [handle, format, property, group, depth]).1)
    }

    func getObject(_ handle: UInt32, sink: @escaping (Data) throws -> Void, expectedSize: UInt64? = nil, progress: MTPProgress? = nil) throws {
        try transact(.getObject, [handle], receive: sink, expectedReceiveSize: expectedSize, progress: progress)
    }

    /// Android GetPartialObject64: reads `length` bytes from a 64-bit `offset`.
    /// Returns the number of bytes the device reports sending.
    @discardableResult
    func getPartialObject64(_ handle: UInt32, offset: UInt64, length: UInt32, sink: @escaping (Data) throws -> Void, progress: MTPProgress? = nil) throws -> UInt32 {
        let response = try transact(
            .androidGetPartialObject64,
            [handle, UInt32(truncatingIfNeeded: offset), UInt32(truncatingIfNeeded: offset >> 32), length],
            receive: sink, progress: progress
        )
        return response.parameters.first ?? 0
    }

    /// Returns (storage, parent, new handle).
    func sendObjectInfo(storage: UInt32, parent: UInt32, _ info: ObjectInfo) throws -> (storage: UInt32, parent: UInt32, handle: UInt32) {
        let response = try transact(.sendObjectInfo, [storage, parent], send: .bytes(info.encoded()))
        guard response.parameters.count >= 3 else {
            throw MTPError.protocolDesync("SendObjectInfo returned \(response.parameters.count) parameters")
        }
        return (response.parameters[0], response.parameters[1], response.parameters[2])
    }

    func sendObject(_ data: MTPOutgoingData, progress: MTPProgress? = nil) throws {
        try transact(.sendObject, send: data, progress: progress)
    }

    func deleteObject(_ handle: UInt32) throws {
        try transact(.deleteObject, [handle, 0])
    }
}
