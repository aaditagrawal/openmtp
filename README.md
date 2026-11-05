# OpenMTP

A native macOS app for transferring files between a Mac and an MTP device. SwiftUI replaces the Electron interface; Swift and IOUSBHost replace the Go/libusb bridge. This is the user-owned [aaditagrawal/openmtp](https://github.com/aaditagrawal/openmtp) fork of Ganesh Rathinavel's OpenMTP.

Browse Mac and phone folders side by side, copy complete folder trees, manage a transfer queue, and resolve conflicts with skip, replace, keep both or Smart Sync. Finder file promises, Quick Look, native menus and saved preferences are included. On macOS 26 and later, controls use Liquid Glass with accessibility fallbacks.

The app targets macOS 13 and later. Building requires macOS SDK 26 or later and Swift 6.2 or later. CI builds Apple Silicon and Intel separately. Real-phone compatibility, older macOS runtime behavior and signed update installation still need the validation recorded in [macos/VALIDATION.md](macos/VALIDATION.md).

## Build and run

Install Xcode 26 or later, or its Command Line Tools, then:

```sh
git clone https://github.com/aaditagrawal/openmtp.git
cd openmtp
make test
make run
```

`make build` creates `macos/build/OpenMTP.app`, including the `mtpctl` diagnostic CLI. `make package` creates an ad-hoc signed ZIP and DMG under `dist/`. No Node, Bun, Electron, Go or libusb installation is required.

Use a private profile and starting folder for development:

```sh
OPENMTP_PROFILE_DIR=/tmp/openmtp-profile OPENMTP_LOCAL_ROOT=/tmp/openmtp-files make run
```

Unlock the phone and select USB file transfer mode. Another MTP client, Image Capture, Photos or vendor software may hold the USB interface. OpenMTP reports its owner when the system provides that information.

## Using the app

Choose a device and storage in the sidebar. Each pane has its own navigation, selection, filter and list/grid preference. Copy with Cmd+C, focus the destination pane, and paste with Cmd+V, or use Copy to Phone / Copy to Mac. Cmd+Shift+C appends to the captured copy selection. Transfers run sequentially for a device so MTP transactions remain ordered.

Smart Sync copies new or changed files and skips matching files using known sizes and modification dates at the device's timestamp precision. Removing destination extras requires a separate confirmation. Local removals go to Trash; phone removals are permanent.

| Action | Shortcut |
| --- | --- |
| Copy / paste | Cmd+C / Cmd+V |
| Append to copy selection | Cmd+Shift+C |
| New folder | Cmd+Shift+N |
| Open / rename | Cmd+O / Return |
| Quick Look | Space or Cmd+Y |
| Move to Trash / confirm phone deletion | Cmd+Delete |
| Icon / list view | Cmd+1 / Cmd+2 |
| Show hidden files | Cmd+Shift+. |
| Back / forward | Cmd+[ / Cmd+] |
| Parent folder / refresh | Cmd+Up / Cmd+R |
| Focus Mac / phone pane | Cmd+Option+Left / Cmd+Option+Right |

## Development and releases

- [Native architecture, protocol and performance notes](macos/README.md)
- [Feature comparison with the previous app](macos/PARITY.md)
- [Build, test and hardware evidence](macos/VALIDATION.md)
- [Signing, notarization and native updates](macos/RELEASING.md)
- [Contributing](CONTRIBUTING.md)

Electron source and its toolchain are preserved in Git history at [`6eb3e7b`](https://github.com/aaditagrawal/openmtp/tree/6eb3e7b). The current repository ships the native app. Downloads and update checks use [this fork's releases](https://github.com/aaditagrawal/openmtp/releases); the upstream website and Homebrew cask distribute the upstream app.

## Credits and license

OpenMTP was created by [Ganesh Rathinavel](https://github.com/ganeshrvel) and is distributed under the [MIT license](LICENSE). The app logo is by [Shubhendu Mitra](https://www.behance.net/soponhara). [NOTICE](macos/NOTICE) records native source provenance and historical protocol references. Sparkle's license is included with the app.
