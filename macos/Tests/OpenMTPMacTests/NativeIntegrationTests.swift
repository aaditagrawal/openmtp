import AppKit
import Foundation
import Testing

@testable import OpenMTPMac

@Suite("Native update contracts")
struct NativeUpdateTests {
  @Test func automaticInstallerRequiresConfiguredOwnedArchitectureFeed() {
    let info: [String: Any] = [
      "OpenMTPAutomaticUpdatesEnabled": true,
      "SUPublicEDKey": Data(repeating: 1, count: 32).base64EncodedString(),
      "SUFeedURL":
        "https://github.com/aaditagrawal/openmtp/releases/latest/download/appcast-arm64.xml",
    ]
    #expect(NativeSparkleConfiguration.feed(in: info, architecture: "arm64") != nil)
    #expect(NativeSparkleConfiguration.feed(in: info, architecture: "x86_64") == nil)
    for (key, value) in [
      ("OpenMTPAutomaticUpdatesEnabled", false as Any),
      ("SUPublicEDKey", "invalid" as Any),
      (
        "SUFeedURL",
        "https://github.com/ganeshrvel/openmtp/releases/latest/download/appcast-arm64.xml" as Any
      ),
      (
        "SUFeedURL",
        "http://github.com/aaditagrawal/openmtp/releases/latest/download/appcast-arm64.xml" as Any
      ),
      (
        "SUFeedURL",
        "https://github.com/aaditagrawal/openmtp/releases/latest/download/appcast-arm64.xml?override=1"
          as Any
      ),
    ] {
      var changed = info
      changed[key] = value
      #expect(NativeSparkleConfiguration.feed(in: changed, architecture: "arm64") == nil)
    }
  }

  private let os13 = OperatingSystemVersion(majorVersion: 13, minorVersion: 0, patchVersion: 0)

  private func data(_ releases: [[String: Any]]) throws -> Data {
    try JSONSerialization.data(withJSONObject: releases)
  }
  private func release(
    _ version: String, architecture: String = "arm64",
    label: String? = "openmtp-native;minimum-macos=13.0",
    prerelease: Bool = false, draft: Bool = false, owner: String = "aaditagrawal",
    name: String? = nil
  ) -> [String: Any] {
    let asset = name ?? "OpenMTP-\(version)-macos-\(architecture).zip"
    var entry: [String: Any] = [
      "name": asset,
      "browser_download_url":
        "https://github.com/\(owner)/openmtp/releases/download/v\(version)/\(asset)",
    ]
    if let label { entry["label"] = label }
    return ["tag_name": "v\(version)", "draft": draft, "prerelease": prerelease, "assets": [entry]]
  }

