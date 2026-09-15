/**
 * audioDiagnostics — Sarah audio setup (2026-09-15)
 * -------------------------------------------------------------------------
 * Deterministic pass/warn/fail checks over level frames the app ALREADY emits
 * (native onLevel / onChannelLevels: { rms, db, peak }). Sarah (the LLM) only
 * explains these results — she never decides pass/fail. Pure; no capture.
 *
 * Thresholds from docs/audio/AUDIO_SETUP_KNOWLEDGE_BASE.md §C:
 *   speech peaks ≈ -18..-12 dBFS; below -24 hurts ASR; clipping ≥ -1 dBFS;
 *   noise floor above -50 dBFS in a quiet room suggests hum / an open channel.
 */

export type LevelFrame = { db: number; peak: number; rms?: number };
export type CheckStatus = "pass" | "warn" | "fail";
export type CheckId = "signal" | "noise-floor" | "speech-level" | "clipping" | "channel";

export interface DiagnosticCheck { id: CheckId; status: CheckStatus; value?: number; detail: string }

export const THRESHOLDS = {
  silenceDb: -60,
  quietNoiseWarnDb: -50,
  quietNoiseFailDb: -40,
  speechLowFailDb: -30,
  speechLowWarnDb: -24,
  speechHotWarnDb: -6,
  clipPeak: 0.89, // ≈ -1 dBFS linear
  clipFractionFail: 0.02,
} as const;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const dbOfPeak = (p: number) => (p > 0 ? 20 * Math.log10(p) : -120);

function percentile(values: number[], q: number): number {
  if (values.length === 0) return -120;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

/** Quiet-room check (~10 s, nobody talking): median level = noise floor. */
export function checkNoiseFloor(frames: LevelFrame[]): DiagnosticCheck {
  const dbs = frames.map((f) => f.db).filter(finite);
  if (dbs.length < 5) return { id: "noise-floor", status: "warn", detail: "Not enough audio to measure the quiet room." };
  const floor = Math.round(percentile(dbs, 0.5));
  if (floor > THRESHOLDS.quietNoiseFailDb) return { id: "noise-floor", status: "fail", value: floor, detail: `Quiet room is loud (${floor} dBFS). Likely hum/buzz, music still playing, or an open mic.` };
  if (floor > THRESHOLDS.quietNoiseWarnDb) return { id: "noise-floor", status: "warn", value: floor, detail: `Some background noise (${floor} dBFS). Could be light hum or room noise.` };
  return { id: "noise-floor", status: "pass", value: floor, detail: `Quiet room is clean (${floor} dBFS).` };
}

/** Speaking check: any signal at all, speech level, and clipping. */
export function checkSpeech(frames: LevelFrame[]): DiagnosticCheck[] {
  const valid = frames.filter((f) => finite(f.db) && finite(f.peak));
  if (valid.length < 5) return [{ id: "signal", status: "fail", detail: "No audio frames arrived from this input." }];
  const loud = percentile(valid.map((f) => dbOfPeak(f.peak)), 0.9);
  const out: DiagnosticCheck[] = [];
  if (loud <= THRESHOLDS.silenceDb) {
    out.push({ id: "signal", status: "fail", value: Math.round(loud), detail: "Silence — nothing is reaching this input." });
    return out;
  }
  out.push({ id: "signal", status: "pass", detail: "Audio is reaching PresentFlow." });
  const v = Math.round(loud);
  if (loud < THRESHOLDS.speechLowFailDb) out.push({ id: "speech-level", status: "fail", value: v, detail: `Voice is far too quiet (${v} dBFS peaks).` });
  else if (loud < THRESHOLDS.speechLowWarnDb) out.push({ id: "speech-level", status: "warn", value: v, detail: `Voice is a bit quiet (${v} dBFS peaks).` });
  else if (loud > THRESHOLDS.speechHotWarnDb) out.push({ id: "speech-level", status: "warn", value: v, detail: `Voice is hot (${v} dBFS peaks) — close to distorting.` });
  else out.push({ id: "speech-level", status: "pass", value: v, detail: `Voice level is healthy (${v} dBFS peaks).` });
  const clipped = valid.filter((f) => f.peak >= THRESHOLDS.clipPeak).length / valid.length;
  out.push(clipped >= THRESHOLDS.clipFractionFail
    ? { id: "clipping", status: "fail", value: Math.round(clipped * 100), detail: `Distorting ${Math.round(clipped * 100)}% of the time.` }
    : { id: "clipping", status: "pass", detail: "No distortion." });
  return out;
}

/** Given per-channel peak history while someone talks, find the channel(s) that moved. */
export function detectActiveChannels(history: Map<number, number[]>, minDb = -40): number[] {
  const scored = [...history.entries()]
    .map(([ch, peaks]) => ({ ch, loud: percentile(peaks.filter(finite).map(dbOfPeak), 0.9) }))
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
