import AppKit
import CryptoKit
import Darwin
import Foundation
import QuickLookUI
import SwiftUI
import UniformTypeIdentifiers

enum NativeFileIntegrationError: LocalizedError {
  case invalidFilename, invalidExport, unsupportedDrop, destinationExists
  var errorDescription: String? {
    switch self {
    case .invalidFilename: "The file name is not a valid path component."
    case .invalidExport: "The promised file was not created in its transfer directory."
    case .unsupportedDrop:
      "Drop files or folders from Finder, Photos or another app that provides files."
    case .destinationExists: "The destination already exists. Choose a different name."
    }
  }
}

/// Owns only generated cache directories. Export requests never reuse a previous
/// device handle's file, even if a phone reconnects with the same object handle.
final class NativeExportStore: @unchecked Sendable {
  let root: URL
  private let activityLock = NSLock()
  private var activeRequests = 0
  var hasActiveTransfers: Bool {
    activityLock.lock()
    defer { activityLock.unlock() }
    return activeRequests > 0
  }
  private func beginActivity() {
    activityLock.lock()
    activeRequests += 1
    activityLock.unlock()
  }
  private func endActivity() {
    activityLock.lock()
    activeRequests -= 1
    activityLock.unlock()
  }

  init(root: URL? = nil) {
    self.root =
      root
      ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("io.ganeshrvel.openmtp/NativeExports", isDirectory: true)
  }

