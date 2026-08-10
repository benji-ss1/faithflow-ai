// NDIReceiver.swift — receives audio from an NDI network source and produces
// the SAME 16kHz / mono / Int16 PCM stream as AudioCapture (CoreAudio). To
// everything downstream (main.swift → stdout → Electron → Deepgram/Groq) an
// NDI source is indistinguishable from a USB device: identical PCM, identical
// level / channel-level events, identical set-channel / set-gain / probe.
//
// NDI audio frames are planar 32-bit float, typically 48kHz, N channels. We:
//   1. select channel(s) + apply gain, mixing down to mono (same rules as
//      AudioCapture: single = pass, pair = 0.5 sum, N = 1/sqrt(N) sum),
//   2. emit VU (~20Hz) and per-channel probe levels (~10Hz while probing),
//   3. resample mono float @ source-rate → Int16 @ 16k via AVAudioConverter,
//   4. hand the bytes to onPCM (main.swift writes them to stdout).
//
// The receive loop runs on a dedicated thread; live parameter changes snapshot
// under `paramLock` exactly like AudioCapture's tap.

import AVFoundation
import CNDI
import Foundation

enum NDIReceiveError: Error, CustomStringConvertible {
    case runtimeUnavailable
    case sourceNotFound(String)
    case recvCreateFailed
    case converterInit

    var description: String {
        switch self {
        case .runtimeUnavailable: return "NDI runtime not loaded"
        case .sourceNotFound(let n): return "NDI source not found: \(n)"
        case .recvCreateFailed: return "NDIlib_recv_create_v3 returned null"
        case .converterInit: return "could not create 16kHz Int16 converter"
        }
    }
}

final class NDIReceiver {

    static let outputSampleRate: Double = 16000

    // Untrusted-frame bounds. NDI audio frames arrive from any sender on the
    // LAN, so every header field (sample_rate, no_channels, no_samples,
    // channel_stride) is hostile input that drives pointer math + allocation.
    // Anything outside these ranges is dropped, not processed.
    private static let minSampleRate: Int32 = 8000
    private static let maxSampleRate: Int32 = 192000
    private static let maxChannels = 64
    private static let maxFrames = 1 << 20           // 1,048,576 samples/channel
    private static let maxStrideBytes = 64 * 1024 * 1024

    private let discovery: NDIDiscovery

    // Live-mutable capture parameters (snapshotted by the receive thread).
    private let paramLock = NSLock()
    private var channels: [Int] = [0]
    private var gain: Float = 1.0
    private var probing = false

    // `recv` and `stopFlag` are shared between the main (command) thread and
    // the receive thread; guard both with stateLock so the receive loop sees
    // stop promptly and never dereferences a destroyed instance.
    private let stateLock = NSLock()
    private var recv: NDIlib_recv_instance_t?
    private var stopFlag = false
    private var thread: Thread?
    // Real channel count of the connected source, learned from the first
    // received frame (an NDI source's channel count is unknown until you
    // connect — same as OBS/DistroAV). Guarded by stateLock.
    private var knownChannels = 0
    // Signaled once when the receive loop has fully exited its last capture.
    // stop() waits on this BEFORE calling NDIlib_recv_destroy so the SDK
    // instance is never freed while a capture call is in flight (UAF).
    private var threadDone: DispatchSemaphore?
    private(set) var running = false
    private(set) var emitPCM = true // false = probe-only session (no audio to pipeline)
    private(set) var sourceName = ""

    // Converter state — rebuilt whenever the incoming NDI sample rate changes.
    private var converter: AVAudioConverter?
    private var monoFormat: AVAudioFormat?
    private var outFormat: AVAudioFormat?
    private var converterSampleRate: Double = 0
    private var monoScratch: AVAudioPCMBuffer?

    // Emission throttles (receive-thread only).
    private var lastLevelAt: TimeInterval = 0
    private var lastProbeAt: TimeInterval = 0
    private var lastErrorAt: TimeInterval = 0        // throttle error floods to ~1/s
    private let levelInterval: TimeInterval = 0.05  // ~20Hz
    private let probeInterval: TimeInterval = 0.10  // ~10Hz

    // Callbacks — invoked from the receive thread; main.swift marshals them
    // onto its serial output queues (same contract as AudioCapture).
    var onPCM: ((Data) -> Void)?
    var onLevel: ((ChannelLevel) -> Void)?
    var onChannelLevels: (([ChannelLevel]) -> Void)?
    var onError: ((String, String) -> Void)?
    var onLog: ((String) -> Void)?
    // Fired (receive thread) when the connected source's channel count becomes
    // known or changes, so the device list can be refreshed with the real count.
    var onChannelCount: ((Int) -> Void)?

    init(discovery: NDIDiscovery) {
        self.discovery = discovery
    }

    /// Real channel count of the connected source, or 0 until the first frame.
    func currentChannelCount() -> Int {
        stateLock.lock()
        defer { stateLock.unlock() }
        return knownChannels
    }

    // MARK: - lifecycle

