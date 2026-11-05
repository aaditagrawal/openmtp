import AppKit
import MTPCore
import SwiftUI
import UniformTypeIdentifiers

@MainActor
struct WorkspaceView: View {
  @EnvironmentObject private var model: AppModel
  @EnvironmentObject private var settings: WorkspaceSettings

  private var activeSearch: Binding<String> {
    model.activePane == .local ? $model.localSearch : $model.phoneSearch
  }

  var body: some View {
    NavigationSplitView {
      WorkspaceSidebar()
        .navigationSplitViewColumnWidth(min: 160, ideal: 200, max: 260)
    } detail: {
      VStack(spacing: 0) {
        HSplitView {
          if settings.showLocalPane && settings.localPaneOnLeft {
            FileBrowserPane(pane: .local).frame(minWidth: 230)
          }
          FileBrowserPane(pane: .phone).frame(minWidth: 250)
          if settings.showLocalPane && !settings.localPaneOnLeft {
            FileBrowserPane(pane: .local).frame(minWidth: 230)
          }
        }
        if settings.showTransfers {
          TransferQueueView()
            .frame(height: model.transfers.isEmpty ? 44 : 180)
            .padding(12)
        }
      }
      .navigationTitle("OpenMTP")
      .searchable(
        text: activeSearch,
        prompt: model.activePane == .local ? "Filter Mac folder" : "Filter phone folder"
      )
      .toolbar {
        ToolbarItemGroup(placement: .navigation) {
          Button {
            model.goBack()
          } label: {
            Image(systemName: "chevron.left")
          }
          .disabled(!model.canGoBack).help("Back")
          Button {
            model.goForward()
          } label: {
            Image(systemName: "chevron.right")
          }
          .disabled(!model.canGoForward).help("Forward")
        }
        if #available(macOS 26, *) {
          ToolbarSpacer(.fixed)
        }
        ToolbarItemGroup {
          Button {
            model.goUpActive()
          } label: {
            Label("Enclosing Folder", systemImage: "arrow.up")
          }.disabled(!model.canGoUp).help("Enclosing Folder")
          Button {
            model.beginNewFolder()
          } label: {
            Label("New Folder", systemImage: "folder.badge.plus")
          }.disabled(model.activePane == .phone && model.connection != .connected)
          Button {
            model.reloadActive()
          } label: {
            Label("Refresh", systemImage: "arrow.clockwise")
          }
        }
        if #available(macOS 26, *) {
          ToolbarSpacer(.fixed)
        }
        ToolbarItem {
          Button {
            model.copyToOtherPane()
          } label: {
            Label(
              model.activePane == .local ? "Copy to Phone" : "Copy to Mac",
              systemImage: "arrow.left.arrow.right")
          }
          .disabled(model.activeSelectionCount == 0 || model.connection != .connected)
          .help(
            model.activePane == .local
              ? "Copy selected files to phone" : "Copy selected files to Mac")
        }
        if #available(macOS 26, *) {
          ToolbarSpacer(.fixed)
        }
        ToolbarItem {
          Menu {
            Toggle("Show Mac Pane", isOn: $settings.showLocalPane)
            Toggle("Mac Pane on Left", isOn: $settings.localPaneOnLeft)
            Toggle("Show Transfers", isOn: $settings.showTransfers)
            Divider()
            Button("Choose Mac Folder…") { model.chooseLocalFolder() }
          } label: {
            Label("Workspace", systemImage: "rectangle.split.2x1")
          }
        }
      }
    }
    .disabled(model.isTerminating)
    .background(WorkspaceKeyboardBridge(model: model).frame(width: 0, height: 0))
    .modifier(WorkspaceDialogs(model: model, browser: model.browser))
    .preferredColorScheme(settings.appearance.colorScheme)
  }
}

