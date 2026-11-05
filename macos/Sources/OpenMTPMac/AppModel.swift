import AppKit
import Combine
import Foundation
import MTPCore
import MTPUSB

@MainActor
final class AppModel: ObservableObject {
  enum Connection: Equatable {
    case noDevice
    case connecting(String)
    case connected
    case failed(String, canSeize: Bool)
  }
  struct Transfer: Identifiable, Codable, Sendable {
    enum Direction: String, Codable, Sendable { case download, upload }
    enum State: String, Codable, Sendable {
      case queued, planning, waiting, running, cancelling, completed, failed, cancelled
      var isTerminal: Bool { self == .completed || self == .failed || self == .cancelled }
    }
    let id: UUID
    let name: String
    let direction: Direction
    let sourcePaths: [String]
    let destination: String
    let storage: UInt32
    let phoneIdentity: String
    var ownedIncoming: [NativeIncomingOwnership]? = nil
    var state: State = .queued
    var total: UInt64?
    var done: UInt64 = 0
    var totalFiles = 0
    var completedFiles = 0
    var skippedFiles = 0
    var currentFile = ""
    var error: String?
    var startedAt: Date?
    var completedAt: Date?
    var finished: Bool { state.isTerminal }
    var fraction: Double? {
      guard let total else { return state == .completed ? 1 : nil }
      return total == 0 ? (state == .completed ? 1 : 0) : min(1, Double(done) / Double(total))
    }
    var route: String {
      direction == .upload ? "Mac → Phone / \(destination)" : "Phone → Mac / \(destination)"
    }
    var bytesPerSecond: Double? {
      guard state == .running, let startedAt else { return nil }
      let elapsed = Date().timeIntervalSince(startedAt)
      return elapsed > 1 && done > 0 ? Double(done) / elapsed : nil
    }
    var remainingSeconds: Double? {
      guard let total, let speed = bytesPerSecond, speed > 0, done <= total else { return nil }
      return Double(total - done) / speed
    }
  }
  struct PendingDeletion: Sendable {
    let client: MTPClient
    let storage: UInt32
    let parent: UInt32
    let objects: [MTPObject]
    let location: String
    var title: String {
      objects.count == 1
        ? "Permanently delete \"\(objects[0].name)\"?"
        : "Permanently delete \(objects.count) items?"
    }
    var message: String {
      let names = objects.prefix(8).map(\.name).joined(separator: "\n")
      let more = objects.count > 8 ? "\n…and \(objects.count - 8) more." : ""
      return
        "These items will be permanently deleted from the phone at \(location). This cannot be undone. Folders include all their contents.\n\n\(names)\(more)"
    }
  }
  struct PendingConflict {
    let jobID: UUID
    let names: [String]
    let count: Int
    let extrasCount: Int
    let route: String
    let destinationIsPhone: Bool
    let extraNames: [String]
  }
  private struct ConflictDecision: Sendable {
    let policy: CopyConflictPolicy
    let removeExtras: Bool
  }
  struct Clipboard: Codable, Sendable {
    let pane: WorkspacePane
    let paths: [String]
    let storage: UInt32?
    let phoneIdentity: String?
  }
  struct PhoneLocation: Equatable {
    let storage: UInt32
    let folders: [MTPObject]
  }
  struct FolderCreationContext {
    let pane: WorkspacePane
    let localDirectory: URL
    let client: MTPClient?
    let storage: UInt32?
    let parent: UInt32
    let location: String
  }

  @Published private(set) var candidates: [USBMTPCandidate] = []
  @Published private(set) var connection: Connection = .noDevice
  @Published private(set) var deviceName = ""
  @Published private(set) var storages: [StorageInfo] = []
  @Published var selectedStorage: UInt32? {
    didSet {
      guard !restoringLocation, oldValue != selectedStorage else { return }
      path = []
      entries = []
      selection = []
      if let selectedStorage { pushPhoneHistory(.init(storage: selectedStorage, folders: [])) }
      Task { await reload() }
    }
  }
  @Published private(set) var path: [MTPObject] = []
  @Published private(set) var entries: [MTPObject] = [] { didSet { phoneRevision += 1 } }
  @Published private(set) var isLoading = false
  @Published var selection = Set<MTPObject.ID>()
  @Published var sortOrder = [KeyPathComparator(\MTPObject.name, comparator: .localizedStandard)] {
    didSet { savePhoneSort() }
  }
  @Published var localSortOrder = [
    KeyPathComparator(\LocalFile.name, comparator: .localizedStandard)
  ] { didSet { saveLocalSort() } }
  @Published private(set) var localDirectory: URL
  @Published private(set) var localEntries: [LocalFile] = [] { didSet { localRevision += 1 } }
  @Published private(set) var localLoading = false
  @Published var localSelection = Set<URL>()
  @Published var activePane: WorkspacePane = .phone {
    didSet { if activePane == .local && !settings.showLocalPane { activePane = .phone } }
  }
  @Published var localSearch = "" { didSet { if oldValue != localSearch { localSelection = [] } } }
  @Published var phoneSearch = "" { didSet { if oldValue != phoneSearch { selection = [] } } }
  @Published var transfers: [Transfer] = []
  @Published var errorMessage: String?
  @Published var pendingDeletion: PendingDeletion?
  @Published var pendingConflict: PendingConflict?
  @Published private(set) var clipboard: Clipboard?
  @Published var dropInProgress = false
  @Published private(set) var preparingPreview = false
  @Published private(set) var isTerminating = false
  let settings: WorkspaceSettings
  let fileIntegration: NativeFileIntegration
  let browser = BrowserState()

  private var client: MTPClient?
  private var connectedID: UInt64?
  private var monitor: USBHotplugMonitor?
  private var deviceKey = ""
  private var connectionEpoch = UUID()
  private var worker: Task<Void, Never>?
  private var dropTasks: [UUID: Task<Void, Never>] = [:]
  private var tokens: [UUID: TransferCancellationToken] = [:]
  private var conflictContinuation: CheckedContinuation<ConflictDecision?, Never>?
  private let defaults: WorkspacePreferenceStore
  private var settingsSubscription: AnyCancellable?
  private var paneVisibilitySubscription: AnyCancellable?
  private var closingConnection = false
  private var localHistory: [URL] = []
  private var localHistoryIndex = -1
  private var phoneHistory: [PhoneLocation] = []
  private var phoneHistoryIndex = -1
  private var restoringLocation = false
  private var localReadID = UUID()
  private var clipboardChangeCount = -1
  private var previewEpoch = UUID()
  private var lastGridSelection: [WorkspacePane: String] = [:]
  private var phoneRevision = 0, localRevision = 0
  private struct PhoneCacheKey: Equatable {
    let revision: Int, order: [KeyPathComparator<MTPObject>], hidden: Bool, folders: Bool,
      search: String
  }
  private struct LocalCacheKey: Equatable {
    let revision: Int, order: [KeyPathComparator<LocalFile>], hidden: Bool, folders: Bool,
      search: String
  }
  private var phoneCacheKey: PhoneCacheKey?
  private var localCacheKey: LocalCacheKey?
  private var phoneCache: [MTPObject] = []
  private var localCache: [LocalFile] = []