  @Test func semanticVersionsNeverDowngradeOrMisorderBetaNumbers() throws {
    let values = [
      "3.2.26", "4.0.0-alpha.1", "4.0.0-beta.2", "4.0.0-beta.10", "4.0.0-rc.1", "4.0.0", "4.1.0",
    ]
    let parsed = try values.map { try #require(NativeVersion($0)) }
    #expect(parsed.sorted() == parsed)
    #expect(NativeVersion("v4.0.0+build.2") == NativeVersion("4.0.0"))
    for invalid in [
      "", "4.0", "4.0.0.1", "04.0.0", "4.0.0-beta.01", "4.0.0-", "4.0.0+", "4.0.0/../5",
    ] {
      #expect(NativeVersion(invalid) == nil)
    }
  }

  @Test func selectsNewestCompatibleNativeOwnedAsset() throws {
    let response = try data([
      release("4.5.0", label: "openmtp-native;minimum-macos=26.0"),
      release("4.4.0", architecture: "x86_64"),
      release("4.3.0", owner: "ganeshrvel"),
      release("4.2.0", name: "openmtp-4.2.0-mac-arm64.zip"),
      release("4.1.0"), release("4.0.0"),
    ])
    let offer = try #require(
      try NativeReleaseSelector.offer(
        in: response, currentVersion: "4.0.0", architecture: "arm64",
        includePrereleases: false, currentOS: os13))
    #expect(offer.version == "4.1.0")
    #expect(offer.downloadURL.host == "github.com")
    #expect(offer.releaseURL.path == "/aaditagrawal/openmtp/releases/tag/v4.1.0")
    #expect(
      try NativeReleaseSelector.offer(
        in: response, currentVersion: "5.0.0", architecture: "arm64",
        includePrereleases: true, currentOS: os13) == nil)
  }

  @Test func channelAndMinimumOSAreExplicit() throws {
    let response = try data([
      release("4.1.0-beta.2", prerelease: true), release("4.1.0-beta.10", prerelease: true),
      release("4.2.0", draft: true), release("4.3.0", label: nil),
    ])
    #expect(
      try NativeReleaseSelector.offer(
        in: response, currentVersion: "4.0.0", architecture: "arm64",
        includePrereleases: false, currentOS: os13) == nil)
    let offer = try #require(
      try NativeReleaseSelector.offer(
        in: response, currentVersion: "4.1.0-beta.2", architecture: "arm64",
        includePrereleases: true, currentOS: os13))
    #expect(offer.version == "4.1.0-beta.10")
    #expect(offer.isPrerelease)
    for label in [
      nil, "minimum-macos=13.0", "openmtp-native;minimum-macos=bad",
      "openmtp-native;minimum-macos=14.0", "openmtp-native;minimum-macos=13.0;extra=true",
    ] {
      #expect(!NativeReleaseSelector.supportsCurrentOS(label: label, currentOS: os13))
    }
  }

  @Test func rejectsUnownedDownloadURLs() throws {
    let name = "OpenMTP-4.1.0-macos-arm64.zip"
    for text in [
      "http://github.com/aaditagrawal/openmtp/releases/download/v4.1.0/\(name)",
      "https://github.com.evil.invalid/aaditagrawal/openmtp/releases/download/v4.1.0/\(name)",
      "https://user@github.com/aaditagrawal/openmtp/releases/download/v4.1.0/\(name)",
      "https://github.com/ganeshrvel/openmtp/releases/download/v4.1.0/\(name)",
      "https://github.com/aaditagrawal/openmtp/releases/download/v4.1.0/\(name)?redirect=elsewhere",
    ] {
      #expect(
        !NativeReleaseSelector.isOwnedDownload(
          try #require(URL(string: text)), tag: "v4.1.0", name: name))
    }
  }

  @Test func betaInstallerUsesExactOwnedAppcastForCompatibleNativeRelease() throws {
    var beta = release("4.1.0-beta.2", prerelease: true)
    var assets = try #require(beta["assets"] as? [[String: Any]])
    let expected =
      "https://github.com/aaditagrawal/openmtp/releases/download/v4.1.0-beta.2/appcast-arm64.xml"
    assets.append(["name": "appcast-arm64.xml", "browser_download_url": expected])
    beta["assets"] = assets
    #expect(
      try NativeReleaseSelector.prereleaseAppcast(
        in: data([beta]), currentVersion: "4.0.0", architecture: "arm64")?.absoluteString
        == expected)
    #expect(
      try NativeReleaseSelector.prereleaseAppcast(
        in: data([beta]), currentVersion: "4.0.0", architecture: "x86_64") == nil)
    #expect(
      try NativeReleaseSelector.prereleaseAppcast(
        in: data([beta]), currentVersion: "4.2.0", architecture: "arm64") == nil)
    #expect(
      try NativeReleaseSelector.prereleaseAppcast(
        in: data([beta, release("4.1.0")]), currentVersion: "4.0.0", architecture: "arm64") == nil)
    assets[1]["browser_download_url"] =
      "https://github.com/ganeshrvel/openmtp/releases/download/v4.1.0-beta.2/appcast-arm64.xml"
    beta["assets"] = assets
    #expect(
      try NativeReleaseSelector.prereleaseAppcast(
        in: data([beta]), currentVersion: "4.0.0", architecture: "arm64") == nil)
  }
}

@Suite("Native file export contracts")
@MainActor
struct NativeExportTests {
  private func directory() throws -> URL {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      "native-export-test-\(UUID())", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return root
  }
  private func file(_ name: String = "photo.jpg", identity: String = "session:storage:handle")
    -> NativeFileIntegration.RemoteFile
  {
    NativeFileIntegration.RemoteFile(
      name: name, isDirectory: false, identity: identity, byteCount: 3
    ) { directory, _ in
      let url = directory.appendingPathComponent(name)
      try Data([1, 2, 3]).write(to: url)
      return url
    }
  }

