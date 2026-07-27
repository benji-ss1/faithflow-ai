// pcmLevel.ts — pure RMS/peak/dB computation from Int16 PCM buffers.
// Kept intentionally dependency-free so it stays cheap in the hot path;
// nativeCapture.ts calls this for every stdout chunk from ffmpeg (up to a
// few hundred times per second) and multiChannelProbe.ts calls
// splitInterleaved on every 50ms window across up to 32 channels.

export type Level = { rms: number; db: number; peak: number };

/**
 * RMS + peak + dBFS from a single mono/interleaved-collapsed Int16 buffer.
 * Values normalized to [0, 1] (dBFS in the -inf..0 range).
 * `buf` may be any subarray of a Node Buffer — we honor byteOffset/length.
 */
export function computeLevel(buf: Buffer): Level {
  if (!buf || buf.length < 2) return { rms: 0, db: -Infinity, peak: 0 };
  // Guard: Int16Array requires even byte length; drop trailing odd byte.
  const usableLen = buf.length - (buf.length % 2);
  const samples = new Int16Array(buf.buffer, buf.byteOffset, usableLen / 2);
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 32768;
    sumSq += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  const rms = samples.length > 0 ? Math.sqrt(sumSq / samples.length) : 0;
  const db = 20 * Math.log10(Math.max(rms, 1e-9));
  return { rms, db, peak };
}

/**
 * Split an interleaved multi-channel Int16 buffer into per-channel levels.
 * `nCh` is the number of interleaved channels in the buffer. Used by the
 * channel-grid probe so we can render 32 meters at ~20Hz without spawning
 * 32 ffmpeg subprocesses.
 */
export function splitInterleaved(buf: Buffer, nCh: number): Level[] {
  if (nCh <= 0) return [];
  if (!buf || buf.length < 2) {
    return Array.from({ length: nCh }, () => ({ rms: 0, db: -Infinity, peak: 0 }));
  }
  const usableLen = buf.length - (buf.length % 2);
  const samples = new Int16Array(buf.buffer, buf.byteOffset, usableLen / 2);
  const sumSq = new Float64Array(nCh);
  const peak = new Float64Array(nCh);
  const count = new Uint32Array(nCh);
  for (let i = 0; i < samples.length; i++) {
    const ch = i % nCh;
    const v = samples[i] / 32768;
    sumSq[ch] += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak[ch]) peak[ch] = a;
    count[ch] += 1;
  }
  const out: Level[] = new Array(nCh);
  for (let c = 0; c < nCh; c++) {
    const n = Math.max(1, count[c]);
    const rms = Math.sqrt(sumSq[c] / n);
    const db = 20 * Math.log10(Math.max(rms, 1e-9));
    out[c] = { rms, db, peak: peak[c] };
  }
  return out;
}
