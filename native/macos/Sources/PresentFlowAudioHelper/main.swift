// main.swift — PresentFlowAudioHelper stdio protocol loop.
//
// Wire protocol (consumed by electron/audio/swiftHelper.ts):
//   stdin  : line-delimited JSON commands
//   stdout : RAW 16-bit LE PCM, 16kHz, mono — nothing else, ever
//   stderr : line-delimited JSON events
//
// Commands:
//   {"cmd":"list-devices"}
//   {"cmd":"start-capture","device_uid":"...","channels":[0],"gain":1.0}
//   {"cmd":"stop-capture"}
//   {"cmd":"set-channel","channels":[6]}
//   {"cmd":"set-gain","gain":1.5}
//   {"cmd":"probe-channels"}            (optionally {"device_uid":"..."} when not capturing)
//   {"cmd":"stop-probe"}
//   {"cmd":"quit"}
//
// Events:
//   {"event":"ready","version":1}
//   {"event":"devices","devices":[...]}
//   {"event":"capturing","device_uid":"...","channels":[...],"gain":..}
//   {"event":"stopped"}
//   {"event":"level","rms":..,"peak":..,"db":..}                (~20Hz)
//   {"event":"channel-levels","levels":[{channel,rms,peak,db}]} (~10Hz while probing)
//   {"event":"probing","device_uid":"..."} / {"event":"probe-stopped"}
//   {"event":"device-change"}   (CoreAudio hot-plug)
//   {"event":"error","code":"...","message":"..."}
//   {"event":"log","message":"..."}

import Foundation

// MARK: - serialized output writers

// stdout carries ONLY raw PCM; stderr carries ONLY JSON lines. Each gets a
// serial queue so the audio tap thread never blocks on pipe writes and
// interleaved writes can't tear.
let pcmQueue = DispatchQueue(label: "presentflow.audio.pcm")
let eventQueue = DispatchQueue(label: "presentflow.audio.events")
let stdoutHandle = FileHandle.standardOutput
let stderrHandle = FileHandle.standardError

func emitEvent(_ object: [String: Any]) {
    eventQueue.async {
        guard JSONSerialization.isValidJSONObject(object),
              var data = try? JSONSerialization.data(withJSONObject: object, options: [])
        else { return }
        data.append(0x0A) // newline
        stderrHandle.write(data)
    }
}

func emitError(code: String, message: String) {
    emitEvent(["event": "error", "code": code, "message": message])
}

func emitLog(_ message: String) {
    emitEvent(["event": "log", "message": message])
}

// Bound the in-flight PCM backlog. If the consumer (Electron) stops draining
// stdout, or a hostile NDI sender floods frames, unbounded `pcmQueue.async`
// enqueues would grow helper memory without limit. When the backlog exceeds
// the cap we DROP (never block the audio/receive thread, never OOM). Normal
// throughput is ~32KB/s (16k mono s16le), so this only trips on a genuine
// stall/flood. Guards both the CoreAudio and NDI paths.
let pcmBacklogLock = NSLock()
var pcmBacklogBytes = 0
let pcmBacklogMaxBytes = 8 * 1024 * 1024  // 8MB

func writePCM(_ data: Data) {
    pcmBacklogLock.lock()
    if pcmBacklogBytes + data.count > pcmBacklogMaxBytes {
        pcmBacklogLock.unlock()
        return // drop — consumer not keeping up; don't grow unbounded
    }
    pcmBacklogBytes += data.count
    pcmBacklogLock.unlock()
    pcmQueue.async {
        stdoutHandle.write(data)
        pcmBacklogLock.lock()
        pcmBacklogBytes -= data.count
        pcmBacklogLock.unlock()
    }
}

// MARK: - capture wiring

let capture = AudioCapture()
// Tracks whether the current engine session was started ONLY for probing
// (probe-channels while idle) so stop-probe can tear the engine down.
var probeOnlySession = false

