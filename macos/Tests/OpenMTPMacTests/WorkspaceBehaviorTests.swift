import AppKit
import Foundation
import MTPCore
import Testing

@testable import MTPSimulation
@testable import OpenMTPMac

@Suite("Native workspace behavior", .serialized)
@MainActor
struct WorkspaceBehaviorTests {
  private func temporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "workspace-tests-\(UUID())", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  @Test func legacySettingsMigrateOnceWithoutRewritingLegacyFile() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let legacy = directory.appendingPathComponent("settings.json")
    let original = Data(
      #"{"appThemeMode":"dark","showLocalPane":false,"showLocalPaneOnLeftSide":false,"showDirectoriesFirst":false,"enableBackgroundAutoUpdate":true,"hideHiddenFiles":{"local":false,"mtp":true},"fileExplorerListingType":{"local":"grid","mtp":"list"}}"#
        .utf8)
    try original.write(to: legacy)
    let suite = "io.openmtp.tests.\(UUID())"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let settings = WorkspaceSettings(defaults: defaults, legacyDirectory: directory)
    #expect(settings.appearance == .dark)
    #expect(!settings.showLocalPane)
    #expect(!settings.localPaneOnLeft)
    #expect(!settings.directoriesFirst)
    #expect(settings.showHiddenLocal && !settings.showHiddenPhone)
    #expect(settings.localView == .grid && settings.phoneView == .list)
    #expect(settings.autoInstallUpdates)
    settings.appearance = .light
    let restored = WorkspaceSettings(defaults: defaults, legacyDirectory: directory)
    #expect(restored.appearance == .light)
    #expect(try Data(contentsOf: legacy) == original)
  }

  @Test func largeDirectoryNaturalSortFilteringAndRangeSelection() async throws {
    let sim = SimulatedDevice()
    for number in (1...1_500).reversed() { _ = sim.add("photo\(number).jpg") }
    let hidden = sim.add(".private")
    let folder = sim.add("Folder", directory: true)
    let settings = WorkspaceSettings(defaults: nil)
    let model = AppModel(
      client: MTPClient(device: try MTPDevice(transport: sim)), storage: sim.storageID,
      settings: settings)
    await model.reload()
    #expect(model.sortedEntries.count == 1_501)
    #expect(model.sortedEntries.first?.id == folder)
    #expect(
      Array(model.sortedEntries.dropFirst().prefix(3).map(\.name)) == [
        "photo1.jpg", "photo2.jpg", "photo3.jpg",
      ])
    let first = try #require(model.sortedEntries.first { $0.name == "photo2.jpg" })
    let last = try #require(model.sortedEntries.first { $0.name == "photo5.jpg" })
    model.selectGridItem(String(first.id), in: .phone, modifiers: [])
    model.selectGridItem(String(last.id), in: .phone, modifiers: [.shift])
    #expect(model.selection.count == 4)
    model.selectGridItem(String(first.id), in: .phone, modifiers: [.command])
    #expect(model.selection.count == 3 && !model.selection.contains(first.id))
    model.phoneSearch = "photo1500"
    #expect(model.sortedEntries.map(\.name) == ["photo1500.jpg"])
    model.phoneSearch = ""
    settings.showHiddenPhone = true
    #expect(model.sortedEntries.contains { $0.id == hidden })
  }

  @Test func localHistoryAndClipboardKeepCapturedSources() async throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let first = directory.appendingPathComponent("First", isDirectory: true)
    let second = directory.appendingPathComponent("Second", isDirectory: true)
    try FileManager.default.createDirectory(at: first, withIntermediateDirectories: false)
    try FileManager.default.createDirectory(at: second, withIntermediateDirectories: false)
    let source = first.appendingPathComponent("source.txt")
    try Data([1, 2, 3]).write(to: source)
    let sim = SimulatedDevice()
    let settings = WorkspaceSettings(defaults: nil)
    settings.localPath = first.path
    let model = AppModel(
      client: MTPClient(device: try MTPDevice(transport: sim)), storage: sim.storageID,
      settings: settings)
    model.activePane = .local
    model.navigateLocal(to: first)
    await Task.yield()
    await model.reloadLocal()
    let listedSource = try #require(model.localEntries.first { $0.name == "source.txt" })
    model.localSelection = [listedSource.url]
    model.copySelection()
    model.navigateLocal(to: second)
    await model.reloadLocal()
    #expect(model.clipboard?.paths == [listedSource.url.path])
    #expect(model.localSelection.isEmpty)
    #expect(model.canGoBack)
    model.goBack()
    #expect(model.localDirectory == first)
    model.goForward()
    #expect(model.localDirectory == second)
    model.activePane = .phone
    model.pasteSelection()
    let job = try #require(model.transfers.first)
    #expect(job.sourcePaths == [listedSource.url.path])
    #expect(job.destination == "/")
    #expect(job.storage == sim.storageID)
    #expect(job.phoneIdentity == model.deviceIdentity)
    model.cancelAll()
  }

  @Test func remoteClipboardRetainsOriginalFolderAcrossNavigation() async throws {
    let sim = SimulatedDevice()
    let original = sim.add("original.txt")
    let folder = sim.add("folder", directory: true)
    let model = AppModel(
      client: MTPClient(device: try MTPDevice(transport: sim)), storage: sim.storageID)
    await model.reload()
    model.selection = [original]
    model.copySelection()
    let identity = model.deviceIdentity
    model.open(try #require(model.entries.first { $0.id == folder }))
    #expect(model.clipboard?.paths == ["/original.txt"])
    #expect(model.clipboard?.phoneIdentity == identity)
    #expect(model.clipboard?.storage == sim.storageID)
    #expect(model.phonePath == "/folder")
  }
}