@MainActor
private struct WorkspaceSidebar: View {
  @EnvironmentObject private var model: AppModel
  @EnvironmentObject private var settings: WorkspaceSettings
  private var locations: [(String, String, URL)] {
    let home = FileManager.default.homeDirectoryForCurrentUser
    return [
      ("Home", "house", home),
      ("Desktop", "desktopcomputer", home.appendingPathComponent("Desktop")),
      ("Documents", "doc", home.appendingPathComponent("Documents")),
      ("Downloads", "arrow.down.circle", home.appendingPathComponent("Downloads")),
    ]
  }
  var body: some View {
    List(
      selection: Binding<String?>(
        get: {
          model.activePane == .local && settings.showLocalPane ? model.localDirectory.path : nil
        },
        set: { path in
          guard let path else { return }
          settings.showLocalPane = true
          model.activePane = .local
          model.navigateLocal(to: URL(fileURLWithPath: path, isDirectory: true))
        }
      )
    ) {
      Section("Favorites") {
        ForEach(locations, id: \.0) { name, icon, url in
          Label(name, systemImage: icon).tag(url.path)
        }
        Button {
          model.chooseLocalFolder()
        } label: {
          Label("Choose Folder…", systemImage: "folder")
        }.buttonStyle(.plain)
      }
      if !settings.favorites.isEmpty {
        Section("Folders") {
          ForEach(settings.favorites, id: \.self) { path in
            Label(URL(fileURLWithPath: path).lastPathComponent, systemImage: "folder")
              .tag(path).help(path)
              .contextMenu {
                Button("Remove Favorite") { settings.favorites.removeAll { $0 == path } }
              }
          }
        }
      }
      Section("Devices") {
        if model.candidates.isEmpty && model.connection != .connected {
          Label("No phone connected", systemImage: "iphone").foregroundStyle(.secondary)
        }
        ForEach(model.candidates) { device in
          Button {
            Task { await model.connect(device) }
          } label: {
            Label(device.displayName, systemImage: "iphone")
          }.buttonStyle(.plain).disabled(isConnecting)
        }
      }
      if model.connection == .connected {
        Section(model.deviceName.isEmpty ? "Phone Storage" : model.deviceName) {
          ForEach(model.storages) { storage in
            Button {
              model.activePane = .phone
              model.selectedStorage = storage.id
            } label: {
              VStack(alignment: .leading, spacing: 5) {
                HStack {
                  Label(storage.displayName, systemImage: "internaldrive")
                  Spacer(minLength: 0)
                  if model.selectedStorage == storage.id {
                    Image(systemName: "checkmark").foregroundStyle(.tint)
                  }
                }
                if storage.maxCapacity > 0 {
                  ProgressView(
                    value: Double(
                      storage.maxCapacity - min(storage.freeSpaceInBytes, storage.maxCapacity)),
                    total: Double(storage.maxCapacity)
                  )
                  .tint(.secondary)
                  Text("\(bytes(storage.freeSpaceInBytes)) free of \(bytes(storage.maxCapacity))")
                    .font(.caption2).foregroundStyle(.secondary)
                }
                if storage.isReadOnly {
                  Text("Read only").font(.caption2).foregroundStyle(.secondary)
                }
              }.padding(.vertical, 3)
            }.buttonStyle(.plain)
          }
          Button("Disconnect") { Task { await model.disconnect() } }.buttonStyle(.plain)
        }
      }
    }
    .listStyle(.sidebar)
    .navigationTitle("Locations")
  }
  private var isConnecting: Bool { if case .connecting = model.connection { true } else { false } }
}

