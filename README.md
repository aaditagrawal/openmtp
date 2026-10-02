# OpenMTP

Android file transfers over USB for macOS. This is [aaditagrawal/openmtp](https://github.com/aaditagrawal/openmtp), a maintained fork of [Ganesh Rathinavel's OpenMTP](https://github.com/ganeshrvel/openmtp).

The app keeps the upstream split-pane file manager, Kalam MTP backend, Legacy mode, internal storage and SD card access, drag and drop, keyboard navigation, and large-file transfers.

## How this fork has evolved

- A revised interface with selectable file transfers, file checkboxes, a transfer queue, list and grid views, light and dark themes, and configurable pane order.
- Smart Sync skips matching files. Large directories use windowed rendering and bounded asynchronous filesystem reads. Sorting computes filename keys once per entry, and keyboard selection uses linear scans.
- Electron 44, React 19, MUI 9, Babel 8, Koffi 3, the `usb` 3 library, and Bun. The Apple Silicon native build uses Go 1.27 and libusb 1.0.30 with a macOS 13 deployment target.
- Atomic settings writes, recovery from missing or corrupt profiles, serialized native calls, and explicit native-session cleanup.
- Shared window creation, renderer build rules, transfer dispatch, and native response encoding replace duplicated implementations. Unused Sass helpers, reducer injection, and the unused FUSE frontend are removed.
- Updates and releases point to this fork. Local diagnostics and hardware checks are available without adding them to CI.

The current runtime requires **macOS 13 or newer**. Apple Silicon is the actively tested build. Historical Intel binaries remain in the repository, but the current host native build and physical-device verification cover ARM64.

## Upstream changes

Upstream released [3.3.0](https://github.com/ganeshrvel/openmtp/releases/tag/v3.3.0) after this fork diverged. Its [macOS 27 ARM64 compatibility change](https://github.com/ganeshrvel/openmtp/pull/481) uses an additional native binary variant. This fork builds with a newer Go linker and validates the Mach-O chained-fixup segment counts directly, so it does not need that extra variant.

The [progress-bar update fix](https://github.com/ganeshrvel/openmtp/pull/434) is adapted to the current MUI component: transfer progress updates without an interpolated CSS transition. Upstream changes are reviewed individually to preserve this fork's UI, transfer behavior, native lifetime fixes, and release configuration.

## Install or build

Use artifacts from [this fork's releases](https://github.com/aaditagrawal/openmtp/releases), when available. The upstream website and Homebrew cask distribute the upstream app.

For development, install Git, Node.js 26.9.0 and Bun 1.4.2. Runtime pins are checked in as `.nvmrc` and `.bun-version`.

```sh
git clone https://github.com/aaditagrawal/openmtp.git
cd openmtp
bun install --frozen-lockfile
bun run dev
```

Development creates missing profile files automatically. If Electron was incompletely installed, run `bun run ensure-electron`. DevTools extension downloads are optional through `OPENMTP_INSTALL_DEVTOOLS=1`.

```sh
bun run build          # lint and production bundles
bun run start          # build and launch the production app
bun run package-mac   # build and package locally
bun run build-docs     # build the website
```

Local packaging signs only when signing credentials are configured. The native host build creates ad-hoc signed binaries; it does not notarize them. See [native build instructions](ffi/kalam/native/README.md) for rebuilding Kalam and libusb.

## Tests and diagnostics

The existing unit suite remains the CI baseline:

```sh
bun run test
```

Additional regression tests, benchmarks, startup checks, and device checks are **manual only**. Their entry points refuse to run when `CI` is set. The manual runner isolates suites so Electron and native-module mocks cannot leak between them.

```sh
bun run test:manual
bun run test:startup   # real Electron, fresh/existing/corrupt profiles
bun run benchmark

go -C ffi/kalam/native test -race -tags openmtp_manual ./...
```

Build before running the Electron startup checks. For transfer tests, close other MTP clients and follow the [physical-device test instructions](ffi/kalam/native/README.md). Those checks create unique disposable directories, compare SHA-256 hashes, and remove only their own fixtures. They are never part of CI.

```sh
OPENMTP_TRACE=1 OPENMTP_RENDERER_DIAGNOSTICS=1 bun run dev
```

`OPENMTP_TRACE_FILE` chooses a JSONL diagnostics file. `OPENMTP_PROFILE_DIR` isolates settings for test runs. `OPENMTP_REDUX_LOGS=1` enables verbose Redux logging. Native protocol logging is opt-in through `OPENMTP_NATIVE_DEBUG=1` and can include device identifiers and filenames.

## Code layout

| Path                                    | Purpose                                                     |
| --------------------------------------- | ----------------------------------------------------------- |
| `app/containers`, `app/components`      | Screens, file explorer, dialogs and shared UI               |
| `app/data/file-explorer`                | Local, Kalam and Legacy operations behind one controller    |
| `app/store`, `app/helpers`, `app/utils` | State, windows, filesystem and selection logic              |
| `ffi/kalam/src`                         | Serialized JavaScript-to-native calls                       |
| `ffi/kalam/native`                      | Go backend and attributed MTP source patches                |
| `build/mac/bin`                         | Packaged native binaries                                    |
| `webpack`, `internals`                  | Development, bundling and packaging                         |
| `shared`                                | Privacy policy markup shared by the desktop app and website |
| `docs-sources`, `docs`                  | Website sources and published website                       |
| `tests/manual`, `scripts`               | Opt-in regression, startup and device checks                |

## Common shortcuts

| Action                  | Shortcut           |
| ----------------------- | ------------------ |
| Copy / paste            | ⌘C / ⌘V            |
| Add to transfer queue   | ⌘⇧C                |
| Select all              | ⌘A                 |
| Select individual items | ⌘-click            |
| Select a range          | ⇧-click or ⇧-arrow |
| New folder / rename     | ⌘N / ⌘D            |
| Delete                  | Backspace          |
| Open / parent folder    | Enter / ⌘B         |
| Refresh / switch pane   | ⌘R / ⌘1            |

## Troubleshooting

Unlock the Android device, choose USB file transfer mode, and close other apps using MTP. Check the cable and USB port if storage does not appear. Samsung Smart Switch and other device clients can hold the connection. Kalam and Legacy mode remain available in settings.

Report fork-specific issues in [this repository](https://github.com/aaditagrawal/openmtp/issues), with macOS version, device model, transfer mode, and relevant logs.

## Credits and license

OpenMTP was created by [Ganesh Rathinavel](https://github.com/ganeshrvel) and is distributed under the [MIT license](LICENSE). Copyright © 2018-present Ganesh Rathinavel. The Kalam kernel uses [go-mtpx](https://github.com/ganeshrvel/go-mtpx). Its name honors Dr. A. P. J. Abdul Kalam.

Thanks to the upstream contributors and testers, CodeMagic and Kevin Suhajda for historical build infrastructure, Cody Jung for Fujifilm and Garmin support, and Ayushi Bothra for documentation. The app grew from [Electron React Redux Advanced Boilerplate](https://github.com/ganeshrvel/electron-react-redux-advanced-boilerplate) and [Electron React Boilerplate](https://github.com/electron-react-boilerplate/electron-react-boilerplate).

The app logo is by [Shubhendu Mitra](https://www.behance.net/soponhara). Legacy MTP uses Vladimir Menshakov's [android-file-transfer-linux](https://github.com/whoozle/android-file-transfer-linux). Original icons by [Flaticon](https://www.flaticon.com), [Good Ware](https://www.flaticon.com/authors/good-ware), and [Kiranshastry](https://www.flaticon.com/authors/kiranshastry) are licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The fallback image icon is by [Phonlaphat Thongsriphong](https://www.iconfinder.com/phatpc).