capture.onPCM = { data in writePCM(data) }
capture.onLevel = { level in
    emitEvent([
        "event": "level",
        "rms": Double(level.rms),
        "peak": Double(level.peak),
        "db": level.db.isFinite ? Double(level.db) : -160.0,
    ])
}
capture.onChannelLevels = { levels in
    emitEvent([
        "event": "channel-levels",
        "levels": levels.enumerated().map { $1.toJSONObject(channel: $0) },
    ])
}
capture.onError = { code, message in emitError(code: code, message: message) }
capture.onLog = { message in emitLog(message) }

// MARK: - NDI wiring (network audio receive)

// Parse `--flag <value>` from argv. Used for --ndi-runtime (our bundled
// libndi.dylib), and optional --ndi-extra-ips / --ndi-groups for discovery on
// segmented networks. Absent/unloadable runtime ⇒ NDI unavailable; CoreAudio
// capture is unaffected.
func parseArg(_ flag: String) -> String? {
    let args = CommandLine.arguments
    if let i = args.firstIndex(of: flag), i + 1 < args.count {
        return args[i + 1]
    }
    return nil
}

let ndiDiscovery = NDIDiscovery()
let ndiReceiver = NDIReceiver(discovery: ndiDiscovery)

// The NDI receiver feeds the SAME output path as CoreAudio capture.
ndiReceiver.onPCM = { data in writePCM(data) }
ndiReceiver.onLevel = { level in
    emitEvent([
        "event": "level",
        "rms": Double(level.rms),
        "peak": Double(level.peak),
        "db": level.db.isFinite ? Double(level.db) : -160.0,
    ])
}
ndiReceiver.onChannelLevels = { levels in
    emitEvent([
        "event": "channel-levels",
        "levels": levels.enumerated().map { $1.toJSONObject(channel: $0) },
    ])
}
ndiReceiver.onError = { code, message in emitError(code: code, message: message) }
ndiReceiver.onLog = { message in emitLog(message) }
// When the connected NDI source's real channel count becomes known, nudge the
// renderer to re-list so the picker shows the true count (and the >2ch grid).
ndiReceiver.onChannelCount = { _ in emitEvent(["event": "device-change"]) }

ndiDiscovery.onLog = { message in emitLog(message) }
// A source appearing/disappearing on the LAN surfaces to the renderer exactly
// like a CoreAudio hot-plug — it re-lists and the picker updates live.
ndiDiscovery.onChange = { emitEvent(["event": "device-change"]) }

// Load the runtime and begin discovery (both no-ops if NDI is unavailable).
if NDI.shared.load(explicitPath: parseArg("--ndi-runtime"), onLog: { emitLog($0) }) {
    ndiDiscovery.start(extraIps: parseArg("--ndi-extra-ips"), groups: parseArg("--ndi-groups"))
}

// UID scheme: NDI sources are addressed as `ndi://<source name>` so a single
// device_uid namespace covers both CoreAudio (HAL UID) and NDI sources.
let ndiUIDPrefix = "ndi://"
func isNDIUID(_ uid: String) -> Bool { uid.hasPrefix(ndiUIDPrefix) }
func ndiName(fromUID uid: String) -> String { String(uid.dropFirst(ndiUIDPrefix.count)) }

// Tracks which backend owns the current capture/probe so set-channel /
// set-gain / stop route to the right one.
var activeIsNDI = false
var ndiProbeOnly = false

// STABLE per-session index for each NDI source. The renderer captures by
// enumeration index (swiftHelper.resolveUid maps index→uid on a fresh list),
// but NDI sources sort by name and flap on/off far more than USB devices — a
// positional index would resolve to the WRONG source when the list reorders,
// streaming the wrong audio. Assigning each source name a stable index (from a
// high base that can't collide with CoreAudio's 0..N) keeps index→source fixed
// for the whole session regardless of who else appears/disappears.
// (All access is on the single stdin command thread.)
var ndiIndexByName: [String: Int] = [:]
var nextNDIIndex = 100000
func stableNDIIndex(forName name: String) -> Int {
    if let i = ndiIndexByName[name] { return i }
    let i = nextNDIIndex
    nextNDIIndex += 1
    ndiIndexByName[name] = i
    return i
}

