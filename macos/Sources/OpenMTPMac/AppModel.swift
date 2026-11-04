import AppKit
import Foundation
import MTPCore
import MTPUSB
import Observation

@MainActor
@Observable
final class AppModel {
    enum Connection: Equatable {
        case noDevice
        case connecting(String)
        case connected
        case failed(String, canSeize: Bool)
    }

    struct Transfer: Identifiable {
        enum Direction { case download, upload }
        let id = UUID()
        let name: String
        let direction: Direction
        let total: UInt64
        var done: UInt64 = 0
        var error: String?
        var finished = false
        var fraction: Double { total == 0 ? (finished ? 1 : 0) : Double(done) / Double(total) }
    }

    private(set) var candidates: [USBMTPCandidate] = []
    private(set) var connection: Connection = .noDevice
    private(set) var deviceName = ""
    private(set) var storages: [StorageInfo] = []
    var selectedStorage: UInt32? {
        didSet { if oldValue != selectedStorage { path = []; Task { await reload() } } }
    }

    /// Folders from the storage root to the current directory.
    private(set) var path: [MTPObject] = []
    private(set) var entries: [MTPObject] = []
    private(set) var isLoading = false
    var selection = Set<MTPObject.ID>()
    var sortOrder = [KeyPathComparator(\MTPObject.name, comparator: .localizedStandard)]
    var transfers: [Transfer] = []
    var errorMessage: String?
    let browser = BrowserState()

    private var client: MTPClient?
    private var connectedID: UInt64?
    private var monitor: USBHotplugMonitor?

    var currentParent: UInt32 { path.last?.handle ?? MTPHandle.root }
    var sortedEntries: [MTPObject] {
        let folders = entries.filter(\.isDirectory).sorted(using: sortOrder)
        let files = entries.filter { !$0.isDirectory }.sorted(using: sortOrder)
        return folders + files
    }

    func start() {
        guard monitor == nil else { return }
        let monitor = USBHotplugMonitor { [weak self] candidates in
            Task { @MainActor [weak self] in self?.devicesChanged(candidates) }
        }
        self.monitor = monitor
        monitor.start()
    }

    private func devicesChanged(_ list: [USBMTPCandidate]) {
        candidates = list
        if let connectedID, !list.contains(where: { $0.id == connectedID }) {
            Task { await disconnect() }
        }
        guard client == nil else { return }
        switch connection {
        case .connecting, .failed:
            // Connecting already, or waiting for an explicit retry after an error.
            if list.isEmpty { connection = .noDevice }
        case .noDevice, .connected:
            if let first = list.first { Task { await connect(first) } }
        }
    }

    func connect(_ candidate: USBMTPCandidate, seize: Bool = false) async {
        await disconnect()
        connection = .connecting(candidate.displayName)
        do {
            let client = try await Task.detached(priority: .userInitiated) {
                let transport = try USBMTPTransport(candidate, seize: seize)
                return MTPClient(device: try MTPDevice(transport: transport))
            }.value
            let storages = try await client.run { try $0.storages() }
            self.client = client
            connectedID = candidate.id
            deviceName = "\(client.device.info.manufacturer) \(client.device.info.model)"
            self.storages = storages
            connection = .connected
            if storages.isEmpty {
                connection = .failed("Unlock the phone and choose “File transfer” in its USB notification.", canSeize: false)
            }
            selectedStorage = storages.first?.id
        } catch let error as USBTransportError {
            if case .busy = error {
                connection = .failed(error.description, canSeize: true)
            } else {
                connection = .failed(error.description, canSeize: false)
            }
        } catch {
            connection = .failed(String(describing: error), canSeize: false)
        }
    }

    func retry(seize: Bool) {
        guard let candidate = candidates.first else { connection = .noDevice; return }
        Task { await connect(candidate, seize: seize) }
    }

    func disconnect() async {
        if let client { await client.close() }
        client = nil
        connectedID = nil
        storages = []
        entries = []
        path = []
        connection = candidates.isEmpty ? .noDevice : connection
    }

    // MARK: Navigation

    func reload(refresh: Bool = false) async {
        guard let client, let storage = selectedStorage else { return }
        isLoading = true
        defer { isLoading = false }
        let parent = currentParent
        do {
            entries = try await client.run { try $0.children(storage: storage, parent: parent, refresh: refresh) }
            selection = selection.filter { id in entries.contains { $0.id == id } }
        } catch {
            report(error)
        }
    }

    func open(_ object: MTPObject) {
        guard object.isDirectory else { return }
        path.append(object)
        selection = []
        Task { await reload() }
    }

