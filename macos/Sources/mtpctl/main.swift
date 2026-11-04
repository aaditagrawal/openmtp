import Foundation
import MTPCore
import MTPUSB

// mtpctl: exercise the Swift MTP stack against a real phone, without the GUI.
//
//   mtpctl devices
//   mtpctl info
//   mtpctl ls [/path] [--objectinfo|--proplist]
//   mtpctl pull /device/path [local-dir] [--chunk-kib N]
//   mtpctl push local-file /device/dir
//   mtpctl mkdir /device/dir/name | rm /device/path | mv /device/path new-name
//   mtpctl bench-ls /path        compare listing strategies (round trips and time)
//   mtpctl bench-pull /path      compare 16 KiB (go-mtpfs) vs larger bulk transfers
//
// Options: --device N (candidate index), --storage ID (hex or decimal), --seize

var args = Array(CommandLine.arguments.dropFirst())

@MainActor func flag(_ name: String) -> Bool {
    if let i = args.firstIndex(of: name) { args.remove(at: i); return true }
    return false
}

@MainActor func option(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    let value = args[i + 1]
    args.removeSubrange(i ... i + 1)
    return value
}

func parseInt(_ s: String) -> UInt32? {
    s.hasPrefix("0x") ? UInt32(s.dropFirst(2), radix: 16) : UInt32(s)
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("mtpctl: \(message)\n".utf8))
    exit(1)
}

func bytes(_ n: UInt64) -> String {
    ByteCountFormatter.string(fromByteCount: Int64(n), countStyle: .file)
}

func time<T>(_ body: () throws -> T) rethrows -> (T, TimeInterval) {
    let start = DispatchTime.now().uptimeNanoseconds
    let value = try body()
    return (value, Double(DispatchTime.now().uptimeNanoseconds - start) / 1e9)
}

let deviceIndex = option("--device").flatMap { Int($0) } ?? 0
let storageOption = option("--storage").flatMap(parseInt)
let seize = flag("--seize")
let chunkKiB = option("--chunk-kib").flatMap { Int($0) }
let forceObjectInfo = flag("--objectinfo")
let forcePropList = flag("--proplist")
guard let command = args.first else {
    fail("usage: mtpctl devices|info|ls|pull|push|mkdir|rm|mv|bench-ls|bench-pull …")
}
args.removeFirst()

let candidates = USBDiscovery.candidates()
if command == "devices" {
    if candidates.isEmpty { print("No MTP/PTP interfaces found. Is the phone unlocked and set to File transfer?") }
    for (i, c) in candidates.enumerated() {
        print(String(format: "[%d] %@  %04X:%04X  iface %d  %@  serial %@%@", i, c.displayName, c.vendorID, c.productID,
                     c.interfaceNumber, c.isPTPClass ? "PTP-class" : "vendor-MTP", c.serialNumber,
                     c.exclusiveOwner.map { "  held by \($0)" } ?? ""))
    }
    exit(0)
}

guard deviceIndex < candidates.count else { fail("no device at index \(deviceIndex); run `mtpctl devices`") }
let device: MTPDevice
do {
    let transport = try USBMTPTransport(candidates[deviceIndex], seize: seize)
    device = try MTPDevice(transport: transport)
} catch {
    fail("\(error)")
}
defer { device.close() }
if let chunkKiB { device.session.transferSize = chunkKiB * 1024 }
if forceObjectInfo { device.listingStrategy = .objectInfo }
if forcePropList { device.listingStrategy = .propertyList }

