// AudioCapture.swift — AVAudioEngine capture pinned to a NON-DEFAULT
// CoreAudio device via the inputNode's underlying AUHAL AudioUnit
// (kAudioOutputUnitProperty_CurrentDevice), per the research doc. The tap
// extracts the selected channel(s), applies gain, resamples to 16kHz mono
// Int16 via AVAudioConverter, and hands Data to the caller (main.swift
// writes it to stdout).
//
// set-channel / set-gain apply LIVE: the tap snapshots the current
// selection under a lock on every callback — no engine restart, no gap.

import AVFoundation
import CoreAudio
import Foundation

enum CaptureError: Error, CustomStringConvertible {
    case deviceNotFound(String)
    case devicePinFailed(OSStatus)
    case badInputFormat
    case converterInit
    case engineStart(Error)

    var description: String {
        switch self {
        case .deviceNotFound(let uid): return "device not found for uid \(uid)"
        case .devicePinFailed(let status): return "failed to pin capture device (OSStatus \(status))"
        case .badInputFormat: return "input node reported an unusable format"
        case .converterInit: return "could not create 16kHz Int16 converter"
        case .engineStart(let err): return "engine start failed: \(err.localizedDescription)"
        }
    }
}

final class AudioCapture {

    static let outputSampleRate: Double = 16000

    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private var monoFormat: AVAudioFormat?
    private var outFormat: AVAudioFormat?
    private var monoScratch: AVAudioPCMBuffer?

    // Live-mutable capture parameters. The audio tap snapshots these under
    // `paramLock`; command handlers mutate them. Cheap uncontended lock.
    private let paramLock = NSLock()
    private var channels: [Int] = [0]
    private var gain: Float = 1.0
    private var probing = false

    private(set) var running = false
    private(set) var emitPCM = true // false = probe-only session
    private(set) var deviceUID: String = ""
    private var configChangeObserver: NSObjectProtocol?

    // Emission throttles (audio-thread timestamps, only read/written there).
    private var lastLevelAt: TimeInterval = 0
    private var lastProbeAt: TimeInterval = 0
    private let levelInterval: TimeInterval = 0.05  // ~20Hz
    private let probeInterval: TimeInterval = 0.10  // ~10Hz

    // Callbacks — invoked from the audio tap thread; main.swift marshals
    // them onto serial output queues.
    var onPCM: ((Data) -> Void)?
    var onLevel: ((ChannelLevel) -> Void)?
    var onChannelLevels: (([ChannelLevel]) -> Void)?
    var onError: ((String, String) -> Void)? // (code, message)
    var onLog: ((String) -> Void)?

    // MARK: - lifecycle

