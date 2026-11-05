# Contributing

The application is SwiftUI with a Swift MTP engine. Build on a Mac with macOS SDK 26 or later and Swift 6.2 or later. The runtime deployment target is macOS 13.

```sh
make format-check
make test
make package
./macos/scripts/verify-package.sh
```

Keep protocol changes in MTPCore and USB operations in MTPUSB. Test protocol behavior with MTPSimulation before using a physical device. Treat device operations as ordered transactions; concurrent UI work must use MTPClient's serialized queue.

For file operations, preserve existing destination data on transfer failure, reject invalid path components, check unknown and 64-bit sizes, and capture destructive action targets before confirmation. Reuse the tree planner for Finder exports and Quick Look rather than opening a second device session.

Use standard macOS controls, keyboard navigation and accessibility labels. Guard newer SwiftUI APIs by availability and respect Reduce Transparency and Reduce Motion. Keep implementation details out of user-facing dialogs unless they help recovery.

Record compatibility decisions in [macos/PARITY.md](macos/PARITY.md). Report measured performance with workload, hardware, connection, build and elapsed times. Simulated request reductions are not hardware throughput results.

GitHub Actions tests and packages Apple Silicon and Intel separately. Release credentials belong in repository secrets, never in source or logs. See [release instructions](macos/RELEASING.md).