do {
    let storages = try device.storages()
    guard let storage = storageOption.flatMap({ id in storages.first { $0.id == id } }) ?? storages.first else {
        fail("no mounted storage; unlock the phone and choose File transfer")
    }

    func lookup(_ path: String) throws -> MTPObject? {
        try device.resolve(storage: storage.id, path: path)
    }

    switch command {
    case "info":
        let i = device.info
        print("\(i.manufacturer) \(i.model)  version \(i.deviceVersion)  serial \(i.serialNumber)")
        print("extensions: \(i.vendorExtensionDesc)")
        print("GetObjectPropList: \(i.supports(.getObjectPropList))  GetPartialObject64: \(i.supports(.androidGetPartialObject64))  SendPartialObject: \(i.supports(.androidSendPartialObject))")
        print("USB max packet: \(device.session.transport.maxPacketSize) bytes")
        for s in storages {
            print(String(format: "storage 0x%08X  %@  %@ free of %@%@", s.id, s.displayName, bytes(s.freeSpaceInBytes), bytes(s.maxCapacity), s.isReadOnly ? "  read-only" : ""))
        }

    case "ls":
        let path = args.first ?? "/"
        let parent = try lookup(path)?.handle ?? MTPHandle.root
        let (entries, seconds) = try time { try device.children(storage: storage.id, parent: parent) }
        let formatter = ISO8601DateFormatter()
        for e in entries.sorted(by: { ($0.isDirectory ? 0 : 1, $0.name.lowercased()) < ($1.isDirectory ? 0 : 1, $1.name.lowercased()) }) {
            let date = e.modified.map { formatter.string(from: $0) } ?? "-"
            print("\(e.isDirectory ? "d" : "-")  \(e.isDirectory ? "".padding(toLength: 10, withPad: " ", startingAt: 0) : bytes(e.size).padding(toLength: 10, withPad: " ", startingAt: 0))  \(date)  \(e.name)")
        }
        FileHandle.standardError.write(Data(String(format: "%d entries in %.3fs (%@)\n", entries.count, seconds, device.listingStrategy.rawValue).utf8))

    case "pull":
        guard let path = args.first, let obj = try lookup(path), !obj.isDirectory else { fail("pull needs a device file path") }
        let dir = URL(fileURLWithPath: args.dropFirst().first ?? FileManager.default.currentDirectoryPath)
        let dest = dir.appendingPathComponent(obj.name)
        var lastPrint = Date.distantPast
        let (_, seconds) = try time {
            try device.download(obj, to: dest) { done in
                if Date().timeIntervalSince(lastPrint) > 0.5 {
                    lastPrint = Date()
                    FileHandle.standardError.write(Data("\r\(bytes(done)) / \(bytes(obj.size))   ".utf8))
                }
            }
        }
        print("\n\(dest.path): \(bytes(obj.size)) in \(String(format: "%.2f", seconds))s, \(bytes(UInt64(Double(obj.size) / max(seconds, 0.001))))/s")

    case "push":
        guard args.count >= 2 else { fail("push local-file /device/dir") }
        let source = URL(fileURLWithPath: args[0])
        let parent = try lookup(args[1])?.handle ?? MTPHandle.root
        let size = (try FileManager.default.attributesOfItem(atPath: source.path)[.size] as? NSNumber)?.uint64Value ?? 0
        let (_, seconds) = try time { try device.upload(source, storage: storage.id, parent: parent) }
        print("\(source.lastPathComponent): \(bytes(size)) in \(String(format: "%.2f", seconds))s, \(bytes(UInt64(Double(size) / max(seconds, 0.001))))/s")

    case "mkdir":
        guard let path = args.first else { fail("mkdir /device/dir/name") }
        let url = URL(fileURLWithPath: path)
        let parent = try lookup(url.deletingLastPathComponent().path)?.handle ?? MTPHandle.root
        print(String(format: "created handle 0x%08X", try device.makeDirectory(url.lastPathComponent, storage: storage.id, parent: parent)))

    case "rm":
        guard let path = args.first, path != "/", let obj = try lookup(path) else { fail("rm /device/path") }
        try device.delete(obj)

    case "mv":
        guard args.count == 2, let obj = try lookup(args[0]) else { fail("mv /device/path new-name") }
        try device.rename(obj, to: args[1])

    case "bench-ls":
        let path = args.first ?? "/"
        let parent = try lookup(path)?.handle ?? MTPHandle.root
        for strategy in [MTPDevice.ListingStrategy.objectInfo, .propertyList] {
            device.listingStrategy = strategy
            do {
                let (entries, seconds) = try time { try device.children(storage: storage.id, parent: parent, refresh: true) }
                print(String(format: "%-13@ %6d entries  %8.3fs", strategy.rawValue, entries.count, seconds))
            } catch {
                print("\(strategy.rawValue): \(error)")
            }
        }

    case "bench-pull":
        guard let path = args.first, let obj = try lookup(path), !obj.isDirectory else { fail("bench-pull needs a device file path") }
        for size in [16 * 1024, 256 * 1024, 1 << 20, 4 << 20] {
            device.session.transferSize = size
            var total: UInt64 = 0
            let (_, seconds) = try time { try device.session.getObject(obj.handle, sink: { total += UInt64($0.count) }) }
            print(String(format: "%5d KiB transfers: %@ in %.2fs = %@/s", size / 1024, bytes(total), seconds, bytes(UInt64(Double(total) / max(seconds, 0.001)))))
        }

    default:
        fail("unknown command \(command)")
    }
} catch {
    fail("\(error)")
}
