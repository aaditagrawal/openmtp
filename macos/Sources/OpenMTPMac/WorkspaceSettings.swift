import Combine
import Foundation
import SwiftUI

enum WorkspacePane: String, Codable, CaseIterable, Sendable { case local, phone }
enum BrowserViewMode: String, Codable, CaseIterable, Sendable { case list, grid }
enum BrowserSortField: String, Codable, CaseIterable, Sendable { case name, size, modified }
enum WorkspaceAppearance: String, Codable, CaseIterable, Sendable {
  case system, light, dark
  var colorScheme: ColorScheme? {
    switch self {
    case .system: nil
    case .light: .light
    case .dark: .dark
    }
  }
}

/// Explicit profiles keep QA and separate launches out of the user's ordinary preferences.
@MainActor
final class WorkspacePreferenceStore {
  private let defaults: UserDefaults?
  private var file: URL?
  private var values: [String: Any] = [:]
  private(set) var lastError: String?
  var isPersistent: Bool { defaults != nil || file != nil }

  init(defaults: UserDefaults?, legacyDirectory: URL? = nil, profileDirectory: URL? = nil) {
    let profile =
      profileDirectory
      ?? (defaults == nil
        ? nil
        : ProcessInfo.processInfo.environment["OPENMTP_PROFILE_DIR"].flatMap {
          $0.isEmpty ? nil : URL(fileURLWithPath: $0, isDirectory: true)
        })
    if let profile {
      self.defaults = nil
      file = profile.appendingPathComponent("native-settings.json")
      if let file, FileManager.default.fileExists(atPath: file.path) {
        do {
          let data = try Data(contentsOf: file)
          guard data.count <= 4 << 20,
            let decoded = try JSONSerialization.jsonObject(with: data) as? [String: Any]
          else { throw CocoaError(.fileReadCorruptFile) }
          values = decoded
        } catch {
          lastError = "The profile could not be read: \(error)"
          let backup = file.deletingPathExtension().appendingPathExtension(
            "corrupt-\(UUID().uuidString).json")
          do { try FileManager.default.copyItem(at: file, to: backup) } catch {
            self.file = nil
            lastError =
              "The profile is unreadable and could not be backed up. Settings are kept in memory."
            return
          }
        }
      }
    } else {
      self.defaults = defaults
      file = nil
    }
    migrateLegacySettingsIfNeeded(directory: legacyDirectory)
  }
  func object(forKey key: String) -> Any? { defaults?.object(forKey: key) ?? values[key] }
  func string(forKey key: String) -> String? { object(forKey: key) as? String }
  func bool(forKey key: String) -> Bool { object(forKey: key) as? Bool ?? false }
  func stringArray(forKey key: String) -> [String]? { object(forKey: key) as? [String] }
  func data(forKey key: String) -> Data? {
    if let value = object(forKey: key) as? Data { return value }
    return (object(forKey: key) as? String).flatMap { Data(base64Encoded: $0) }
  }
  func set(_ value: Any?, forKey key: String) {
    if let defaults {
      defaults.set(value, forKey: key)
      return
    }
    if let data = value as? Data {
      values[key] = data.base64EncodedString()
    } else {
      values[key] = value
    }
    persist()
  }
  func setMany(_ newValues: [String: Any]) {
    if let defaults {
      for (key, value) in newValues { defaults.set(value, forKey: key) }
      return
    }
    values.merge(newValues) { _, new in new }
    persist()
  }
  private func persist() {
    guard let file else { return }
    do {
      try FileManager.default.createDirectory(
        at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONSerialization.data(withJSONObject: values, options: [.sortedKeys]).write(
        to: file, options: .atomic)
      lastError = nil
    } catch { lastError = "Settings could not be saved: \(error)" }
  }
  private func migrateLegacySettingsIfNeeded(directory legacyDirectory: URL?) {
    guard defaults != nil || file != nil, object(forKey: "workspace.appearance") == nil,
      object(forKey: "workspace.migrated") == nil
    else { return }
    let directory: URL
    if let legacyDirectory {
      directory = legacyDirectory
    } else if let profile = ProcessInfo.processInfo.environment["OPENMTP_PROFILE_DIR"],
      !profile.isEmpty
    {
      directory = URL(fileURLWithPath: profile, isDirectory: true)
    } else {
      directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(
        "Library/Application Support/io.ganeshrvel.openmtp", isDirectory: true)
    }
    let source = directory.appendingPathComponent("settings.json")
    guard let data = try? Data(contentsOf: source), data.count <= 4 << 20,
      let old = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return }
    let keys = [
      "showLocalPane": "showLocalPane", "showLocalPaneOnLeftSide": "localPaneOnLeft",
      "showDirectoriesFirst": "directoriesFirst", "enableStatusBar": "showStatusBar",
      "enableUsbHotplug": "autoConnect", "enableAutoUpdateCheck": "autoCheckUpdates",
      "enablePrereleaseUpdates": "includePrereleases",
      "enableBackgroundAutoUpdate": "autoInstallUpdates",
    ]
    var migration: [String: Any] = ["workspace.migrated": true]
    func importValue(_ value: Any, forKey key: String) {
      if object(forKey: key) == nil { migration[key] = value }
    }
    for (legacy, native) in keys {
      if let value = old[legacy] as? Bool { importValue(value, forKey: "workspace.\(native)") }
    }
    if let theme = old["appThemeMode"] as? String {
      importValue(theme == "auto" ? "system" : theme, forKey: "workspace.appearance")
    }
    if let hidden = old["hideHiddenFiles"] as? [String: Bool] {
      if let value = hidden["local"] { importValue(!value, forKey: "workspace.showHiddenLocal") }
      if let value = hidden["mtp"] { importValue(!value, forKey: "workspace.showHiddenPhone") }
    }
    if let views = old["fileExplorerListingType"] as? [String: String] {
      if let value = views["local"] { importValue(value, forKey: "workspace.localView") }
      if let value = views["mtp"] { importValue(value, forKey: "workspace.phoneView") }
    }
    setMany(migration)
  }
}