  static func validateFilename(_ name: String) throws {
    guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\0") else {
      throw NativeFileIntegrationError.invalidFilename
    }
  }

  func directory(identity: String, parent: URL? = nil) throws -> URL {
    let base = parent ?? root
    try FileManager.default.createDirectory(
      at: base, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let digest = SHA256.hash(data: Data(identity.utf8)).prefix(8).map { String(format: "%02x", $0) }
      .joined()
    let directory = base.appendingPathComponent(
      ".openmtp-export-\(digest)-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    return directory
  }

  func materialize(_ file: NativeFileIntegration.RemoteFile, progress: Progress, parent: URL? = nil)
    async throws -> URL
  {
    beginActivity()
    defer { endActivity() }
    try Self.validateFilename(file.name)
    let staging = try directory(identity: file.identity, parent: parent)
    do {
      if progress.isCancelled { throw CancellationError() }
      let result = try await file.download(staging, progress)
      if progress.isCancelled { throw CancellationError() }
      let expected = staging.appendingPathComponent(file.name, isDirectory: file.isDirectory)
      guard result.standardizedFileURL == expected.standardizedFileURL,
        result.resolvingSymlinksInPath().deletingLastPathComponent().standardizedFileURL
          == staging.resolvingSymlinksInPath().standardizedFileURL
      else {
        throw NativeFileIntegrationError.invalidExport
      }
      let attrs = try FileManager.default.attributesOfItem(atPath: result.path)
      let wanted: FileAttributeType = file.isDirectory ? .typeDirectory : .typeRegular
      guard attrs[.type] as? FileAttributeType == wanted else {
        throw NativeFileIntegrationError.invalidExport
      }
      return result
    } catch {
      try? FileManager.default.removeItem(at: staging)
      throw error
    }
  }

  /// Finder chooses the destination. Commit the fully materialized item there
  /// exclusively, so another app's file cannot be replaced by a race.
  func fulfill(_ file: NativeFileIntegration.RemoteFile, at destination: URL, progress: Progress)
    async throws
  {
    beginActivity()
    defer { endActivity() }
    guard destination.isFileURL else { throw NativeFileIntegrationError.invalidExport }
    guard !FileManager.default.fileExists(atPath: destination.path) else {
      throw NativeFileIntegrationError.destinationExists
    }
    let result = try await materialize(
      file, progress: progress, parent: destination.deletingLastPathComponent())
    let staging = result.deletingLastPathComponent()
    defer { try? FileManager.default.removeItem(at: staging) }
    var coordinationError: NSError?
    var writeError: Error?
    NSFileCoordinator().coordinate(
      writingItemAt: destination, options: .forReplacing, error: &coordinationError
    ) { coordinatedURL in
      let status = result.path.withCString { source in
        coordinatedURL.path.withCString { target in renamex_np(source, target, UInt32(RENAME_EXCL))
        }
      }
      if status != 0 {
        writeError =
          errno == EEXIST
          ? NativeFileIntegrationError.destinationExists
          : POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
      }
    }
    if let error = coordinationError { throw error }
    if let error = writeError { throw error }
  }

  func copyIncoming(_ source: URL, name: String, into directory: URL) throws -> URL {
    try Self.validateFilename(name)
    let destination = directory.appendingPathComponent(name)
    try FileManager.default.copyItem(at: source, to: destination)
    return destination
  }

  /// Cache files may be removed by the OS. Prune only old generated directories,
  /// never user destinations or arbitrary files that happen to share a name.
  func prune(olderThan date: Date = Date().addingTimeInterval(-7 * 24 * 60 * 60)) {
    guard
      let children = try? FileManager.default.contentsOfDirectory(
        at: root,
        includingPropertiesForKeys: [.creationDateKey, .isDirectoryKey, .isSymbolicLinkKey])
    else { return }
    for child in children.prefix(1024) where Self.isGeneratedDirectory(child.lastPathComponent) {
      guard
        let values = try? child.resourceValues(forKeys: [
          .creationDateKey, .isDirectoryKey, .isSymbolicLinkKey,
        ]),
        values.isDirectory == true, values.isSymbolicLink != true,
        let created = values.creationDate, created < date
      else { continue }
      try? FileManager.default.removeItem(at: child)
    }
  }

  static func isGeneratedDirectory(_ name: String) -> Bool {
    guard name.hasPrefix(".openmtp-export-") else { return false }
    let suffix = String(name.dropFirst(".openmtp-export-".count))
    guard suffix.count == 53 else { return false }
    let digest = suffix.prefix(16)
    guard digest.allSatisfy({ $0.isASCII && $0.isHexDigit }), suffix.dropFirst(16).first == "-"
    else { return false }
    return UUID(uuidString: String(suffix.dropFirst(17))) != nil
  }
}

private final class NativeCompletion: @unchecked Sendable {
  private let callback: (Error?) -> Void
  private let lock = NSLock()
  private var finished = false
  init(_ callback: @escaping (Error?) -> Void) { self.callback = callback }
  func finish(_ error: Error?) {
    lock.lock()
    guard !finished else {
      lock.unlock()
      return
    }
    finished = true
    lock.unlock()
    callback(error)
  }
}

private final class NativeFilePromiseWriter: NSObject, NSFilePromiseProviderDelegate,
  @unchecked Sendable
{
  let file: NativeFileIntegration.RemoteFile
  let store: NativeExportStore
  let queue: OperationQueue
  init(file: NativeFileIntegration.RemoteFile, store: NativeExportStore) {
    self.file = file
    self.store = store
    queue = OperationQueue()
    queue.name = "OpenMTP file promises"
    queue.maxConcurrentOperationCount = 1
    super.init()
  }
  func filePromiseProvider(
    _ filePromiseProvider: NSFilePromiseProvider, fileNameForType fileType: String
  ) -> String { file.name }
  func operationQueue(for filePromiseProvider: NSFilePromiseProvider) -> OperationQueue { queue }
  func filePromiseProvider(
    _ filePromiseProvider: NSFilePromiseProvider, writePromiseTo url: URL,
    completionHandler: @escaping (Error?) -> Void
  ) {
    let completion = NativeCompletion(completionHandler)
    let file = file
    let store = store
    Task.detached(priority: .userInitiated) {
      do {
        try await store.fulfill(
          file, at: url, progress: Progress(totalUnitCount: Int64(clamping: file.byteCount ?? 0)))
        completion.finish(nil)
      } catch { completion.finish(error) }
    }
  }
}

/// NSFilePromiseProvider's delegate is weak. Keep it alive for the dragging session.
private final class RetainedNativeFilePromise: NSFilePromiseProvider {
  let retainedWriter: NativeFilePromiseWriter
  init(writer: NativeFilePromiseWriter) {
    retainedWriter = writer
    let type =
      writer.file.isDirectory
      ? UTType.folder
      : UTType(filenameExtension: (writer.file.name as NSString).pathExtension) ?? .data
    super.init(fileType: type.identifier, delegate: writer)
  }
  required init?(coder: NSCoder) { nil }
}

private final class NativePreviewItems: @unchecked Sendable {
  private let lock = NSLock()
  private var urls: [URL] = []
  func replace(_ values: [URL]) {
    lock.lock()
    defer { lock.unlock() }
    urls = values
  }
  var count: Int {
    lock.lock()
    defer { lock.unlock() }
    return urls.count
  }
  func item(at index: Int) -> URL? {
    lock.lock()
    defer { lock.unlock() }
    return urls.indices.contains(index) ? urls[index] : nil
  }
}

@MainActor
final class NativeFileIntegration: NSObject, QLPreviewPanelDataSource {
  struct RemoteFile: Sendable {
    let name: String
    let isDirectory: Bool
    /// Include connection, storage and object identity. Only its hash reaches a path.
    let identity: String
    let byteCount: UInt64?
    let download: @Sendable (URL, Progress) async throws -> URL
    init(
      name: String, isDirectory: Bool, identity: String, byteCount: UInt64?,
      download: @escaping @Sendable (URL, Progress) async throws -> URL
    ) {
      self.name = name
      self.isDirectory = isDirectory
      self.identity = identity
      self.byteCount = byteCount
      self.download = download
    }
  }

  static let shared = NativeFileIntegration()
  private let store: NativeExportStore
  private let previewItems = NativePreviewItems()
  private var previewGeneration = UUID()
  private var previewProgress: Progress?
  init(store: NativeExportStore = NativeExportStore()) {
    self.store = store
    super.init()
    store.prune()
  }

  var isPreviewVisible: Bool {
    QLPreviewPanel.sharedPreviewPanelExists() && QLPreviewPanel.shared()?.isVisible == true
  }
  var isPreviewLoading: Bool { previewProgress != nil }
  var hasActiveTransfers: Bool { store.hasActiveTransfers }
  private func cancelPreviewRequest() {
    previewGeneration = UUID()
    previewProgress?.cancel()
    previewProgress = nil
  }
  func closePreview() {
    cancelPreviewRequest()
    if QLPreviewPanel.sharedPreviewPanelExists() { QLPreviewPanel.shared()?.orderOut(nil) }
  }
  func reveal(_ url: URL) { NSWorkspace.shared.activateFileViewerSelecting([url]) }

  /// A type icon is immediately available without reading the phone's payload.
  /// Actual remote contents are fetched only for a requested preview or export.
  func icon(name: String, isDirectory: Bool) -> NSImage {
    let type =
      isDirectory
      ? UTType.folder : UTType(filenameExtension: (name as NSString).pathExtension) ?? .data
    return NSWorkspace.shared.icon(for: type)
  }

  func icon(localURL: URL) -> NSImage { NSWorkspace.shared.icon(forFile: localURL.path) }

  func preview(localURLs: [URL]) {
    cancelPreviewRequest()
    showPreview(localURLs: localURLs)
  }

  private func showPreview(localURLs: [URL]) {
    guard !localURLs.isEmpty else { return }
    previewItems.replace(localURLs)
    guard let panel = QLPreviewPanel.shared() else { return }
    panel.dataSource = self
    panel.reloadData()
    panel.makeKeyAndOrderFront(nil)
  }

  func preview(remoteFiles: [RemoteFile]) async throws {
    cancelPreviewRequest()
    let generation = previewGeneration
    defer { if previewGeneration == generation { previewProgress = nil } }
    var urls = [URL]()
    // Explicit selections only. No thumbnail sweep competes with an MTP copy.
    for file in remoteFiles where !file.isDirectory {
      try Task.checkCancellation()
      guard previewGeneration == generation else { throw CancellationError() }
      let progress = Progress(totalUnitCount: Int64(clamping: file.byteCount ?? 0))
      previewProgress = progress
      let url = try await withTaskCancellationHandler {
        try await store.materialize(file, progress: progress)
      } onCancel: {
        progress.cancel()
      }
      urls.append(url)
    }
    try Task.checkCancellation()
    guard previewGeneration == generation else { throw CancellationError() }
    showPreview(localURLs: urls)
  }

  func itemProvider(for file: RemoteFile) -> NSItemProvider {
    let provider = NSItemProvider()
    provider.suggestedName = file.name
    let type =
      file.isDirectory
      ? UTType.folder : UTType(filenameExtension: (file.name as NSString).pathExtension) ?? .data
    let store = store
    provider.registerFileRepresentation(
      forTypeIdentifier: type.identifier, fileOptions: [], visibility: .all
    ) { completion in
      let progress = Progress(totalUnitCount: Int64(clamping: file.byteCount ?? 0))
      Task.detached(priority: .userInitiated) {
        do { completion(try await store.materialize(file, progress: progress), false, nil) } catch {
          completion(nil, false, error)
        }
      }
      return progress
    }
    return provider
  }

  func filePromiseProvider(for file: RemoteFile) -> NSFilePromiseProvider {
    RetainedNativeFilePromise(writer: NativeFilePromiseWriter(file: file, store: store))
  }

  func receive(_ providers: [NSItemProvider]) async throws -> [URL] {
    guard !providers.isEmpty else { throw NativeFileIntegrationError.unsupportedDrop }
    var result = [URL]()
    var ownedDirectories = [URL]()
    do {
      for provider in providers {
        if provider.canLoadObject(ofClass: NSURL.self) {
          let url: URL = try await withCheckedThrowingContinuation { continuation in
            _ = provider.loadObject(ofClass: NSURL.self) { value, error in
              if let error {
                continuation.resume(throwing: error)
              } else if let url = value as? URL, url.isFileURL {
                continuation.resume(returning: url)
              } else {
                continuation.resume(throwing: NativeFileIntegrationError.unsupportedDrop)
              }
            }
          }
          result.append(url)
          continue
        }
        guard
          let identifier = provider.registeredTypeIdentifiers.first(where: {
            provider.hasRepresentationConforming(toTypeIdentifier: $0, fileOptions: [])
              && UTType($0)?.conforms(to: .item) == true
          })
        else { throw NativeFileIntegrationError.unsupportedDrop }
        let directory = try store.directory(identity: "incoming promise")
        ownedDirectories.append(directory)
        let suggested = provider.suggestedName
        let store = store
        let url: URL = try await withCheckedThrowingContinuation { continuation in
          _ = provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, error in
            do {
              if let error { throw error }
              guard let url else { throw NativeFileIntegrationError.unsupportedDrop }
              // The provider's temporary URL is valid only during this callback.
              let name = suggested ?? url.lastPathComponent
              continuation.resume(
                returning: try store.copyIncoming(url, name: name, into: directory))
            } catch { continuation.resume(throwing: error) }
          }
        }
        result.append(url)
      }
      return result
    } catch {
      for directory in ownedDirectories { try? FileManager.default.removeItem(at: directory) }
      throw error
    }
  }

  nonisolated func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int { previewItems.count }
  nonisolated func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> (
    any QLPreviewItem
  )! {
    guard let url = previewItems.item(at: index) else { return nil }
    return url as NSURL
  }
}