  init(
    client: MTPClient? = nil, storage: UInt32? = nil, settings: WorkspaceSettings? = nil,
    defaults: UserDefaults? = nil, fileIntegration: NativeFileIntegration? = nil
  ) {
    let store: UserDefaults? =
      defaults ?? (client == nil && settings == nil ? UserDefaults.standard : nil)
    self.settings = settings ?? WorkspaceSettings(defaults: store)
    self.fileIntegration = fileIntegration ?? NativeFileIntegration.shared
    self.defaults = self.settings.store
    self.client = client
    selectedStorage = storage
    let localOverride =
      client == nil && settings == nil
      ? ProcessInfo.processInfo.environment["OPENMTP_LOCAL_ROOT"] : nil
    localDirectory = URL(
      fileURLWithPath: localOverride ?? self.settings.localPath, isDirectory: true)
    if localOverride == nil, !FileManager.default.fileExists(atPath: localDirectory.path) {
      localDirectory = FileManager.default.homeDirectoryForCurrentUser
    }
    if let client {
      connection = .connected
      deviceName = "\(client.device.info.manufacturer) \(client.device.info.model)"
      deviceKey =
        client.device.info.serialNumber.isEmpty
        ? UUID().uuidString : client.device.info.serialNumber
    }
    if let data = self.defaults.data(forKey: "workspace.transferJobs"),
      let saved = try? JSONDecoder().decode([Transfer].self, from: data)
    {
      transfers = saved.map { job in
        var job = job
        if !job.finished {
          job.state = .waiting
          job.error = "Interrupted on the previous launch. Retry starts the copy again."
        }
        return job
      }
    }
    settingsSubscription = self.settings.objectWillChange.sink { [weak self] _ in
      self?.objectWillChange.send()
    }
    paneVisibilitySubscription = self.settings.$showLocalPane.sink { [weak self] visible in
      if !visible {
        self?.activePane = .phone
        self?.localSelection = []
      }
    }
    if self.defaults.isPersistent {
      for index in transfers.indices where transfers[index].state == .completed {
        let remaining = self.fileIntegration.cleanupIncoming(transfers[index].ownedIncoming ?? [])
        transfers[index].ownedIncoming = remaining.isEmpty ? nil : remaining
      }
      self.fileIntegration.prune(preserving: transfers.flatMap { $0.ownedIncoming ?? [] })
    }
    applySavedSort()
    persistJobs()
  }

  var nativeClient: MTPClient? { client }
  var deviceIdentity: String { deviceKey }
  var currentParent: UInt32 { path.last?.handle ?? MTPHandle.root }
  var phonePath: String { "/" + path.map(\.name).joined(separator: "/") }
  var phoneLocation: String {
    ([storages.first { $0.id == selectedStorage }?.displayName ?? "Phone"] + path.map(\.name))
      .joined(separator: "/")
  }
  var selectedObjects: [MTPObject] { entries.filter { selection.contains($0.id) } }
  var selectedLocalFiles: [LocalFile] { localEntries.filter { localSelection.contains($0.id) } }
  var activeSelectionCount: Int {
    isTerminating ? 0 : (activePane == .local ? localSelection.count : selection.count)
  }
  var hasActiveTransfers: Bool {
    fileIntegration.hasActiveTransfers || !dropTasks.isEmpty || pendingConflict != nil
      || transfers.contains { !$0.finished && $0.state != .waiting }
  }
  var hasInFlightWork: Bool {
    worker != nil || !tokens.isEmpty || !dropTasks.isEmpty || closingConnection
      || fileIntegration.hasActiveTransfers
  }

  /// Stop accepting work, then let cancellation and exact-handle cleanup finish.
  /// A stalled provider/device cancels this quit attempt instead of forcing exit.
  func prepareForTermination(timeout: TimeInterval = 65) async -> Bool {
    guard !isTerminating else { return false }
    isTerminating = true
    let wasMonitoring = monitor != nil
    monitor?.stop()
    monitor = nil
    cancelAll()
    for task in dropTasks.values { task.cancel() }
    cancelPreview()
    fileIntegration.beginTermination()
    if !closingConnection {
      closingConnection = true
      Task { [weak self] in
        guard let self else { return }
        await disconnect(preserveWaiting: true)
        closingConnection = false
      }
    }
    let deadline = ProcessInfo.processInfo.systemUptime + max(0, timeout)
    while hasInFlightWork {
      if Task.isCancelled || ProcessInfo.processInfo.systemUptime >= deadline {
        isTerminating = false
        fileIntegration.cancelTermination()
        if wasMonitoring { startDeviceMonitoring() }
        errorMessage =
          "The copy is still stopping. OpenMTP stayed open so cleanup can finish. Try Quit again after it stops."
        return false
      }
      try? await Task.sleep(nanoseconds: 20_000_000)
    }
    persistJobs()
    return true
  }
  var canGoBack: Bool { activePane == .local ? localHistoryIndex > 0 : phoneHistoryIndex > 0 }
  var canGoForward: Bool {
    activePane == .local
      ? localHistoryIndex + 1 < localHistory.count : phoneHistoryIndex + 1 < phoneHistory.count
  }
  var canGoUp: Bool { activePane == .local ? localDirectory.path != "/" : !path.isEmpty }

