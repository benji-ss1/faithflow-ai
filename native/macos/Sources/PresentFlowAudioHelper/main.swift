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

func writePCM(_ data: Data) {
    pcmQueue.async {
        stdoutHandle.write(data)
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

// MARK: - hot-plug

DeviceEnumerator.installHotPlugListener {
    emitEvent(["event": "device-change"])
}

// MARK: - command handlers

func handleListDevices() {
    let devices = DeviceEnumerator.inputDevices()
    emitEvent([
        "event": "devices",
        "devices": devices.enumerated().map { $1.toJSONObject(index: $0) },
    ])
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
    probeOnlySession = false
    emitEvent(["event": "stopped"])
}

func handleSetChannel(_ cmd: [String: Any]) {
    guard let channels = intArray(cmd["channels"]), !channels.isEmpty else {
        emitError(code: "bad-command", message: "set-channel requires channels array")
        return
    }
    capture.setChannels(channels)
    emitLog("channels set to \(channels)")
}

func handleSetGain(_ cmd: [String: Any]) {
    guard let gain = floatValue(cmd["gain"]) else {
        emitError(code: "bad-command", message: "set-gain requires gain number")
        return
    }
    capture.setGain(gain)
    emitLog("gain set to \(gain)")
}

func handleProbeChannels(_ cmd: [String: Any]) {
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
pcmQueue.sync {}
eventQueue.sync {}
exit(0)