/// An explicit header handle exports the complete selection as one native drag.
/// Keeping it separate from row hit testing preserves table/grid selection.
struct NativeRemoteDragHandle: NSViewRepresentable {
  let files: [NativeFileIntegration.RemoteFile]

  func makeNSView(context: Context) -> NativeRemoteDragHandleView {
    let view = NativeRemoteDragHandleView()
    view.files = files
    return view
  }

  func updateNSView(_ nsView: NativeRemoteDragHandleView, context: Context) { nsView.files = files }
}

final class NativeRemoteDragHandleView: NSView, NSDraggingSource {
  var files: [NativeFileIntegration.RemoteFile] = [] {
    didSet {
      toolTip =
        files.isEmpty
        ? "Select phone files or folders to drag to Finder"
        : "Drag \(files.count) selected items to Finder"
      setAccessibilityElement(true)
      setAccessibilityRole(.image)
      setAccessibilityLabel(toolTip)
      setAccessibilityHelp("Use Copy and Paste for keyboard transfers.")
      needsDisplay = true
    }
  }
  private var origin: NSPoint?
  private var dragging = false

  override var intrinsicContentSize: NSSize { NSSize(width: 28, height: 28) }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func draw(_ dirtyRect: NSRect) {
    guard let icon = NSImage(systemSymbolName: "square.and.arrow.up", accessibilityDescription: nil)
    else { return }
    icon.draw(
      in: bounds.insetBy(dx: 5, dy: 5), from: .zero, operation: .sourceOver,
      fraction: files.isEmpty ? 0.3 : 1, respectFlipped: true, hints: nil)
  }

