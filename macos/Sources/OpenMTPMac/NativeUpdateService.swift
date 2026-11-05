import AppKit
import Combine
import Foundation
import Sparkle

enum NativeSparkleConfiguration {
  static func feed(in info: [String: Any], architecture: String) -> URL? {
    guard info["OpenMTPAutomaticUpdatesEnabled"] as? Bool == true,
      let key = info["SUPublicEDKey"] as? String, Data(base64Encoded: key)?.count == 32,
      let text = info["SUFeedURL"] as? String, let url = URL(string: text),
      ["arm64", "x86_64"].contains(architecture),
      url.scheme == "https", url.host == "github.com", url.user == nil, url.password == nil,
      url.port == nil, url.query == nil, url.fragment == nil,
      url.path == "/aaditagrawal/openmtp/releases/latest/download/appcast-\(architecture).xml"
    else { return nil }
    return url
  }
}

/// SemVer comparison is independent of the release tag's optional `v` prefix.
struct NativeVersion: Comparable, Sendable {
  let numbers: [Int]
  let prerelease: [String]
  let description: String

  init?(_ text: String) {
    let value = text.hasPrefix("v") ? String(text.dropFirst()) : text
    let build = value.split(separator: "+", omittingEmptySubsequences: false)
    guard build.count <= 2 else { return nil }
    if build.count == 2, !Self.validIdentifiers(String(build[1]), allowLeadingZeros: true) {
      return nil
    }
    let parts = build[0].split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
    let numeric = parts[0].split(separator: ".", omittingEmptySubsequences: false)
    guard numeric.count == 3 else { return nil }
    var parsed = [Int]()
    for part in numeric {
      guard !part.isEmpty, part.allSatisfy({ $0.isASCII && $0.isNumber }),
        part.count == 1 || part.first != "0", let n = Int(part)
      else { return nil }
      parsed.append(n)
    }
    if parts.count == 2, !Self.validIdentifiers(String(parts[1]), allowLeadingZeros: false) {
      return nil
    }
    numbers = parsed
    prerelease = parts.count == 2 ? parts[1].split(separator: ".").map(String.init) : []
    description = value
  }

  private static func validIdentifiers(_ value: String, allowLeadingZeros: Bool) -> Bool {
    let identifiers = value.split(separator: ".", omittingEmptySubsequences: false)
    return identifiers.allSatisfy { part in
      guard !part.isEmpty,
        part.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") })
      else { return false }
      return allowLeadingZeros || !part.allSatisfy(\.isNumber) || part.count == 1
        || part.first != "0"
    }
  }

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.numbers == rhs.numbers && lhs.prerelease == rhs.prerelease
  }

  static func < (lhs: Self, rhs: Self) -> Bool {
    if lhs.numbers != rhs.numbers { return lhs.numbers.lexicographicallyPrecedes(rhs.numbers) }
    if lhs.prerelease.isEmpty { return false }
    if rhs.prerelease.isEmpty { return true }
    for (a, b) in zip(lhs.prerelease, rhs.prerelease) where a != b {
      let an = a.allSatisfy(\.isNumber)
      let bn = b.allSatisfy(\.isNumber)
      if an && bn { return a.count == b.count ? a < b : a.count < b.count }
      if an != bn { return an }
      return a < b
    }
    return lhs.prerelease.count < rhs.prerelease.count
  }
}

struct NativeUpdateOffer: Equatable, Sendable {
  let version: String
  let releaseURL: URL
  let downloadURL: URL
  let assetName: String
  let isPrerelease: Bool
}

enum NativeReleaseSelector {
  struct Release: Decodable, Sendable {
    struct Asset: Decodable, Sendable {
      let name: String
      let browserDownloadURL: URL
      let label: String?
      enum CodingKeys: String, CodingKey {
        case name, label
        case browserDownloadURL = "browser_download_url"
      }
    }
    let tagName: String
    let draft: Bool
    let prerelease: Bool
    let assets: [Asset]
    enum CodingKeys: String, CodingKey {
      case tagName = "tag_name"
      case draft, prerelease, assets
    }
  }