    func start(sourceName name: String, channels: [Int], gain: Float, emitPCM: Bool = true) throws {
        stop()
        guard NDI.shared.isAvailable, let lib = NDI.shared.lib else {
            throw NDIReceiveError.runtimeUnavailable
        }
        paramLock.lock()
        self.channels = channels.isEmpty ? [0] : channels
        self.gain = gain
        paramLock.unlock()
        self.sourceName = name
        self.emitPCM = emitPCM

        // Resolve URL from discovery when we have it; otherwise connect by
        // name and let the receiver resolve it via its own discovery.
        let info = discovery.sourceInfo(named: name)
        let cName = strdup(name)
        let cURL = info?.url.flatMap { strdup($0) }
        defer { free(cName); if let u = cURL { free(u) } }

        var settings = NDIlib_recv_create_v3_t()
        settings.source_to_connect_to.p_ndi_name = UnsafePointer(cName)
        if let cURL = cURL {
            settings.source_to_connect_to.p_url_address = UnsafePointer(cURL)
        }
        settings.color_format = NDIlib_recv_color_format_fastest
        settings.bandwidth = NDIlib_recv_bandwidth_audio_only
        settings.allow_video_fields = false

        guard let instance = lib.pointee.NDIlib_recv_create_v3?(&settings) else {
            throw NDIReceiveError.recvCreateFailed
        }
        stateLock.lock()
        recv = instance
        stopFlag = false
        knownChannels = 0 // re-learn for this source
        stateLock.unlock()
        running = true

        let done = DispatchSemaphore(value: 0)
        threadDone = done
        let t = Thread { [weak self] in
            self?.receiveLoop()
            done.signal()
        }
        t.name = "presentflow.ndi.receive"
        t.stackSize = 1024 * 1024
        thread = t
        t.start()
        onLog?("NDI receiver connected to \"\(name)\"")
    }

    func stop() {
        guard running else { return }
        // Signal stop, then WAIT for the receive loop to fully exit its last
        // capture BEFORE destroying the instance. Destroying while the receive
        // thread is inside NDIlib_recv_capture_v2 on the same instance is a
        // use-after-free. This reproduces the synchronous teardown barrier
        // AVAudioEngine.removeTap gives AudioCapture. (stop() is only ever
        // called from the single stdin command thread, so no re-entrancy.)
        stateLock.lock()
        stopFlag = true
        let r = recv
        stateLock.unlock()
        running = false
        if let done = threadDone {
            // Receive loop's capture timeout is 100ms; 1s is a generous cap in
            // case a capture call blocks longer than expected.
            _ = done.wait(timeout: .now() + 1.0)
            threadDone = nil
        }
        if let r = r, let lib = NDI.shared.lib {
            lib.pointee.NDIlib_recv_destroy?(r)
        }
        stateLock.lock()
        recv = nil
        stateLock.unlock()
        thread = nil
        paramLock.lock()
        probing = false
        paramLock.unlock()
    }

    // MARK: - live parameter updates (mirror AudioCapture)

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

    // MARK: - receive loop (background thread)

    private func receiveLoop() {
        guard let lib = NDI.shared.lib else { return }
        while !stopFlag, let r = recv {
            var audio = NDIlib_audio_frame_v2_t()
            // Only pull audio (video/metadata pointers nil ⇒ discarded).
            let frameType = lib.pointee.NDIlib_recv_capture_v2?(r, nil, &audio, nil, 100)
                ?? NDIlib_frame_type_none
            guard frameType == NDIlib_frame_type_audio else {
                // none/timeout/other — loop and re-check stopFlag.
                continue
            }
            defer { lib.pointee.NDIlib_recv_free_audio_v2?(r, &audio) }
            processAudioFrame(audio)
        }
    }

    /// Emit an error at most ~once/second so a persistently bad sender or a
    /// wedged converter can't flood the renderer with toasts.
    private func throttledError(_ code: String, _ message: String) {
        let now = ProcessInfo.processInfo.systemUptime
        if now - lastErrorAt < 1.0 { return }
        lastErrorAt = now
        onError?(code, message)
    }