  override func mouseDown(with event: NSEvent) {
    origin = event.locationInWindow
    dragging = false
  }
  override func mouseUp(with event: NSEvent) {
    origin = nil
    dragging = false
  }
  override func mouseDragged(with event: NSEvent) {
    guard !dragging, !files.isEmpty, let origin,
      hypot(event.locationInWindow.x - origin.x, event.locationInWindow.y - origin.y) >= 3
    else { return }
    dragging = true
    let point = convert(event.locationInWindow, from: nil)
    let items = files.enumerated().map { index, file in
      let item = NSDraggingItem(
        pasteboardWriter: NativeFileIntegration.shared.filePromiseProvider(for: file))
      let offset = CGFloat(min(index, 5)) * 3
      item.setDraggingFrame(
        NSRect(x: point.x + offset, y: point.y - offset, width: 32, height: 32),
        contents: NativeFileIntegration.shared.icon(name: file.name, isDirectory: file.isDirectory))
      return item
    }
    let session = beginDraggingSession(with: items, event: event, source: self)
    session.animatesToStartingPositionsOnCancelOrFail = true
    session.draggingFormation = .pile
  }

  nonisolated func draggingSession(
    _ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation { .copy }
  nonisolated func ignoreModifierKeys(for session: NSDraggingSession) -> Bool { true }
}