  static var hostArchitecture: String {
    #if arch(arm64)
      "arm64"
    #elseif arch(x86_64)
      "x86_64"
    #else
      "unsupported"
    #endif
  }

  static var installedVersion: String {
    Bundle.main.object(forInfoDictionaryKey: "OpenMTPVersion") as? String
      ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
      ?? "0.0.0"
  }

  static func offer(
    in data: Data, currentVersion: String, architecture: String, includePrereleases: Bool,
    currentOS: OperatingSystemVersion = ProcessInfo.processInfo.operatingSystemVersion
  ) throws -> NativeUpdateOffer? {
    guard data.count <= 2 << 20 else { throw UpdateError.invalidResponse }
    guard let current = NativeVersion(currentVersion), ["arm64", "x86_64"].contains(architecture)
    else { throw UpdateError.invalidVersion }
    let releases = try JSONDecoder().decode([Release].self, from: data)
    for (release, version) in releases.compactMap({ release -> (Release, NativeVersion)? in
      guard !release.draft, let version = NativeVersion(release.tagName), version > current,
        includePrereleases || (!release.prerelease && version.prerelease.isEmpty)
      else { return nil }
      return (release, version)
    }).sorted(by: { $0.1 > $1.1 }) {
      // Legacy Electron packages have different names and must never replace this app.
      let names = [architecture, "universal"].flatMap { arch in
        ["zip", "dmg"].map { "OpenMTP-\(version.description)-macos-\(arch).\($0)" }
      }
      for name in names {
        guard let asset = release.assets.first(where: { $0.name == name }),
          supportsCurrentOS(label: asset.label, currentOS: currentOS),
          isOwnedDownload(asset.browserDownloadURL, tag: release.tagName, name: name)
        else { continue }
        let page = URL(string: "https://github.com/aaditagrawal/openmtp/releases/tag/")!
          .appendingPathComponent(release.tagName)
        return NativeUpdateOffer(
          version: version.description, releaseURL: page, downloadURL: asset.browserDownloadURL,
          assetName: name, isPrerelease: release.prerelease || !version.prerelease.isEmpty)
      }
    }
    return nil
  }

  static func isOwnedDownload(_ url: URL, tag: String, name: String) -> Bool {
    guard url.scheme == "https", url.host == "github.com", url.user == nil, url.password == nil,
      url.port == nil, url.query == nil, url.fragment == nil
    else { return false }
    return url.path == "/aaditagrawal/openmtp/releases/download/\(tag)/\(name)"
  }

  static func prereleaseAppcast(in data: Data, currentVersion: String, architecture: String) throws
    -> URL?
  {
    guard
      let offer = try offer(
        in: data, currentVersion: currentVersion, architecture: architecture,
        includePrereleases: true),
      offer.isPrerelease
    else { return nil }
    let releases = try JSONDecoder().decode([Release].self, from: data)
    let name = "appcast-\(architecture).xml"
    guard
      let release = releases.first(where: {
        NativeVersion($0.tagName)?.description == offer.version
      }),
      let asset = release.assets.first(where: { $0.name == name }),
      isOwnedDownload(asset.browserDownloadURL, tag: release.tagName, name: name)
    else { return nil }
    return asset.browserDownloadURL
  }

  static func supportsCurrentOS(label: String?, currentOS: OperatingSystemVersion) -> Bool {
    guard let label else { return false }
    let fields = label.split(separator: ";", omittingEmptySubsequences: false)
    guard fields.count == 2, fields[0] == "openmtp-native", fields[1].hasPrefix("minimum-macos=")
    else { return false }
    let parts = fields[1].dropFirst("minimum-macos=".count).split(
      separator: ".", omittingEmptySubsequences: false)
    guard (2...3).contains(parts.count) else { return false }
    let minimum = parts.compactMap { part -> Int? in
      guard !part.isEmpty, part.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
      return Int(part)
    }
    guard minimum.count == parts.count, minimum[0] >= 10 else { return false }
    let required = minimum.count == 2 ? minimum + [0] : minimum
    let actual = [currentOS.majorVersion, currentOS.minorVersion, currentOS.patchVersion]
    return !actual.lexicographicallyPrecedes(required)
  }