@MainActor
private struct FileBrowserPane: View {
  let pane: WorkspacePane
  @EnvironmentObject private var model: AppModel
  @EnvironmentObject private var settings: WorkspaceSettings
  @FocusState private var focusedPane: WorkspacePane?
  private var isLocal: Bool { pane == .local }
  private var title: String {
    isLocal ? "Mac" : (model.deviceName.isEmpty ? "Phone" : model.deviceName)
  }
  private var locationName: String {
    if isLocal {
      return model.localDirectory.lastPathComponent.isEmpty
        ? "Macintosh HD" : model.localDirectory.lastPathComponent
    }
    guard model.connection == .connected else { return "Not connected" }
    return model.path.last?.name ?? model.storages.first { $0.id == model.selectedStorage }?
      .displayName ?? "Phone"
  }
  private var count: Int { isLocal ? model.sortedLocalEntries.count : model.sortedEntries.count }
  private var selectionCount: Int { isLocal ? model.localSelection.count : model.selection.count }
  private var loading: Bool { isLocal ? model.localLoading : model.isLoading }
  private var search: Binding<String> { isLocal ? $model.localSearch : $model.phoneSearch }
  private var dropTarget: Binding<Bool> {
    Binding(
      get: { isLocal ? model.browser.isLocalDropTargeted : model.browser.isDropTargeted },
      set: {
        if isLocal {
          model.browser.isLocalDropTargeted = $0
        } else {
          model.browser.isDropTargeted = $0
        }
      })
  }
  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        Image(systemName: isLocal ? "laptopcomputer" : "iphone")
          .font(.title2).foregroundStyle(model.activePane == pane ? Color.accentColor : .secondary)
          .frame(width: 28)
        VStack(alignment: .leading, spacing: 2) {
          Text(title).font(.caption).foregroundStyle(.secondary)
          Text(locationName).font(.system(size: 15, weight: .semibold)).lineLimit(1)
        }
        Spacer(minLength: 5)
        if loading { ProgressView().controlSize(.small) }
        if !isLocal && model.preparingPreview {
          ProgressView().controlSize(.small)
          Button("Cancel Preview") { model.cancelPreview() }.buttonStyle(.borderless).font(.caption)
        }
        if isLocal {
          Button {
            model.toggleFavorite()
          } label: {
            Image(
              systemName: settings.favorites.contains(model.localDirectory.path)
                ? "star.fill" : "star")
          }
          .buttonStyle(.borderless).help("Favorite This Folder")
        } else if !model.selection.isEmpty {
          NativeRemoteDragHandle(files: model.selectedRemoteFiles).frame(width: 22, height: 22)
        }
        Menu {
          Picker(
            "View",
            selection: Binding(
              get: { settings.view(for: pane) }, set: { settings.setView($0, for: pane) })
          ) {
            Label("Icons", systemImage: "square.grid.2x2").tag(BrowserViewMode.grid)
            Label("List", systemImage: "list.bullet").tag(BrowserViewMode.list)
          }
          Picker(
            "Sort",
            selection: Binding(
              get: { isLocal ? settings.localSort : settings.phoneSort },
              set: {
                model.setSort(
                  $0, descending: isLocal ? settings.localDescending : settings.phoneDescending,
                  for: pane)
              })
          ) {
            Text("Name").tag(BrowserSortField.name)
            Text("Size").tag(BrowserSortField.size)
            Text("Modified").tag(BrowserSortField.modified)
          }
          Toggle(
            "Descending",
            isOn: Binding(
              get: { isLocal ? settings.localDescending : settings.phoneDescending },
              set: {
                model.setSort(
                  isLocal ? settings.localSort : settings.phoneSort, descending: $0, for: pane)
              }))
          Divider()
          Button(
            (isLocal ? settings.showHiddenLocal : settings.showHiddenPhone)
              ? "Hide Hidden Files" : "Show Hidden Files"
          ) { settings.toggleHidden(for: pane) }
        } label: {
          Image(systemName: settings.view(for: pane) == .list ? "list.bullet" : "square.grid.2x2")
        }
        .menuStyle(.borderlessButton).fixedSize()
      }
      .padding(.horizontal, 16).padding(.vertical, 14)
      .background(.bar)
      Divider()
      if !isLocal && model.connection != .connected {
        PhoneConnectionView()
      } else {
        ZStack {
          if settings.view(for: pane) == .list {
            table.focused($focusedPane, equals: pane)
          } else {
            grid.focusable().focused($focusedPane, equals: pane)
              .modifier(GridFocusAppearance())
          }
          if count == 0 && !loading {
            EmptyBrowserState(
              symbol: search.wrappedValue.isEmpty ? "folder" : "magnifyingglass",
              title: search.wrappedValue.isEmpty ? "This folder is empty" : "No matching items",
              message: search.wrappedValue.isEmpty
                ? "Drop files here or create a folder." : "Try another name or show hidden files."
            )
            .allowsHitTesting(false)
          }
          if dropTarget.wrappedValue {
            RoundedRectangle(cornerRadius: 8).strokeBorder(Color.accentColor, lineWidth: 3).padding(
              4
            ).allowsHitTesting(false)
          }
        }
        .onDrop(
          of: [UTType.fileURL.identifier, UTType.item.identifier, AppModel.remoteDragType],
          isTargeted: dropTarget
        ) { providers in model.receiveDrop(providers, into: pane) }
        Divider()
        pathBar
        if settings.showStatusBar {
          HStack(spacing: 8) {
            Text(selectionCount > 0 ? "\(selectionCount) of \(count) selected" : "\(count) items")
            if !search.wrappedValue.isEmpty {
              Text("Filtered").foregroundStyle(.secondary)
              Button("Clear") { search.wrappedValue = "" }.buttonStyle(.borderless)
            }
            Spacer(minLength: 0)
            if model.dropInProgress { Text("Receiving dropped files…") }
          }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 16).padding(.bottom, 10)
        }
      }
    }
    .simultaneousGesture(TapGesture().onEnded { model.activePane = pane })
    .onChange(of: focusedPane) { value in if value == pane { model.activePane = pane } }
    .onChange(of: model.activePane) { value in if value == pane { focusedPane = pane } }
    .accessibilityElement(children: .contain).accessibilityLabel("\(title) file browser")
  }
  private var pathBar: some View {
    HStack(spacing: 5) {
      if isLocal {
        Button {
          model.chooseLocalFolder()
        } label: {
          Image(systemName: "folder")
        }.buttonStyle(.plain).help("Choose Mac Folder")
        Text(model.localDirectory.path).lineLimit(1).truncationMode(.head).help(
          model.localDirectory.path)
      } else {
        Button {
          model.goUp(to: 0)
        } label: {
          Image(systemName: "internaldrive")
        }.buttonStyle(.plain).help("Storage Root")
        Text(model.phoneLocation).lineLimit(1).truncationMode(.head).help(model.phoneLocation)
      }
      Spacer(minLength: 0)
    }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 16).padding(.vertical, 10)
  }
  @ViewBuilder private var table: some View {
    if isLocal {
      Table(
        model.sortedLocalEntries, selection: $model.localSelection, sortOrder: $model.localSortOrder
      ) {
        TableColumn("Name", value: \.name) { item in
          HStack(spacing: 7) {
            Image(nsImage: NativeFileIntegration.shared.icon(localURL: item.url)).resizable().frame(
              width: 18, height: 18)
            Text(item.name).lineLimit(1)
          }
          .contentShape(Rectangle()).onTapGesture(count: 2) { model.openLocal(item) }
          .onDrag { NSItemProvider(contentsOf: item.url) ?? NSItemProvider() }
        }.width(min: 110, ideal: 220)
        TableColumn("Size", value: \.sortSize) { item in
          Text(item.isDirectory ? "—" : item.size.map(bytes) ?? "—").monospacedDigit()
            .foregroundStyle(.secondary)
        }.width(min: 65, ideal: 80, max: 105)
        TableColumn("Modified", value: \.sortModified) { item in
          Text(item.modified.map { $0.formatted(date: .numeric, time: .shortened) } ?? "—")
            .foregroundStyle(.secondary)
        }.width(min: 95, ideal: 130, max: 175)
      }
      .contextMenu(forSelectionType: URL.self) { ids in
        contextActions(ids: ids.map(\.absoluteString))
      }
    } else {
      Table(model.sortedEntries, selection: $model.selection, sortOrder: $model.sortOrder) {
        TableColumn("Name", value: \.name) { item in
          HStack(spacing: 7) {
            Image(
              nsImage: NativeFileIntegration.shared.icon(
                name: item.name, isDirectory: item.isDirectory)
            ).resizable().frame(width: 18, height: 18)
            Text(item.name).lineLimit(1)
          }.contentShape(Rectangle()).onTapGesture(count: 2) { model.open(item) }.onDrag {
            model.remoteItemProvider(item)
          }
        }.width(min: 110, ideal: 220)
        TableColumn("Size", value: \.sortSize) { item in
          Text(item.isDirectory ? "—" : item.size.map(bytes) ?? "—").monospacedDigit()
            .foregroundStyle(.secondary)
        }.width(min: 65, ideal: 80, max: 105)
        TableColumn("Modified", value: \.sortModified) { item in
          Text(item.modified.map { $0.formatted(date: .numeric, time: .shortened) } ?? "—")
            .foregroundStyle(.secondary)
        }.width(min: 95, ideal: 130, max: 175)
      }
      .contextMenu(forSelectionType: UInt32.self) { ids in contextActions(ids: ids.map(String.init))
      }
    }
  }
  private var grid: some View {
    ScrollView {
      LazyVGrid(
        columns: [GridItem(.adaptive(minimum: 105, maximum: 145), spacing: 12)],
        alignment: .leading, spacing: 12
      ) {
        if isLocal {
          ForEach(model.sortedLocalEntries) { item in
            gridCell(
              name: item.name, image: NativeFileIntegration.shared.icon(localURL: item.url),
              selected: model.localSelection.contains(item.id)
            )
            .onTapGesture(count: 2) { model.openLocal(item) }
            .onTapGesture {
              model.selectGridItem(
                item.id.absoluteString, in: pane, modifiers: NSEvent.modifierFlags)
            }
            .onDrag { NSItemProvider(contentsOf: item.url) ?? NSItemProvider() }
            .contextMenu {
              contextActions(
                ids: model.contextSelectionIDs(clicked: item.id.absoluteString, in: pane))
            }
          }
        } else {
          ForEach(model.sortedEntries) { item in
            gridCell(
              name: item.name,
              image: NativeFileIntegration.shared.icon(
                name: item.name, isDirectory: item.isDirectory),
              selected: model.selection.contains(item.id)
            )
            .onTapGesture(count: 2) { model.open(item) }
            .onTapGesture {
              model.selectGridItem(String(item.id), in: pane, modifiers: NSEvent.modifierFlags)
            }
            .onDrag { model.remoteItemProvider(item) }
            .contextMenu {
              contextActions(ids: model.contextSelectionIDs(clicked: String(item.id), in: pane))
            }
          }
        }
      }.padding(12)
    }
  }
  private func gridCell(name: String, image: NSImage, selected: Bool) -> some View {
    VStack(spacing: 7) {
      Image(nsImage: image).resizable().scaledToFit().frame(width: 48, height: 48)
      Text(name).font(.system(size: 12)).lineLimit(2).multilineTextAlignment(.center).frame(
        height: 32, alignment: .top)
    }.frame(maxWidth: .infinity).padding(8)
      .background(
        selected ? Color.accentColor.opacity(0.18) : .clear, in: RoundedRectangle(cornerRadius: 7)
      )
      .contentShape(Rectangle()).accessibilityLabel(name).accessibilityAddTraits(
        selected ? [.isSelected] : [])
  }
  @ViewBuilder private func contextActions(ids: [String]) -> some View {
    if !ids.isEmpty {
      Button("Open") {
        guard applyContext(ids) else { return }
        model.openSelection()
      }
      Button("Quick Look") {
        guard applyContext(ids) else { return }
        model.previewSelection()
      }
      Button("Copy") {
        guard applyContext(ids) else { return }
        model.copySelection()
      }
      Button(isLocal ? "Copy to Phone" : "Copy to Mac") {
        guard applyContext(ids) else { return }
        model.copyToOtherPane()
      }.disabled(model.connection != .connected)
      if ids.count == 1 {
        Button("Rename…") {
          guard applyContext(ids) else { return }
          model.beginRename()
        }
      }
      if isLocal {
        Button("Show in Finder") {
          if let first = ids.first, let url = URL(string: first) {
            NativeFileIntegration.shared.reveal(url)
          }
        }
      }
      Divider()
      Button(isLocal ? "Move to Trash" : "Delete from Phone…", role: .destructive) {
        guard applyContext(ids) else { return }
        model.requestActiveDeletion()
      }
    }
    Button("New Folder…") {
      model.activePane = pane
      model.beginNewFolder()
    }
  }
  private func applyContext(_ ids: [String]) -> Bool {
    model.applyContextSelection(ids, in: pane)
  }
}