@MainActor
final class WorkspaceSettings: ObservableObject {
  let store: WorkspacePreferenceStore
  @Published var appearance: WorkspaceAppearance { didSet { save() } }
  @Published var showLocalPane: Bool { didSet { save() } }
  @Published var localPaneOnLeft: Bool { didSet { save() } }
  @Published var showHiddenLocal: Bool { didSet { save() } }
  @Published var showHiddenPhone: Bool { didSet { save() } }
  @Published var localView: BrowserViewMode { didSet { save() } }
  @Published var phoneView: BrowserViewMode { didSet { save() } }
  @Published var directoriesFirst: Bool { didSet { save() } }
  @Published var showStatusBar: Bool { didSet { save() } }
  @Published var showTransfers: Bool { didSet { save() } }
  @Published var autoConnect: Bool { didSet { save() } }
  @Published var autoCheckUpdates: Bool { didSet { save() } }
  @Published var autoInstallUpdates: Bool { didSet { save() } }
  @Published var includePrereleases: Bool { didSet { save() } }
  @Published var localPath: String { didSet { save() } }
  @Published var localSort: BrowserSortField { didSet { save() } }
  @Published var localDescending: Bool { didSet { save() } }
  @Published var phoneSort: BrowserSortField { didSet { save() } }
  @Published var phoneDescending: Bool { didSet { save() } }
  @Published var favorites: [String] { didSet { save() } }

