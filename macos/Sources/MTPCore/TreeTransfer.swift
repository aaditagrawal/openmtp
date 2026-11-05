import Foundation

#if canImport(Darwin)
  import Darwin
#else
  import Glibc
#endif

public enum CopyConflictPolicy: String, CaseIterable, Sendable {
  case ask, skip, replace, keepBoth, smartSync
}

/// Cancellation is checked on the device queue and from each streaming progress
/// callback. It does not depend on cancellation of an unrelated Swift Task.
public final class TransferCancellationToken: @unchecked Sendable {
  private let lock = NSLock()
  private var cancelled = false
  private var recoveries: [String] = []
  public init() {}
  public var isCancelled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelled
  }
  public var recoveryPaths: [String] {
    lock.lock()
    defer { lock.unlock() }
    return recoveries
  }
  public func cancel() {
    lock.lock()
    cancelled = true
    lock.unlock()
  }
  public func check() throws { if isCancelled { throw MTPError.cancelled } }
  fileprivate func record(_ path: String) {
    lock.lock()
    defer { lock.unlock() }
    if !recoveries.contains(path) { recoveries.append(path) }
  }
  fileprivate func resolved(_ path: String) {
    lock.lock()
    defer { lock.unlock() }
    recoveries.removeAll { $0 == path }
  }
}

public struct TreeTransferProgress: Sendable {
  public let fileName: String
  /// Payload bytes actually transferred. Skipped files do not add bytes.
  public let completedBytes: UInt64
  /// Payload bytes planned after the selected conflict policy is applied.
  public let totalBytes: UInt64?
  /// Files processed, including skipped files.
  public let completedFiles: Int
  public let totalFiles: Int
}

public struct TreeTransferSummary: Sendable {
  public let copiedFiles: Int
  public let skippedFiles: Int
  public let bytes: UInt64
}

public struct TreeTransferConflict: Sendable, Identifiable, Hashable {
  public let relativePath: String
  public var id: String { relativePath }
  public var name: String { (relativePath as NSString).lastPathComponent }
  public let sourceIsDirectory: Bool
  public let destinationIsDirectory: Bool
  public let sourceSize: UInt64?
  public let destinationSize: UInt64?
  public let sourceModified: Date?
  public let destinationModified: Date?
}

/// Unmatched destination files remain unless the caller explicitly invokes
/// removeExtras after a successful Smart Sync. Empty folders always remain.
public struct TreeTransferExtra: Sendable, Identifiable, Hashable {
  public let relativePath: String
  public var id: String { relativePath }
  public var name: String { (relativePath as NSString).lastPathComponent }
  public let isDirectory: Bool
}

public enum TreeTransferError: Error, Sendable, CustomStringConvertible {
  case conflicts([TreeTransferConflict])
  case invalidInput(String)
  case sourceChanged(String)
  case destinationChanged(String)
  case limitExceeded(String)
  case recoveryRequired(String)

  public var description: String {
    switch self {
    case .conflicts(let items): "Choose what to do with \(items.count) existing items."
    case .invalidInput(let message): message
    case .sourceChanged(let path): "The source changed. Start the copy again: \(path)"
    case .destinationChanged(let path): "The destination changed. Start the copy again: \(path)"
    case .limitExceeded(let message): message
    case .recoveryRequired(let message): message
    }
  }
}

public struct TreeTransferPlan: Sendable {
  public let conflicts: [TreeTransferConflict]
  public let extras: [TreeTransferExtra]
  public let fileCount: Int
  public let totalBytes: UInt64?
  fileprivate let owner: MTPDevice
  fileprivate let destination: TreeDestination
  fileprivate let nodes: [TreeNode]
  fileprivate let extraOperations: [TreeExtraOperation]
  fileprivate let extraParents: [String: TreeItem]
  fileprivate let completion: TreePlanCompletion
}

private final class TreePlanCompletion: @unchecked Sendable {
  private let lock = NSLock()
  private var successfulPolicy: CopyConflictPolicy?
  private var removed: Set<String> = []
  func begin() {
    lock.lock()
    successfulPolicy = nil
    removed = []
    lock.unlock()
  }
  func succeed(_ policy: CopyConflictPolicy) {
    lock.lock()
    successfulPolicy = policy
    lock.unlock()
  }
  var canRemoveExtras: Bool {
    lock.lock()
    defer { lock.unlock() }
    return successfulPolicy == .smartSync
  }
  func wasRemoved(_ path: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return removed.contains(path)
  }
  func didRemove(_ path: String) {
    lock.lock()
    removed.insert(path)
    lock.unlock()
  }
}

private struct TreeExtraOperation: Sendable {
  let path: String
  let item: TreeItem
}

private enum TreeDestination: Sendable {
  case local(LocalTreeItem)
  case remote(storage: UInt32, parent: MTPObject?)
}

private struct LocalTreeItem: Sendable {
  let url: URL
  let isDirectory: Bool
  let size: UInt64
  let modified: Date?
  let device: UInt64
  let inode: UInt64
}

private enum TreeItem: Sendable {
  case local(LocalTreeItem)
  case remote(MTPObject)
  var isDirectory: Bool {
    switch self {
    case .local(let i): i.isDirectory
    case .remote(let i): i.isDirectory
    }
  }
  var size: UInt64? {
    switch self {
    case .local(let i): i.isDirectory ? 0 : i.size
    case .remote(let i): i.size
    }
  }
  var modified: Date? {
    switch self {
    case .local(let i): i.modified
    case .remote(let i): i.modified
    }
  }
}

private struct TreeNode: Sendable {
  let name: String
  let path: String
  let source: TreeItem
  let existing: TreeItem?
  let children: [TreeNode]
  var fileCount: Int { source.isDirectory ? children.reduce(0) { $0 + $1.fileCount } : 1 }
}

