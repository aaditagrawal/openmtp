# Native replacement validation

Observed on 2026-11-05. The replacement branch removes the Electron application and build toolchain. The legacy comparison baseline is owned master [`6eb3e7b`](https://github.com/aaditagrawal/openmtp/tree/6eb3e7b79727c7cef09844c72c35908caedfaa24). The original prototype directory and the user's separate working checkout were preserved.

## Environment and scope

Darkstar is the Linux editing host. Authenticated SSH with strict host-key checking verified personal Mac Quasar over the direct Ethernet route, source 2.3.4.1 to 2.3.4.7. Quasar reported macOS 27.0, Apple Silicon, Apple Swift 6.4.2, Command Line Tools and macOS SDK 27.2.

Integrated staging is `/Users/mav/.t3/scratch/openmtp-replacement-OlUuKz`. Temporary profiles, local files and simulated MTP devices isolate test operations. The existing `/Users/mav/Sandbox/openmtp-swift` application and source remain untouched. No physical phone files were transferred or deleted.

## Automated checks

The integrated Swift test run passed 92 tests: 55 protocol/core tests across six suites and 37 native model/integration tests across eight suites. `workspace-final-pass.log` records the integrated run. After final formatting and layout changes, `native-final-validation.log` records another passing 92-test run, strict format checks, release-bundle verification, ZIP/DMG checksums and CLI discovery. Coverage includes:

- Packet boundaries, split headers, unknown lengths, zero and 64-bit sizes, failed commits and byte-exact streaming.
- Complete recursive folder plans, conflict choices, timestamp precision, source changes, cancellation, destination preservation and explicit scoped extras cleanup.
- Old Smart Sync decisions executed as real simulated transfers, including nested repeated names and empty folders.
- Queue retry/cancellation drain, stale progress, captured destinations, changed connections and dismissed conflict choices.
- Read-only legacy preference migration, independent navigation/selection, 1,500-item sorting/filtering and clipboard snapshots.
- Lazy file promises, exclusive Finder destination commits, preview cancellation/generations, export activity and update deferral.
- Owned native release selection, prerelease policy, CPU/minimum-OS filtering and Sparkle configuration gates.
- Directory membership checks when a device returns incomplete or overbroad batched metadata, and propagation of access errors.

Swift products compile with a macOS 13 deployment target. CLT's test-only Testing.framework requires macOS 14 and emits a linker-floor warning. Testing on Quasar does not establish macOS 13 runtime compatibility.

Local actionlint 1.7.12 accepts both native workflows. Shell syntax and whitespace checks pass. Action hashes and macOS 26 / macOS 26 Intel Xcode 26.6 runner paths were checked against current official sources.

## Rendering evidence

A staging-only harness instantiated the real SwiftUI workspace, settings and conflict views with simulated phone and local fixtures. It captured only its own NSWindow. Compositor captures show native toolbar and Liquid Glass pixels. The initial NSView bitmap method did not capture compositor-backed materials reliably and is not accepted as visual evidence.

The hosting harness obscured pane headings beneath its title area. A separate actual SwiftUI App Scene check in `/Users/mav/.t3/scratch/openmtp-scene-qa-2QYrva` confirmed both headings, path, filters and tables render below the toolbar. [The captured Scene](Design/screenshots/native-scene.png) uses a temporary profile and local fixtures with auto-connect disabled. The candidate exited and QA hooks were removed. The production app and committed test targets contain no capture harness. Screen recording permission was not granted; only caller-owned windows were captured.

## Signing and update checks

Sparkle 2.10.1 is pinned exactly; SwiftPM verifies its binary checksum. The release scripts verify that the archive's signature matches the app's embedded public key before generating a feed. An isolated public RFC8032 vector accepted a matching key and rejected a mismatched key through the actual Sparkle tool and CryptoKit. Mock publication checks accepted valid prerelease/stable inputs and rejected unsigned or missing-feed stable inputs before invoking GitHub publication.

The actual appcast-generation script also passed against an independent copy of the final app and ZIP in `/Users/mav/Sandbox/openmtp-appcast-smoke.crvYGE`. CryptoKit independently verified the signed feed against the embedded public test key, including beta channel, arm64, minimum OS and exact owned URLs. A mismatched key failed before feed creation. Checksums confirmed the original app, ZIP and DMG were unchanged.

No Developer ID, notarization or Sparkle secrets are configured in this repository. An ad-hoc package, a public test-vector signature or a mocked publication does not establish a signed automatic update round trip. Stable release jobs require those credentials and both architecture feeds.

## Remaining release checks

- Physical devices: browsing, large files, both transfer directions, conflicts/Smart Sync, cable detach/reconnect, cancellation recovery and competing USB owners.
- Interactive macOS behavior: multiple Finder promises, incoming Photos promises, Quick Look, keyboard focus/selection, VoiceOver, Reduce Transparency, Reduce Motion and Increase Contrast.
- Intel CI and runtime execution on the minimum supported macOS.
- A Developer ID signed/notarized older-to-newer Sparkle installation from published owned feeds.
- Representative hardware timings before claiming any throughput improvement. Simulated request-count reductions are not measured hardware speedups.

## Final local release package

`make format format-check package` and the final 92-test rerun passed on Quasar. Both release executables target macOS 13.0; the app links only Apple libraries and the bundled Sparkle framework. Strict deep signature verification, architecture checks, ZIP integrity, SHA-256 checksums and DMG verification passed. The artifacts are explicitly ad-hoc signed. `mtpctl devices` ran and reported no attached MTP/PTP interfaces. The original prototype app remained running.

Release cross-compilation for both OpenMTPMac and mtpctl also passed for x86_64 using Quasar. The arm64 CLT toolchain emitted a compatibility-packs archive architecture warning during Intel linking. Native Intel CI/runtime validation remains required; a successful cross-build is not an Intel runtime test.