  enum UpdateError: LocalizedError {
    case invalidResponse, invalidVersion
    case http(Int)
    var errorDescription: String? {
      switch self {
      case .invalidResponse: "GitHub returned an invalid release response."
      case .invalidVersion: "This build has no supported native version or architecture."
      case .http(let code): "The release check failed with HTTP \(code). Try again later."
      }
    }
  }
}

/// Cancellation belongs to this loop, including an in-flight refresh. Keeping the
/// scheduler separate lets requests and preference transitions run in tests.
@MainActor
final class NativePrereleaseDiscoveryScheduler {
  private struct Configuration: Equatable {
    let automaticallyChecks: Bool
    let includePrereleases: Bool
    let isConfigured: Bool
  }
  private let interval: Duration
  private var configuration: Configuration?
  private var refreshTask: Task<Void, Never>?

  init(interval: Duration = .seconds(24 * 60 * 60)) { self.interval = interval }

  func configure(
    automaticallyChecks: Bool, includePrereleases: Bool, isConfigured: Bool,
    refresh: @escaping @MainActor @Sendable () async -> Void
  ) {
    let next = Configuration(
      automaticallyChecks: automaticallyChecks, includePrereleases: includePrereleases,
      isConfigured: isConfigured)
    guard next != configuration else { return }
    configuration = next
    refreshTask?.cancel()
    refreshTask = nil
    guard automaticallyChecks, includePrereleases, isConfigured else { return }
    let interval = interval
    refreshTask = Task {
      while !Task.isCancelled {
        await refresh()
        do { try await Task.sleep(for: interval) } catch { return }
      }
    }
  }

  deinit { refreshTask?.cancel() }
}

@MainActor
final class NativeUpdateService: NSObject, ObservableObject, SPUUpdaterDelegate {
  enum State: Equatable {
    case idle, checking, waitingForTransfers, upToDate
    case available(NativeUpdateOffer)
    case failed(String)
  }
  static let shared = NativeUpdateService()
  @Published private(set) var state: State = .idle
  @Published private(set) var canCheckForUpdates = true
  let currentVersion: String
  private let architecture: String
  private let session: URLSession
  private var updaterController: SPUStandardUpdaterController?
  private var updaterObservation: AnyCancellable?
  private var updaterPreferencesObservation: AnyCancellable?
  private var includePrereleases = false
  private var prereleaseFeed: URL?
  private let prereleaseDiscovery = NativePrereleaseDiscoveryScheduler()
  /// Mirror changes made in Sparkle's own permission/update UI back into the
  /// app's settings, so the next launch does not undo the user's choice.
  var automaticPreferencesChanged: ((Bool, Bool) -> Void)?
  var hasActiveTransfers: () -> Bool = { NativeFileIntegration.shared.hasActiveTransfers }
  private var deferredInstallation: (() -> Void)?
  private var installationWaitTask: Task<Void, Never>?

  init(
    currentVersion: String = NativeReleaseSelector.installedVersion,
    architecture: String = NativeReleaseSelector.hostArchitecture, session: URLSession = .shared
  ) {
    self.currentVersion = currentVersion
    self.architecture = architecture
    self.session = session
    super.init()
  }

  var usesAutomaticInstaller: Bool { updaterController != nil }