  var sortedEntries: [MTPObject] {
    let key = PhoneCacheKey(
      revision: phoneRevision, order: sortOrder, hidden: settings.showHiddenPhone,
      folders: settings.directoriesFirst, search: phoneSearch)
    if phoneCacheKey != key {
      let visible = entries.filter {
        (settings.showHiddenPhone || !$0.name.hasPrefix("."))
          && (phoneSearch.isEmpty || $0.name.localizedStandardContains(phoneSearch))
      }
      phoneCache =
        settings.directoriesFirst
        ? visible.filter(\.isDirectory).sorted(using: sortOrder)
          + visible.filter { !$0.isDirectory }.sorted(using: sortOrder)
        : visible.sorted(using: sortOrder)
      phoneCacheKey = key
    }
    return phoneCache
  }
  var sortedLocalEntries: [LocalFile] {
    let key = LocalCacheKey(
      revision: localRevision, order: localSortOrder, hidden: settings.showHiddenLocal,
      folders: settings.directoriesFirst, search: localSearch)
    if localCacheKey != key {
      let visible = localEntries.filter {
        (settings.showHiddenLocal || !$0.name.hasPrefix("."))
          && (localSearch.isEmpty || $0.name.localizedStandardContains(localSearch))
      }
      localCache =
        settings.directoriesFirst
        ? visible.filter(\.isDirectory).sorted(using: localSortOrder)
          + visible.filter { !$0.isDirectory }.sorted(using: localSortOrder)
        : visible.sorted(using: localSortOrder)
      localCacheKey = key
    }
    return localCache
  }

  func start() {
    guard monitor == nil else { return }
    startDeviceMonitoring()
    navigateLocal(to: localDirectory)
    NativeUpdateService.shared.automaticPreferencesChanged = { [weak self] checks, installs in
      guard let self else { return }
      if settings.autoCheckUpdates != checks { settings.autoCheckUpdates = checks }
      if settings.autoInstallUpdates != installs { settings.autoInstallUpdates = installs }
    }
    NativeUpdateService.shared.hasActiveTransfers = { [weak self] in
      self?.hasActiveTransfers ?? false
    }
    NativeUpdateService.shared.start(
      automaticallyChecks: settings.autoCheckUpdates,
      automaticallyInstalls: settings.autoInstallUpdates,
      includePrereleases: settings.includePrereleases)
    if settings.autoCheckUpdates && !NativeUpdateService.shared.usesAutomaticInstaller {
      Task {
        await NativeUpdateService.shared.check(includePrereleases: settings.includePrereleases)
      }
    }
  }
  private func startDeviceMonitoring() {
    guard monitor == nil, !isTerminating else { return }
    let monitor = USBHotplugMonitor { [weak self] list in
      Task { @MainActor [weak self] in self?.devicesChanged(list) }
    }
    self.monitor = monitor
    monitor.start()
  }
  private func devicesChanged(_ list: [USBMTPCandidate]) {
    guard !isTerminating else { return }
    candidates = list
    if let connectedID, !list.contains(where: { $0.id == connectedID }) {
      cancelAll()
      Task { await disconnect() }
      return
    }
    guard client == nil, settings.autoConnect else { return }
    switch connection {
    case .connecting, .failed: if list.isEmpty { connection = .noDevice }
    case .noDevice, .connected: if let first = list.first { Task { await connect(first) } }
    }
  }
  func connect(_ candidate: USBMTPCandidate, seize: Bool = false) async {
    guard !isTerminating else { return }
    await disconnect()
    let epoch = UUID()
    connectionEpoch = epoch
    connection = .connecting(candidate.displayName)
    do {
      let opened = try await Task.detached(priority: .userInitiated) {
        let transport = try USBMTPTransport(candidate, seize: seize)
        return MTPClient(device: try MTPDevice(transport: transport))
      }.value
      let stores = try await opened.run { try $0.storages() }
      guard connectionEpoch == epoch else {
        await opened.close()
        return
      }
      client = opened
      connectedID = candidate.id
      deviceKey =
        opened.device.info.serialNumber.isEmpty
        ? "connection:\(epoch)" : opened.device.info.serialNumber
      deviceName = "\(opened.device.info.manufacturer) \(opened.device.info.model)"
      storages = stores
      guard !stores.isEmpty else {
        await opened.close()
        client = nil
        connection = .failed(
          "Unlock the phone and choose File transfer in its USB notification.", canSeize: false)
        return
      }
      connection = .connected
      selectedStorage = stores.first?.id
      await reload()
      startWorkerIfNeeded()
    } catch let error as USBTransportError {
      guard connectionEpoch == epoch else { return }
      if case .busy = error {
        connection = .failed(error.description, canSeize: true)
      } else {
        connection = .failed(error.description, canSeize: false)
      }
    } catch {
      guard connectionEpoch == epoch else { return }
      connection = .failed(String(describing: error), canSeize: false)
    }
  }
  func retry(seize: Bool) {
    guard let candidate = candidates.first else {
      connection = .noDevice
      return
    }
    Task { await connect(candidate, seize: seize) }
  }
  func disconnect(preserveWaiting: Bool = false) async {
    connectionEpoch = UUID()
    if preserveWaiting {
      for job in transfers where !job.finished && job.state != .waiting { cancelTransfer(job.id) }
    } else {
      cancelAll()
    }
    let old = client
    client = nil
    connectedID = nil
    selectedStorage = nil
    storages = []
    entries = []
    path = []
    selection = []
    phoneHistory = []
    phoneHistoryIndex = -1
    pendingDeletion = nil
    resolveConflict(nil)
    connection = .noDevice
    if let old { await old.close() }
  }