    func start(deviceUID uid: String, channels: [Int], gain: Float, emitPCM: Bool) throws {
        stop()
        guard let deviceID = DeviceEnumerator.deviceID(forUID: uid) else {
            throw CaptureError.deviceNotFound(uid)
        }
        self.deviceUID = uid
        self.emitPCM = emitPCM
        paramLock.lock()
        self.channels = channels.isEmpty ? [0] : channels
        self.gain = gain
        paramLock.unlock()

        // Pin the AUHAL to the requested device BEFORE reading formats or
        // starting — the research-confirmed technique for non-default input.
        let inputNode = engine.inputNode
        guard let au = inputNode.audioUnit else { throw CaptureError.badInputFormat }
        var devID = deviceID
        let status = AudioUnitSetProperty(
            au,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &devID,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )
        guard status == noErr else { throw CaptureError.devicePinFailed(status) }

        let inFormat = inputNode.inputFormat(forBus: 0)
        guard inFormat.sampleRate > 0, inFormat.channelCount > 0 else {
            throw CaptureError.badInputFormat
        }

        // mono float @ hardware rate → Int16 interleaved @ 16k
        guard
            let mono = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: inFormat.sampleRate, channels: 1, interleaved: false),
            let out = AVAudioFormat(
                commonFormat: .pcmFormatInt16,
                sampleRate: Self.outputSampleRate, channels: 1, interleaved: true),
            let conv = AVAudioConverter(from: mono, to: out)
        else { throw CaptureError.converterInit }
        conv.sampleRateConverterQuality = AVAudioQuality.medium.rawValue
        monoFormat = mono
        outFormat = out
        converter = conv
        monoScratch = nil // re-allocated lazily to the tap's buffer size

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: inFormat) { [weak self] buffer, _ in
            self?.handleTap(buffer: buffer)
        }

        // AVAudioEngine drops the AUHAL device pin on configuration changes
        // (e.g. default-device switch, sample-rate change) — re-apply.
        configChangeObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: nil
        ) { [weak self] _ in
            self?.handleConfigurationChange()
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            inputNode.removeTap(onBus: 0)
            removeObserver()
            throw CaptureError.engineStart(error)
        }
        running = true
    }

    func stop() {
        guard running || engine.isRunning else {
            removeObserver()
            return
        }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        removeObserver()
        running = false
        paramLock.lock()
        probing = false
        paramLock.unlock()
    }

    private func removeObserver() {
        if let obs = configChangeObserver {
            NotificationCenter.default.removeObserver(obs)
            configChangeObserver = nil
        }
    }

    private func handleConfigurationChange() {
        guard running else { return }
        let uid = deviceUID
        let pcm = emitPCM
        paramLock.lock()
        let ch = channels
        let g = gain
        let wasProbing = probing
        paramLock.unlock()
        onLog?("engine configuration change — restarting capture on \(uid)")
        do {
            try start(deviceUID: uid, channels: ch, gain: g, emitPCM: pcm)
            if wasProbing { setProbing(true) }
        } catch {
            onError?("config-change-restart-failed", String(describing: error))
        }
    }

    // MARK: - live parameter updates

    func setChannels(_ newChannels: [Int]) {
        paramLock.lock()
        channels = newChannels.isEmpty ? [0] : newChannels
        paramLock.unlock()
    }

    func setGain(_ newGain: Float) {
        paramLock.lock()
        gain = max(0, min(newGain, 16))
        paramLock.unlock()
    }

    func setProbing(_ on: Bool) {
        paramLock.lock()
        probing = on
        paramLock.unlock()
    }

    var isProbing: Bool {
        paramLock.lock()
        defer { paramLock.unlock() }
        return probing
    }

    // MARK: - tap

    private func handleTap(buffer: AVAudioPCMBuffer) {
        guard let src = buffer.floatChannelData else { return }
        let frames = Int(buffer.frameLength)
        let srcChannels = Int(buffer.format.channelCount)
        guard frames > 0, srcChannels > 0 else { return }

        paramLock.lock()
        let selected = channels
        let g = gain
        let probeNow = probing
        paramLock.unlock()

        let now = ProcessInfo.processInfo.systemUptime

        // Per-channel probe stats (~10Hz) — same tap, zero extra sessions.
        if probeNow, now - lastProbeAt >= probeInterval {
            lastProbeAt = now
            onChannelLevels?(ChannelProbe.computeLevels(buffer: buffer))
        }

        guard emitPCM, let conv = converter, let mono = monoFormat, let out = outFormat
        else { return }

        // -- mixdown to mono --------------------------------------------
        if monoScratch == nil || monoScratch!.frameCapacity < AVAudioFrameCount(frames) {
            monoScratch = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: AVAudioFrameCount(frames))
        }
        guard let monoBuf = monoScratch, let dst = monoBuf.floatChannelData?[0] else { return }
        monoBuf.frameLength = AVAudioFrameCount(frames)

        // Clamp selection to channels that actually exist in this buffer.
        let valid = selected.filter { $0 >= 0 && $0 < srcChannels }
        let use = valid.isEmpty ? [0] : valid
        // mono pick / stereo-pair 0.5 sum / sum-all 1/sqrt(N)
        let scale: Float
        switch use.count {
        case 1: scale = 1.0
        case 2: scale = 0.5
        default: scale = 1.0 / sqrt(Float(use.count))
        }

        if use.count == 1 {
            let s = src[use[0]]
            for i in 0..<frames { dst[i] = s[i] * g }
        } else {
            for i in 0..<frames { dst[i] = 0 }
            for c in use {
                let s = src[c]
                for i in 0..<frames { dst[i] += s[i] }
            }
            let k = scale * g
            for i in 0..<frames { dst[i] *= k }
        }

        // -- level meter (~20Hz), post-mix post-gain --------------------
        if now - lastLevelAt >= levelInterval {
            lastLevelAt = now
            onLevel?(ChannelProbe.computeMonoLevel(samples: dst, count: frames))
        }

        // -- resample to 16k Int16 --------------------------------------
        let ratio = Self.outputSampleRate / mono.sampleRate
        let capacity = AVAudioFrameCount(Double(frames) * ratio) + 32
        guard let outBuf = AVAudioPCMBuffer(pcmFormat: out, frameCapacity: capacity) else { return }
        var fed = false
        var convError: NSError?
        let status = conv.convert(to: outBuf, error: &convError) { _, outStatus in
            if fed {
                outStatus.pointee = .noDataNow
                return nil
            }
            fed = true
            outStatus.pointee = .haveData
            return monoBuf
        }
        if status == .error {
            onError?("convert-failed", convError?.localizedDescription ?? "AVAudioConverter error")
            return
        }
        let outFrames = Int(outBuf.frameLength)
        guard outFrames > 0, let int16Data = outBuf.int16ChannelData?[0] else { return }
        let data = Data(bytes: int16Data, count: outFrames * MemoryLayout<Int16>.size)
        onPCM?(data)
    }
}
