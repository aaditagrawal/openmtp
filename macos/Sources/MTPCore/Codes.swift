/// MTP 1.1 / PTP (ISO 15740) protocol constants used by OpenMTP.

public enum ContainerType: UInt16, Sendable {
    case command = 1
    case data = 2
    case response = 3
    case event = 4
}

public struct OperationCode: RawRepresentable, Hashable, Sendable, CustomStringConvertible {
    public let rawValue: UInt16
    public init(rawValue: UInt16) { self.rawValue = rawValue }

    public static let getDeviceInfo = Self(rawValue: 0x1001)
    public static let openSession = Self(rawValue: 0x1002)
    public static let closeSession = Self(rawValue: 0x1003)
    public static let getStorageIDs = Self(rawValue: 0x1004)
    public static let getStorageInfo = Self(rawValue: 0x1005)
    public static let getNumObjects = Self(rawValue: 0x1006)
    public static let getObjectHandles = Self(rawValue: 0x1007)
    public static let getObjectInfo = Self(rawValue: 0x1008)
    public static let getObject = Self(rawValue: 0x1009)
    public static let deleteObject = Self(rawValue: 0x100B)
    public static let sendObjectInfo = Self(rawValue: 0x100C)
    public static let sendObject = Self(rawValue: 0x100D)
    public static let moveObject = Self(rawValue: 0x1019)
    public static let getPartialObject = Self(rawValue: 0x101B)
    public static let getObjectPropsSupported = Self(rawValue: 0x9801)
    public static let getObjectPropDesc = Self(rawValue: 0x9802)
    public static let getObjectPropValue = Self(rawValue: 0x9803)
    public static let setObjectPropValue = Self(rawValue: 0x9804)
    public static let getObjectPropList = Self(rawValue: 0x9805)
    // Android extensions (frameworks/av/media/mtp/mtp.h)
    public static let androidGetPartialObject64 = Self(rawValue: 0x95C1)
    public static let androidSendPartialObject = Self(rawValue: 0x95C2)
    public static let androidTruncateObject = Self(rawValue: 0x95C3)
    public static let androidBeginEditObject = Self(rawValue: 0x95C4)
    public static let androidEndEditObject = Self(rawValue: 0x95C5)

    public var description: String {
        let names: [UInt16: String] = [
            0x1001: "GetDeviceInfo", 0x1002: "OpenSession", 0x1003: "CloseSession",
            0x1004: "GetStorageIDs", 0x1005: "GetStorageInfo", 0x1006: "GetNumObjects",
            0x1007: "GetObjectHandles", 0x1008: "GetObjectInfo", 0x1009: "GetObject",
            0x100B: "DeleteObject", 0x100C: "SendObjectInfo", 0x100D: "SendObject",
            0x1019: "MoveObject", 0x101B: "GetPartialObject",
            0x9801: "GetObjectPropsSupported", 0x9802: "GetObjectPropDesc",
            0x9803: "GetObjectPropValue", 0x9804: "SetObjectPropValue", 0x9805: "GetObjectPropList",
            0x95C1: "AndroidGetPartialObject64", 0x95C2: "AndroidSendPartialObject",
            0x95C3: "AndroidTruncateObject", 0x95C4: "AndroidBeginEditObject",
            0x95C5: "AndroidEndEditObject",
        ]
        return names[rawValue] ?? hex(rawValue)
    }
}

public struct ResponseCode: RawRepresentable, Hashable, Sendable, CustomStringConvertible {
    public let rawValue: UInt16
    public init(rawValue: UInt16) { self.rawValue = rawValue }