  func reload(refresh: Bool = false) async {
    guard let client, let storage = selectedStorage else { return }
    isLoading = true
    defer { isLoading = false }
    let parent = currentParent
    do {
      let listed = try await client.run {
        try $0.children(storage: storage, parent: parent, refresh: refresh)
      }
      guard self.client === client, selectedStorage == storage, currentParent == parent else {
        return
      }
      entries = listed
      selection.formIntersection(Set(entries.map(\.id)))
    } catch { report(error) }
  }
  func reloadActive() {
    if activePane == .local {
      Task { await reloadLocal() }
    } else {
      Task { await reload(refresh: true) }
    }
  }
  func reloadLocal() async {
    let directory = localDirectory
    let id = UUID()
    localReadID = id
    localLoading = true
    do {
      let listed = try await Task.detached(priority: .userInitiated) {
        try LocalDirectoryReader.read(directory)
      }.value
      guard localReadID == id, localDirectory == directory else { return }
      localEntries = listed
      localSelection.formIntersection(Set(listed.map(\.id)))
      localLoading = false
    } catch {
      guard localReadID == id else { return }
      localLoading = false
      errorMessage = "Cannot open \(directory.path): \(error)"
    }
  }
  func navigateLocal(to url: URL, recordHistory: Bool = true) {
    let url = url.standardizedFileURL
    localDirectory = url
    settings.localPath = url.path
    localSelection = []
    localEntries = []
    localSearch = ""
    if recordHistory {
      if localHistoryIndex + 1 < localHistory.count {
        localHistory.removeSubrange((localHistoryIndex + 1)...)
      }
      if localHistory.last != url { localHistory.append(url) }
      localHistoryIndex = localHistory.count - 1
    }
    Task { await reloadLocal() }
  }
  func open(_ object: MTPObject) {
    guard object.isDirectory else {
      selection = [object.id]
      activePane = .phone
      previewSelection()
      return
    }
    path.append(object)
    entries = []
    selection = []
    phoneSearch = ""
    if let selectedStorage { pushPhoneHistory(.init(storage: selectedStorage, folders: path)) }
    Task { await reload() }
  }
  func openLocal(_ file: LocalFile) {
    if file.isDirectory { navigateLocal(to: file.url) } else { NSWorkspace.shared.open(file.url) }
  }
  func openSelection() {
    if activePane == .local, let file = selectedLocalFiles.first {
      openLocal(file)
    } else if let object = selectedObjects.first {
      if object.isDirectory { open(object) } else { previewSelection() }
    }
  }
  func goUp(to depth: Int? = nil) {
    let target = depth ?? max(path.count - 1, 0)
    guard target < path.count else { return }
    path.removeLast(path.count - target)
    entries = []
    selection = []
    if let selectedStorage { pushPhoneHistory(.init(storage: selectedStorage, folders: path)) }
    Task { await reload() }
  }
  func goUpActive() {
    if activePane == .local {
      navigateLocal(to: localDirectory.deletingLastPathComponent())
    } else {
      goUp()
    }
  }
  func goBack() {
    if activePane == .local {
      guard localHistoryIndex > 0 else { return }
      localHistoryIndex -= 1
      navigateLocal(to: localHistory[localHistoryIndex], recordHistory: false)
    } else {
      guard phoneHistoryIndex > 0 else { return }
      phoneHistoryIndex -= 1
      restorePhoneLocation(phoneHistory[phoneHistoryIndex])
    }
  }
  func goForward() {
    if activePane == .local {
      guard localHistoryIndex + 1 < localHistory.count else { return }
      localHistoryIndex += 1
      navigateLocal(to: localHistory[localHistoryIndex], recordHistory: false)
    } else {
      guard phoneHistoryIndex + 1 < phoneHistory.count else { return }
      phoneHistoryIndex += 1
      restorePhoneLocation(phoneHistory[phoneHistoryIndex])
    }
  }
  private func pushPhoneHistory(_ location: PhoneLocation) {
    if phoneHistoryIndex + 1 < phoneHistory.count {
      phoneHistory.removeSubrange((phoneHistoryIndex + 1)...)
    }
    if phoneHistory.last != location { phoneHistory.append(location) }
    phoneHistoryIndex = phoneHistory.count - 1
  }
  private func restorePhoneLocation(_ location: PhoneLocation) {
    restoringLocation = true
    selectedStorage = location.storage
    restoringLocation = false
    path = location.folders
    entries = []
    selection = []
    Task { await reload() }
  }
  func chooseLocalFolder() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.directoryURL = localDirectory
    if panel.runModal() == .OK, let url = panel.url {
      activePane = .local
      navigateLocal(to: url)
    }
  }
  func toggleFavorite() {
    if settings.favorites.contains(localDirectory.path) {
      settings.favorites.removeAll { $0 == localDirectory.path }
    } else {
      settings.favorites.append(localDirectory.path)
    }
  }
  func selectAll() {
    if activePane == .local {
      localSelection = Set(sortedLocalEntries.map(\.id))
    } else {
      selection = Set(sortedEntries.map(\.id))
    }
  }
  func selectGridItem(_ id: String, in pane: WorkspacePane, modifiers: NSEvent.ModifierFlags) {
    guard !isTerminating, pane != .local || settings.showLocalPane else { return }
    let ordered =
      pane == .local
      ? sortedLocalEntries.map { $0.id.absoluteString } : sortedEntries.map { String($0.id) }
    var selected =
      pane == .local ? Set(localSelection.map(\.absoluteString)) : Set(selection.map(String.init))
    if modifiers.contains(.shift), let anchor = lastGridSelection[pane],
      let a = ordered.firstIndex(of: anchor), let b = ordered.firstIndex(of: id)
    {
      let range = Set(ordered[min(a, b)...max(a, b)])
      selected = modifiers.contains(.command) ? selected.union(range) : range
    } else if modifiers.contains(.command) {
      if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
      lastGridSelection[pane] = id
    } else {
      selected = [id]
      lastGridSelection[pane] = id
    }
    activePane = pane
    if pane == .local {
      localSelection = Set(selected.compactMap(URL.init(string:)))
    } else {
      selection = Set(selected.compactMap(UInt32.init))
    }
  }

  func contextSelectionIDs(clicked id: String, in pane: WorkspacePane) -> [String] {
    let selected =
      pane == .local
      ? Set(localSelection.map(\.absoluteString)) : Set(selection.map(String.init))
    return selected.contains(id) ? selected.sorted() : [id]
  }
  @discardableResult func applyContextSelection(_ ids: [String], in pane: WorkspacePane) -> Bool {
    guard !isTerminating, pane != .local || settings.showLocalPane else { return false }
    activePane = pane
    if pane == .local {
      localSelection = Set(ids.compactMap(URL.init(string:)))
    } else {
      selection = Set(ids.compactMap(UInt32.init))
    }
    return true
  }

  func copySelection(append: Bool = false) {
    let incoming: Clipboard
    if activePane == .local {
      guard !selectedLocalFiles.isEmpty else { return }
      incoming = Clipboard(
        pane: .local, paths: selectedLocalFiles.map { $0.url.path }, storage: nil,
        phoneIdentity: nil)
    } else {
      guard !selectedObjects.isEmpty, let selectedStorage else { return }
      incoming = Clipboard(
        pane: .phone, paths: selectedObjects.map { Self.remoteChildPath(phonePath, $0.name) },
        storage: selectedStorage, phoneIdentity: deviceKey)
    }
    if append, let clipboard {
      guard clipboard.pane == incoming.pane, clipboard.storage == incoming.storage,
        clipboard.phoneIdentity == incoming.phoneIdentity
      else {
        errorMessage =
          "The copy selection can contain items from one source at a time. Copy the new selection to start again."
        return
      }
      var seen = Set(clipboard.paths)
      self.clipboard = Clipboard(
        pane: incoming.pane,
        paths: clipboard.paths + incoming.paths.filter { seen.insert($0).inserted },
        storage: incoming.storage, phoneIdentity: incoming.phoneIdentity)
    } else {
      clipboard = incoming
    }
    NSPasteboard.general.clearContents()
    if incoming.pane == .local, let clipboard {
      NSPasteboard.general.writeObjects(clipboard.paths.map { URL(fileURLWithPath: $0) as NSURL })
    } else if let clipboard, let data = try? JSONEncoder().encode(clipboard) {
      NSPasteboard.general.setData(data, forType: Self.clipboardType)
    }
    clipboardChangeCount = NSPasteboard.general.changeCount
  }
  var canPaste: Bool {
    if isTerminating { return false }
    guard connection == .connected else { return false }
    if let clipboard, NSPasteboard.general.changeCount == clipboardChangeCount {
      return clipboard.pane != activePane
    }
    return activePane == .phone
      && NSPasteboard.general.canReadObject(
        forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true])
  }
  func pasteSelection() {
    if let clipboard, NSPasteboard.general.changeCount == clipboardChangeCount {
      guard clipboard.pane != activePane else {
        errorMessage = "Choose the other pane as the copy destination."
        return
      }
      if clipboard.pane == .local {
        _ = upload(clipboard.paths.map { URL(fileURLWithPath: $0) })
      } else if let storage = clipboard.storage, clipboard.phoneIdentity == deviceKey {
        enqueueDownload(
          paths: clipboard.paths, storage: storage, destination: localDirectory, identity: deviceKey
        )
      } else {
        errorMessage = "Connect the source phone before copying these items."
      }
    } else if let urls = NSPasteboard.general.readObjects(
      forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]
    {
      _ = upload(urls)
    }
  }
  func copyToOtherPane() {
    copySelection()
    activePane = activePane == .local ? .phone : .local
    pasteSelection()
  }
  private static let clipboardType = NSPasteboard.PasteboardType(
    "io.ganeshrvel.openmtp.remote-files")
  static let remoteDragType = "io.ganeshrvel.openmtp.remote-drag"

  func remoteItemProvider(_ object: MTPObject) -> NSItemProvider {
    guard let file = remoteFile(object) else { return NSItemProvider() }
    let provider = fileIntegration.itemProvider(for: file)
    let payload = Clipboard(
      pane: .phone, paths: [Self.remoteChildPath(phonePath, object.name)], storage: selectedStorage,
      phoneIdentity: deviceKey)
    if let data = try? JSONEncoder().encode(payload) {
      provider.registerDataRepresentation(
        forTypeIdentifier: Self.remoteDragType, visibility: .ownProcess
      ) { completion in
        completion(data, nil)
        return nil
      }
    }
    return provider
  }
  var selectedRemoteFiles: [NativeFileIntegration.RemoteFile] {
    selectedObjects.compactMap(remoteFile)
  }
  @discardableResult func receiveDrop(_ providers: [NSItemProvider], into pane: WorkspacePane)
    -> Bool
  {
    guard !isTerminating, !providers.isEmpty, pane == .local || connection == .connected else {
      return false
    }
    let destination = localDirectory
    let parentPath = phonePath
    let storage = selectedStorage
    let identity = deviceKey
    let taskID = UUID()
    dropInProgress = true
    dropTasks[taskID] = Task {
      defer {
        dropTasks[taskID] = nil
        dropInProgress = !dropTasks.isEmpty
      }
      do {
        if providers.allSatisfy({ $0.hasItemConformingToTypeIdentifier(Self.remoteDragType) }) {
          guard pane == .local else {
            throw MTPError.transport("Drop phone items into the Mac pane.")
          }
          var paths = [String]()
          var sourceStorage: UInt32?
          for provider in providers {
            let data = try await Self.loadData(provider, type: Self.remoteDragType)
            let value = try JSONDecoder().decode(Clipboard.self, from: data)
            guard value.phoneIdentity == identity,
              sourceStorage == nil || sourceStorage == value.storage
            else {
              throw MTPError.transport("The dropped items belong to a different phone or storage.")
            }
            sourceStorage = value.storage
            paths.append(contentsOf: value.paths)
          }
          guard let sourceStorage else { return }
          enqueueDownload(
            paths: paths, storage: sourceStorage, destination: destination, identity: identity)
        } else {
          guard pane == .phone, let storage else {
            throw MTPError.transport(
              "Drop Mac files into the phone pane, or drag phone files into Finder.")
          }
          let received = try await fileIntegration.receiveOwned(providers)
          var enqueued = false
          defer { if !enqueued { _ = fileIntegration.cleanupIncoming(received.ownership) } }
          try Task.checkCancellation()
          guard !isTerminating, identity == deviceKey else {
            throw MTPError.transport("The phone changed while receiving the drop.")
          }
          enqueued = enqueueUpload(
            received.urls, storage: storage, parentPath: parentPath,
            ownedIncoming: received.ownership)
        }
      } catch { errorMessage = String(describing: error) }
    }
    return true
  }
  private static func loadData(_ provider: NSItemProvider, type: String) async throws -> Data {
    try await withCheckedThrowingContinuation { continuation in
      _ = provider.loadDataRepresentation(forTypeIdentifier: type) { data, error in
        if let data {
          continuation.resume(returning: data)
        } else {
          continuation.resume(
            throwing: error ?? MTPError.transport("The drag did not contain file information."))
        }
      }
    }
  }

  func downloadSelection(_ ids: Set<MTPObject.ID>? = nil) {
    let selected = entries.filter { (ids ?? selection).contains($0.id) }
    guard !selected.isEmpty, let storage = selectedStorage else { return }
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.canCreateDirectories = true
    panel.prompt = "Copy to Mac"
    panel.directoryURL = localDirectory
    guard panel.runModal() == .OK, let destination = panel.url else { return }
    enqueueDownload(
      paths: selected.map { Self.remoteChildPath(phonePath, $0.name) }, storage: storage,
      destination: destination, identity: deviceKey)
  }
  @discardableResult func upload(_ urls: [URL]) -> Bool {
    guard let storage = selectedStorage, connection == .connected else { return false }
    return enqueueUpload(urls, storage: storage, parentPath: phonePath)
  }
  private func enqueueUpload(
    _ urls: [URL], storage: UInt32, parentPath: String,
    ownedIncoming: [NativeIncomingOwnership] = []
  ) -> Bool {
    var accepted = false
    defer { if !accepted { _ = fileIntegration.cleanupIncoming(ownedIncoming) } }
    guard !isTerminating, !urls.isEmpty else { return false }
    do {
      for url in urls {
        guard url.isFileURL else {
          throw MTPError.transport("Choose local files and folders only.")
        }
        let type =
          try FileManager.default.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType
        guard type == .typeRegular || type == .typeDirectory else {
          throw MTPError.transport(
            "\(url.lastPathComponent) is not a regular file or folder. Symbolic links are not copied."
          )
        }
      }
    } catch {
      errorMessage = "Nothing was uploaded. \(error)"
      return false
    }
    let names = urls.map(\.lastPathComponent)
    enqueue(
      Transfer(
        id: UUID(), name: names.count == 1 ? names[0] : "\(names.count) selected items",
        direction: .upload, sourcePaths: urls.map(\.path), destination: parentPath,
        storage: storage, phoneIdentity: deviceKey,
        ownedIncoming: ownedIncoming.isEmpty ? nil : ownedIncoming))
    accepted = true
    return true
  }
  private func enqueueDownload(paths: [String], storage: UInt32, destination: URL, identity: String)
  {
    guard !paths.isEmpty else { return }
    enqueue(
      Transfer(
        id: UUID(),
        name: paths.count == 1
          ? URL(fileURLWithPath: paths[0]).lastPathComponent : "\(paths.count) selected items",
        direction: .download, sourcePaths: paths, destination: destination.path, storage: storage,
        phoneIdentity: identity))
  }
  private func enqueue(_ job: Transfer) {
    guard !isTerminating else { return }
    transfers.append(job)
    settings.showTransfers = true
    persistJobs()
    startWorkerIfNeeded()
  }
  func chooseFilesToUpload() {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = true
    panel.canChooseDirectories = true
    panel.canChooseFiles = true
    panel.prompt = "Copy to Phone"
    if panel.runModal() == .OK { _ = upload(panel.urls) }
  }
  private func startWorkerIfNeeded() {
    guard !isTerminating, worker == nil, client != nil, connection == .connected else { return }
    worker = Task { [weak self] in
      guard let self else { return }
      while !isTerminating, let job = transfers.first(where: { $0.state == .queued }) {
        await run(job)
      }
      worker = nil
    }
  }
  private func run(_ job: Transfer) async {
    guard let client, connection == .connected, job.phoneIdentity == deviceKey else {
      updateJob(job.id) {
        $0.state = .waiting
        $0.error = "Connect the original phone, then retry this job."
      }
      persistJobs()
      return
    }
    let token = TransferCancellationToken()
    tokens[job.id] = token
    updateJob(job.id) {
      $0.state = .planning
      $0.error = nil
      $0.done = 0
      $0.total = nil
      $0.completedFiles = 0
      $0.skippedFiles = 0
      $0.totalFiles = 0
      $0.currentFile = ""
      $0.startedAt = nil
      $0.completedAt = nil
    }
    persistJobs()
    do {
      let plan = try await client.run { device in
        try token.check()
        if job.direction == .upload {
          let parent = try device.resolve(storage: job.storage, path: job.destination)
          return try device.planUpload(
            job.sourcePaths.map { URL(fileURLWithPath: $0) }, storage: job.storage,
            parent: parent?.handle ?? MTPHandle.root, cancellation: token)
        }
        let objects = try job.sourcePaths.map { path in
          try token.check()
          guard let object = try device.resolve(storage: job.storage, path: path) else {
            throw MTPError.notFound(path)
          }
          return object
        }
        return try device.planDownload(
          objects, to: URL(fileURLWithPath: job.destination, isDirectory: true), cancellation: token
        )
      }
      try token.check()
      guard self.client === client, deviceKey == job.phoneIdentity else {
        throw MTPError.transport("The phone changed before the copy started.")
      }
      updateJob(job.id) {
        $0.total = plan.totalBytes
        $0.totalFiles = plan.fileCount
      }
      var policy = CopyConflictPolicy.replace
      var removeExtras = false
      browser.removeExtras = false
      if !plan.conflicts.isEmpty || !plan.extras.isEmpty {
        updateJob(job.id) { $0.state = .waiting }
        pendingConflict = PendingConflict(
          jobID: job.id, names: Array(plan.conflicts.prefix(8).map(\.relativePath)),
          count: plan.conflicts.count, extrasCount: plan.extras.count, route: job.route,
          destinationIsPhone: job.direction == .upload,
          extraNames: Array(plan.extras.prefix(12).map(\.relativePath)))
        let decision = await withCheckedContinuation { conflictContinuation = $0 }
        pendingConflict = nil
        guard let decision else { throw MTPError.cancelled }
        policy = decision.policy
        removeExtras = decision.removeExtras && policy == .smartSync
      }
      try token.check()
      guard self.client === client, connection == .connected, deviceKey == job.phoneIdentity else {
        throw MTPError.transport(
          "The phone changed while choosing how to copy. Retry the job on the original phone.")
      }
      updateJob(job.id) {
        $0.state = .running
        $0.startedAt = Date()
      }
      let progress = treeProgressReporter(job.id, cancellation: token)
      let chosenPolicy = policy
      let shouldRemoveExtras = removeExtras
      let summary = try await client.run { device in
        let result = try device.execute(
          plan, policy: chosenPolicy, cancellation: token, progress: progress)
        if shouldRemoveExtras { _ = try device.removeExtras(from: plan, cancellation: token) }
        return result
      }
      updateJob(job.id) {
        $0.state = .completed
        $0.completedAt = Date()
        $0.completedFiles = summary.copiedFiles + summary.skippedFiles
        $0.skippedFiles = summary.skippedFiles
        $0.done = summary.bytes
        $0.total = summary.bytes
      }
      persistJobs()
      let remaining = fileIntegration.cleanupIncoming(job.ownedIncoming ?? [])
      updateJob(job.id) { $0.ownedIncoming = remaining.isEmpty ? nil : remaining }
      if job.direction == .download,
        URL(fileURLWithPath: job.destination).standardizedFileURL == localDirectory
      {
        await reloadLocal()
      }
      await reload(refresh: true)
    } catch {
      let cancelled =
        token.isCancelled || (error as? MTPError) == .cancelled || error is CancellationError
      updateJob(job.id) {
        $0.state = cancelled ? .cancelled : .failed
        $0.error = cancelled ? nil : String(describing: error)
        if !token.recoveryPaths.isEmpty {
          $0.error =
            ($0.error.map { $0 + "\n" } ?? "") + "Recovery copies: "
            + token.recoveryPaths.joined(separator: ", ")
        }
        $0.completedAt = Date()
      }
      if client.device.session.isBroken, self.client === client {
        for i in transfers.indices where transfers[i].state == .queued {
          transfers[i].state = .waiting
          transfers[i].error =
            "Reconnect the phone and retry. A previous transfer interrupted the session."
        }
        await disconnect(preserveWaiting: true)
      }
    }
    tokens[job.id] = nil
    persistJobs()
  }
  private func updateJob(_ id: UUID, _ change: (inout Transfer) -> Void) {
    guard let index = transfers.firstIndex(where: { $0.id == id }) else { return }
    change(&transfers[index])
  }
  nonisolated private func treeProgressReporter(_ id: UUID, cancellation: TransferCancellationToken)
    -> @Sendable (TreeTransferProgress) throws -> Void
  {
    let last = LockedValue(0)
    return { [weak self] progress in
      let now = ProcessInfo.processInfo.systemUptime
      guard
        last.exchange(ifOlderThan: now - 0.1, with: now)
          || progress.completedFiles == progress.totalFiles
      else { return }
      Task { @MainActor [weak self] in
        guard let self, self.tokens[id] === cancellation else { return }
        self.updateJob(id) {
          if !$0.finished {
            $0.currentFile = progress.fileName
            $0.done = progress.completedBytes
            $0.total = progress.totalBytes
            $0.completedFiles = progress.completedFiles
            $0.totalFiles = progress.totalFiles
          }
        }
      }
    }
  }
  func resolveConflict(_ policy: CopyConflictPolicy?, removeExtras: Bool = false) {
    guard let continuation = conflictContinuation else { return }
    browser.removeExtras = removeExtras
    conflictContinuation = nil
    pendingConflict = nil
    continuation.resume(
      returning: policy.map { ConflictDecision(policy: $0, removeExtras: removeExtras) })
  }
  func cancelTransfer(_ id: UUID) {
    guard let index = transfers.firstIndex(where: { $0.id == id }), !transfers[index].finished
    else { return }
    tokens[id]?.cancel()
    if pendingConflict?.jobID == id { resolveConflict(nil) }
    if tokens[id] != nil {
      transfers[index].state = .cancelling
    } else {
      transfers[index].state = .cancelled
      transfers[index].completedAt = Date()
    }
    persistJobs()
  }
  func cancelAll() { for job in transfers where !job.finished { cancelTransfer(job.id) } }
  func canRetryTransfer(_ id: UUID) -> Bool {
    guard tokens[id] == nil, client != nil, connection == .connected,
      let job = transfers.first(where: { $0.id == id }), job.phoneIdentity == deviceKey
    else { return false }
    return job.state == .failed || job.state == .cancelled || job.state == .waiting
  }
  func retryTransfer(_ id: UUID) {
    guard !isTerminating else { return }
    guard let index = transfers.firstIndex(where: { $0.id == id }) else { return }
    guard connection == .connected, transfers[index].phoneIdentity == deviceKey else {
      errorMessage =
        "Connect the original phone before retrying. Anonymous devices require a new copy selection after reconnecting."
      return
    }
    guard canRetryTransfer(id) else { return }
    transfers[index].state = .queued
    transfers[index].error = nil
    transfers[index].completedAt = nil
    persistJobs()
    startWorkerIfNeeded()
  }
  func clearFinishedTransfers() {
    for job in transfers where job.finished {
      _ = fileIntegration.cleanupIncoming(job.ownedIncoming ?? [])
    }
    transfers.removeAll { $0.finished }
    persistJobs()
  }
  private func persistJobs() {
    // Retryable jobs own their provider copies until explicitly cleared. Bound
    // completed history, rather than evicting pending or failed ownership.
    let retryable = transfers.filter { $0.state != .completed }
    let completed = transfers.filter { $0.state == .completed }.suffix(
      max(0, 200 - retryable.count))
    if let data = try? JSONEncoder().encode(retryable + Array(completed)) {
      defaults.set(data, forKey: "workspace.transferJobs")
    }
  }

  func beginNewFolder() {
    guard !isTerminating else { return }
    browser.folderContext = FolderCreationContext(
      pane: activePane, localDirectory: localDirectory, client: client,
      storage: selectedStorage, parent: currentParent,
      location: activePane == .local ? localDirectory.path : phoneLocation)
    browser.newFolderName = ""
    browser.showingNewFolder = true
  }
  func commitNewFolder() {
    guard !isTerminating else { return }
    guard let context = browser.folderContext else { return }
    defer { browser.folderContext = nil }
    guard activePane == context.pane,
      context.pane == .local
        ? localDirectory == context.localDirectory
        : (client === context.client && selectedStorage == context.storage
          && currentParent == context.parent)
    else {
      errorMessage = "Folder creation was cancelled because the destination changed."
      return
    }
    makeFolder(named: browser.newFolderName)
    browser.newFolderName = ""
  }
  func makeFolder(named name: String) {
    guard Self.validName(name) else {
      errorMessage = "Use a filename without a slash, NUL or dot-only component."
      return
    }
    if activePane == .local {
      let destination = localDirectory.appendingPathComponent(name, isDirectory: true)
      Task {
        do {
          try await Task.detached {
            try FileManager.default.createDirectory(
              at: destination, withIntermediateDirectories: false)
          }.value
          await reloadLocal()
        } catch { errorMessage = String(describing: error) }
      }
    } else {
      guard let client, let storage = selectedStorage else { return }
      let parent = currentParent
      Task {
        do {
          _ = try await client.run { try $0.makeDirectory(name, storage: storage, parent: parent) }
          await reload(refresh: true)
        } catch { report(error) }
      }
    }
  }
  func rename(_ object: MTPObject, to name: String) {
    guard let client, Self.validName(name), name != object.name else { return }
    Task {
      do {
        try await client.run { try $0.rename(object, to: name) }
        await reload(refresh: true)
      } catch { report(error) }
    }
  }
  func beginRename() {
    guard !isTerminating else { return }
    browser.renameText =
      activePane == .local
      ? (selectedLocalFiles.first?.name ?? "") : (selectedObjects.first?.name ?? "")
    browser.renaming = activePane == .phone ? selectedObjects.first : nil
    browser.renamingLocal = activePane == .local ? selectedLocalFiles.first?.url : nil
    browser.renamingClient = activePane == .phone ? client : nil
    browser.renamingStorage = selectedStorage
    browser.renamingParent = currentParent
    browser.showingRename = browser.renaming != nil || browser.renamingLocal != nil
  }
  func commitRename() {
    guard !isTerminating else { return }
    let name = browser.renameText
    guard Self.validName(name) else {
      errorMessage = "Use a valid filename."
      return
    }
    if let object = browser.renaming {
      guard client === browser.renamingClient, selectedStorage == browser.renamingStorage,
        currentParent == browser.renamingParent
      else {
        errorMessage = "Rename was cancelled because the phone or folder changed."
        return
      }
      rename(object, to: name)
    } else if let url = browser.renamingLocal {
      let destination = url.deletingLastPathComponent().appendingPathComponent(name)
      Task {
        do {
          try await Task.detached { try FileManager.default.moveItem(at: url, to: destination) }
            .value
          await reloadLocal()
        } catch { errorMessage = String(describing: error) }
      }
    }
  }
  func requestActiveDeletion() {
    guard !isTerminating else { return }
    if activePane == .local {
      let urls = selectedLocalFiles.map(\.url)
      Task {
        do {
          try await Task.detached {
            for url in urls {
              _ = try FileManager.default.trashItem(at: url, resultingItemURL: nil)
            }
          }.value
          await reloadLocal()
        } catch { errorMessage = String(describing: error) }
      }
    } else {
      requestDeletion()
    }
  }
  func requestDeletion(_ ids: Set<MTPObject.ID>? = nil) {
    guard !isTerminating else { return }
    guard let client, let storage = selectedStorage, connection == .connected else { return }
    let objects = entries.filter { (ids ?? selection).contains($0.id) }
    guard !objects.isEmpty else { return }
    pendingDeletion = PendingDeletion(
      client: client, storage: storage, parent: currentParent, objects: objects,
      location: phoneLocation)
  }
  func confirmDeletion(_ request: PendingDeletion) async {
    guard !isTerminating else { return }
    guard client === request.client, connection == .connected, selectedStorage == request.storage,
      currentParent == request.parent
    else {
      errorMessage =
        "Deletion cancelled because the phone or folder changed. Select the items again."
      return
    }
    do {
      try await request.client.run { device in
        for object in request.objects { try device.delete(object) }
      }
      if client === request.client, selectedStorage == request.storage,
        currentParent == request.parent
      {
        selection.subtract(request.objects.map(\.id))
        await reload(refresh: true)
      }
    } catch { report(error) }
  }
  func previewSelection() {
    guard !isTerminating else { return }
    if fileIntegration.isPreviewVisible
      || fileIntegration.isPreviewLoading || preparingPreview
    {
      cancelPreview()
      return
    }
    if activePane == .local {
      fileIntegration.preview(localURLs: selectedLocalFiles.map(\.url))
    } else {
      let files = selectedObjects.compactMap { remoteFile($0) }
      guard !files.isEmpty else { return }
      let epoch = UUID()
      previewEpoch = epoch
      preparingPreview = true
      Task {
        defer { if previewEpoch == epoch { preparingPreview = false } }
        do {
          try await fileIntegration.preview(remoteFiles: files)
        } catch is CancellationError {} catch MTPError.cancelled {
          if let client, client.device.session.isBroken { await disconnect(preserveWaiting: true) }
        } catch { report(error) }
      }
    }
  }
  func cancelPreview() {
    previewEpoch = UUID()
    preparingPreview = false
    fileIntegration.closePreview()
  }
  private func remoteFile(_ object: MTPObject) -> NativeFileIntegration.RemoteFile? {
    guard let client, let storage = selectedStorage else { return nil }
    return NativeFileIntegration.RemoteFile(
      name: object.name, isDirectory: object.isDirectory,
      identity: "\(deviceKey)/\(storage)/\(object.handle)", byteCount: object.size
    ) { directory, progress in
      let token = TransferCancellationToken()
      progress.cancellationHandler = { token.cancel() }
      let plan = try await client.run {
        try $0.planDownload([object], to: directory, cancellation: token)
      }
      _ = try await client.run { device in
        try device.execute(plan, policy: .replace, cancellation: token) { status in
          if let total = status.totalBytes { progress.totalUnitCount = Int64(clamping: total) }
          progress.completedUnitCount = Int64(clamping: status.completedBytes)
        }
      }
      return directory.appendingPathComponent(object.name, isDirectory: object.isDirectory)
    }
  }
  private func report(_ error: Error) {
    errorMessage = String(describing: error)
    if let client, client.device.session.isBroken { Task { await disconnect() } }
  }
  private static func validName(_ name: String) -> Bool {
    !name.isEmpty && name != "." && name != ".." && !name.contains("/") && !name.contains("\0")
  }
  private static func remoteChildPath(_ parent: String, _ name: String) -> String {
    (parent == "/" ? "" : parent) + "/" + name
  }
  private func applySavedSort() {
    let order: SortOrder = settings.phoneDescending ? .reverse : .forward
    switch settings.phoneSort {
    case .name:
      sortOrder = [KeyPathComparator(\MTPObject.name, comparator: .localizedStandard, order: order)]
    case .size: sortOrder = [KeyPathComparator(\MTPObject.sortSize, order: order)]
    case .modified: sortOrder = [KeyPathComparator(\MTPObject.sortModified, order: order)]
    }
    let localOrder: SortOrder = settings.localDescending ? .reverse : .forward
    switch settings.localSort {
    case .name:
      localSortOrder = [
        KeyPathComparator(\LocalFile.name, comparator: .localizedStandard, order: localOrder)
      ]
    case .size: localSortOrder = [KeyPathComparator(\LocalFile.sortSize, order: localOrder)]
    case .modified: localSortOrder = [KeyPathComparator(\LocalFile.sortModified, order: localOrder)]
    }
  }
  func setSort(_ field: BrowserSortField, descending: Bool, for pane: WorkspacePane) {
    if pane == .local {
      settings.localSort = field
      settings.localDescending = descending
    } else {
      settings.phoneSort = field
      settings.phoneDescending = descending
    }
    applySavedSort()
  }
  private func savePhoneSort() {
    guard let value = sortOrder.first else { return }
    settings.phoneDescending = value.order == .reverse
    settings.phoneSort =
      value.keyPath == \MTPObject.size || value.keyPath == \MTPObject.sortSize
      ? .size
      : value.keyPath == \MTPObject.modified || value.keyPath == \MTPObject.sortModified
        ? .modified : .name
  }
  private func saveLocalSort() {
    guard let value = localSortOrder.first else { return }
    settings.localDescending = value.order == .reverse
    settings.localSort =
      value.keyPath == \LocalFile.size || value.keyPath == \LocalFile.sortSize
      ? .size
      : value.keyPath == \LocalFile.modified || value.keyPath == \LocalFile.sortModified
        ? .modified : .name
  }
}

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

@MainActor
final class BrowserState: ObservableObject {
  @Published var newFolderName = ""
  var folderContext: AppModel.FolderCreationContext?
  @Published var showingNewFolder = false
  @Published var renaming: MTPObject?
  @Published var renamingLocal: URL?
  var renamingClient: MTPClient?
  var renamingStorage: UInt32?
  var renamingParent: UInt32?
  @Published var showingRename = false
  @Published var renameText = ""
  @Published var isDropTargeted = false
  @Published var isLocalDropTargeted = false
  @Published var showingSeize = false
  @Published var removeExtras = false
  @Published var confirmExtras = false
}
