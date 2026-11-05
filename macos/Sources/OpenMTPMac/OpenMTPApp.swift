import AppKit
import SwiftUI

@main
struct OpenMTPApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @StateObject private var model = AppModel()

  var body: some Scene {
    Window("OpenMTP", id: "main") {
      WorkspaceView()
        .environmentObject(model)
        .environmentObject(model.settings)
        .frame(minWidth: model.settings.showLocalPane ? 900 : 600, minHeight: 520)
        .task {
          delegate.model = model
          model.start()
        }
    }
    .defaultSize(width: 1120, height: 740)
    .windowResizability(.contentMinSize)
    .windowToolbarStyle(.unified)
    .commands { WorkspaceCommands(model: model) }

    Settings {
      WorkspaceSettingsView(settings: model.settings)
    }
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  weak var model: AppModel?
  private var terminationTask: Task<Void, Never>?
  func applicationDidFinishLaunching(_: Notification) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
  }
  func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool { false }
  func applicationShouldTerminate(_: NSApplication) -> NSApplication.TerminateReply {
    if terminationTask != nil { return .terminateLater }
    guard let model else { return .terminateNow }
    guard model.hasActiveTransfers || model.hasInFlightWork else { return .terminateNow }
    let alert = NSAlert()
    alert.messageText = "Quit while copies are pending?"
    alert.informativeText =
      "Active copies will be interrupted. Completed files stay complete, and pending jobs can be retried next time."
    alert.addButton(withTitle: "Quit")
    alert.addButton(withTitle: "Cancel")
    guard alert.runModal() == .alertFirstButtonReturn else { return .terminateCancel }
    terminationTask = Task { [weak self] in
      let finished = await model.prepareForTermination()
      self?.terminationTask = nil
      NSApp.reply(toApplicationShouldTerminate: finished)
    }
    return .terminateLater
  }
}

@MainActor
struct WorkspaceCommands: Commands {
  @ObservedObject var model: AppModel
  private var editingText: Bool {
    (NSApp.keyWindow?.firstResponder as? NSTextView)?.isFieldEditor == true
  }
  var body: some Commands {
    CommandGroup(replacing: .newItem) {
      Button("New Folder…") { model.beginNewFolder() }
        .keyboardShortcut("n", modifiers: [.command, .shift])
        .disabled(model.activePane == .phone && model.connection != .connected)
      Button("Open Selection") { model.openSelection() }.keyboardShortcut("o")
        .disabled(model.activeSelectionCount == 0)
      Button("Rename…") { model.beginRename() }.disabled(model.activeSelectionCount != 1)
      Divider()
      Button("Copy to Mac…") { model.downloadSelection() }.disabled(
        model.selection.isEmpty || model.connection != .connected)
      Button("Copy Files to Phone…") { model.chooseFilesToUpload() }.disabled(
        model.connection != .connected)
      Button("Quick Look") { model.previewSelection() }.keyboardShortcut("y").disabled(
        model.activeSelectionCount == 0)
    }
    CommandGroup(replacing: .pasteboard) {
      Button("Cut") { NSApp.sendAction(#selector(NSText.cut(_:)), to: nil, from: nil) }
        .keyboardShortcut("x").disabled(!editingText)
      Button("Copy") {
        if editingText {
          NSApp.sendAction(#selector(NSText.copy(_:)), to: nil, from: nil)
        } else {
          model.copySelection()
        }
      }.keyboardShortcut("c").disabled(!editingText && model.activeSelectionCount == 0)
      Button("Paste") {
        if editingText {
          NSApp.sendAction(#selector(NSText.paste(_:)), to: nil, from: nil)
        } else {
          model.pasteSelection()
        }
      }.keyboardShortcut("v").disabled(!editingText && !model.canPaste)
      Button("Add to Copy Selection") { model.copySelection(append: true) }
        .keyboardShortcut("c", modifiers: [.command, .shift]).disabled(
          model.activeSelectionCount == 0 || editingText)
      Divider()
      Button("Select All") {
        if editingText {
          NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: nil)
        } else {
          model.selectAll()
        }
      }.keyboardShortcut("a")
      Button(model.activePane == .local ? "Move to Trash" : "Delete from Phone…") {
        model.requestActiveDeletion()
      }
      .keyboardShortcut(.delete, modifiers: .command).disabled(
        model.activeSelectionCount == 0 || editingText)
    }
    CommandGroup(after: .toolbar) {
      Button("Icon View") { model.settings.setView(.grid, for: model.activePane) }.keyboardShortcut(
        "1")
      Button("List View") { model.settings.setView(.list, for: model.activePane) }.keyboardShortcut(
        "2")
      Button("Show Hidden Files") { model.settings.toggleHidden(for: model.activePane) }
        .keyboardShortcut(".", modifiers: [.command, .shift])
      Divider()
      Toggle(
        "Show Mac Pane",
        isOn: Binding(
          get: { model.settings.showLocalPane }, set: { model.settings.showLocalPane = $0 }))
      Toggle(
        "Mac Pane on Left",
        isOn: Binding(
          get: { model.settings.localPaneOnLeft }, set: { model.settings.localPaneOnLeft = $0 }))
      Toggle(
        "Show Transfers",
        isOn: Binding(
          get: { model.settings.showTransfers }, set: { model.settings.showTransfers = $0 }))
    }
    CommandMenu("Go") {
      Button("Back") { model.goBack() }.keyboardShortcut("[").disabled(!model.canGoBack)
      Button("Forward") { model.goForward() }.keyboardShortcut("]").disabled(!model.canGoForward)
      Button("Enclosing Folder") { model.goUpActive() }.keyboardShortcut(
        .upArrow, modifiers: .command
      ).disabled(!model.canGoUp)
      Button("Choose Mac Folder…") { model.chooseLocalFolder() }.keyboardShortcut(
        "g", modifiers: [.command, .shift])
      Button("Refresh") { model.reloadActive() }.keyboardShortcut("r")
      Divider()
      Button("Focus Mac Pane") {
        model.settings.showLocalPane = true
        model.activePane = .local
      }
      .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
      Button("Focus Phone Pane") { model.activePane = .phone }
        .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
    }
    CommandGroup(after: .appInfo) {
      Button("Check for Updates…") {
        Task {
          await NativeUpdateService.shared.check(
            includePrereleases: model.settings.includePrereleases)
        }
      }
    }
  }
}