    private func processAudioFrame(_ frame: NDIlib_audio_frame_v2_t) {
        guard let base = frame.p_data else { return }
        let srcChannels = Int(frame.no_channels)
        let frames = Int(frame.no_samples)
        // Validate UNTRUSTED header fields before any pointer math/allocation.
        // Reject (drop) rather than clamp — a frame this malformed is garbage.
        guard frame.sample_rate >= Self.minSampleRate, frame.sample_rate <= Self.maxSampleRate,
              srcChannels >= 1, srcChannels <= Self.maxChannels,
              frames >= 1, frames <= Self.maxFrames
        else {
            throttledError("ndi-frame-rejected",
                "dropped malformed NDI audio frame (rate=\(frame.sample_rate) ch=\(frame.no_channels) samples=\(frame.no_samples))")
            return
        }
        let srcRate = Double(frame.sample_rate)

        // Planar float: channel c starts at base + c * channel_stride bytes.
        // Some senders report stride 0 meaning tightly-packed (= frames*4).
        // Require at least one full plane and reject absurd/negative strides
        // (negative → OOB read before `base`; huge → nonsense).
        let minStride = frames * MemoryLayout<Float>.size
        let rawStride = Int(frame.channel_stride_in_bytes)
        let stride = rawStride == 0 ? minStride : rawStride
        guard stride >= minStride, stride <= Self.maxStrideBytes else {
            throttledError("ndi-frame-rejected",
                "dropped NDI audio frame (bad channel stride=\(rawStride), need \(minStride)…\(Self.maxStrideBytes))")
            return
        }

        // Publish the real channel count the first time we see it (or if the
        // source renegotiates), so the picker can show the true count + grid.
        stateLock.lock()
        let channelsChanged = srcChannels != knownChannels
        if channelsChanged { knownChannels = srcChannels }
        stateLock.unlock()
        if channelsChanged { onChannelCount?(srcChannels) }

        paramLock.lock()
        let selected = channels
        let g = gain
        let probeNow = probing
        paramLock.unlock()

        let raw = UnsafeRawPointer(base)
        func plane(_ c: Int) -> UnsafePointer<Float> {
            return (raw + c * stride).assumingMemoryBound(to: Float.self)
        }

        let now = ProcessInfo.processInfo.systemUptime

        // Per-channel probe stats (~10Hz) — computed directly from planes.
        if probeNow, now - lastProbeAt >= probeInterval {
            lastProbeAt = now
            var levels: [ChannelLevel] = []
            levels.reserveCapacity(srcChannels)
            for c in 0..<srcChannels {
                levels.append(ChannelProbe.computeMonoLevel(samples: plane(c), count: frames))
            }
            onChannelLevels?(levels)
        }

        // Probe-only session: we only needed the per-channel levels above —
        // never touch the pipeline (no mixdown, no resample, no PCM).
        if !emitPCM { return }

        // (Re)build the converter if this is the first frame or the source
        // sample rate changed mid-stream.
        if converter == nil || converterSampleRate != srcRate {
            guard rebuildConverter(sampleRate: srcRate) else {
                throttledError("convert-init-failed", "could not build converter for \(srcRate)Hz")
                return
            }
        }
        guard let conv = converter, let mono = monoFormat, let out = outFormat else { return }

        // -- mixdown selected channels → mono, apply gain -------------------
        if monoScratch == nil || monoScratch!.frameCapacity < AVAudioFrameCount(frames) {
            monoScratch = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: AVAudioFrameCount(frames))
        }
        guard let monoBuf = monoScratch, let dst = monoBuf.floatChannelData?[0] else { return }
        monoBuf.frameLength = AVAudioFrameCount(frames)

        let valid = selected.filter { $0 >= 0 && $0 < srcChannels }
        let use = valid.isEmpty ? [0] : valid
        let scale: Float
        switch use.count {
        case 1: scale = 1.0
        case 2: scale = 0.5
        default: scale = 1.0 / sqrt(Float(use.count))
        }
        if use.count == 1 {
            let s = plane(use[0])
            for i in 0..<frames { dst[i] = s[i] * g }
        } else {
            for i in 0..<frames { dst[i] = 0 }
            for c in use {
                let s = plane(c)
                for i in 0..<frames { dst[i] += s[i] }
            }
            let k = scale * g
            for i in 0..<frames { dst[i] *= k }
        }

        // -- VU meter (~20Hz), post-mix post-gain ---------------------------
        if now - lastLevelAt >= levelInterval {
            lastLevelAt = now
            onLevel?(ChannelProbe.computeMonoLevel(samples: dst, count: frames))
        }

        // -- resample to 16k Int16 ------------------------------------------
        let ratio = Self.outputSampleRate / srcRate
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
            throttledError("convert-failed", convError?.localizedDescription ?? "AVAudioConverter error")
            return
        }
        let outFrames = Int(outBuf.frameLength)
        guard outFrames > 0, let int16Data = outBuf.int16ChannelData?[0] else { return }
        let data = Data(bytes: int16Data, count: outFrames * MemoryLayout<Int16>.size)
        onPCM?(data)
    }

    private func rebuildConverter(sampleRate: Double) -> Bool {
        guard
            let mono = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: sampleRate, channels: 1, interleaved: false),
            let out = AVAudioFormat(
                commonFormat: .pcmFormatInt16,
                sampleRate: Self.outputSampleRate, channels: 1, interleaved: true),
            let conv = AVAudioConverter(from: mono, to: out)
        else { return false }
        // Kept at .medium to match the field-proven USB path (AudioCapture.swift).
        // For 48k→16k mono speech, medium is transparent to the ASR; NDI's real
        // latency is dominated by LAN + the SDK's own receive buffering, not the
        // sample-rate converter, so lowering quality would trade accuracy risk
        // for no measurable latency win. Do not diverge without a measured test.
        conv.sampleRateConverterQuality = AVAudioQuality.medium.rawValue
        monoFormat = mono
        outFormat = out
        converter = conv
        converterSampleRate = sampleRate
        monoScratch = nil // re-allocated lazily at the new format
        return true
    }
}