  /// Release packaging enables this only for a Developer ID signed app with an
  /// owned architecture-specific feed and a configured public EdDSA key.
  /// Developer/ad-hoc builds retain the verified GitHub manual fallback.
  func start(automaticallyChecks: Bool, automaticallyInstalls: Bool, includePrereleases: Bool) {
    self.includePrereleases = includePrereleases
    guard updaterController == nil,
      NativeSparkleConfiguration.feed(
        in: Bundle.main.infoDictionary ?? [:], architecture: architecture) != nil
    else { return }
    let controller = SPUStandardUpdaterController(
      startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
    do {
      try controller.updater.start()
      updaterController = controller
      configureAutomaticUpdates(
        automaticallyChecks: automaticallyChecks, automaticallyInstalls: automaticallyInstalls,
        includePrereleases: includePrereleases)
      updaterObservation = controller.updater.publisher(for: \.canCheckForUpdates)
        .receive(on: DispatchQueue.main)
        .sink { [weak self] available in self?.canCheckForUpdates = available }
      updaterPreferencesObservation = controller.updater.publisher(
        for: \.automaticallyChecksForUpdates
      )
      .combineLatest(controller.updater.publisher(for: \.automaticallyDownloadsUpdates))
      .receive(on: DispatchQueue.main)
      .sink { [weak self] checks, installs in
        guard let self else { return }
        self.schedulePrereleaseDiscovery()
        self.automaticPreferencesChanged?(checks, installs)
      }
      schedulePrereleaseDiscovery()
    } catch { state = .failed("Automatic updates could not start: \(error.localizedDescription)") }
  }

  func configureAutomaticUpdates(
    automaticallyChecks: Bool, automaticallyInstalls: Bool, includePrereleases: Bool
  ) {
    let channelChanged = self.includePrereleases != includePrereleases
    self.includePrereleases = includePrereleases
    guard let updater = updaterController?.updater else { return }
    if updater.automaticallyChecksForUpdates != automaticallyChecks {
      updater.automaticallyChecksForUpdates = automaticallyChecks
    }
    if updater.automaticallyDownloadsUpdates != automaticallyInstalls {
      updater.automaticallyDownloadsUpdates = automaticallyInstalls
    }
    schedulePrereleaseDiscovery()
    if channelChanged { updater.resetUpdateCycleAfterShortDelay() }
  }

  private func schedulePrereleaseDiscovery() {
    if !includePrereleases || updaterController == nil { prereleaseFeed = nil }
    prereleaseDiscovery.configure(
      automaticallyChecks: updaterController?.updater.automaticallyChecksForUpdates == true,
      includePrereleases: includePrereleases, isConfigured: updaterController != nil
    ) { [weak self] in
      await self?.refreshPrereleaseFeed()
    }
  }

  private func releaseData() async throws -> Data {
    var request = URLRequest(
      url: URL(string: "https://api.github.com/repos/aaditagrawal/openmtp/releases?per_page=30")!)
    request.timeoutInterval = 20
    request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
    request.setValue("OpenMTP/\(currentVersion)", forHTTPHeaderField: "User-Agent")
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw NativeReleaseSelector.UpdateError.invalidResponse
    }
    guard http.statusCode == 200 else {
      throw NativeReleaseSelector.UpdateError.http(http.statusCode)
    }
    guard data.count <= 2 << 20 else { throw NativeReleaseSelector.UpdateError.invalidResponse }
    return data
  }

  private func refreshPrereleaseFeed() async {
    do {
      let data = try await releaseData()
      let feed = try NativeReleaseSelector.prereleaseAppcast(
        in: data, currentVersion: currentVersion, architecture: architecture)
      guard includePrereleases, !Task.isCancelled else { return }
      if feed != prereleaseFeed {
        prereleaseFeed = feed
        updaterController?.updater.resetUpdateCycleAfterShortDelay()
      }
    } catch {
      // A transient discovery failure keeps the last verified owned feed;
      // Sparkle still validates the appcast and archive before installing.
    }
  }

  var statusMessage: String {
    switch state {
    case .idle:
      usesAutomaticInstaller
        ? "Signed updates can be downloaded and installed by OpenMTP."
        : "This developer build uses manual update installation."
    case .checking: "Checking for updates…"
    case .waitingForTransfers: "The update will install after pending copies finish."
    case .upToDate: "OpenMTP is up to date."
    case .available(let offer):
      "OpenMTP \(offer.version) is available. Download and install it to update."
    case .failed(let message): message
    }
  }

  var defaultIncludePrereleases: Bool {
    !(NativeVersion(currentVersion)?.prerelease.isEmpty ?? true)
  }

