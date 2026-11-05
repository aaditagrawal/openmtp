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
- Runtime execution on the minimum supported macOS.
- A Developer ID signed/notarized older-to-newer Sparkle installation from published owned feeds.
- Representative hardware timings before claiming any throughput improvement. Simulated request-count reductions are not measured hardware speedups.

## Final local release package

`make format format-check package` and the final 92-test rerun passed on Quasar. Both release executables target macOS 13.0; the app links only Apple libraries and the bundled Sparkle framework. Strict deep signature verification, architecture checks, ZIP integrity, SHA-256 checksums and DMG verification passed. The artifacts are explicitly ad-hoc signed. `mtpctl devices` ran and reported no attached MTP/PTP interfaces. The original prototype app remained running.

Release cross-compilation for both OpenMTPMac and mtpctl also passed for x86_64 using Quasar. The arm64 CLT toolchain emitted a compatibility-packs archive architecture warning during Intel linking. A successful cross-build is not an Intel runtime test. Native Intel CI followed below.

## Native CI and independent review

[Native macOS CI at 817f841](https://github.com/aaditagrawal/openmtp/actions/runs/41982045758) passed on macOS 26 Apple Silicon and Intel with Xcode 26.6, Swift 6.3.3 and SDK 26.5. Each host ran all 92 tests across 14 suites, built the release app and CLI, and verified native ZIP/DMG integrity and signatures before uploading its artifact. This establishes native Intel execution on macOS 26, not runtime compatibility with macOS 13.

CodeRabbit initially skipped the whole replacement because legacy deletions exceeded its file limit. Three independent reviewers examined protocol/USB, transfer safety/Finder integration, and workspace/updater/delivery code. The deleted tree was audited against the cutover scope: old runtime/build consumers were retired together, the app icon and MIT attribution were retained, and comparison source links remain pinned to the legacy commit. Review path filters cover every active tracked file and root configuration while keeping retired nested directories visible in GitHub's full diff. The configuration matches CodeRabbit's official schema.

The four independent-review findings were fixed and regression-tested: unknown-length packet framing with omitted ZLPs, basic-device uploads without filename renaming, beta discovery after automatic checks are disabled, and universal builds sharing a SwiftPM products directory. The final integrated run passed 104 tests across 15 suites: 64 core and 40 native tests. Ordinary metadata mismatch still preserves destinations and session health. Unsupported upload compatibility retries require a definite unsupported-operation response, exact staged-object cleanup, and source/destination revalidation; replacements and ambiguous failures never take that path.

`OPENMTP_ARCH=universal make package` plus universal package verification passed using the shared-products-directory toolchain that exposed the original defect. Both executables contain arm64 and x86_64 slices. Deep signatures, minimum OS, ZIP integrity, checksums and DMG verification passed. Logs are `optional-rename-validation.log` and `review-universal-package.log` in integrated staging. The output is ad-hoc signed, not a notarized public release.

## CodeRabbit review disposition

All 20 inline findings and the two additional review-body findings were checked against the implementation. The changes below preserve the review scope; review thresholds were not reduced.

| Finding | Disposition |
| --- | --- |
| Stable release promotion | Older maintenance tags remain non-latest; publication is serialized; API failures stop promotion. Sparkle also checks semantic release order independently of build numbers. |
| Prerelease hyphens | Verification accepts identifiers such as rc-1. |
| Full minimum macOS version | Package policy rejects 13.0.1 and 13.5, while accepting 13.0. |
| Date suffix junk | Invalid trailing data is rejected; Smart Sync treats it as unknown metadata. |
| ObjectInfo scope | Returned objects are checked against actual parent/storage without a duplicate metadata request. |
| Upload source race | O_NOFOLLOW and descriptor fstat bind bytes and size to a verified regular file. |
| CLI device index, chunk arithmetic and explicit storage | Invalid values fail with errors, and missing storage never falls back silently. |
| Rename path components | Invalid names fail before a mutation is sent. |
| Vendor MTP language IDs | Interface identification tries the languages reported by the device. |
| Distinct bulk-OUT packet size | Upload alignment and terminating ZLP use OUT; downloads continue using IN. |
| Automatic install-on-quit | Sparkle retains this behavior; it cannot become a restart merely because copies finish. Requested restarts still defer. |
| Prune after 1,024 entries | All generated cache entries are considered, preserving explicitly owned retry sources. |
| Interrupted multi-file preview | Only that request's completed staging directories are removed on failure/cancellation. |
| Incoming drop copies | Explicit nonce-backed ownership is persisted; completed/rejected/discarded jobs clean their copies, while failed/cancelled jobs retain retry sources. |
| Quit cancellation drain | Termination is deferred until active operations drain; an operation that cannot stop cancels the quit attempt instead of forcing exit. |
| Hidden Mac pane | Focus moves to Phone and hidden local selections clear. |
| Grid context selection | A selected clicked item retains the complete selection; an unselected item acts alone. |
| Local replacement race, review-body finding | Exclusive backup/commit/restore operations verify the displaced item and retain recovery copies on a conflict. There can be a brief absent-target window; no filesystem compare-and-swap is claimed. |
| Preference migration, review-body finding | One atomic setMany write includes the complete imported dictionary and migration marker. |
| Unknown size and omitted ZLP | Safe success cannot be inferred from arbitrary payload bytes. This peer combination remains unsupported and fails without committing the destination; regressions also preserve response-looking payload bytes when framing is valid. |

The separate docstring-coverage check is a nonblocking documentation warning. Its threshold was left unchanged; filler comments were not added to manufacture coverage. Physical-device, minimum-OS and signed-release checks above remain outstanding.

Final CodeRabbit-correction validation on Quasar passed 139 Swift tests across 20 suites: 77 core, five USB and 57 native tests. Strict formatting and the mocked release-promotion/minimum-OS policy harness passed. A separate real environment-verification fixture accepted 4.0.0-rc-1 and rejected an empty prerelease identifier. The universal app and CLI both contain arm64 and x86_64; deep signatures, ZIP integrity, checksums and DMG verification passed. Evidence is review-final-validation.log in integrated staging. CLI smoke additionally rejected nine malformed argument combinations without a trap. No physical-device mutation or public release occurred.