// MARK: - hot-plug

DeviceEnumerator.installHotPlugListener {
    emitEvent(["event": "device-change"])
}

// MARK: - command handlers

func handleListDevices() {
    let devices = DeviceEnumerator.inputDevices()
    var out: [[String: Any]] = devices.enumerated().map { $1.toJSONObject(index: $0) }
    // Append discovered NDI network sources after the CoreAudio devices,
    // continuing the index sequence. They look like any other input to the
    // renderer (uid `ndi://<name>`, transport "ndi", name "NDI: <name>").
    // input_channels defaults to 2 until the first received frame is known;
    // channel selection still works because the receiver clamps to the real
    // count of the live stream.
    for name in ndiDiscovery.currentSources() {
        // Real channel count is only known once connected. For the source we're
        // actively receiving, report the learned count so the picker shows all
        // channels; others fall back to a sensible 2 until selected.
        var channels = 2
        if activeIsNDI, name == ndiReceiver.sourceName {
            let known = ndiReceiver.currentChannelCount()
            if known > 0 { channels = known }
        }
        out.append([
            "index": stableNDIIndex(forName: name),
            "uid": "\(ndiUIDPrefix)\(name)",
            "name": "NDI: \(name)",
            "manufacturer": "NDI",
            "transport": "ndi",
            "input_channels": channels,
            "sample_rate": 48000,
            "is_default": false,
        ])
    }
    emitEvent(["event": "devices", "devices": out])
}

func intArray(_ any: Any?) -> [Int]? {
    guard let arr = any as? [Any] else { return nil }
    var out: [Int] = []
    for v in arr {
        if let i = v as? Int { out.append(i) }
        else if let d = v as? Double, d == d.rounded() { out.append(Int(d)) }
        else { return nil }
    }
    return out
}

func floatValue(_ any: Any?) -> Float? {
    if let d = any as? Double { return Float(d) }
    if let i = any as? Int { return Float(i) }
    return nil
}

func handleStartCapture(_ cmd: [String: Any]) {
    guard let uid = cmd["device_uid"] as? String, !uid.isEmpty else {
        emitError(code: "bad-command", message: "start-capture requires device_uid")
        return
    }
    let channels = intArray(cmd["channels"]) ?? [0]
    let gain = floatValue(cmd["gain"]) ?? 1.0
    probeOnlySession = false
    if isNDIUID(uid) {
        // Route to the NDI receiver; make sure CoreAudio capture is idle.
        capture.stop()
        do {
            try ndiReceiver.start(sourceName: ndiName(fromUID: uid), channels: channels, gain: gain, emitPCM: true)
            activeIsNDI = true
            ndiProbeOnly = false
            emitEvent([
                "event": "capturing",
                "device_uid": uid,
                "channels": channels,
                "gain": Double(gain),
            ])
        } catch {
            activeIsNDI = false
            emitError(code: "start-failed", message: String(describing: error))
        }
        return
    }
    // CoreAudio path — make sure any NDI receiver is idle first.
    ndiReceiver.stop()
    activeIsNDI = false
    do {
        try capture.start(deviceUID: uid, channels: channels, gain: gain, emitPCM: true)
        emitEvent([
            "event": "capturing",
            "device_uid": uid,
            "channels": channels,
            "gain": Double(gain),
        ])
    } catch {
        emitError(code: "start-failed", message: String(describing: error))
    }
}

func handleStopCapture() {
    capture.stop()
    ndiReceiver.stop()
    activeIsNDI = false
    ndiProbeOnly = false
    probeOnlySession = false
    emitEvent(["event": "stopped"])
}

func handleSetChannel(_ cmd: [String: Any]) {
    guard let channels = intArray(cmd["channels"]), !channels.isEmpty else {
        emitError(code: "bad-command", message: "set-channel requires channels array")
        return
    }
    if activeIsNDI { ndiReceiver.setChannels(channels) } else { capture.setChannels(channels) }
    emitLog("channels set to \(channels)")
}

