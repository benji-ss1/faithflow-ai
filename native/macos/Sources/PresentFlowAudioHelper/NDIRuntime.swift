// NDIRuntime.swift — dynamic loader for the NDI runtime (libndi.dylib).
//
// We DO NOT link against libndi. Instead we dlopen() the runtime at startup
// and resolve the single exported entry point `NDIlib_v5_load()`, which
// returns a struct of function pointers (NDIlib_v5) for every NDI call.
// This is the redistributable-friendly pattern the NDI SDK documents and
// that OBS/DistroAV use: the app ships a bundled libndi.dylib but degrades
// gracefully (no NDI sources, never a crash) if it can't be loaded.
//
// Search order for the dylib:
//   1. explicit path passed via `--ndi-runtime <path>` (our bundled copy)
//   2. $NDI_RUNTIME_DIR_V5/libndi.dylib   (NDI SDK's documented env var)
//   3. /usr/local/lib/libndi.dylib        (NDI Tools / Runtime installer)
//   4. bare "libndi.dylib"                 (let dyld search standard paths)

import CNDI
import Foundation

/// Thin, thread-safe accessor over the loaded NDIlib_v5 function table.
/// All NDI access in the helper goes through `NDI.shared`.
final class NDI {
    static let shared = NDI()

    /// Pointer to the NDI function table, or nil when the runtime is absent.
    private(set) var lib: UnsafePointer<NDIlib_v5>?
    private var handle: UnsafeMutableRawPointer?
    private var initialized = false

    private init() {}

    var isAvailable: Bool { lib != nil && initialized }

    /// Attempt to load + initialize the runtime. Idempotent; returns whether
    /// NDI is usable afterwards. `onLog` receives a human-readable trace.
    @discardableResult
    func load(explicitPath: String?, onLog: (String) -> Void) -> Bool {
        if isAvailable { return true }

        let candidates = Self.candidatePaths(explicitPath: explicitPath)
        var opened: UnsafeMutableRawPointer?
        var loadedFrom = ""
        for path in candidates {
            if let h = dlopen(path, RTLD_NOW | RTLD_LOCAL) {
                opened = h
                loadedFrom = path
                break
            }
        }
        guard let h = opened else {
            onLog("NDI runtime not found (searched: \(candidates.joined(separator: ", "))) — NDI sources disabled")
            return false
        }

        // Resolve the single documented entry point.
        typealias LoadFn = @convention(c) () -> UnsafePointer<NDIlib_v5>?
        guard let sym = dlsym(h, "NDIlib_v5_load") else {
            onLog("NDI runtime at \(loadedFrom) missing NDIlib_v5_load — NDI disabled")
            dlclose(h)
            return false
        }
        let loadFn = unsafeBitCast(sym, to: LoadFn.self)
        guard let table = loadFn() else {
            onLog("NDIlib_v5_load() returned null — NDI disabled")
            dlclose(h)
            return false
        }

        // NDIlib_initialize() can fail on unsupported CPUs (very old x86);
        // treat that as "no NDI" rather than crashing the whole helper.
        if let initFn = table.pointee.NDIlib_initialize, initFn() == false {
            onLog("NDIlib_initialize() failed (unsupported CPU?) — NDI disabled")
            dlclose(h)
            return false
        }

        self.handle = h
        self.lib = table
        self.initialized = true
        var version = "unknown"
        if let versionFn = table.pointee.NDIlib_version, let cStr = versionFn() {
            version = String(cString: cStr)
        }
        onLog("NDI runtime loaded from \(loadedFrom) (\(version))")
        return true
    }

    private static func candidatePaths(explicitPath: String?) -> [String] {
        // FAIL CLOSED when an explicit path is given. The packaged app ALWAYS
        // spawns the helper with `--ndi-runtime <bundled dylib>`, so in
        // production we load ONLY our bundled copy — never $NDI_RUNTIME_DIR_V5,
        // /usr/local/lib, or a bare leaf name. Those locations are writable by
        // other users / influenced by DYLD_* env, so falling through to them
        // would let a planted libndi.dylib run arbitrary code in this process
        // (dylib hijack). The runtime is only ad-hoc signed with no hardened
        // runtime, so library validation would not stop such a load.
        if let p = explicitPath, !p.isEmpty { return [p] }
        // No explicit path ⇒ manual/dev invocation only. Allow the SDK's
        // documented locations as a convenience (never a bare leaf name).
        var paths: [String] = []
        if let dir = ProcessInfo.processInfo.environment["NDI_RUNTIME_DIR_V5"], !dir.isEmpty {
            paths.append((dir as NSString).appendingPathComponent("libndi.dylib"))
        }
        paths.append("/usr/local/lib/libndi.dylib")
        var seen = Set<String>()
        return paths.filter { seen.insert($0).inserted }
    }
}
