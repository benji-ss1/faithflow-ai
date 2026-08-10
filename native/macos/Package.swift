// swift-tools-version:5.7
// PresentFlowAudioHelper — Tier 3 native CoreAudio + NDI capture helper.
// Buildable without an Xcode project: `swift build -c release` or the
// bundled build.sh (which also handles direct swiftc + ad-hoc signing).
//
// CNDI is a thin C target exposing the NDI SDK C API. Its headers are copied
// in from the installed "NDI SDK for Apple" by build.sh (license-gated, not
// committed). The NDI runtime is loaded dynamically at run time (dlopen), so
// there is NO link-time dependency on libndi.
import PackageDescription

let package = Package(
    name: "PresentFlowAudioHelper",
    platforms: [.macOS(.v12)],
    targets: [
        .target(
            name: "CNDI",
            path: "Sources/CNDI"
        ),
        .executableTarget(
            name: "PresentFlowAudioHelper",
            dependencies: ["CNDI"],
            path: "Sources/PresentFlowAudioHelper"
        )
    ]
)
