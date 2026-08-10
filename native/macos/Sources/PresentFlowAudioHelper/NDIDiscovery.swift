// NDIDiscovery.swift — live NDI source discovery (the "find" side).
//
// Mirrors OBS/DistroAV behaviour: a single long-lived NDIlib_find instance
// polls the LAN (mDNS) for NDI senders. When the set of source NAMES changes
// we fire `onChange` so main.swift can emit a `device-change` event and the
// renderer re-lists — sources appear/disappear live in the picker.
//
// Source names are the stable identifier we expose to the rest of the app as
// `ndi://<name>` UIDs (see main.swift). We copy names out of the SDK-owned
// buffer on every poll because that buffer is only valid until the next call.

import CNDI
import Foundation

/// A discovered NDI source: its stable display name plus the resolved URL/IP
/// (when known) so the receiver can connect deterministically rather than by
/// name alone.
struct NDISourceInfo {
    let name: String
    let url: String?
}

final class NDIDiscovery {
    private let lock = NSLock()
    private var find: NDIlib_find_instance_t?
    private var sources: [NDISourceInfo] = []
    private var pollThread: Thread?
    private var running = false
    // Signaled once when the poll loop has fully exited its last blocking
    // wait — stop() joins on this before destroying the find instance (UAF).
    private var pollDone: DispatchSemaphore?

    // Hard caps: source names and counts come from untrusted LAN senders. A
    // giant name or a flood of sources must never blow past the helper's
    // event-line cap (which would silently drop the WHOLE device list — CoreAudio
    // mic included) or spin CPU. Names are truncated, the list is capped.
    private static let maxNameBytes = 512
    private static let maxSources = 64
    // device-change debounce: coalesce discovery churn so a flapping sender
    // can't flood the renderer with re-enumerations.
    private static let minEmitInterval: TimeInterval = 0.5
    private var lastEmitAt: TimeInterval = 0
    private var pendingEmit = false

    var onChange: (() -> Void)?
    var onLog: ((String) -> Void)?

    /// Start discovery if the NDI runtime is available. Idempotent.
    ///
    /// `extraIps` (comma/space-separated) lets an admin point discovery at
    /// specific sender IPs when mDNS can't reach them — the common case on
    /// segmented church networks where the FOH/broadcast rack and the
    /// presentation Mac sit on different subnets/VLANs. `groups` restricts to
    /// named NDI groups. Both are optional; nil ⇒ standard local discovery.
    func start(extraIps: String? = nil, groups: String? = nil) {
        guard NDI.shared.isAvailable, let lib = NDI.shared.lib else { return }
        lock.lock()
        defer { lock.unlock() }
        guard !running else { return }

        // show_local_sources = true so a same-machine sender is also seen.
        // NDIlib_find_create_v2 copies these strings synchronously, so the
        // strdup'd buffers only need to outlive the create call (freed below).
        var settings = NDIlib_find_create_t()
        settings.show_local_sources = true
        let ipsC = (extraIps?.isEmpty == false) ? strdup(extraIps!) : nil
        let grpC = (groups?.isEmpty == false) ? strdup(groups!) : nil
        defer { if let p = ipsC { free(p) }; if let p = grpC { free(p) } }
        settings.p_extra_ips = ipsC.map { UnsafePointer($0) }
        settings.p_groups = grpC.map { UnsafePointer($0) }
        guard let created = lib.pointee.NDIlib_find_create_v2?(&settings) else {
            onLog?("NDIlib_find_create_v2 returned null — NDI discovery unavailable")
            return
        }
        if let extraIps = extraIps, !extraIps.isEmpty {
            onLog?("NDI discovery targeting extra IPs: \(extraIps)")
        }
        find = created
        running = true
        let done = DispatchSemaphore(value: 0)
        pollDone = done

        let t = Thread { [weak self] in
            self?.pollLoop()
            done.signal()
        }
        t.name = "presentflow.ndi.discovery"
        t.stackSize = 512 * 1024
        pollThread = t
        t.start()
        onLog?("NDI discovery started")
    }

    func stop() {
        lock.lock()
        guard running else { lock.unlock(); return }
        running = false
        let done = pollDone
        lock.unlock()
        // Wait for the poll loop to exit its NDIlib_find_wait_for_sources call
        // BEFORE destroying the find instance (avoids UAF: find_destroy vs an
        // in-flight wait). The loop wakes at most every 250ms.
        if let done = done {
            _ = done.wait(timeout: .now() + 2.0)
        }
        lock.lock()
        let f = find
        find = nil
        pollDone = nil
        pollThread = nil
        lock.unlock()
        if let f = f, let lib = NDI.shared.lib {
            lib.pointee.NDIlib_find_destroy?(f)
        }
    }

    /// Snapshot of currently-visible NDI source names (sorted, stable order).
    func currentSources() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return sources.map { $0.name }
    }

    /// Look up the resolved info for a source by name, if currently visible.
    func sourceInfo(named name: String) -> NDISourceInfo? {
        lock.lock()
        defer { lock.unlock() }
        return sources.first { $0.name == name }
    }

    // MARK: - poll loop (background thread)

    /// Truncate an untrusted source name to a safe byte length (on a UTF-8
    /// boundary) so one giant name can't blow the event-line cap downstream.
    private static func cappedName(_ raw: String) -> String {
        if raw.utf8.count <= maxNameBytes { return raw }
        var s = raw
        while s.utf8.count > maxNameBytes && !s.isEmpty { s.removeLast() }
        return s + "…"
    }

    private func pollLoop() {
        guard let lib = NDI.shared.lib else { return }
        while true {
            lock.lock()
            let isRunning = running
            let f = find
            lock.unlock()
            guard isRunning, let f = f else { break }

            // Block up to 250ms for a source-list change, then read the list.
            // Returns immediately if something already changed. Short timeout
            // bounds stop() latency and keeps the debounce below responsive.
            _ = lib.pointee.NDIlib_find_wait_for_sources?(f, 250)

            var count: UInt32 = 0
            let listed = lib.pointee.NDIlib_find_get_current_sources?(f, &count)
            var found: [NDISourceInfo] = []
            // Cap the source count — a LAN flood of sources must not build an
            // unbounded (or oversized) device list.
            let n = min(Int(count), Self.maxSources)
            if let listed = listed, n > 0 {
                for i in 0..<n {
                    let src = listed[i]
                    guard let cName = src.p_ndi_name else { continue }
                    let url = src.p_url_address.map { String(cString: $0) }
                    found.append(NDISourceInfo(name: Self.cappedName(String(cString: cName)), url: url))
                }
            }
            found.sort { $0.name < $1.name }
            let names = found.map { $0.name }

            // Monotonic clock (never wall-clock) for debounce timing.
            let now = ProcessInfo.processInfo.systemUptime
            var shouldEmit = false
            var logNames: [String]? = nil
            lock.lock()
            let changed = names != sources.map { $0.name }
            if changed {
                sources = found
                pendingEmit = true
                logNames = names
            }
            // Emit at most once per minEmitInterval, with a trailing emit: the
            // ≤250ms loop re-checks pendingEmit so a coalesced change still
            // surfaces within the window.
            if pendingEmit && (now - lastEmitAt) >= Self.minEmitInterval {
                pendingEmit = false
                lastEmitAt = now
                shouldEmit = true
            }
            lock.unlock()

            if let logNames = logNames {
                onLog?("NDI sources: [\(logNames.joined(separator: ", "))]")
            }
            if shouldEmit {
                onChange?()
            }
        }
    }
}