  init(defaults: UserDefaults? = .standard, legacyDirectory: URL? = nil) {
    store = WorkspacePreferenceStore(defaults: defaults, legacyDirectory: legacyDirectory)
    appearance =
      WorkspaceAppearance(rawValue: store.string(forKey: "workspace.appearance") ?? "") ?? .system
    showLocalPane = store.object(forKey: "workspace.showLocalPane") as? Bool ?? true
    localPaneOnLeft = store.object(forKey: "workspace.localPaneOnLeft") as? Bool ?? true
    showHiddenLocal = store.bool(forKey: "workspace.showHiddenLocal")
    showHiddenPhone = store.bool(forKey: "workspace.showHiddenPhone")
    localView =
      BrowserViewMode(rawValue: store.string(forKey: "workspace.localView") ?? "") ?? .list
    phoneView =
      BrowserViewMode(rawValue: store.string(forKey: "workspace.phoneView") ?? "") ?? .list
    directoriesFirst = store.object(forKey: "workspace.directoriesFirst") as? Bool ?? true
    showStatusBar = store.object(forKey: "workspace.showStatusBar") as? Bool ?? true
    showTransfers = store.object(forKey: "workspace.showTransfers") as? Bool ?? true
    autoConnect = store.object(forKey: "workspace.autoConnect") as? Bool ?? true
    autoCheckUpdates = store.object(forKey: "workspace.autoCheckUpdates") as? Bool ?? true
    autoInstallUpdates = store.object(forKey: "workspace.autoInstallUpdates") as? Bool ?? false
    includePrereleases =
      store.object(forKey: "workspace.includePrereleases") as? Bool
      ?? NativeUpdateService.shared.defaultIncludePrereleases
    localPath =
      store.string(forKey: "workspace.localPath")
      ?? FileManager.default.homeDirectoryForCurrentUser.path
    localSort =
      BrowserSortField(rawValue: store.string(forKey: "workspace.localSort") ?? "") ?? .name
    localDescending = store.bool(forKey: "workspace.localDescending")
    phoneSort =
      BrowserSortField(rawValue: store.string(forKey: "workspace.phoneSort") ?? "") ?? .name
    phoneDescending = store.bool(forKey: "workspace.phoneDescending")
    favorites = store.stringArray(forKey: "workspace.favorites") ?? []
  }
  private func save() {
    let values: [String: Any] = [
      "appearance": appearance.rawValue, "showLocalPane": showLocalPane,
      "localPaneOnLeft": localPaneOnLeft,
      "showHiddenLocal": showHiddenLocal, "showHiddenPhone": showHiddenPhone,
      "localView": localView.rawValue,
      "phoneView": phoneView.rawValue, "directoriesFirst": directoriesFirst,
      "showStatusBar": showStatusBar,
      "showTransfers": showTransfers, "autoConnect": autoConnect,
      "autoCheckUpdates": autoCheckUpdates,
      "includePrereleases": includePrereleases, "autoInstallUpdates": autoInstallUpdates,
      "localPath": localPath, "localSort": localSort.rawValue,
      "localDescending": localDescending, "phoneSort": phoneSort.rawValue,
      "phoneDescending": phoneDescending,
      "favorites": favorites,
    ]
    store.setMany(
      Dictionary(uniqueKeysWithValues: values.map { ("workspace.\($0.key)", $0.value) }))
  }
  func view(for pane: WorkspacePane) -> BrowserViewMode { pane == .local ? localView : phoneView }
  func setView(_ mode: BrowserViewMode, for pane: WorkspacePane) {
    if pane == .local { localView = mode } else { phoneView = mode }
  }
  func toggleHidden(for pane: WorkspacePane) {
    if pane == .local { showHiddenLocal.toggle() } else { showHiddenPhone.toggle() }
  }
}

struct LocalFile: Identifiable, Hashable, Sendable {
  let url: URL
  let name: String
  let isDirectory: Bool
  let isSymbolicLink: Bool
  let size: UInt64?
  let modified: Date?
  var id: URL { url }
}
enum LocalDirectoryReader {
  static func read(_ directory: URL) throws -> [LocalFile] {
    let keys: Set<URLResourceKey> = [
      .isDirectoryKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey,
    ]
    return try FileManager.default.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: Array(keys)
    ).map { url in
      let values = try url.resourceValues(forKeys: keys)
      return LocalFile(
        url: url, name: url.lastPathComponent,
        isDirectory: values.isDirectory == true && values.isSymbolicLink != true,
        isSymbolicLink: values.isSymbolicLink == true,
        size: values.fileSize.map { UInt64(max($0, 0)) },
        modified: values.contentModificationDate)
    }
  }
}