    public static let ok = Self(rawValue: 0x2001)
    public static let generalError = Self(rawValue: 0x2002)
    public static let sessionNotOpen = Self(rawValue: 0x2003)
    public static let invalidTransactionID = Self(rawValue: 0x2004)
    public static let operationNotSupported = Self(rawValue: 0x2005)
    public static let parameterNotSupported = Self(rawValue: 0x2006)
    public static let incompleteTransfer = Self(rawValue: 0x2007)
    public static let invalidStorageID = Self(rawValue: 0x2008)
    public static let invalidObjectHandle = Self(rawValue: 0x2009)
    public static let storeFull = Self(rawValue: 0x200C)
    public static let objectWriteProtected = Self(rawValue: 0x200D)
    public static let storeReadOnly = Self(rawValue: 0x200E)
    public static let accessDenied = Self(rawValue: 0x200F)
    public static let deviceBusy = Self(rawValue: 0x2019)
    public static let invalidParentObject = Self(rawValue: 0x201A)
    public static let invalidParameter = Self(rawValue: 0x201D)
    public static let sessionAlreadyOpen = Self(rawValue: 0x201E)
    public static let transactionCancelled = Self(rawValue: 0x201F)
    public static let invalidObjectPropCode = Self(rawValue: 0xA801)
    public static let specificationByGroupUnsupported = Self(rawValue: 0xA807)
    public static let specificationByDepthUnsupported = Self(rawValue: 0xA808)
    public static let objectTooLarge = Self(rawValue: 0xA809)

    public var description: String {
        let names: [UInt16: String] = [
            0x2001: "OK", 0x2002: "GeneralError", 0x2003: "SessionNotOpen",
            0x2004: "InvalidTransactionID", 0x2005: "OperationNotSupported",
            0x2006: "ParameterNotSupported", 0x2007: "IncompleteTransfer",
            0x2008: "InvalidStorageID", 0x2009: "InvalidObjectHandle", 0x200C: "StoreFull",
            0x200D: "ObjectWriteProtected", 0x200E: "StoreReadOnly", 0x200F: "AccessDenied",
            0x2019: "DeviceBusy", 0x201A: "InvalidParentObject", 0x201D: "InvalidParameter",
            0x201E: "SessionAlreadyOpen", 0x201F: "TransactionCancelled",
            0xA801: "InvalidObjectPropCode", 0xA807: "SpecificationByGroupUnsupported",
            0xA808: "SpecificationByDepthUnsupported", 0xA809: "ObjectTooLarge",
        ]
        return names[rawValue] ?? hex(rawValue)
    }
}

public enum ObjectFormat {
    public static let undefined: UInt16 = 0x3000
    public static let association: UInt16 = 0x3001
}

public enum AssociationType {
    public static let genericFolder: UInt16 = 0x0001
}

public struct ObjectProperty: RawRepresentable, Hashable, Sendable {
    public let rawValue: UInt16
    public init(rawValue: UInt16) { self.rawValue = rawValue }

    public static let storageID = Self(rawValue: 0xDC01)
    public static let objectFormat = Self(rawValue: 0xDC02)
    public static let protectionStatus = Self(rawValue: 0xDC03)
    public static let objectSize = Self(rawValue: 0xDC04)
    public static let objectFileName = Self(rawValue: 0xDC07)
    public static let dateCreated = Self(rawValue: 0xDC08)
    public static let dateModified = Self(rawValue: 0xDC09)
    public static let parentObject = Self(rawValue: 0xDC0B)
    public static let persistentUID = Self(rawValue: 0xDC41)
    public static let name = Self(rawValue: 0xDC44)
    public static let dateAdded = Self(rawValue: 0xDC4E)
    /// Wildcard for GetObjectPropList: return every property.
    public static let all = Self(rawValue: 0xFFFF)
}

/// MTP data type codes used in property values (MTP 1.1 §3.2).
public enum DataType: UInt16, Sendable {
    case int8 = 0x0001, uint8 = 0x0002, int16 = 0x0003, uint16 = 0x0004
    case int32 = 0x0005, uint32 = 0x0006, int64 = 0x0007, uint64 = 0x0008
    case int128 = 0x0009, uint128 = 0x000A
    case string = 0xFFFF

    var scalarSize: Int? {
        switch self {
        case .int8, .uint8: 1
        case .int16, .uint16: 2
        case .int32, .uint32: 4
        case .int64, .uint64: 8
        case .int128, .uint128: 16
        case .string: nil
        }
    }
}

public enum MTPHandle {
    /// GetObjectHandles / SendObjectInfo: the storage root.
    public static let root: UInt32 = 0xFFFF_FFFF
    /// GetObjectHandles storage argument meaning "every storage".
    public static let allStorages: UInt32 = 0xFFFF_FFFF
}

func hex<T: BinaryInteger>(_ v: T) -> String {
    "0x" + String(v, radix: 16, uppercase: true)
}