@MainActor
private struct PhoneConnectionView: View {
  @EnvironmentObject private var model: AppModel
  var body: some View {
    VStack(spacing: 15) {
      Spacer()
      switch model.connection {
      case .noDevice:
        EmptyBrowserState(
          symbol: "iphone", title: "Connect your phone",
          message:
            "Use a USB cable, unlock your phone, then choose File transfer in its USB notification."
        )
        if !model.candidates.isEmpty {
          ForEach(model.candidates) { device in
            Button("Connect \(device.displayName)") { Task { await model.connect(device) } }
          }
        }
      case .connecting(let name):
        ProgressView()
        Text("Connecting to \(name)…").font(.headline)
        Text("Keep the phone unlocked.").foregroundStyle(.secondary)
      case .failed(let message, let canSeize):
        EmptyBrowserState(
          symbol: "exclamationmark.triangle",
          title: canSeize ? "Phone is in use" : "Couldn’t connect", message: message)
        HStack {
          Button("Try Again") { model.retry(seize: false) }
          if canSeize { Button("Take USB Connection…") { model.browser.showingSeize = true } }
        }
        Text("Close other phone transfer or photo apps before trying again.").font(.caption)
          .foregroundStyle(.secondary).multilineTextAlignment(.center)
      case .connected: EmptyView()
      }
      Spacer()
    }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct EmptyBrowserState: View {
  let symbol: String
  let title: String
  let message: String
  var body: some View {
    if #available(macOS 14, *) {
      ContentUnavailableView(title, systemImage: symbol, description: Text(message))
    } else {
      VStack(spacing: 10) {
        Image(systemName: symbol).font(.system(size: 34, weight: .light)).foregroundStyle(
          .secondary
        )
        .accessibilityHidden(true)
        Text(title).font(.headline)
        Text(message).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
          .frame(maxWidth: 310)
      }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

@MainActor
private struct WorkspaceDialogs: ViewModifier {
  @ObservedObject var model: AppModel
  @ObservedObject var browser: BrowserState
  func body(content: Content) -> some View {
    content
      .alert("New Folder", isPresented: $browser.showingNewFolder) {
        TextField("Folder name", text: $browser.newFolderName)
        Button("Cancel", role: .cancel) {
          browser.newFolderName = ""
          browser.folderContext = nil
        }
        Button("Create") { model.commitNewFolder() }
      } message: {
        Text("Create a folder in \(browser.folderContext?.location ?? "").")
      }
      .alert("Rename", isPresented: $browser.showingRename) {
        TextField("Name", text: $browser.renameText)
        Button("Cancel", role: .cancel) {}
        Button("Rename") { model.commitRename() }
      }
      .alert(
        model.pendingDeletion?.title ?? "Delete from Phone",
        isPresented: Binding(
          get: { model.pendingDeletion != nil }, set: { if !$0 { model.pendingDeletion = nil } }),
        presenting: model.pendingDeletion
      ) { request in
        Button("Cancel", role: .cancel) { model.pendingDeletion = nil }
        Button("Delete Permanently", role: .destructive) {
          Task { await model.confirmDeletion(request) }
        }
      } message: { request in
        Text(request.message)
      }
      .alert(
        "Couldn’t Complete the Action",
        isPresented: Binding(
          get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })
      ) {
        Button("OK") { model.errorMessage = nil }
      } message: {
        Text(model.errorMessage ?? "")
      }
      .alert("Take the USB connection?", isPresented: $browser.showingSeize) {
        Button("Cancel", role: .cancel) {}
        Button("Take Connection") { model.retry(seize: true) }
      } message: {
        Text("This may interrupt another app using the phone. Close that app first if possible.")
      }
      .sheet(
        isPresented: Binding(
          get: { model.pendingConflict != nil }, set: { if !$0 { model.resolveConflict(nil) } })
      ) {
        ConflictSheet(model: model, browser: browser)
      }
  }
}

@MainActor
private struct ConflictSheet: View {
  @ObservedObject var model: AppModel
  @ObservedObject var browser: BrowserState
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Choose how to copy").font(.title2).fontWeight(.semibold)
      if let conflict = model.pendingConflict {
        Text(conflict.route).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
        Text(
          "\(conflict.count) existing \(conflict.count == 1 ? "item" : "items") at the destination."
        )
        if !conflict.names.isEmpty {
          ScrollView {
            VStack(alignment: .leading, spacing: 5) {
              ForEach(conflict.names, id: \.self) {
                Text($0).font(.system(.callout, design: .monospaced))
              }
            }
          }.frame(maxHeight: 120)
        }
        Text(
          "Skip keeps existing items. Replace overwrites matching files. Keep Both creates new names. Smart Sync copies missing or newer files."
        ).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        if conflict.extrasCount > 0 {
          Toggle(
            "Remove \(conflict.extrasCount) destination-only files after Smart Sync",
            isOn: $browser.removeExtras)
          Text(
            conflict.destinationIsPhone
              ? "Phone files are deleted permanently. You’ll confirm before copying."
              : "Mac files are moved to Trash. You’ll confirm before copying."
          )
          .font(.caption).foregroundStyle(.secondary)
        }
      }
      GlassControlGroup {
        HStack {
          Button("Cancel", role: .cancel) { model.resolveConflict(nil) }.keyboardShortcut(
            .cancelAction)
          Spacer()
          Button("Skip") { model.resolveConflict(.skip) }
          Button("Replace") { model.resolveConflict(.replace) }
          Button("Keep Both") { model.resolveConflict(.keepBoth) }
          Button("Smart Sync") {
            if browser.removeExtras {
              browser.confirmExtras = true
            } else {
              model.resolveConflict(.smartSync)
            }
          }.keyboardShortcut(.defaultAction)
        }
      }
    }.padding(24).frame(width: 620)
      .interactiveDismissDisabled()
      .alert(
        model.pendingConflict?.destinationIsPhone == true
          ? "Permanently remove destination-only phone files?"
          : "Move destination-only Mac files to Trash?", isPresented: $browser.confirmExtras
      ) {
        Button("Cancel", role: .cancel) {}
        Button(
          model.pendingConflict?.destinationIsPhone == true
            ? "Copy, Then Delete Permanently" : "Copy, Then Move to Trash", role: .destructive
        ) { model.resolveConflict(.smartSync, removeExtras: true) }
      } message: {
        Text(
          "After Smart Sync succeeds, only the \(model.pendingConflict?.extrasCount ?? 0) destination-only files in this captured plan will be removed. Extra folders are kept.\n\n"
            + (model.pendingConflict?.extraNames.joined(separator: "\n") ?? ""))
      }
  }
}

private struct GlassControlGroup<Content: View>: View {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let content: () -> Content
  init(@ViewBuilder content: @escaping () -> Content) { self.content = content }
  var body: some View {
    if #available(macOS 26.0, *), !reduceTransparency {
      GlassEffectContainer(spacing: 12) {
        content().padding(10).glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14))
      }.transaction { if reduceMotion { $0.animation = nil } }
    } else {
      content().padding(10).background(
        Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
    }
  }
}

