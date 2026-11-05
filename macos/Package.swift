// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "OpenMTP",
  platforms: [.macOS(.v13)],
  products: [
    .library(name: "MTPCore", targets: ["MTPCore"]),
    .library(name: "MTPUSB", targets: ["MTPUSB"]),
    .executable(name: "mtpctl", targets: ["mtpctl"]),
    .executable(name: "OpenMTPMac", targets: ["OpenMTPMac"]),
  ],
  dependencies: [
    .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1")
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
    .executableTarget(
      name: "OpenMTPMac",
      dependencies: ["MTPCore", "MTPUSB", .product(name: "Sparkle", package: "Sparkle")],
      linkerSettings: [
        .unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])
      ]
    ),
    .target(name: "MTPSimulation", dependencies: ["MTPCore"], path: "Tests/MTPSimulation"),
    .testTarget(name: "MTPCoreTests", dependencies: ["MTPCore", "MTPSimulation"]),
    .testTarget(
      name: "OpenMTPMacTests", dependencies: ["OpenMTPMac", "MTPSimulation"],
      resources: [.copy("Fixtures")]),
  ]
)
