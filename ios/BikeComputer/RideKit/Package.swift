// swift-tools-version:5.9
// RideKit holds everything that doesn't need an iPhone: Bluetooth packet
// parsing, ride metrics and file export. It builds on macOS and Linux, so
// `swift test` runs without a device or simulator.
import PackageDescription

let package = Package(
    name: "RideKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "RideKit", targets: ["RideKit"]),
    ],
    targets: [
        .target(name: "RideKit"),
        .testTarget(name: "RideKitTests", dependencies: ["RideKit"]),
    ]
)
