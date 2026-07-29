// ChannelProbe.swift — per-channel level statistics computed inside the
// shared capture tap. Powers the channel-grid picker (up to 32 live meters)
// without a second audio session: probing while capturing is just the same
// tap also computing per-channel stats.

import AVFoundation
import Foundation

struct ChannelLevel {
    let rms: Float
    let peak: Float
    let db: Float

    func toJSONObject(channel: Int) -> [String: Any] {
        return [
            "channel": channel,
            "rms": Double(rms),
            "peak": Double(peak),
            "db": db.isFinite ? Double(db) : -160.0,
        ]
    }
}

enum ChannelProbe {

    /// Compute rms/peak/dBFS for every channel of a deinterleaved float
    /// PCM buffer. Cost is one pass per channel — trivial even at 32ch/48k.
    static func computeLevels(buffer: AVAudioPCMBuffer) -> [ChannelLevel] {
        guard let data = buffer.floatChannelData else { return [] }
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0, channels > 0 else { return [] }
        var out: [ChannelLevel] = []
        out.reserveCapacity(channels)
        for c in 0..<channels {
            let samples = data[c]
            var sumSq: Float = 0
            var peak: Float = 0
            for i in 0..<frames {
                let v = samples[i]
                sumSq += v * v
                let a = abs(v)
                if a > peak { peak = a }
            }
            let rms = sqrt(sumSq / Float(frames))
            let db = 20 * log10(max(rms, 1e-9))
            out.append(ChannelLevel(rms: rms, peak: peak, db: db))
        }
        return out
    }

    /// Single-channel (post-mix mono) level — used for the ~20Hz capture VU.
    static func computeMonoLevel(samples: UnsafePointer<Float>, count: Int) -> ChannelLevel {
        guard count > 0 else { return ChannelLevel(rms: 0, peak: 0, db: -160) }
        var sumSq: Float = 0
        var peak: Float = 0
        for i in 0..<count {
            let v = samples[i]
            sumSq += v * v
            let a = abs(v)
            if a > peak { peak = a }
        }
        let rms = sqrt(sumSq / Float(count))
        let db = 20 * log10(max(rms, 1e-9))
        return ChannelLevel(rms: rms, peak: peak, db: db)
    }
}
