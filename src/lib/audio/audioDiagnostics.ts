/**
 * audioDiagnostics — Sarah audio setup (2026-09-15, hardened after review)
 * -------------------------------------------------------------------------
 * Deterministic pass/warn/fail checks over level frames the app ALREADY emits
 * (native onChannelLevels / browser analyser: { db (rms), peak }). Sarah (the LLM)
 * only explains these results — she never decides pass/fail. Pure; no capture.
 *
 * Noise floor = median RMS level (quiet room). Speech = 90th-percentile PEAK.
 * Clipping = at least 3 CONSECUTIVE frames at ≥ -0.25 dBFS (robust to single
 * converter/limiter overshoots and to frame length), or ≥ 2% of frames.
 */

export type LevelFrame = { db: number; peak: number; rms?: number };
export type CheckStatus = "pass" | "warn" | "fail";
export type CheckId = "signal" | "noise-floor" | "speech-level" | "clipping" | "channel";

export interface DiagnosticCheck { id: CheckId; status: CheckStatus; value?: number; detail: string }

export const THRESHOLDS = {
  silenceDb: -60,
  deadInputDb: -110,
  quietNoiseWarnDb: -45,
  quietNoiseFailDb: -40,
  speechLowFailDb: -30,
  speechLowWarnDb: -24,
  speechHotWarnDb: -6,
  clipPeak: 0.97,
  clipConsecutive: 3,
  clipFractionFail: 0.02,
} as const;

/** -Infinity (digital silence) → -120; NaN/non-numbers dropped. */
const dbValue = (n: unknown): number | null => (typeof n === "number" ? (Number.isNaN(n) ? null : Number.isFinite(n) ? n : n < 0 ? -120 : 0) : null);
const peakValue = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? Math.abs(n) : null);
const dbOfPeak = (p: number) => (p > 0 ? 20 * Math.log10(p) : -120);

function percentile(values: number[], q: number): number {
  if (values.length === 0) return -120;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

/** Quiet-room check (~8 s, nobody talking): median RMS level = noise floor. */
export function checkNoiseFloor(frames: LevelFrame[]): DiagnosticCheck {
  const dbs = (Array.isArray(frames) ? frames : []).map((f) => dbValue(f?.db)).filter((v): v is number => v !== null);
  if (dbs.length < 5) return { id: "noise-floor", status: "warn", detail: "I didn't get enough audio to measure the quiet room." };
  const floor = Math.round(percentile(dbs, 0.5));
  if (floor <= THRESHOLDS.deadInputDb) return { id: "noise-floor", status: "warn", value: floor, detail: "This input is completely silent — not even room noise. Check it's the right input and it's connected." };
  if (floor > THRESHOLDS.quietNoiseFailDb) return { id: "noise-floor", status: "fail", value: floor, detail: `The quiet room is loud (average ${floor} dBFS). Likely hum or buzz, music still playing, or an open mic.` };
  if (floor > THRESHOLDS.quietNoiseWarnDb) return { id: "noise-floor", status: "warn", value: floor, detail: `There's some background noise (average ${floor} dBFS) — maybe light hum or room noise.` };
  return { id: "noise-floor", status: "pass", value: floor, detail: `The quiet room is clean (average ${floor} dBFS).` };
}

/** Speaking check: any signal at all, speech level, and clipping. */
export function checkSpeech(frames: LevelFrame[]): DiagnosticCheck[] {
  const peaks = (Array.isArray(frames) ? frames : []).map((f) => peakValue(f?.peak)).filter((v): v is number => v !== null);
  if (peaks.length < 5) return [{ id: "signal", status: "fail", detail: "No audio arrived from this input." }];
  const loud = percentile(peaks.map(dbOfPeak), 0.9);
  const out: DiagnosticCheck[] = [];
  if (loud <= THRESHOLDS.silenceDb) {
    out.push({ id: "signal", status: "fail", value: Math.round(loud), detail: "Silence — nothing is reaching this input." });
    return out;
  }
  out.push({ id: "signal", status: "pass", detail: "Audio is reaching PresentFlow." });
  const v = Math.round(loud);
  if (loud < THRESHOLDS.speechLowFailDb) out.push({ id: "speech-level", status: "fail", value: v, detail: `The voice is far too quiet (peaks around ${v} dBFS).` });
  else if (loud < THRESHOLDS.speechLowWarnDb) out.push({ id: "speech-level", status: "warn", value: v, detail: `The voice is a bit quiet (peaks around ${v} dBFS).` });
  else if (loud > THRESHOLDS.speechHotWarnDb) out.push({ id: "speech-level", status: "warn", value: v, detail: `The voice is hot (peaks around ${v} dBFS) — close to distorting.` });
  else out.push({ id: "speech-level", status: "pass", value: v, detail: `The voice level is healthy (peaks around ${v} dBFS).` });
  let run = 0; let maxRun = 0; let hot = 0;
  for (const p of peaks) { if (p >= THRESHOLDS.clipPeak) { hot++; run++; maxRun = Math.max(maxRun, run); } else run = 0; }
  const frac = hot / peaks.length;
  out.push(maxRun >= THRESHOLDS.clipConsecutive || frac >= THRESHOLDS.clipFractionFail
    ? { id: "clipping", status: "fail", value: Math.round(frac * 100), detail: `It's distorting (${Math.round(frac * 100)}% of the time).` }
    : { id: "clipping", status: "pass", detail: "No distortion." });
  return out;
}

/** Given per-channel peak history while someone talks, find the channel(s) that moved. */
export function detectActiveChannels(history: Map<number, number[]>, minDb = -40): number[] {
  const scored = [...history.entries()]
    .map(([ch, ps]) => ({ ch, loud: percentile(ps.map(peakValue).filter((v): v is number => v !== null).map(dbOfPeak), 0.9) }))
    .filter((x) => x.loud > minDb)
    .sort((a, b) => b.loud - a.loud);
  if (scored.length === 0) return [];
  const top = scored[0].loud;
  return scored.filter((x) => x.loud >= top - 6).slice(0, 2).map((x) => x.ch).sort((a, b) => a - b);
}

export function overallStatus(checks: DiagnosticCheck[]): CheckStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "pass";
}

/** Plain-language meter band for volunteers. */
export function levelBand(peakDb: number): "silent" | "quiet" | "good" | "loud" {
  if (peakDb <= THRESHOLDS.silenceDb) return "silent";
  if (peakDb < THRESHOLDS.speechLowWarnDb) return "quiet";
  if (peakDb > THRESHOLDS.speechHotWarnDb) return "loud";
  return "good";
}
