// swift-tools-version:5.7
// PresentFlowAudioHelper — Tier 3 native CoreAudio capture helper.
// Buildable without an Xcode project: `swift build -c release` or the
// bundled build.sh (which also handles direct swiftc + ad-hoc signing).
import PackageDescription

let package = Package(
    name: "PresentFlowAudioHelper",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "PresentFlowAudioHelper",
            path: "Sources/PresentFlowAudioHelper"
        )
    ]
)
