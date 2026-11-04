# OpenMTP Native (exploration)

A Swift reimplementation of OpenMTP's MTP stack plus a SwiftUI shell. It replaces the
current Electron + Koffi + Go (`kalam.dylib`) + go-mtpfs + libusb chain with one Swift
package: no runtime, no FFI, no bundled libusb.

| Target | What it is |
| --- | --- |
| `MTPCore` | Pure-Swift MTP: containers, datasets, transaction engine, file operations, async client. No USB or AppKit imports. |
| `MTPUSB` | IOUSBHost transport, interface discovery, hot-plug notifications. |
| `mtpctl` | CLI for driving a real phone and benchmarking. |
| `OpenMTPMac` | SwiftUI app: device/storage sidebar, sortable table, drag-in upload, transfers, rename/delete/new folder. |
| `MTPCoreTests` | swift-testing suite against a packet-accurate simulated Android device. |

## Build and test (Command Line Tools are enough)

```sh
scripts/swift-test.sh          # 22 tests / 37 cases
swift build --product mtpctl
scripts/bundle-app.sh          # build/OpenMTP Native.app, ad-hoc signed, ~1.1 MB
```

`scripts/swift-test.sh` adds the Testing framework and macro plugin paths that SwiftPM
misses when only Command Line Tools are installed. The app avoids `@State`, because on the
macOS 27 SDK it is a macro whose plugin ships only with Xcode. View state lives in
`@Observable` models instead.

## Where the time goes today, and what this changes

Read from `ffi/kalam/native/third_party/go-mtpfs/mtp/mtp.go` and go-mtpx `helpers.go`:

1. **Listing is N+1 round trips.** go-mtpx lists with `GetObjectHandles` and then one
   `GetObjectInfo` per child. `MTPDevice` uses one `GetObjectPropList` (depth 1) per
   directory when the device supports it, and falls back per directory otherwise. The test
   `propertyListUsesFarFewerRoundTrips` checks this: 1 versus 1,001 transactions for 1,000
   files.
2. **Path resolution walks siblings by name.** `GetObjectFromPath` issues a
   `GetObjectPropValue(filename)` for every sibling at every path level. `resolve` lists
   each directory once and caches it; the UI navigates by handle.
3. **16 KiB bulk transfers.** go-mtpfs reads and writes in `rwBufSize = 0x4000` chunks.
   The Swift engine streams 1 MiB transfers (configurable), so an 8 MiB file takes 9 USB
   requests instead of 513 (`largeTransfersUseFewerUSBRequests`). Wall-clock throughput
   still needs to be measured on hardware with `mtpctl bench-pull`.
4. **Conflict diagnosis by process-name polling.** `app/utils/usbConflictApps.js` guesses
   from running process names. The IOUSBHost transport reads the interface's
   `UsbExclusiveOwner` registry property, which names the process that holds the phone
   (for example `ptpcamerad`). It can also ask that owner to release the phone
   (`--seize`, the app's "Ask the Other App to Release It").

The engine covers the protocol cases that bit go-mtpfs: split headers (MTP 1.1 Appendix
H), zero-length packets on packet boundaries, the Linux-xHCI case of a response arriving
where a zero-length packet should be, `0xFFFFFFFF` lengths for objects of 4 GiB or more,
stale sessions left by a crashed host, and Android's zone-less local timestamps (the
fork's +05:30 fix). Downloads go to a hidden `.openmtp-partial` file and are renamed only
after the byte count matches and the file is synced.

## Not verified yet

No phone was attached to Quasar while this was written. Everything above `MTPUSB` is
covered by tests against the simulator. The IOUSBHost transport compiles, and discovery
runs correctly with no device present, but it has **not** been run against a real phone.
To validate, close the Electron OpenMTP and any Image Capture or Photos import, then:

```sh
.build/debug/mtpctl devices
.build/debug/mtpctl info
.build/debug/mtpctl bench-ls /DCIM/Camera        # objectInfo vs propertyList
.build/debug/mtpctl bench-pull /DCIM/Camera/<large video>
.build/debug/mtpctl pull /Download/<file> /tmp && shasum -a 256 /tmp/<file>
```

Known gaps: cancelling a transfer marks the session broken and the app reconnects, so
there is no in-place resume yet. There is no drag-out to Finder (needs
`NSFilePromiseProvider`), no recursive folder copy, and no MTP event (interrupt pipe)
handling, so changes made on the phone show up only on refresh.
