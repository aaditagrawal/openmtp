// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OpenMTPNative",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "MTPCore", targets: ["MTPCore"]),
        .library(name: "MTPUSB", targets: ["MTPUSB"]),
        .executable(name: "mtpctl", targets: ["mtpctl"]),
        .executable(name: "OpenMTPMac", targets: ["OpenMTPMac"]),
    ],
    targets: [
        // Pure-Swift protocol layer: containers, datasets, transactions, file operations.
        // No USB or AppKit dependency, so it is fully testable against a simulated device.
        .target(name: "MTPCore"),
        // IOUSBHost transport, discovery and hot-plug monitoring.
        .target(
            name: "MTPUSB",
            dependencies: ["MTPCore"],
            linkerSettings: [.linkedFramework("IOUSBHost"), .linkedFramework("IOKit")]
        ),
        .executableTarget(name: "mtpctl", dependencies: ["MTPCore", "MTPUSB"]),
        .executableTarget(name: "OpenMTPMac", dependencies: ["MTPCore", "MTPUSB"]),
        .testTarget(name: "MTPCoreTests", dependencies: ["MTPCore"]),
    ]
)