  @Test func cacheIsolatedPerRequestAndSession() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = NativeExportStore(root: root)
    let first = try await store.materialize(file(), progress: Progress(totalUnitCount: 3))
    let second = try await store.materialize(file(), progress: Progress(totalUnitCount: 3))
    let third = try await store.materialize(
      file(identity: "different-phone:same-handle"), progress: Progress(totalUnitCount: 3))
    #expect(first != second && second != third)
    #expect(try Data(contentsOf: first) == Data([1, 2, 3]))
    #expect(try Data(contentsOf: second) == Data([1, 2, 3]))
    #expect(
      NativeExportStore.isGeneratedDirectory(first.deletingLastPathComponent().lastPathComponent))
  }

  @Test func promiseUsesFindersExactNameAndNeverReplacesUserFile() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = NativeExportStore(root: root.appendingPathComponent("cache"))
    let destination = root.appendingPathComponent("Finder chose this name.jpg")
    try await store.fulfill(file(), at: destination, progress: Progress(totalUnitCount: 3))
    #expect(try Data(contentsOf: destination) == Data([1, 2, 3]))
    try Data([9]).write(to: destination)
    do {
      try await store.fulfill(file(), at: destination, progress: Progress(totalUnitCount: 3))
      Issue.record("An existing Finder destination was replaced")
    } catch { #expect(try Data(contentsOf: destination) == Data([9])) }
    #expect(
      !(try FileManager.default.contentsOfDirectory(atPath: root.path)).contains {
        $0.hasPrefix(".openmtp-export-")
      })
  }

  @Test func folderPromisesKeepNestedFilesAndEmptyDirectories() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let request = NativeFileIntegration.RemoteFile(
      name: "Camera", isDirectory: true, identity: "phone:folder", byteCount: nil
    ) { staging, _ in
      let folder = staging.appendingPathComponent("Camera", isDirectory: true)
      try FileManager.default.createDirectory(
        at: folder.appendingPathComponent("empty"), withIntermediateDirectories: true)
      try Data([4]).write(to: folder.appendingPathComponent("photo.jpg"))
      return folder
    }
    let destination = root.appendingPathComponent("Camera copy", isDirectory: true)
    try await NativeExportStore(root: root.appendingPathComponent("cache")).fulfill(
      request, at: destination, progress: Progress())
    #expect(try Data(contentsOf: destination.appendingPathComponent("photo.jpg")) == Data([4]))
    #expect(
      FileManager.default.fileExists(atPath: destination.appendingPathComponent("empty").path))
  }

  @Test func itemProvidersAreLazyAndIncomingPromisesKeepFilesAndFolders() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let integration = NativeFileIntegration(store: NativeExportStore(root: root))
    let folder = NativeFileIntegration.RemoteFile(
      name: "Album", isDirectory: true, identity: "phone:album", byteCount: nil
    ) { staging, _ in
      let url = staging.appendingPathComponent("Album")
      try FileManager.default.createDirectory(
        at: url.appendingPathComponent("empty"), withIntermediateDirectories: true)
      try Data([8]).write(to: url.appendingPathComponent("nested.jpg"))
      return url
    }
    let providers = [integration.itemProvider(for: file()), integration.itemProvider(for: folder)]
    #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    let received = try await integration.receive(providers)
    #expect(received.map(\.lastPathComponent) == ["photo.jpg", "Album"])
    #expect(try Data(contentsOf: received[0]) == Data([1, 2, 3]))
    #expect(try Data(contentsOf: received[1].appendingPathComponent("nested.jpg")) == Data([8]))
    #expect(
      try received[1].appendingPathComponent("empty").resourceValues(forKeys: [.isDirectoryKey])
        .isDirectory == true)
    #expect(received[0].deletingLastPathComponent() != received[1].deletingLastPathComponent())
  }

  @Test func cancellationAndInvalidProviderResultsCleanOnlyOwnedStaging() async throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let userFile = root.appendingPathComponent("keep.txt")
    try Data([7]).write(to: userFile)
    let store = NativeExportStore(root: root.appendingPathComponent("cache"))
    let progress = Progress(totalUnitCount: 3)
    progress.cancel()
    await #expect(throws: CancellationError.self) {
      try await store.materialize(file(), progress: progress)
    }
    let invalid = NativeFileIntegration.RemoteFile(
      name: "escape", isDirectory: false, identity: "invalid", byteCount: 1
    ) { _, _ in userFile }
    await #expect(throws: NativeFileIntegrationError.self) {
      try await store.materialize(invalid, progress: Progress())
    }
    #expect(try Data(contentsOf: userFile) == Data([7]))
    #expect(try FileManager.default.contentsOfDirectory(atPath: store.root.path).isEmpty)
    for name in ["", ".", "..", "../other", "folder/file", "name\0suffix"] {
      #expect(throws: NativeFileIntegrationError.self) {
        try NativeExportStore.validateFilename(name)
      }
    }
  }

  @Test func pruneKeepsUnrelatedCacheItems() throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = NativeExportStore(root: root)
    let generated = try store.directory(identity: "phone")
    let unrelated = root.appendingPathComponent(".openmtp-export-personal", isDirectory: true)
    try FileManager.default.createDirectory(at: unrelated, withIntermediateDirectories: false)
    store.prune(olderThan: .distantFuture)
    #expect(!FileManager.default.fileExists(atPath: generated.path))
    #expect(FileManager.default.fileExists(atPath: unrelated.path))
  }
}
