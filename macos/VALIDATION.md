# Native exploration validation

Observed on 2026-11-04. This draft adds only `macos/` to owned master
`6eb3e7b79727c7cef09844c72c35908caedfaa24`.

## Local checks on Darkstar

- `git diff --check` and `sh -n macos/scripts/*.sh` passed.
- All 19 files in the original source artifact matched the byte-for-byte import
  commit `a0ebc1f`. The original directory was not modified.
- Swift is not installed on this Linux host. Swift tests and compilation ran on
  Quasar instead. No package installation or dependency changes were needed.

## Quasar build and test

Authenticated batch SSH with strict host-key checking verified hostname `Quasar`,
user `mav`, home `/Users/mav`, macOS 27.0 build 26A428, and arm64. The direct route
from Darkstar was `enp9s0`, source `2.3.4.1`, to Ethernet `2.3.4.7`; Quasar's return
route used `en0`, active 1000baseT. The compiler was Apple Swift 6.4.2 with Command
Line Tools selected at `/Library/Developer/CommandLineTools`, SDK macOS 27.2.

All source synchronization, tests and build products were scoped to a new directory:

```text
/Users/mav/.t3/scratch/openmtp-native-pr-20261104.TgRbzO/
```

From its `macos/` directory:

```sh
scripts/swift-test.sh
swift build --product mtpctl
scripts/bundle-app.sh
codesign --verify --strict --verbose=2 "build/OpenMTP Native.app"
BIN=$(swift build --show-bin-path)
"$BIN/mtpctl" devices
```

- The complete test script passed: 29 protocol/file-operation tests across four
  suites and six native model tests in one suite. Parameterized cases also passed.
- Size-mismatch tests use three-byte payloads with fake metadata at zero, a small
  size, `0xFFFFFFFF`, 4 GiB, above 4 GiB and `UInt64.max`, through both listing
  strategies. They preserve existing destinations and another transfer's partial.
- Tests cover empty downloads, unknown metadata, unknown transport containers,
  cancellation, overlapping temporary files and final-rename failure cleanup.
- A follow-up combined unknown transport lengths with split-header devices. Both
  listing strategies reproduced a protocol desync before the fix. The engine now
  reads the payload after the header-only packet; known zero-byte objects remain
  supported. The full suite passes with the expanded parameterized cases.
- Metadata filenames are rejected before producing browser entries when empty,
  dot entries, slash-separated or NUL-containing. Both listing strategies pass
  all 14 filename cases. The complete suite now contains 35 tests.
- Native model tests cover captured selection, context-menu targets, cancellation,
  changed navigation/connection, date sorting including missing dates, and rejection
  of mixed files/folders, symlinks and missing files before any upload is queued.
- Debug CLI and release SwiftUI app builds passed. The ad-hoc-signed bundle passed
  strict verification. Its embedded LICENSE and NOTICE match the source files.
- The release app executable's SHA-256 was
  `8a6b4c40a426a2490ad1eb4bde991142795f02351faab16fec0e919a9aebbf7a`.
- Discovery returned `No MTP/PTP interfaces found`. It did not open a phone session.
- The toolchain emitted linker search-path warnings for absent CLT
  `Developer/Library/Frameworks` and `Developer/usr/lib` paths. The provided CLT
  Testing framework/plugin flags allowed tests to build and run successfully.

The existing app retained PID 56338 at
`/Users/mav/Sandbox/openmtp-swift/build/OpenMTP Native.app/Contents/MacOS/OpenMTP Native`.
The candidate app was not launched. No active source, installed app, packages or
device settings were changed. Build and test logs remain beside the scoped source.

## Gaps before this can leave draft

No screenshots of the candidate UI were obtained. The alert wording, Cmd+Delete,
Cancel/Escape, drag/drop feedback, sorting header clicks and normal browsing need
interactive visual and keyboard verification. Model tests do not establish those
SwiftUI behaviors.

Real-phone USB compatibility, multi-gigabyte transfer hashes, hot-plug/error recovery
and throughput remain unverified. Simulated bulk-read call counts are neither USB
packet counts nor a Swift-versus-Go benchmark. An unknown metadata size cannot
verify completeness when a device reports an early successful end of an
unknown-length container. File changes after upload preflight can still produce
partial batches. Overwrite prompts, recursive copies, drag-out promises, interrupt
events and resume remain absent. Minimum-macOS and Intel compatibility, power-loss
durability and distribution signing/notarization also remain unverified.
