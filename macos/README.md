# Native OpenMTP

The Swift package is the shipped application and protocol engine. See the root [README](../README.md) for user instructions and [PARITY.md](PARITY.md) for the previous app's behavior and remaining release checks.

| Target | Responsibility |
| --- | --- |
| MTPCore | MTP containers, datasets, transactions, metadata, streaming, transfer planning, conflict handling and Smart Sync. No USB or AppKit dependency. |
| MTPUSB | IOUSBHost bulk transport, interface discovery, ownership errors and hot-plug monitoring. |
| OpenMTPMac | SwiftUI workspace, AppKit file promises/Quick Look, persistent preferences and Sparkle updates. |
| mtpctl | Device diagnostics and controlled protocol benchmarks. |
| MTPSimulation | Fake MTP device used by protocol, transfer and parity tests. Never included in the app. |

From the repository root, `make test`, `make build`, `make package` and `make run` use the same scripts as CI. `make format` applies Swift's formatter; `make format-check` checks it. SwiftPM pins Sparkle 2.10.1 in Package.resolved and verifies its binary archive checksum. The bundled framework is the app's only third-party native runtime dependency.

## Protocol and transfer behavior

MTP transactions are serialized per connection on a dedicated queue. Browsing and copy work run off the main actor. Local and phone state remain independent; the UI does not create simultaneous transactions on the same device to simulate parallel transfers.

Capability-gated GetObjectPropList reduces directory metadata requests. In the simulated 1,000-file case it uses one metadata transaction instead of 1,001. The protocol engine caches scoped listings and navigates by object handle. A simulated buffer test compares the same Swift engine at 16 KiB and 1 MiB. These request counts do not establish real USB throughput or a speedup over the old app.

The transaction layer handles split headers, packet-boundary zero-length packets, response packets in place of a zero-length packet, unknown container lengths and 64-bit object sizes. Known object sizes include zero; an unknown size is nil. Android timestamps without a zone use the local timezone consistently.

TreeTransfer plans a complete immutable source/destination snapshot before writes. It handles recursive files and empty folders, rejects links and invalid path components, and revalidates identities before destructive commits. Downloads verify a private staged file before commit. Replacements use exclusive backup and commit moves, verify the displaced item, and preserve recovery copies on a concurrent change. The target can briefly be absent between these moves; the replacement is not a filesystem compare-and-swap. Upload replacements stage a new object before committing its name and removing the backup. Failure recovery paths identify any retained remote staging objects.

Cancellation checks run between protocol reads and writes. A failed or cancelled transaction can invalidate the session; reconnecting is required before retry. Retry starts the file again. An unknown-size object on a peer that also omits its terminating zero-length packet has no reliable payload boundary; it fails without committing the destination. Byte-offset pause/resume, network MTP transports and live MTP interrupt-event handling are not implemented. External device changes appear after refresh.

## Native interface

Native tables and lazy grids show file contents. Navigation and actions use standard SwiftUI/AppKit controls. Custom control groups use GlassEffectContainer and glassEffect on macOS 26 and later, with an opaque fallback for Reduce Transparency and suppressed custom animation for Reduce Motion. File contents remain on a readable system background.

The native preference file is separate from the previous settings.json. Compatible old settings import once, read-only. OPENMTP_PROFILE_DIR and OPENMTP_LOCAL_ROOT isolate test runs. Finder exports fulfill file promises on demand, and remote Quick Look downloads only the requested selection into a private cache.

Apple references: [Liquid Glass custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views), [macOS interface guidelines](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos), [file promises](https://developer.apple.com/documentation/appkit/nsfilepromiseproviderdelegate).

## Hardware diagnostics

Close competing MTP clients before opening a device. The CLI is bundled at `build/OpenMTP.app/Contents/MacOS/mtpctl`:

```sh
macos/build/OpenMTP.app/Contents/MacOS/mtpctl devices
macos/build/OpenMTP.app/Contents/MacOS/mtpctl info
macos/build/OpenMTP.app/Contents/MacOS/mtpctl bench-ls /DCIM/Camera
macos/build/OpenMTP.app/Contents/MacOS/mtpctl bench-pull '/DCIM/Camera/example.mp4'
```

Run diagnostics only against deliberately selected files. Compare elapsed times and byte hashes on representative hardware before claiming a transfer speed improvement. See [VALIDATION.md](VALIDATION.md).
