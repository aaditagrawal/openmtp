# Kalam native backend

The Apple Silicon host build uses the installed Go toolchain and libusb. It
builds both native entry points, bundles libusb beside them, changes dynamic
library references to `@loader_path`, and verifies local ad-hoc signatures.
The generated binaries are local builds, without Apple notarization.

From the repository root:

```sh
brew install go pkg-config autoconf automake libtool
bun run build-libusb
bun run build-native
```

The libusb helper downloads the official 1.0.30 release, verifies its pinned
SHA-256, builds for macOS 13, and caches it at
`tmp/libusb-1.0.30-macos13/prefix`. The host builder prefers that cache.
`OPENMTP_LIBUSB_PREFIX=/another/prefix bun run build-native` selects an explicit
compatible build. It rejects libraries targeting a newer macOS than 13 rather
than silently packaging incompatible Homebrew binaries. Go 1.27 supports
macOS 13 and newer, as documented in the [Go release notes](https://go.dev/doc/go1.27#linker).

The build replaces `build/mac/bin/arm64/{kalam.dylib,kalam.h,kalam_debug_report,libusb.dylib}`
only after all compilation/signature checks succeed. The builder also checks
chained-fixups segment counts, covering upstream [PR #481](https://github.com/ganeshrvel/openmtp/pull/481)
without a second binary variant; this fork already builds with Go 1.27. Existing loaded binaries
remain valid because replacement uses rename. The older multi-architecture
`build.mjs` remains available for historical binary maintenance; it downloads
pinned historical libusb bottles and is not the current host build.

Native tests are opt-in and are not run by CI. Run the unit and race tests:

```sh
go -C ffi/kalam/native test -race -tags openmtp_manual ./...
```

With no MTP phone attached, enable the read-only hardware stress test:

```sh
OPENMTP_NATIVE_HARDWARE_TEST=1 go -C ffi/kalam/native test -race -tags openmtp_manual ./...
node --expose-gc ffi/kalam/native/scripts/stress-native.mjs /tmp/openmtp-native-stress.json
```

The Go hardware test repeats 100 real libusb discovery/dispose cycles and checks
that every failed initialization releases the session/context. The JavaScript
probe exercises the built dylib through Koffi and samples native thread count,
file descriptors, and process RSS. It stops after releasing the session if a
phone is connected; it never transfers files. `OPENMTP_STRESS_ITERATIONS` adjusts
the count and `OPENMTP_STRESS_LIBRARY` selects a baseline dylib for comparison.

`OPENMTP_NATIVE_DEBUG=1` enables USB/MTP protocol logging during initialization.
Protocol logs can include device identifiers and file metadata, so enable this
only when diagnosing a device. Normal lifecycle timings use `OPENMTP_TRACE_FILE`.

Kalam owns libusb context/device lifetime. Native exports release their mutex
only after all callbacks return, and the JS bridge waits for that native return
before advancing its operation queue. Go panics invalidate and release the
session before returning an operation error. A native C fault still requires
process-level crash diagnosis.

The module uses a local, source-attributed `go-mtpfs` replacement with corrected
selection/error cleanup. See [the patch record](third_party/go-mtpfs/OPENMTP_PATCHES.md)
and its original LICENSE. Direct Go USB/MTP dependencies are pinned to their
latest available versions; JSON encoding uses the Go standard library.

Run a scoped physical-device transfer test only after closing OpenMTP and any
other MTP client:

```sh
env -u ELECTRON_RUN_AS_NODE OPENMTP_TRANSFER_OUTPUT=/tmp/openmtp-transfer-run \
  node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/native-transfer.cjs
```

This creates a unique directory under the existing Android Download directory,
round-trips 1 MiB and 64 MiB generated files, validates SHA-256, checks rename/listing
and Smart Sync, and removes only its own test directory after inspecting it.
The result and lifecycle trace remain in the chosen output directory.