private func validTreeName(_ name: String) throws {
  guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\0"),
    name.utf16.count <= 254
  else {
    throw TreeTransferError.invalidInput("Invalid file name: \(name.debugDescription)")
  }
}

/// lstat semantics deliberately reject links, sockets, devices and pipes before
/// any copy is queued. Missing entries are distinct from unreadable entries.
private func localTreeItem(_ url: URL) throws -> LocalTreeItem? {
  guard url.isFileURL else {
    throw TreeTransferError.invalidInput("Choose a local file or folder.")
  }
  let attrs: [FileAttributeKey: Any]
  do { attrs = try FileManager.default.attributesOfItem(atPath: url.path) } catch let error
    as NSError
    where
    (error.domain == NSCocoaErrorDomain
    && [NSFileNoSuchFileError, NSFileReadNoSuchFileError].contains(error.code))
    || (error.domain == NSPOSIXErrorDomain && error.code == Int(ENOENT))
  { return nil }
  let type = attrs[.type] as? FileAttributeType
  guard type == .typeRegular || type == .typeDirectory else {
    throw TreeTransferError.invalidInput(
      "Symbolic links and special files are not supported: \(url.path)")
  }
  return LocalTreeItem(
    url: url, isDirectory: type == .typeDirectory,
    size: (attrs[.size] as? NSNumber)?.uint64Value ?? 0,
    modified: attrs[.modificationDate] as? Date,
    device: (attrs[.systemNumber] as? NSNumber)?.uint64Value ?? 0,
    inode: (attrs[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0)
}

private func sameLocal(_ a: LocalTreeItem, _ b: LocalTreeItem, contents: Bool) -> Bool {
  a.device == b.device && a.inode == b.inode && a.isDirectory == b.isDirectory
    && (!contents || (a.size == b.size && a.modified == b.modified))
}

private func sameRemoteIdentity(_ current: MTPObject, _ expected: MTPObject) -> Bool {
  current.handle == expected.handle && current.storageID == expected.storageID
    && current.parent == expected.parent && current.name == expected.name
    && current.format == expected.format
}

private func sameRemote(_ current: MTPObject, _ expected: MTPObject) -> Bool {
  sameRemoteIdentity(current, expected) && (expected.size == nil || current.size == expected.size)
    && (expected.modified == nil || current.modified == expected.modified)
}

private func smartSyncMatches(_ source: TreeItem, _ destination: TreeItem) -> Bool {
  guard !source.isDirectory, !destination.isDirectory,
    let a = source.size, let b = destination.size, a == b,
    let sourceTime = source.modified, let destinationTime = destination.modified
  else { return false }
  // MTP dates have second precision. Unknown timestamps force a copy.
  return floor(sourceTime.timeIntervalSince1970) <= floor(destinationTime.timeIntervalSince1970)
}

private func plannedBytes(_ nodes: [TreeNode], policy: CopyConflictPolicy) -> UInt64? {
  var result: UInt64 = 0
  for node in nodes {
    if let existing = node.existing {
      if policy == .skip { continue }
      if policy == .smartSync && smartSyncMatches(node.source, existing) { continue }
    }
    let amount =
      node.source.isDirectory
      ? plannedBytes(node.children, policy: policy == .keepBoth ? .replace : policy)
      : node.source.size
    guard let amount else { return nil }
    let (sum, overflow) = result.addingReportingOverflow(amount)
    if overflow { return nil }
    result = sum
  }
  return result
}

/// Directory merges can copy new children without renaming. Replacing a file
/// or a file/folder type clash requires the staged replacement protocol.
private func firstRenameRequiredPath(_ nodes: [TreeNode], policy: CopyConflictPolicy) -> String? {
  for node in nodes {
    guard let existing = node.existing else { continue }
    if policy == .skip || policy == .keepBoth { continue }
    if policy == .smartSync && smartSyncMatches(node.source, existing) { continue }
    guard node.source.isDirectory && existing.isDirectory else { return node.path }
    if let path = firstRenameRequiredPath(node.children, policy: policy) { return path }
  }
  return nil
}

private func unsupportedReplacement(_ path: String) -> TreeTransferError {
  .invalidInput(
    "This device cannot rename files, so existing items cannot be replaced safely: \(path). Choose Skip or Keep Both."
  )
}

private final class TreePlanner {
  let device: MTPDevice
  let cancellation: TransferCancellationToken?
  var count = 0
  var conflicts: [TreeTransferConflict] = []
  var extras: [TreeTransferExtra] = []
  var extraOperations: [TreeExtraOperation] = []
  var extraParents: [String: TreeItem] = [:]
  var visitedRemote: Set<UInt32> = []
  var visitedLocal: Set<String> = []
  var remoteListings: [UInt32: [String: MTPObject]] = [:]
  var localPaths: Set<String> = []
  var visitedExtraFolders: Set<String> = []
  let localCaseSensitive: Bool

  init(
    device: MTPDevice, localCaseSensitive: Bool = true,
    cancellation: TransferCancellationToken? = nil
  ) {
    self.device = device
    self.localCaseSensitive = localCaseSensitive
    self.cancellation = cancellation
  }

  func localNameKey(_ value: String) -> String {
    let normalized = value.precomposedStringWithCanonicalMapping
    return localCaseSensitive
      ? normalized
      : normalized.folding(options: .caseInsensitive, locale: Locale(identifier: "en_US_POSIX"))
  }

  func visit(_ path: String, depth: Int) throws {
    try cancellation?.check()
    count += 1
    guard count <= 100_000, depth <= 256 else {
      throw TreeTransferError.limitExceeded(
        "A copy can contain at most 100,000 entries and 256 folder levels.")
    }
  }

  func conflict(path: String, source: TreeItem, destination: TreeItem?) {
    guard let destination else { return }
    conflicts.append(
      TreeTransferConflict(
        relativePath: path,
        sourceIsDirectory: source.isDirectory, destinationIsDirectory: destination.isDirectory,
        sourceSize: source.size, destinationSize: destination.size,
        sourceModified: source.modified, destinationModified: destination.modified))
  }

  func remoteChildren(storage: UInt32, parent: UInt32) throws -> [String: MTPObject] {
    try cancellation?.check()
    if let hit = remoteListings[parent] { return hit }
    var result: [String: MTPObject] = [:]
    let children = try device.children(storage: storage, parent: parent, refresh: true)
    try cancellation?.check()
    for object in children {
      try cancellation?.check()
      try validTreeName(object.name)
      guard result[object.name] == nil else {
        throw TreeTransferError.invalidInput("Ambiguous duplicate phone name: \(object.name)")
      }
      result[object.name] = object
    }
    remoteListings[parent] = result
    return result
  }

  func download(
    _ object: MTPObject, to url: URL, path: String, depth: Int, destinationAvailable: Bool
  ) throws -> TreeNode {
    try visit(path, depth: depth)
    try validTreeName(object.name)
    guard visitedRemote.insert(object.handle).inserted else {
      throw TreeTransferError.invalidInput(
        "The phone returned a repeated object or folder cycle: \(path)")
    }
    let key = localNameKey(url.path)
    guard localPaths.insert(key).inserted else {
      throw TreeTransferError.invalidInput(
        "Selected names collide on this destination filesystem: \(path)")
    }
    let existing = destinationAvailable ? try localTreeItem(url) : nil
    let source = TreeItem.remote(object)
    conflict(path: path, source: source, destination: existing.map(TreeItem.local))
    var children: [TreeNode] = []
    if object.isDirectory {
      let sourceChildren = try remoteChildren(storage: object.storageID, parent: object.handle)
        .values.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
      for child in sourceChildren {
        children.append(
          try download(
            child, to: url.appendingPathComponent(child.name), path: path + "/" + child.name,
            depth: depth + 1, destinationAvailable: existing?.isDirectory == true))
      }
      if existing?.isDirectory == true {
        extraParents[path] = existing.map(TreeItem.local)
        let names = Set(sourceChildren.map { localNameKey($0.name) })
        for extra in try FileManager.default.contentsOfDirectory(
          at: url, includingPropertiesForKeys: nil
        ).sorted(by: { $0.lastPathComponent < $1.lastPathComponent })
        where !names.contains(localNameKey(extra.lastPathComponent)) {
          try collectLocalExtra(extra, path: path + "/" + extra.lastPathComponent, depth: depth + 1)
        }
      }
    }
    return TreeNode(
      name: object.name, path: path, source: source, existing: existing.map(TreeItem.local),
      children: children)
  }

  func upload(_ url: URL, storage: UInt32, destination: MTPObject?, path: String, depth: Int) throws
    -> TreeNode
  {
    try visit(path, depth: depth)
    try validTreeName(url.lastPathComponent)
    guard let item = try localTreeItem(url) else { throw TreeTransferError.sourceChanged(url.path) }
    let identity = "\(item.device):\(item.inode)"
    if item.isDirectory && !visitedLocal.insert(identity).inserted {
      throw TreeTransferError.invalidInput("Repeated folder or filesystem cycle: \(url.path)")
    }
    let source = TreeItem.local(item)
    conflict(path: path, source: source, destination: destination.map(TreeItem.remote))
    var children: [TreeNode] = []
    if item.isDirectory {
      let urls = try FileManager.default.contentsOfDirectory(
        at: url, includingPropertiesForKeys: nil
      ).sorted {
        $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending
      }
      let existing =
        destination?.isDirectory == true
        ? try remoteChildren(storage: storage, parent: destination!.handle) : [:]
      if let destination, destination.isDirectory { extraParents[path] = .remote(destination) }
      for child in urls {
        children.append(
          try upload(
            child, storage: storage, destination: existing[child.lastPathComponent],
            path: path + "/" + child.lastPathComponent, depth: depth + 1))
      }
      let sourceNames = Set(urls.map(\.lastPathComponent))
      for (name, extra) in existing.sorted(by: { $0.key < $1.key })
      where !sourceNames.contains(name) {
        try collectRemoteExtra(extra, path: path + "/" + name, depth: depth + 1)
      }
    }
    return TreeNode(
      name: url.lastPathComponent, path: path, source: source,
      existing: destination.map(TreeItem.remote), children: children)
  }

  func collectLocalExtra(_ url: URL, path: String, depth: Int) throws {
    try visit(path, depth: depth)
    guard let item = try localTreeItem(url) else {
      throw TreeTransferError.destinationChanged(url.path)
    }
    if item.isDirectory {
      extraParents[path] = .local(item)
      guard visitedExtraFolders.insert("local:\(item.device):\(item.inode)").inserted else {
        throw TreeTransferError.invalidInput("Repeated destination folder: \(url.path)")
      }
      for child in try FileManager.default.contentsOfDirectory(
        at: url, includingPropertiesForKeys: nil
      ).sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
        try collectLocalExtra(child, path: path + "/" + child.lastPathComponent, depth: depth + 1)
      }
    } else {
      extras.append(TreeTransferExtra(relativePath: path, isDirectory: false))
      extraOperations.append(TreeExtraOperation(path: path, item: .local(item)))
    }
  }

  func collectRemoteExtra(_ object: MTPObject, path: String, depth: Int) throws {
    try visit(path, depth: depth)
    if object.isDirectory {
      extraParents[path] = .remote(object)
      guard visitedExtraFolders.insert("remote:\(object.handle)").inserted else {
        throw TreeTransferError.invalidInput("Repeated destination folder: \(path)")
      }
      for child in try remoteChildren(storage: object.storageID, parent: object.handle).values
        .sorted(by: { $0.name < $1.name })
      {
        try collectRemoteExtra(child, path: path + "/" + child.name, depth: depth + 1)
      }
    } else {
      extras.append(TreeTransferExtra(relativePath: path, isDirectory: false))
      extraOperations.append(TreeExtraOperation(path: path, item: .remote(object)))
    }
  }
}

extension MTPDevice {
  public func planDownload(
    _ objects: [MTPObject], to directory: URL, cancellation: TransferCancellationToken? = nil
  ) throws -> TreeTransferPlan {
    try cancellation?.check()
    let canonical = directory.standardizedFileURL.resolvingSymlinksInPath()
    guard !objects.isEmpty, let root = try localTreeItem(canonical), root.isDirectory else {
      throw TreeTransferError.invalidInput("Select items and an existing destination folder.")
    }
    let sensitive =
      (try? canonical.resourceValues(forKeys: [.volumeSupportsCaseSensitiveNamesKey])
        .volumeSupportsCaseSensitiveNames) ?? false
    let planner = TreePlanner(
      device: self, localCaseSensitive: sensitive, cancellation: cancellation)
    planner.extraParents[""] = .local(root)
    let nodes = try objects.map {
      try planner.download(
        $0, to: canonical.appendingPathComponent($0.name), path: $0.name, depth: 0,
        destinationAvailable: true)
    }
    return TreeTransferPlan(
      conflicts: planner.conflicts, extras: planner.extras,
      fileCount: nodes.reduce(0) { $0 + $1.fileCount },
      totalBytes: plannedBytes(nodes, policy: .replace), owner: self, destination: .local(root),
      nodes: nodes,
      extraOperations: planner.extraOperations, extraParents: planner.extraParents,
      completion: TreePlanCompletion())
  }

  public func planUpload(
    _ urls: [URL], storage: UInt32, parent: UInt32 = MTPHandle.root,
    cancellation: TransferCancellationToken? = nil
  ) throws -> TreeTransferPlan {
    try cancellation?.check()
    guard !urls.isEmpty else {
      throw TreeTransferError.invalidInput("Select files or folders to copy.")
    }
    guard let store = try storages().first(where: { $0.id == storage }), !store.isReadOnly else {
      throw TreeTransferError.invalidInput("The destination storage is unavailable or read-only.")
    }
    let folder = parent == MTPHandle.root ? nil : try object(parent)
    if let folder, !folder.isDirectory || folder.storageID != storage {
      throw TreeTransferError.invalidInput(
        "The destination is not a folder on the selected storage.")
    }
    let planner = TreePlanner(device: self, cancellation: cancellation)
    if let folder { planner.extraParents[""] = .remote(folder) }
    let existing = try planner.remoteChildren(storage: storage, parent: parent)
    var names: Set<String> = []
    let nodes = try urls.map { url in
      // Inspect the selected item before resolving ancestors, so selecting a
      // symlink never silently turns into following it.
      guard try localTreeItem(url) != nil else { throw TreeTransferError.sourceChanged(url.path) }
      let canonical = url.standardizedFileURL.resolvingSymlinksInPath()
      guard names.insert(canonical.lastPathComponent).inserted else {
        throw TreeTransferError.invalidInput(
          "Selected items have the same destination name: \(canonical.lastPathComponent)")
      }
      return try planner.upload(
        canonical, storage: storage, destination: existing[canonical.lastPathComponent],
        path: canonical.lastPathComponent, depth: 0)
    }
    return TreeTransferPlan(
      conflicts: planner.conflicts, extras: planner.extras,
      fileCount: nodes.reduce(0) { $0 + $1.fileCount },
      totalBytes: plannedBytes(nodes, policy: .replace), owner: self,
      destination: .remote(storage: storage, parent: folder), nodes: nodes,
      extraOperations: planner.extraOperations, extraParents: planner.extraParents,
      completion: TreePlanCompletion())
  }

  public func execute(
    _ plan: TreeTransferPlan, policy: CopyConflictPolicy,
    cancellation: TransferCancellationToken? = nil,
    progress: (@Sendable (TreeTransferProgress) throws -> Void)? = nil
  ) throws -> TreeTransferSummary {
    guard plan.owner === self else {
      throw TreeTransferError.invalidInput("The plan belongs to a different phone session.")
    }
    plan.completion.begin()
    if policy == .ask && !plan.conflicts.isEmpty {
      throw TreeTransferError.conflicts(plan.conflicts)
    }
    if policy == .smartSync {
      let clashes = plan.conflicts.filter { $0.sourceIsDirectory != $0.destinationIsDirectory }
      if !clashes.isEmpty { throw TreeTransferError.conflicts(clashes) }
    }
    if case .remote = plan.destination, !info.supports(.setObjectPropValue),
      let path = firstRenameRequiredPath(plan.nodes, policy: policy)
    {
      throw unsupportedReplacement(path)
    }
    let executor = TreeExecutor(
      device: self, plan: plan, policy: policy,
      cancellation: cancellation ?? TransferCancellationToken(), progress: progress)
    let summary = try executor.run()
    plan.completion.succeed(policy)
    return summary
  }

  /// Explicit Smart Sync cleanup. It is available only after this exact plan
  /// finished successfully, never after a failed or canceled copy. Only the
  /// reviewed extra files are removed; newly created files and empty folders
  /// remain. macOS files go to Trash. Phone deletion is permanent.
  @discardableResult
  public func removeExtras(
    from plan: TreeTransferPlan, cancellation: TransferCancellationToken? = nil
  ) throws -> Int {
    guard plan.owner === self else {
      throw TreeTransferError.invalidInput("The plan belongs to a different phone session.")
    }
    if plan.extraOperations.isEmpty { return 0 }
    guard plan.completion.canRemoveExtras else {
      throw TreeTransferError.invalidInput(
        "Destination extras can be removed only after this Smart Sync plan finishes successfully.")
    }
    let token = cancellation ?? TransferCancellationToken()
    var removed = 0
    for extra in plan.extraOperations where !plan.completion.wasRemoved(extra.path) {
      try token.check()
      // Check every captured ancestor so renaming or replacing a folder
      // cannot turn a reviewed relative path into an unrelated deletion.
      let components = extra.path.split(separator: "/")
      for length in 0..<components.count {
        let parentPath = components.prefix(length).joined(separator: "/")
        guard let parent = plan.extraParents[parentPath] else { continue }
        switch parent {
        case .local(let expected):
          guard let current = try localTreeItem(expected.url),
            sameLocal(expected, current, contents: false)
          else {
            throw TreeTransferError.destinationChanged(extra.path)
          }
        case .remote(let expected):
          let current = try object(expected.handle, fallbackParent: expected.parent)
          guard sameRemoteIdentity(current, expected) else {
            throw TreeTransferError.destinationChanged(extra.path)
          }
        }
      }
      switch extra.item {
      case .local(let expected):
        guard
          expected.url.deletingLastPathComponent().resolvingSymlinksInPath()
            == expected.url.deletingLastPathComponent(),
          let current = try localTreeItem(expected.url),
          sameLocal(expected, current, contents: true)
        else {
          throw TreeTransferError.destinationChanged(extra.path)
        }
        #if os(macOS)
          try FileManager.default.trashItem(at: current.url, resultingItemURL: nil)
        #else
          try FileManager.default.removeItem(at: current.url)
        #endif
      case .remote(let expected):
        let current = try object(expected.handle, fallbackParent: expected.parent)
        guard sameRemote(current, expected) else {
          throw TreeTransferError.destinationChanged(extra.path)
        }
        try delete(current)
      }
      plan.completion.didRemove(extra.path)
      removed += 1
    }
    return removed
  }
}

private final class LocalWorkArea {
  let url: URL
  var preserve = false
  init(parent: URL) throws {
    var template = Array(parent.appendingPathComponent(".openmtp-copy-XXXXXX").path.utf8CString)
    let created = template.withUnsafeMutableBufferPointer { mkdtemp($0.baseAddress!) != nil }
    guard created else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    url = template.withUnsafeBufferPointer {
      URL(fileURLWithPath: String(cString: $0.baseAddress!), isDirectory: true)
    }
  }
  deinit { if !preserve { try? FileManager.default.removeItem(at: url) } }
}

/// Every rename is exclusive. The displaced object is verified after it moves,
/// so a writer that replaces the destination after preflight cannot lose data.
/// The move argument lets filesystem race tests exercise this production path.
enum LocalTransferCommit {
  static func moveExclusive(_ source: URL, _ destination: URL) throws {
    #if canImport(Darwin)
      let status = source.path.withCString { from in
        destination.path.withCString { to in renamex_np(from, to, UInt32(RENAME_EXCL)) }
      }
      guard status == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    #else
      throw TreeTransferError.invalidInput("Exclusive local commits require macOS.")
    #endif
  }

  static func commit(
    _ staged: URL, to target: URL, backup: URL,
    matchesExpected: ((URL) throws -> Bool)?,
    move: (URL, URL) throws -> Void = LocalTransferCommit.moveExclusive
  ) throws {
    guard let matchesExpected else {
      try move(staged, target)
      return
    }
    try move(target, backup)
    let matches: Bool
    do {
      matches = try matchesExpected(backup)
    } catch { matches = false }
    guard matches else {
      do { try move(backup, target) } catch {
        throw TreeTransferError.recoveryRequired(
          "The destination changed during replacement. The new copy is preserved at \(staged.path), and the displaced item is preserved at \(backup.path)."
        )
      }
      throw TreeTransferError.destinationChanged(target.path)
    }
    do {
      try move(staged, target)
    } catch {
      let commitError = error
      do {
        // Restoration must also be exclusive: a new writer may own the path.
        try move(backup, target)
      } catch {
        throw TreeTransferError.recoveryRequired(
          "The destination changed during replacement. The new copy is preserved at \(staged.path), and the previous copy is preserved at \(backup.path)."
        )
      }
      throw commitError
    }
    do {
      try FileManager.default.removeItem(at: backup)
    } catch {
      throw TreeTransferError.recoveryRequired(
        "The new copy is complete at \(target.path). The previous copy remains at \(backup.path): \(error)"
      )
    }
  }
}

private final class TreeExecutor {
  let device: MTPDevice
  let plan: TreeTransferPlan
  let policy: CopyConflictPolicy
  let cancellation: TransferCancellationToken
  let progress: (@Sendable (TreeTransferProgress) throws -> Void)?
  var totalBytes: UInt64?
  var copied = 0
  var skipped = 0
  var bytes: UInt64 = 0
  var localDirectories: [URL: LocalTreeItem] = [:]
  var canRenameFiles: Bool

  init(
    device: MTPDevice, plan: TreeTransferPlan, policy: CopyConflictPolicy,
    cancellation: TransferCancellationToken,
    progress: (@Sendable (TreeTransferProgress) throws -> Void)?
  ) {
    self.device = device
    self.plan = plan
    self.policy = policy
    self.cancellation = cancellation
    self.progress = progress
    canRenameFiles = device.info.supports(.setObjectPropValue)
    totalBytes = plannedBytes(plan.nodes, policy: policy)
  }

  func report(_ name: String) throws {
    try cancellation.check()
    try progress?(
      TreeTransferProgress(
        fileName: name, completedBytes: bytes, totalBytes: totalBytes,
        completedFiles: copied + skipped, totalFiles: plan.fileCount))
  }

  func transferProgress(_ name: String) -> MTPProgress {
    var previous: UInt64 = 0
    return { done in
      let (sum, overflow) = self.bytes.addingReportingOverflow(done - previous)
      guard !overflow else {
        throw TreeTransferError.limitExceeded("Transfer byte count overflowed.")
      }
      self.bytes = sum
      previous = done
      try self.report(name)
    }
  }

  func run() throws -> TreeTransferSummary {
    try cancellation.check()
    switch plan.destination {
    case .local(let root):
      guard let current = try localTreeItem(root.url), sameLocal(root, current, contents: false)
      else {
        throw TreeTransferError.destinationChanged(root.url.path)
      }
      localDirectories[root.url] = current
      for node in plan.nodes {
        try download(
          node, to: root.url.appendingPathComponent(node.name), expected: node.existing,
          selectedPolicy: policy)
      }
    case .remote(let storage, let parent):
      if let parent { try validateRemote(parent, source: false) }
      for node in plan.nodes {
        try upload(
          node, storage: storage, parent: parent?.handle ?? MTPHandle.root, name: node.name,
          expected: node.existing, selectedPolicy: policy)
      }
    }
    return TreeTransferSummary(copiedFiles: copied, skippedFiles: skipped, bytes: bytes)
  }

  func validateSource(_ item: TreeItem) throws {
    switch item {
    case .local(let source):
      guard let current = try localTreeItem(source.url), sameLocal(source, current, contents: true)
      else {
        throw TreeTransferError.sourceChanged(source.url.path)
      }
    case .remote(let source): try validateRemote(source, source: true)
    }
  }

  func validateRemote(_ expected: MTPObject, source: Bool) throws {
    let current: MTPObject
    do {
      current = try device.object(expected.handle, fallbackParent: expected.parent)
    } catch MTPError.response(.invalidObjectHandle, _) {
      if source { throw TreeTransferError.sourceChanged(expected.name) }
      throw TreeTransferError.destinationChanged(expected.name)
    }
    guard sameRemote(current, expected) else {
      if source { throw TreeTransferError.sourceChanged(expected.name) }
      throw TreeTransferError.destinationChanged(expected.name)
    }
  }

  func validateLocalDestination(_ url: URL, expected: TreeItem?) throws -> LocalTreeItem? {
    try validateLocalParents(url.deletingLastPathComponent())
    let current = try localTreeItem(url)
    switch (expected, current) {
    case (nil, nil): return nil
    case (.local(let old)?, let current?) where sameLocal(old, current, contents: !old.isDirectory):
      return current
    default: throw TreeTransferError.destinationChanged(url.path)
    }
  }

  func validateLocalParents(_ url: URL) throws {
    guard url.resolvingSymlinksInPath().standardizedFileURL == url.standardizedFileURL else {
      throw TreeTransferError.destinationChanged(url.path)
    }
    for (path, expected) in localDirectories
    where url.path == path.path || url.path.hasPrefix(path.path + "/") {
      guard let current = try localTreeItem(path), sameLocal(expected, current, contents: false)
      else {
        throw TreeTransferError.destinationChanged(path.path)
      }
    }
  }

  func skip(_ node: TreeNode) throws {
    skipped += node.fileCount
    try report(node.path)
  }

  func download(
    _ node: TreeNode, to originalURL: URL, expected: TreeItem?, selectedPolicy: CopyConflictPolicy
  ) throws {
    try cancellation.check()
    try validateSource(node.source)
    let existing = try validateLocalDestination(originalURL, expected: expected)
    if existing != nil && selectedPolicy == .skip {
      try skip(node)
      return
    }
    if let expected, selectedPolicy == .smartSync, smartSyncMatches(node.source, expected) {
      try skip(node)
      return
    }
    var target = originalURL
    var expected = expected
    if existing != nil && selectedPolicy == .keepBoth {
      target = try uniqueLocalURL(originalURL)
      expected = nil
    }
    if node.source.isDirectory {
      if let existing, !existing.isDirectory, selectedPolicy != .keepBoth {
        let work = try LocalWorkArea(parent: target.deletingLastPathComponent())
        let staged = work.url.appendingPathComponent("folder", isDirectory: true)
        try FileManager.default.createDirectory(at: staged, withIntermediateDirectories: false)
        localDirectories[staged] = try localTreeItem(staged)
        for child in node.children {
          try download(
            child, to: staged.appendingPathComponent(child.name), expected: nil,
            selectedPolicy: .replace)
        }
        try validateSource(node.source)
        if let modified = node.source.modified {
          try? FileManager.default.setAttributes(
            [.modificationDate: modified], ofItemAtPath: staged.path)
        }
        try commitLocal(staged, to: target, expected: expected, work: work)
        return
      }
      if expected == nil {
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false)
        guard let created = try localTreeItem(target) else {
          throw TreeTransferError.destinationChanged(target.path)
        }
        localDirectories[target] = created
      } else if let existing {
        localDirectories[target] = existing
      }
      for child in node.children {
        try download(
          child, to: target.appendingPathComponent(child.name),
          expected: expected == nil ? nil : child.existing,
          selectedPolicy: selectedPolicy == .keepBoth ? .replace : selectedPolicy)
      }
      try validateSource(node.source)
      if let modified = node.source.modified {
        try? FileManager.default.setAttributes(
          [.modificationDate: modified], ofItemAtPath: target.path)
      }
      try report(node.path)
      return
    }
    guard case .remote(let source) = node.source else {
      throw TreeTransferError.invalidInput("Invalid download plan.")
    }
    let work = try LocalWorkArea(parent: target.deletingLastPathComponent())
    let staged = work.url.appendingPathComponent("payload")
    try device.download(source, to: staged, progress: transferProgress(node.path))
    try validateSource(node.source)
    try cancellation.check()
    try commitLocal(staged, to: target, expected: expected, work: work)
    copied += 1
    try report(node.path)
  }

  func commitLocal(_ staged: URL, to target: URL, expected: TreeItem?, work: LocalWorkArea) throws {
    let existing = try validateLocalDestination(target, expected: expected)
    let backup = work.url.appendingPathComponent("previous")
    let matchesExpected: ((URL) throws -> Bool)? = existing.map { snapshot in
      { url in
        guard let displaced = try localTreeItem(url) else { return false }
        return sameLocal(snapshot, displaced, contents: true)
      }
    }
    do {
      try LocalTransferCommit.commit(
        staged, to: target, backup: backup, matchesExpected: matchesExpected)
    } catch let error as TreeTransferError {
      guard case .recoveryRequired = error else { throw error }
      work.preserve = true
      cancellation.record(work.url.path)
      throw error
    }
  }

  func uniqueLocalURL(_ original: URL) throws -> URL {
    for n in 1...100_000 {
      let name = try copyName(original.lastPathComponent, number: n)
      let candidate = original.deletingLastPathComponent().appendingPathComponent(name)
      if try localTreeItem(candidate) == nil { return candidate }
    }
    throw TreeTransferError.limitExceeded("Too many copies share this name.")
  }

  func remoteDestination(storage: UInt32, parent: UInt32, name: String, expected: TreeItem?) throws
    -> MTPObject?
  {
    // Revalidate the destination namespace before committing a staged file.
    // The source tree and its transfer operations are never rescanned.
    let matches = try device.children(storage: storage, parent: parent, refresh: true).filter {
      $0.name == name
    }
    guard matches.count <= 1 else { throw TreeTransferError.destinationChanged(name) }
    let current = matches.first
    switch (expected, current) {
    case (nil, nil): return nil
    case (.remote(let old)?, let current?) where sameRemote(current, old): return current
    default: throw TreeTransferError.destinationChanged(name)
    }
  }

  func upload(
    _ node: TreeNode, storage: UInt32, parent: UInt32, name originalName: String,
    expected: TreeItem?, selectedPolicy: CopyConflictPolicy
  ) throws {
    try cancellation.check()
    try validateSource(node.source)
    let existing = try remoteDestination(
      storage: storage, parent: parent, name: originalName, expected: expected)
    if !canRenameFiles, expected != nil,
      let path = firstRenameRequiredPath([node], policy: selectedPolicy)
    {
      throw unsupportedReplacement(path)
    }
    if existing != nil && selectedPolicy == .skip {
      try skip(node)
      return
    }
    if let expected, selectedPolicy == .smartSync, smartSyncMatches(node.source, expected) {
      try skip(node)
      return
    }
    var name = originalName
    var expected = expected
    if existing != nil && selectedPolicy == .keepBoth {
      name = try uniqueRemoteName(originalName, storage: storage, parent: parent)
      expected = nil
    }
    if node.source.isDirectory {
      if let existing, !existing.isDirectory, selectedPolicy != .keepBoth {
        let temporaryName = ".openmtp-\(UUID().uuidString)"
        let handle = try device.makeDirectory(
          temporaryName, storage: storage, parent: parent, modified: node.source.modified)
        let temporary = MTPObject(
          handle: handle, storageID: storage, parent: parent, name: temporaryName,
          format: ObjectFormat.association, size: 0, modified: nil)
        let recovery = "Storage \(storage)/\(temporaryName)"
        cancellation.record(recovery)
        do {
          for child in node.children {
            try upload(
              child, storage: storage, parent: handle, name: child.name, expected: nil,
              selectedPolicy: .replace)
          }
          try validateSource(node.source)
          try commitRemote(
            temporary, as: name, storage: storage, parent: parent, expected: expected)
          cancellation.resolved(recovery)
        } catch {
          cleanupRemoteStage(
            temporary, name: temporaryName, storage: storage, parent: parent, recovery: recovery)
          throw error
        }
        return
      }
      let handle: UInt32
      if let existing, expected != nil {
        handle = existing.handle
      } else {
        handle = try device.makeDirectory(
          name, storage: storage, parent: parent, modified: node.source.modified)
      }
      for child in node.children {
        try upload(
          child, storage: storage, parent: handle, name: child.name,
          expected: expected == nil ? nil : child.existing,
          selectedPolicy: selectedPolicy == .keepBoth ? .replace : selectedPolicy)
      }
      try validateSource(node.source)
      try report(node.path)
      return
    }
    guard case .local(let source) = node.source else {
      throw TreeTransferError.invalidInput("Invalid upload plan.")
    }
    if !canRenameFiles {
      guard expected == nil else { throw unsupportedReplacement(node.path) }
      try uploadNewFile(source, node: node, storage: storage, parent: parent, name: name)
      return
    }
    let temporaryName = ".openmtp-\(UUID().uuidString)"
    let recovery = "Storage \(storage)/\(temporaryName)"
    cancellation.record(recovery)
    defer { device.invalidate(storage: storage, parent: parent) }
    var staged: MTPObject?
    do {
      let handle = try device.upload(
        source.url, storage: storage, parent: parent, name: temporaryName,
        progress: transferProgress(node.path))
      staged = MTPObject(
        handle: handle, storageID: storage, parent: parent, name: temporaryName,
        format: ObjectFormat.undefined, size: source.size, modified: source.modified)
      try validateSource(node.source)
      try cancellation.check()
      try commitRemote(staged!, as: name, storage: storage, parent: parent, expected: expected)
      cancellation.resolved(recovery)
    } catch let MTPError.response(code, operation)
      where expected == nil && operation == .setObjectPropValue
      && (code == .operationNotSupported || code == .invalidObjectPropCode)
    {
      // A definite unsupported-operation response is safe to handle. Never
      // retry transport failures or ambiguous commits under a final filename.
      guard !device.session.isBroken, let staged else {
        throw MTPError.response(code, operation: operation)
      }
      do {
        let current = try device.object(staged.handle, fallbackParent: parent)
        guard sameRemoteIdentity(current, staged) else {
          throw TreeTransferError.destinationChanged(node.path)
        }
        try device.delete(current)
      } catch {
        throw TreeTransferError.recoveryRequired(
          "The device cannot rename files. The uncommitted copy remains at \(recovery): \(error)"
        )
      }
      cancellation.resolved(recovery)
      canRenameFiles = false
      if let total = totalBytes {
        let (updated, overflow) = total.addingReportingOverflow(source.size)
        totalBytes = overflow ? nil : updated
      }
      try uploadNewFile(source, node: node, storage: storage, parent: parent, name: name)
      return
    } catch {
      cleanupRemoteStage(
        staged, name: temporaryName, storage: storage, parent: parent, recovery: recovery)
      if error as? MTPError == .cancelled { throw error }
      if cancellation.recoveryPaths.contains(recovery) {
        throw TreeTransferError.recoveryRequired(
          "Copy failed: \(error). Inspect these recovery locations after reconnecting: \(cancellation.recoveryPaths.joined(separator: ", "))."
        )
      }
      throw error
    }
    copied += 1
    try report(node.path)
  }

  /// Basic SendObjectInfo/SendObject devices can create new files without the
  /// optional filename property operation. The exact created handle is retained
  /// for cleanup; no existing object is ever removed by a name-only lookup.
  func uploadNewFile(
    _ source: LocalTreeItem, node: TreeNode, storage: UInt32, parent: UInt32, name: String
  ) throws {
    try cancellation.check()
    try validateSource(node.source)
    _ = try remoteDestination(storage: storage, parent: parent, name: name, expected: nil)
    try cancellation.check()
    let recovery = "Storage \(storage), parent \(parent)/\(name)"
    var created: MTPObject?
    cancellation.record(recovery)
    defer { device.invalidate(storage: storage, parent: parent) }
    do {
      _ = try device.upload(
        source.url, storage: storage, parent: parent, name: name,
        onCreated: { handle in
          created = MTPObject(
            handle: handle, storageID: storage, parent: parent, name: name,
            format: ObjectFormat.undefined, size: source.size, modified: source.modified)
        }, progress: transferProgress(node.path))
      try validateSource(node.source)
      try cancellation.check()
      cancellation.resolved(recovery)
    } catch {
      if !device.session.isBroken, created == nil {
        cancellation.resolved(recovery)
      } else if let created, !device.session.isBroken {
        do {
          let current = try device.object(created.handle, fallbackParent: parent)
          guard sameRemoteIdentity(current, created) else {
            throw TreeTransferError.destinationChanged(node.path)
          }
          try device.delete(current)
          cancellation.resolved(recovery)
        } catch MTPError.response(.invalidObjectHandle, _) {
          cancellation.resolved(recovery)
        } catch {
          // Keep the exact handle's recovery location when cleanup fails.
        }
      }
      if cancellation.recoveryPaths.contains(recovery), error as? MTPError != .cancelled {
        throw TreeTransferError.recoveryRequired(
          "Copy failed: \(error). A partial new file may remain at \(recovery)."
        )
      }
      throw error
    }
    copied += 1
    try report(node.path)
  }

  func commitRemote(
    _ staged: MTPObject, as name: String, storage: UInt32, parent: UInt32, expected: TreeItem?
  ) throws {
    try cancellation.check()
    let existing = try remoteDestination(
      storage: storage, parent: parent, name: name, expected: expected)
    try device.session.exclusive {
      guard let existing else {
        try device.rename(staged, to: name)
        cancellation.resolved("Storage \(storage)/\(staged.name)")
        return
      }
      let backupName = ".openmtp-previous-\(UUID().uuidString)"
      let recovery = "Storage \(storage)/\(backupName)"
      try device.rename(existing, to: backupName)
      var backup = existing
      backup.name = backupName
      cancellation.record(recovery)
      do {
        try device.rename(staged, to: name)
        cancellation.resolved("Storage \(storage)/\(staged.name)")
      } catch {
        if !device.session.isBroken {
          do {
            try device.rename(backup, to: name)
            cancellation.resolved(recovery)
          } catch {
            throw TreeTransferError.recoveryRequired(
              "The original remains on the phone as \(backupName). Replacement and rollback failed."
            )
          }
        }
        throw error
      }
      do {
        try device.delete(backup)
        cancellation.resolved(recovery)
      } catch {
        throw TreeTransferError.recoveryRequired(
          "The new copy is complete. The previous copy remains on the phone as \(backupName): \(error)"
        )
      }
    }
  }

  /// A failure after final rename can mean only backup cleanup failed. Never
  /// delete a handle that has already become the completed destination.
  func cleanupRemoteStage(
    _ staged: MTPObject?, name: String, storage: UInt32, parent: UInt32, recovery: String
  ) {
    guard !device.session.isBroken else { return }
    do {
      let current: MTPObject?
      if let staged {
        current = try device.object(staged.handle, fallbackParent: parent)
      } else {
        current = try device.children(storage: storage, parent: parent, refresh: true).first {
          $0.name == name
        }
      }
      if let current, current.name == name { try device.delete(current) }
      cancellation.resolved(recovery)
    } catch MTPError.response(.invalidObjectHandle, _) { cancellation.resolved(recovery) } catch {
      // Keep the recovery location when cleanup could not be verified.
    }
  }

  func uniqueRemoteName(_ original: String, storage: UInt32, parent: UInt32) throws -> String {
    let names = Set(
      try device.children(storage: storage, parent: parent, refresh: true).map(\.name))
    for n in 1...100_000 {
      let name = try copyName(original, number: n)
      if !names.contains(name) { return name }
    }
    throw TreeTransferError.limitExceeded("Too many copies share this name.")
  }
}

private func copyName(_ original: String, number: Int) throws -> String {
  let ext = (original as NSString).pathExtension
  let stem = ext.isEmpty ? original : String(original.dropLast(ext.count + 1))
  let suffix = number == 1 ? " copy" : " copy \(number)"
  let ending = suffix + (ext.isEmpty ? "" : "." + ext)
  guard ending.utf16.count < 254 else {
    throw TreeTransferError.invalidInput(
      "The file extension is too long to keep both copies: \(original)")
  }
  var prefix = stem
  while prefix.utf16.count + ending.utf16.count > 254 { prefix.removeLast() }
  let name = prefix + ending
  try validTreeName(name)
  return name
}