func handleSetGain(_ cmd: [String: Any]) {
    guard let gain = floatValue(cmd["gain"]) else {
        emitError(code: "bad-command", message: "set-gain requires gain number")
        return
    }
    if activeIsNDI { ndiReceiver.setGain(gain) } else { capture.setGain(gain) }
    emitLog("gain set to \(gain)")
}

func handleProbeChannels(_ cmd: [String: Any]) {
    // Already capturing NDI — probe shares the live receive stream.
    if activeIsNDI && ndiReceiver.running {
        ndiReceiver.setProbing(true)
        emitEvent(["event": "probing", "device_uid": "\(ndiUIDPrefix)\(ndiReceiver.sourceName)"])
        return
    }
    if capture.running {
        // Probe shares the live tap — just enable per-channel stats.
        capture.setProbing(true)
        emitEvent(["event": "probing", "device_uid": capture.deviceUID])
        return
    }
    // Probe while idle needs a device to open a probe-only session on.
    guard let uid = cmd["device_uid"] as? String, !uid.isEmpty else {
        emitError(code: "bad-command",
                  message: "probe-channels requires device_uid when not capturing")
        return
    }
    if isNDIUID(uid) {
        // Probe-only NDI session: receive (for per-channel levels) but never
        // feed the pipeline (emitPCM:false).
        capture.stop()
        do {
            try ndiReceiver.start(sourceName: ndiName(fromUID: uid), channels: [0], gain: 1.0, emitPCM: false)
            activeIsNDI = true
            ndiProbeOnly = true
            ndiReceiver.setProbing(true)
            emitEvent(["event": "probing", "device_uid": uid])
        } catch {
            activeIsNDI = false
            emitError(code: "probe-failed", message: String(describing: error))
        }
        return
    }
    do {
        try capture.start(deviceUID: uid, channels: [0], gain: 1.0, emitPCM: false)
        probeOnlySession = true
        capture.setProbing(true)
        emitEvent(["event": "probing", "device_uid": uid])
    } catch {
        emitError(code: "probe-failed", message: String(describing: error))
    }
}

func handleStopProbe() {
    if activeIsNDI {
        ndiReceiver.setProbing(false)
        if ndiProbeOnly {
            ndiReceiver.stop()
            ndiProbeOnly = false
            activeIsNDI = false
        }
        emitEvent(["event": "probe-stopped"])
        return
    }
    capture.setProbing(false)
    if probeOnlySession {
        capture.stop()
        probeOnlySession = false
    }
    emitEvent(["event": "probe-stopped"])
}

// MARK: - stdin loop

emitEvent(["event": "ready", "version": 1])

while let line = readLine(strippingNewline: true) {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty { continue }
    guard let data = trimmed.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data),
          let cmd = json as? [String: Any],
          let name = cmd["cmd"] as? String
    else {
        emitError(code: "bad-json", message: "unparseable command line")
        continue
    }
    switch name {
    case "list-devices": handleListDevices()
    case "start-capture": handleStartCapture(cmd)
    case "stop-capture": handleStopCapture()
    case "set-channel": handleSetChannel(cmd)
    case "set-gain": handleSetGain(cmd)
    case "probe-channels": handleProbeChannels(cmd)
    case "stop-probe": handleStopProbe()
    case "quit":
        capture.stop()
        ndiReceiver.stop()
        ndiDiscovery.stop()
        // Flush pending output before exit.
        pcmQueue.sync {}
        eventQueue.sync {}
        exit(0)
    default:
        emitError(code: "unknown-command", message: "unknown cmd: \(name)")
    }
}

// stdin closed (parent died / pipe broke) — never outlive Electron.
capture.stop()
ndiReceiver.stop()
ndiDiscovery.stop()
pcmQueue.sync {}
eventQueue.sync {}
exit(0)
