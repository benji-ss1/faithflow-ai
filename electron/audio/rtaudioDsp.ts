// rtaudioDsp.ts — pure, dependency-free DSP for the RtAudio capture tier
// (hardware I/O Phase B, docs/HARDWARE_IO_PLAN.md). Kept separate from the
// native binding so it is unit-testable in plain Node.
//
// The renderer already expresses channel routing as an ffmpeg `pan` filter
// (src/lib/audio/nativeDeviceStore.ts buildChannelFilter):
//   "pan=mono|c0=c6"                 → channel 6
//   "pan=mono|c0=1.995*c6"           → channel 6 with gain
//   "pan=mono|c0=0.5*c0+0.5*c1"      → stereo pair summed
// We parse that SAME string so the renderer contract is unchanged across tiers.

export type MixTerm = { channel: number; gain: number };

/** Parse an ffmpeg mono pan expression. Returns null = sum-all (no/unknown filter). */
export function parsePanFilter(filter: string | undefined | null): MixTerm[] | null {
  if (!filter || filter.length > 512) return null;
  const m = /^pan=mono\|c0=(.+)$/.exec(filter.trim());
  if (!m) return null;
  const parts = m[1].split("+");
  if (parts.length > 64) return null;
  const terms: MixTerm[] = [];
  const seen = new Set<number>();
  for (const part of parts) {
    const t = /^\s*(?:(-?\d+(?:\.\d+)?)\s*\*\s*)?c(\d+)\s*$/.exec(part);
    if (!t) return null;
    const gain = t[1] === undefined ? 1 : Number(t[1]);
    const channel = Number(t[2]);
    if (!Number.isFinite(gain) || Math.abs(gain) > 16 || !Number.isInteger(channel) || channel < 0 || channel > 255) return null;
    if (seen.has(channel)) return null;
    seen.add(channel);
    terms.push({ channel, gain });
  }
  return terms.length ? terms : null;
}

/**
 * Interleaved Int16 (N channels) → mono Float32 in [-1, 1].
 * `terms === null` sums all channels / N. Terms pointing past N are ignored.
 */
export function mixToMono(interleaved: Int16Array, channels: number, terms: MixTerm[] | null): Float32Array {
  const ch = Math.max(1, channels | 0);
  const frames = Math.floor(interleaved.length / ch);
  const out = new Float32Array(frames);
  const valid = terms?.filter((t) => t.channel < ch) ?? null;
  for (let f = 0; f < frames; f++) {
    const base = f * ch;
    let acc = 0;
    if (valid === null) {
      for (let c = 0; c < ch; c++) acc += interleaved[base + c];
      // √N (not N): one live mic on a 32ch interface must not arrive ~30 dB
      // under-driven (stress review). Clipped below.
      acc /= Math.sqrt(ch);
    } else {
      for (const t of valid) acc += interleaved[base + t.channel] * t.gain;
    }
    const v = acc / 32768;
    out[f] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return out;
}

/**
 * Streaming downsampler to a target rate (16 kHz for Deepgram).
 * Windowed-sinc (Blackman) low-pass at 0.45·outRate, then fractional
 * linear-interpolated decimation. Filter history + fractional position carry
 * across chunks, so output is continuous and drift-free for any chunking.
 */
export class StreamingResampler {
  private readonly ratio: number;
  private readonly taps: Float32Array;
  private readonly hist: Float32Array; // last taps.length input samples (ring)
  private histPos = 0;
  private prevFiltered = 0;
  private phase = 0; // position of next output between prevFiltered (0) and current (1)

  constructor(readonly inRate: number, readonly outRate: number, numTaps = 63) {
    if (!(inRate > 0) || !(outRate > 0)) throw new Error("invalid sample rates");
    this.ratio = inRate / outRate;
    const n = numTaps | 1;
    const fc = Math.min(0.5, (0.45 * outRate) / inRate); // normalised cutoff
    const taps = new Float32Array(n);
    const m = (n - 1) / 2;
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const x = k - m;
      const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (n - 1));
      taps[k] = sinc * w;
      sum += taps[k];
    }
    for (let k = 0; k < n; k++) taps[k] /= sum; // unity DC gain
    this.taps = taps;
    this.hist = new Float32Array(n);
  }

  process(input: Float32Array): Int16Array {
    const out = new Int16Array(Math.ceil(input.length / this.ratio) + 2);
    let o = 0;
    const n = this.taps.length;
    const step = 1 / this.ratio;
    for (let i = 0; i < input.length; i++) {
      this.hist[this.histPos] = input[i];
      this.histPos = (this.histPos + 1) % n;
      let y = 0;
      for (let k = 0; k < n; k++) y += this.taps[k] * this.hist[(this.histPos + k) % n];
      // Emit every output instant that falls between the previous and this sample.
      while (this.phase <= 1) {
        const v = this.prevFiltered + (y - this.prevFiltered) * this.phase;
        const c = v > 1 ? 1 : v < -1 ? -1 : v;
        out[o++] = c < 0 ? Math.round(c * 32768) : Math.round(c * 32767);
        this.phase += this.ratio;
      }
      this.phase -= 1;
      this.prevFiltered = y;
    }
    return out.subarray(0, o);
  }
}

/** Per-channel RMS/peak/dBFS for an interleaved Int16 window (meters). */
export function channelLevels(interleaved: Int16Array, channels: number): { channel: number; rms: number; db: number; peak: number }[] {
  const ch = Math.max(1, channels | 0);
  const frames = Math.floor(interleaved.length / ch);
  const res = [];
  for (let c = 0; c < ch; c++) {
    let sumSq = 0;
    let peak = 0;
    for (let f = 0; f < frames; f++) {
      const v = interleaved[f * ch + c] / 32768;
      sumSq += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const rms = frames ? Math.sqrt(sumSq / frames) : 0;
    res.push({ channel: c, rms, db: 20 * Math.log10(Math.max(rms, 1e-9)), peak });
  }
  return res;
}

/**
 * Stable device index encoding across RtAudio host APIs so a Windows ASIO
 * device and the same interface's WASAPI endpoint never collide.
 */
export const API_INDEX_BASE = 100000;
export function encodeDeviceIndex(api: number, id: number): number {
  return api * API_INDEX_BASE + id;
}
export function decodeDeviceIndex(index: number): { api: number; id: number } {
  return { api: Math.floor(index / API_INDEX_BASE), id: index % API_INDEX_BASE };
}

/** Pseudo host-API id for Blackmagic Desktop Video embedded audio (Phase C). */
export const API_DECKLINK = 50;
export function isDeckLinkIndex(index: number): boolean {
  return Number.isFinite(index) && decodeDeviceIndex(index).api === API_DECKLINK;
}
/** DeckLink EnableAudioInput accepts 2, 8 or 16 channels only. */
export function deckLinkChannels(max: number | undefined): 2 | 8 | 16 {
  const m = typeof max === "number" && max > 0 ? max : 2;
  return m >= 16 ? 16 : m >= 8 ? 8 : 2;
}
