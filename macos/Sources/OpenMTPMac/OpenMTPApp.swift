import AppKit
import MTPCore
import MTPUSB
import SwiftUI
import UniformTypeIdentifiers

@main
struct OpenMTPApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    // App is created once per process. Plain `let` instead of `@State`: on the macOS 27 SDK
    // `@State` is a macro whose plugin ships with Xcode but not the Command Line Tools.
    private let model = AppModel()

    var body: some Scene {
        WindowGroup("OpenMTP") {
            ContentView()
                .environment(model)
                .frame(minWidth: 760, minHeight: 440)
                .task { model.start() }
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("Upload Files…") { model.chooseFilesToUpload() }
                    .keyboardShortcut("u")
                    .disabled(model.connection != .connected)
                Button("Download Selection…") { model.downloadSelection() }
                    .keyboardShortcut("d")
                    .disabled(model.selection.isEmpty)
            }
            CommandGroup(after: .pasteboard) {
                Button("Delete from Phone…", role: .destructive) { model.requestDeletion() }
                    .keyboardShortcut(.delete, modifiers: .command)
                    .disabled(model.connection != .connected || model.selection.isEmpty)
            }
            CommandGroup(after: .toolbar) {
                Button("Refresh") { Task { await model.reload(refresh: true) } }
                    .keyboardShortcut("r")
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_: Notification) {
        // Lets the unbundled `swift run` binary come to the front like a normal app.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool { true }
}

struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationSplitView {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 200, ideal: 230)
        } detail: {
            switch model.connection {
            case .connected:
                Browser()
            case .noDevice:
                ContentUnavailableView(
                    "Connect an Android phone",
                    systemImage: "cable.connector",
                    description: Text("Unlock it and choose “File transfer” in the USB notification.")
                )
            case let .connecting(name):
                ProgressView("Opening \(name)…")
            case let .failed(message, canSeize):
                ContentUnavailableView {
                    Label("Can’t open the phone", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Try Again") { model.retry(seize: false) }
                    if canSeize {
                        Button("Ask the Other App to Release It") { model.retry(seize: true) }
                    }
                }
            }
        }
        .alert("OpenMTP", isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
        .alert(model.pendingDeletion?.title ?? "Delete from Phone", isPresented: Binding(
            get: { model.pendingDeletion != nil },
            set: { if !$0 { model.pendingDeletion = nil } }
        ), presenting: model.pendingDeletion) { request in
            Button("Delete Permanently", role: .destructive) {
                Task { await model.confirmDeletion(request) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { request in
            Text(request.message)
        }
    }
}

struct Sidebar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        List(selection: $model.selectedStorage) {
            if model.connection == .connected {
                Section(model.deviceName) {
                    ForEach(model.storages) { storage in
                        VStack(alignment: .leading, spacing: 4) {
                            Label(storage.displayName, systemImage: storage.storageType == 4 ? "sdcard" : "internaldrive")
                            if storage.maxCapacity > 0 {
                                Gauge(value: Double(storage.maxCapacity - storage.freeSpaceInBytes), in: 0 ... Double(storage.maxCapacity)) {
                                    EmptyView()
                                } currentValueLabel: {
                                    Text("\(storage.freeSpaceInBytes.formatted(.byteCount(style: .file))) free")
                                }
                                .gaugeStyle(.accessoryLinearCapacity)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                        }
                        .tag(storage.id as UInt32?)
                    }
                }
            }
            if !model.transfers.isEmpty {
                Section("Transfers") {
                    ForEach(model.transfers) { TransferRow(transfer: $0) }
                    Button("Clear Finished") { model.clearFinishedTransfers() }
                        .buttonStyle(.link)
                }
            }
        }
    }
}

struct TransferRow: View {
    let transfer: AppModel.Transfer

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(transfer.name, systemImage: transfer.direction == .download ? "arrow.down.circle" : "arrow.up.circle")
                .lineLimit(1)
                .truncationMode(.middle)
            if let error = transfer.error {
                Text(error).font(.caption).foregroundStyle(.red).lineLimit(2)
            } else {
                ProgressView(value: transfer.fraction)
                    .progressViewStyle(.linear)
                    .controlSize(.small)
            }
        }
    }
}