    func goUp(to depth: Int? = nil) {
        let target = depth ?? max(path.count - 1, 0)
        guard target < path.count else { return }
        path.removeLast(path.count - target)
        selection = []
        Task { await reload() }
    }

    var selectedObjects: [MTPObject] { entries.filter { selection.contains($0.id) } }

    // MARK: File operations

    func downloadSelection() {
        let files = selectedObjects.filter { !$0.isDirectory }
        guard !files.isEmpty else { return }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Download"
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        guard panel.runModal() == .OK, let directory = panel.url else { return }
        for file in files {
            download(file, to: directory.appendingPathComponent(file.name))
        }
    }

    func download(_ file: MTPObject, to destination: URL) {
        guard let client else { return }
        let id = startTransfer(file.name, .download, total: file.size)
        Task {
            do {
                try await client.run { device in
                    try device.download(file, to: destination, progress: self.progressReporter(id))
                }
                finishTransfer(id, error: nil)
            } catch {
                finishTransfer(id, error: String(describing: error))
            }
        }
    }

    func upload(_ urls: [URL]) {
        guard let client, let storage = selectedStorage else { return }
        let parent = currentParent
        for url in urls where !url.hasDirectoryPath {
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(UInt64.init) ?? 0
            let id = startTransfer(url.lastPathComponent, .upload, total: size)
            Task {
                do {
                    _ = try await client.run { device in
                        try device.upload(url, storage: storage, parent: parent, progress: self.progressReporter(id))
                    }
                    finishTransfer(id, error: nil)
                    await reload()
                } catch {
                    finishTransfer(id, error: String(describing: error))
                }
            }
        }
    }

    func chooseFilesToUpload() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.prompt = "Upload"
        guard panel.runModal() == .OK else { return }
        upload(panel.urls)
    }

    func makeFolder(named name: String) {
        guard let client, let storage = selectedStorage, !name.isEmpty else { return }
        let parent = currentParent
        Task {
            do {
                _ = try await client.run { try $0.makeDirectory(name, storage: storage, parent: parent) }
                await reload()
            } catch { report(error) }
        }
    }

    func rename(_ object: MTPObject, to name: String) {
        guard let client, !name.isEmpty, name != object.name else { return }
        Task {
            do {
                try await client.run { try $0.rename(object, to: name) }
                await reload()
            } catch { report(error) }
        }
    }

    func deleteSelection() {
        guard let client else { return }
        let objects = selectedObjects
        Task {
            do {
                try await client.run { device in try objects.forEach { try device.delete($0) } }
                selection = []
                await reload()
            } catch { report(error) }
        }
    }

    // MARK: Transfers

    private func startTransfer(_ name: String, _ direction: Transfer.Direction, total: UInt64) -> UUID {
        let transfer = Transfer(name: name, direction: direction, total: total)
        transfers.insert(transfer, at: 0)
        return transfer.id
    }

    /// Progress arrives on the device queue; coalesce to ~10 updates/s on the main actor.
    nonisolated private func progressReporter(_ id: UUID) -> MTPProgress {
        let lastUpdate = LockedValue(0.0)
        return { [weak self] done in
            let now = ProcessInfo.processInfo.systemUptime
            guard lastUpdate.exchange(ifOlderThan: now - 0.1, with: now) else { return }
            Task { @MainActor [weak self] in
                guard let self, let i = transfers.firstIndex(where: { $0.id == id }) else { return }
                transfers[i].done = done
            }
        }
    }

    private func finishTransfer(_ id: UUID, error: String?) {
        guard let i = transfers.firstIndex(where: { $0.id == id }) else { return }
        transfers[i].finished = true
        transfers[i].error = error
        if error == nil { transfers[i].done = transfers[i].total }
        if let error { errorMessage = error }
    }

    func clearFinishedTransfers() {
        transfers.removeAll { $0.finished && $0.error == nil }
    }

    private func report(_ error: Error) {
        errorMessage = String(describing: error)
        if let client, client.device.session.isBroken {
            // A desync or timeout poisons the session; reconnect cleanly.
            Task { await disconnect(); retry(seize: false) }
        }
    }
}

/// Minimal lock-protected timestamp for throttling progress callbacks.
final class LockedValue: @unchecked Sendable {
    private var value: Double
    private let lock = NSLock()
    init(_ value: Double) { self.value = value }

    func exchange(ifOlderThan threshold: Double, with newValue: Double) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard value <= threshold else { return false }
        value = newValue
        return true
    }
}

/// Transient browser UI state (sheets, rename target, drop highlight).
@MainActor
@Observable
final class BrowserState {
    var newFolderName = ""
    var showingNewFolder = false
    var renaming: MTPObject?
    var renameText = ""
    var isDropTargeted = false
}