  func check(includePrereleases: Bool? = nil) async {
    self.includePrereleases = includePrereleases ?? defaultIncludePrereleases
    if let controller = updaterController {
      if self.includePrereleases { await refreshPrereleaseFeed() }
      guard controller.updater.canCheckForUpdates else { return }
      state = .checking
      controller.checkForUpdates(nil)
      return
    }
    guard state != .checking else { return }
    state = .checking
    do {
      let data = try await releaseData()
      if let offer = try NativeReleaseSelector.offer(
        in: data, currentVersion: currentVersion, architecture: architecture,
        includePrereleases: includePrereleases ?? defaultIncludePrereleases)
      {
        state = .available(offer)
      } else {
        state = .upToDate
      }
    } catch is CancellationError { state = .idle } catch {
      state = .failed(error.localizedDescription)
    }
  }

  func openRelease() {
    if case .available(let offer) = state { NSWorkspace.shared.open(offer.releaseURL) }
  }

  func openDownload() {
    if case .available(let offer) = state { NSWorkspace.shared.open(offer.downloadURL) }
  }

  func allowedChannels(for updater: SPUUpdater) -> Set<String> {
    includePrereleases ? ["beta"] : []
  }
  func feedURLString(for updater: SPUUpdater) -> String? {
    if includePrereleases, let prereleaseFeed { return prereleaseFeed.absoluteString }
    return NativeSparkleConfiguration.feed(
      in: Bundle.main.infoDictionary ?? [:], architecture: architecture)?.absoluteString
  }
  func updaterDidNotFindUpdate(_ updater: SPUUpdater) { state = .upToDate }
  func updater(
    _ updater: SPUUpdater, shouldProceedWithUpdate item: SUAppcastItem,
    updateCheck: SPUUpdateCheck
  ) throws {
    try validateSemanticUpdate(item)
  }

  /// Build numbers order installations, but a later maintenance build or the
  /// stable feed shown to a beta user must never downgrade the release version.
  func validateSemanticUpdate(_ item: SUAppcastItem) throws {
    guard let installed = NativeVersion(currentVersion),
      let offered = NativeVersion(item.displayVersionString),
      !offered.numbers.lexicographicallyPrecedes(installed.numbers),
      !(offered.numbers == installed.numbers && installed.prerelease.isEmpty
        && !(item.channel ?? "").isEmpty)
    else {
      throw NSError(
        domain: "io.ganeshrvel.openmtp.updates", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "This update is older than the installed release."])
    }
  }

  func updater(
    _ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem,
    untilInvokingBlock installHandler: @escaping () -> Void
  ) -> Bool {
    postponeInstallationIfBusy(installHandler)
  }
  func updater(
    _ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem,
    immediateInstallationBlock installHandler: @escaping () -> Void
  ) -> Bool {
    // Sparkle already installs on normal termination. Taking ownership here
    // would turn an automatic install-on-quit into an unsolicited restart.
    false
  }

  /// Delay a requested restart while copies or exports are active. Automatic
  /// install-on-quit stays with Sparkle; app termination drains active work.
  func postponeInstallationIfBusy(_ installHandler: @escaping () -> Void) -> Bool {
    guard hasActiveTransfers() else { return false }
    deferredInstallation = installHandler
    state = .waitingForTransfers
    guard installationWaitTask == nil else { return true }
    installationWaitTask = Task { [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
        guard let self else { return }
        if self.resumeDeferredInstallationIfIdle() { return }
      }
    }
    return true
  }

  @discardableResult
  func resumeDeferredInstallationIfIdle() -> Bool {
    guard !hasActiveTransfers(), let installHandler = deferredInstallation else { return false }
    deferredInstallation = nil
    installationWaitTask?.cancel()
    installationWaitTask = nil
    state = .idle
    installHandler()
    return true
  }

  func cancelDeferredInstallation() {
    deferredInstallation = nil
    installationWaitTask?.cancel()
    installationWaitTask = nil
    if state == .waitingForTransfers { state = .idle }
  }

  func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
    cancelDeferredInstallation()
    state = .failed(error.localizedDescription)
  }
  func updater(
    _ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?
  ) {
    if let error {
      cancelDeferredInstallation()
      state = .failed(error.localizedDescription)
    } else if state == .checking {
      state = .idle
    }
  }
}