@MainActor
struct WorkspaceSettingsView: View {
  @ObservedObject var settings: WorkspaceSettings
  @ObservedObject private var updates = NativeUpdateService.shared
  var body: some View {
    TabView {
      Form {
        Picker("Appearance", selection: $settings.appearance) {
          Text("System").tag(WorkspaceAppearance.system)
          Text("Light").tag(WorkspaceAppearance.light)
          Text("Dark").tag(WorkspaceAppearance.dark)
        }
        Toggle("Connect when a phone is attached", isOn: $settings.autoConnect)
        Toggle("Show Mac pane", isOn: $settings.showLocalPane)
        Toggle("Mac pane on the left", isOn: $settings.localPaneOnLeft)
        Toggle("Show transfer queue", isOn: $settings.showTransfers)
        LabeledContent("Mac startup folder") {
          Text(settings.localPath).lineLimit(2).truncationMode(.head).textSelection(.enabled)
        }
        Text(
          "OpenMTP remembers the last Mac folder and view settings. Copies run in order on one device session."
        ).font(.caption).foregroundStyle(.secondary)
      }.formStyle(.grouped).tabItem { Label("General", systemImage: "gearshape") }
      Form {
        Toggle("Show directories first", isOn: $settings.directoriesFirst)
        Toggle("Show hidden Mac files", isOn: $settings.showHiddenLocal)
        Toggle("Show hidden phone files", isOn: $settings.showHiddenPhone)
        Toggle("Show browser status bars", isOn: $settings.showStatusBar)
        Picker("Mac view", selection: $settings.localView) {
          Text("List").tag(BrowserViewMode.list)
          Text("Icons").tag(BrowserViewMode.grid)
        }
        Picker("Phone view", selection: $settings.phoneView) {
          Text("List").tag(BrowserViewMode.list)
          Text("Icons").tag(BrowserViewMode.grid)
        }
        Text(
          "Local deletion uses the Trash. Phone deletion always asks for permanent deletion confirmation. Hidden files stay hidden until you choose to show them."
        ).font(.caption).foregroundStyle(.secondary)
      }.formStyle(.grouped).tabItem { Label("Files", systemImage: "folder") }
      Form {
        LabeledContent("Version") { Text(updates.currentVersion) }
        Toggle("Check for updates at launch", isOn: $settings.autoCheckUpdates)
        Toggle("Automatically install signed updates", isOn: $settings.autoInstallUpdates)
          .disabled(!updates.usesAutomaticInstaller)
        Toggle("Include beta releases", isOn: $settings.includePrereleases)
        Text(updates.statusMessage).textSelection(.enabled)
        HStack {
          Button("Check Now") {
            Task { await updates.check(includePrereleases: settings.includePrereleases) }
          }.disabled(!updates.canCheckForUpdates)
          if case .available = updates.state {
            Button("View Release") { updates.openRelease() }
            Button("Download Update") { updates.openDownload() }
          }
        }
        Text(
          updates.usesAutomaticInstaller
            ? "Signed updates are verified before installation. You can choose when to install an available update."
            : "This build opens the release download for manual installation. Automatic installation requires the signed release feed."
        ).font(.caption).foregroundStyle(.secondary)
      }.formStyle(.grouped).tabItem { Label("Updates", systemImage: "arrow.down.circle") }
    }.padding(12).frame(width: 560, height: 420)
      .preferredColorScheme(settings.appearance.colorScheme)
      .onChange(of: settings.autoCheckUpdates) { _ in configureUpdates() }
      .onChange(of: settings.autoInstallUpdates) { _ in configureUpdates() }
      .onChange(of: settings.includePrereleases) { _ in configureUpdates() }
  }
  private func configureUpdates() {
    updates.configureAutomaticUpdates(
      automaticallyChecks: settings.autoCheckUpdates,
      automaticallyInstalls: settings.autoInstallUpdates,
      includePrereleases: settings.includePrereleases)
  }
}