struct Browser: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        @Bindable var ui = model.browser
        Table(model.sortedEntries, selection: $model.selection, sortOrder: $model.sortOrder) {
            TableColumn("Name", value: \.name, comparator: .localizedStandard) { object in
                Label {
                    Text(object.name)
                } icon: {
                    Image(nsImage: icon(for: object))
                        .resizable()
                        .frame(width: 16, height: 16)
                }
            }
            TableColumn("Size", sortUsing: KeyPathComparator(\MTPObject.size)) { object in
                Text(sizeLabel(for: object))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .width(min: 70, ideal: 90, max: 120)
            TableColumn("Date Modified", sortUsing: KeyPathComparator(\MTPObject.modified)) { object in
                Text(object.modified?.formatted(date: .abbreviated, time: .shortened) ?? "--")
                    .foregroundStyle(.secondary)
            }
            .width(min: 120, ideal: 160)
        }
        .contextMenu(forSelectionType: MTPObject.ID.self) { ids in
            if !ids.isEmpty {
                Button("Download…") { model.downloadSelection(ids) }
                if ids.count == 1, let object = model.entries.first(where: { ids.contains($0.id) }) {
                    Button("Rename…") { ui.renaming = object; ui.renameText = object.name }
                }
                Divider()
                Button("Delete from Phone…", role: .destructive) { model.requestDeletion(ids) }
            }
        } primaryAction: { ids in
            if ids.count == 1, let object = model.entries.first(where: { ids.contains($0.id) }) {
                if object.isDirectory { model.open(object) } else { model.downloadSelection(ids) }
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            model.upload(urls)
        } isTargeted: { ui.isDropTargeted = $0 }
        .overlay {
            if ui.isDropTargeted {
                RoundedRectangle(cornerRadius: 8).stroke(Color.accentColor, lineWidth: 3).padding(4)
            } else if model.entries.isEmpty, !model.isLoading {
                ContentUnavailableView("Empty folder", systemImage: "folder", description: Text("Drop files here to copy them to the phone."))
            }
        }
        .navigationTitle(model.path.last?.name ?? model.storages.first { $0.id == model.selectedStorage }?.displayName ?? "OpenMTP")
        .navigationSubtitle(model.isLoading ? "Loading…" : "\(model.entries.count) items")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { model.goUp() } label: { Label("Enclosing Folder", systemImage: "chevron.left") }
                    .disabled(model.path.isEmpty)
                    .keyboardShortcut(.upArrow, modifiers: .command)
            }
            ToolbarItem(placement: .navigation) {
                PathMenu()
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button { ui.showingNewFolder = true } label: { Label("New Folder", systemImage: "folder.badge.plus") }
                Button { model.chooseFilesToUpload() } label: { Label("Upload", systemImage: "square.and.arrow.up") }
                Button { model.downloadSelection() } label: { Label("Download", systemImage: "square.and.arrow.down") }
                    .disabled(model.selection.isEmpty)
                Button { Task { await model.reload(refresh: true) } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
            }
        }
        .alert("New Folder", isPresented: $ui.showingNewFolder) {
            TextField("Name", text: $ui.newFolderName)
            Button("Create") { model.makeFolder(named: ui.newFolderName); ui.newFolderName = "" }
            Button("Cancel", role: .cancel) { ui.newFolderName = "" }
        }
        .alert("Rename", isPresented: Binding(get: { ui.renaming != nil }, set: { if !$0 { ui.renaming = nil } })) {
            TextField("Name", text: $ui.renameText)
            Button("Rename") { if let target = ui.renaming { model.rename(target, to: ui.renameText) } }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func icon(for object: MTPObject) -> NSImage {
        if object.isDirectory { return NSWorkspace.shared.icon(for: .folder) }
        let ext = (object.name as NSString).pathExtension
        return NSWorkspace.shared.icon(for: UTType(filenameExtension: ext) ?? .data)
    }

    private func sizeLabel(for object: MTPObject) -> String {
        if object.isDirectory { return "--" }
        guard let size = object.size else { return "Unknown" }
        return ByteCountFormatter.string(fromByteCount: Int64(clamping: size), countStyle: .file)
    }
}

/// Breadcrumb as a pop-up, like Finder's title-bar path menu.
struct PathMenu: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Menu {
            Button("Storage Root") { model.goUp(to: 0) }
            ForEach(Array(model.path.enumerated()), id: \.offset) { index, folder in
                Button(folder.name) { model.goUp(to: index + 1) }
            }
        } label: {
            Label("Path", systemImage: "folder")
        }
        .disabled(model.path.isEmpty)
    }
}
