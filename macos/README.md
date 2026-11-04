# OpenMTP Native (exploration)

A Swift reimplementation of OpenMTP's MTP stack plus a SwiftUI shell, imported from
the existing native prototype. It explores replacing the current Electron + Koffi +
Go (`kalam.dylib`) + go-mtpfs + libusb chain with a Swift package using IOUSBHost.
The Electron app remains the main application. This is a draft, not a production replacement.
See [NOTICE](NOTICE) for provenance and the retained MIT attribution.

| Target | What it is |
| --- | --- |
| `MTPCore` | Pure-Swift MTP: containers, datasets, transaction engine, file operations, async client. No USB or AppKit imports. |
| `MTPUSB` | IOUSBHost transport, interface discovery, hot-plug notifications. |
| `mtpctl` | CLI for driving a real phone and benchmarking. |
| `OpenMTPMac` | SwiftUI app: device/storage sidebar, sortable table, drag-in upload, transfers, rename/delete/new folder. |
| `MTPCoreTests`, `OpenMTPMacTests` | Protocol, transfer-commit and native file-action tests using a simulated Android device. |

## Build and test (Command Line Tools are enough)

```sh
scripts/swift-test.sh          # protocol and native model tests, no phone required
swift build --product mtpctl
scripts/bundle-app.sh          # build/OpenMTP Native.app, ad-hoc signed
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
3. **Configurable bulk buffers.** The vendored go-mtpfs source uses
   `rwBufSize = 0x4000`, or 16 KiB. The test
   `largerBuffersReduceSimulatedBulkReadCalls` runs the **Swift engine twice**, at
   16 KiB and 1 MiB. It counts calls to the simulated transport's `bulkRead`,
   including the data phase and response. These are host request counts, not USB
   packet counts. The test does not execute Go, compare Go/Swift performance, or
   measure hardware speed. `mtpctl bench-pull` also compares Swift buffer sizes only;
   hardware throughput and a controlled Go baseline remain unmeasured.
4. **Conflict diagnosis by process-name polling.** `app/utils/usbConflictApps.js` guesses
   from running process names. The IOUSBHost transport reads the interface's
   `UsbExclusiveOwner` registry property, which names the process that holds the phone
   (for example `ptpcamerad`). It can also ask that owner to release the phone
   (`--seize`, the app's "Ask the Other App to Release It").

The engine covers the protocol cases that bit go-mtpfs: split headers (MTP 1.1 Appendix
H), zero-length packets on packet boundaries, the Linux-xHCI case of a response arriving
where a zero-length packet should be, `0xFFFFFFFF` lengths for objects of 4 GiB or more,
stale sessions left by a crashed host, and Android's zone-less local timestamps (the
fork's +05:30 fix). These cases are simulated, not hardware certification.

## File actions and transfer safety

Downloads use an exclusive, unique hidden `.openmtp-*` temporary file beside the
destination. Before an atomic rename, the engine checks every known metadata size,
including zero and 64-bit sizes, then syncs and closes the file. Missing sizes are
explicitly `nil`, never a fabricated zero or `0xFFFFFFFF` byte count. Unknown-length
transport containers remain supported independently of metadata size. Without a
metadata size the engine can check transport completion, but cannot detect a device
that ends an unknown-length transfer early while reporting success.

Failures leave the existing destination intact and remove only this transfer's
temporary file, including when the final rename fails. Successful downloads replace
an existing file atomically. If independent downloads target the same path, the last
successful commit wins. This does not promise recovery across a power loss, and
there is no overwrite confirmation yet.

Cmd+Delete and **Delete from Phone…** open a named confirmation that explains permanent
deletion, including folder contents. Bare Delete has no destructive binding. Confirmation
uses captured items and cancels if the phone, storage or folder changed. Context-menu
actions use the clicked context, even when it differs from the current selection.

Uploads accept local regular files only. The app validates the entire selection's
actual filesystem types before starting work. Folders, symbolic links and mixed
file/folder selections are rejected with an explanation and no queued uploads.
Individual uploads recheck the type. This is not a transactional batch: if a file
changes or disappears after preflight, earlier valid uploads may already have finished.
Date Modified sorts by the underlying date in either direction; missing dates sort
first ascending and last descending, with folders still grouped first.

## Not verified yet

No MTP/PTP interface was attached during validation. The protocol and selected native
model behaviors have simulated tests; they do not cover every UI or protocol path.
The IOUSBHost transport compiles, and discovery reports no interfaces, but it has
**not** been run against a real phone. See [VALIDATION.md](VALIDATION.md) for the
scoped build/test evidence and remaining visual checks.
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
No pause/resume controls are implemented. The design HTML in `Design/` is an imported
concept reference, not a screenshot or evidence of the current SwiftUI app. The new
confirmation, drag/drop feedback and column-header interactions still need visual
and keyboard testing in the built app. Minimum-macOS compatibility, Intel builds,
hardware transfer integrity and signing/notarization for distribution remain unverified.