@MainActor
private struct WorkspaceKeyboardBridge: NSViewRepresentable {
  let model: AppModel
  func makeNSView(context: Context) -> KeyboardView {
    let view = KeyboardView()
    view.model = model
    return view
  }
  func updateNSView(_ view: KeyboardView, context: Context) { view.model = model }
  static func dismantleNSView(_ view: KeyboardView, coordinator: ()) { view.stop() }
  final class KeyboardView: NSView {
    weak var model: AppModel?
    private var monitor: Any?
    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      stop()
      guard window != nil else { return }
      monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
        guard let self, let model = self.model, self.window === NSApp.keyWindow,
          !(NSApp.keyWindow?.firstResponder is NSTextView),
          NSApp.keyWindow?.attachedSheet == nil,
          event.modifierFlags.intersection([.command, .control, .option]).isEmpty
        else { return event }
        switch event.keyCode {
        case 36:
          if model.activeSelectionCount == 1 {
            model.beginRename()
            return nil
          }
        case 49:
          if model.activeSelectionCount > 0 || NativeFileIntegration.shared.isPreviewVisible {
            model.previewSelection()
            return nil
          }
        case 53:
          if NativeFileIntegration.shared.isPreviewVisible || model.preparingPreview {
            model.cancelPreview()
            return nil
          }
        default: break
        }
        return event
      }
    }
    func stop() {
      if let monitor {
        NSEvent.removeMonitor(monitor)
        self.monitor = nil
      }
    }
  }
}

private func bytes(_ count: UInt64) -> String {
  ByteCountFormatter.string(fromByteCount: Int64(min(count, UInt64(Int64.max))), countStyle: .file)
}

extension LocalFile {
  var sortSize: UInt64 { size ?? 0 }
  var sortModified: Date { modified ?? .distantPast }
}
extension MTPObject {
  var sortSize: UInt64 { size ?? 0 }
  var sortModified: Date { modified ?? .distantPast }
}

private struct GridFocusAppearance: ViewModifier {
  func body(content: Content) -> some View {
    if #available(macOS 14, *) {
      content.focusEffectDisabled()
    } else {
      content
    }
  }
}
