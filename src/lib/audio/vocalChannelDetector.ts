/**
 * vocalChannelDetector
 * -------------------------------------------------------------------------
 * Runs a fixed-duration scan across every channel of an already-open
 * MultiChannelCapture and recommends which channel most likely carries a
 * vocal mic (typically the pastor/preacher).
 *
 * Purpose: on a 16/32-channel USB mixer feed (Allen & Heath SQ, X32,
 * Soundcraft Ui, etc.), the operator has no visual way to know which
 * channel index maps to the pulpit mic. Auto-detect samples per-channel
 * FFT/RMS energy for ~10s, then ranks channels by a weighted score that
 * favours (a) raw vocal-band energy, (b) vocal-dominated spectra
 * (reject drums/bass), and (c) consistently active channels (reject
 * brief spikes / channel bleed).
 *
 * Pure service — no React. Consumer owns the MultiChannelCapture lifecycle.
 */

import type { MultiChannelCapture } from "./multiChannelCapture";

// --- Types -----------------------------------------------------------------

export interface ChannelScore {
  /** 0-indexed channel position within the capture. */
  channel: number;
  /** Average `vocalBandEnergy` across the scan window. 0..1 */
  vocalBandEnergy: number;
  /** Average `rms` across the scan window. 0..1 */
  totalEnergy: number;
  /** vocalBandEnergy / max(totalEnergy, 0.001). Higher = vocal-dominant. */
  vocalRatio: number;
  /** Weighted ranking score. See runVocalChannelDetection for weights. */
  score: number;
  /** Fraction of samples with rms > silenceThreshold. 0..1 */
  activeFraction: number;
}

export interface VocalDetectionResult {
  /** Sorted descending by `score`. Always has one entry per channel. */
  rankedChannels: ChannelScore[];
  /** Highest-scoring channel that also passed the "usable" gate, else null. */
  bestChannel: number | null;
  /** Wall-clock duration of the scan, in ms. */
  scanDurationMs: number;
}

export interface VocalDetectionOptions {
  /** Total scan duration in ms. Default 10 000 (10s). */
  durationMs?: number;
  /** Ms between `readLevels()` polls. Default 50 (~20fps). */
  sampleIntervalMs?: number;
  /** RMS values at or below this are treated as silence. Default 0.01. */
  silenceThreshold?: number;
  /**
   * Fires on every sample tick with the elapsed time and the current
   * per-channel rolling scores (same shape returned in `rankedChannels`,
   * but NOT sorted — indices align with channel index).
   */
  onProgress?: (elapsedMs: number, currentLevels: ChannelScore[]) => void;
  /** Abort mid-scan; throws DOMException("Aborted", "AbortError"). */
  signal?: AbortSignal;
}

// --- Implementation --------------------------------------------------------

const DEFAULT_DURATION_MS = 10_000;
const DEFAULT_SAMPLE_INTERVAL_MS = 50;
const DEFAULT_SILENCE_THRESHOLD = 0.01;

const MIN_ACTIVE_FRACTION_FOR_BEST = 0.2;
const MIN_VOCAL_ENERGY_FOR_BEST = 0.02;

// Weights: raw vocal energy dominates, ratio filters bass/drum-only
// channels, activeFraction rejects "spike once and go quiet" channels.
const WEIGHT_VOCAL_ENERGY = 0.5;
const WEIGHT_VOCAL_RATIO = 0.3;
const WEIGHT_ACTIVE_FRACTION = 0.2;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Sample the capture for `durationMs` and return per-channel scores.
 * Never throws for empty-channel captures — returns an empty rankedChannels
 * and bestChannel: null so the UI can render "no channels" cleanly.
 */
export async function runVocalChannelDetection(
  capture: MultiChannelCapture,
  opts: VocalDetectionOptions = {},
): Promise<VocalDetectionResult> {
  const durationMs = opts.durationMs ?? DEFAULT_DURATION_MS;
  const sampleIntervalMs = opts.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
  const silenceThreshold = opts.silenceThreshold ?? DEFAULT_SILENCE_THRESHOLD;
  const onProgress = opts.onProgress;
  const signal = opts.signal;

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const channelCount = capture.channelCount;

  // Per-channel accumulators.
  const sumVocal = new Float64Array(channelCount);
  const sumRms = new Float64Array(channelCount);
  const activeCount = new Int32Array(channelCount);

  let sampleCount = 0;
  const startedAt = performance.now();

  // Loop budget: derive tick count from duration/interval, then re-check
  // the actual elapsed time at the end so we don't overshoot on a busy
  // main thread.
  while (true) {
    const elapsed = performance.now() - startedAt;
    if (elapsed >= durationMs) break;

    const levels = capture.readLevels();
    sampleCount += 1;
    for (let i = 0; i < channelCount; i += 1) {
      const lvl = levels[i];
      if (!lvl) continue;
      sumVocal[i]! += lvl.vocalBandEnergy;
      sumRms[i]! += lvl.rms;
      if (lvl.rms > silenceThreshold) {
        activeCount[i]! += 1;
      }
    }

    if (onProgress) {
      // Emit rolling scores so the UI can highlight the current leader.
      const rolling = buildScores(
        channelCount,
        sumVocal,
        sumRms,
        activeCount,
        sampleCount,
      );
      try {
        onProgress(elapsed, rolling);
      } catch {
        // UI callback errors must not kill the scan.
      }
    }

    // Sleep to the next tick, aborting cleanly if the caller cancels.
    const nextDelay = Math.min(
      sampleIntervalMs,
      Math.max(0, durationMs - (performance.now() - startedAt)),
    );
    if (nextDelay <= 0) break;
    await sleep(nextDelay, signal);
  }

  const scanDurationMs = performance.now() - startedAt;

  // Final scores. If sampleCount is 0 (e.g. immediate abort race), fall
  // back to a zeroed set rather than dividing by zero.
  const finalScores = buildScores(
    channelCount,
    sumVocal,
    sumRms,
    activeCount,
    sampleCount || 1,
  );

  const rankedChannels = [...finalScores].sort((a, b) => b.score - a.score);

  let bestChannel: number | null = null;
  const top = rankedChannels[0];
  if (
    top &&
    top.activeFraction > MIN_ACTIVE_FRACTION_FOR_BEST &&
    top.vocalBandEnergy > MIN_VOCAL_ENERGY_FOR_BEST
  ) {
    bestChannel = top.channel;
  }

  return {
    rankedChannels,
    bestChannel,
    scanDurationMs,
  };
}

function buildScores(
  channelCount: number,
  sumVocal: Float64Array,
  sumRms: Float64Array,
  activeCount: Int32Array,
  sampleCount: number,
): ChannelScore[] {
  const out: ChannelScore[] = new Array(channelCount);
  for (let i = 0; i < channelCount; i += 1) {
    const vocalBandEnergy = sumVocal[i]! / sampleCount;
    const totalEnergy = sumRms[i]! / sampleCount;
    const activeFraction = activeCount[i]! / sampleCount;
    const vocalRatio = vocalBandEnergy / Math.max(totalEnergy, 0.001);
    // Clamp ratio into a sane 0..1 range for weighting. Very low
    // totalEnergy could otherwise let vocalRatio spike unrealistically.
    const clampedRatio = vocalRatio > 1 ? 1 : vocalRatio < 0 ? 0 : vocalRatio;
    const score =
      vocalBandEnergy * WEIGHT_VOCAL_ENERGY +
      clampedRatio * WEIGHT_VOCAL_RATIO +
      activeFraction * WEIGHT_ACTIVE_FRACTION;
    out[i] = {
      channel: i,
      vocalBandEnergy,
      totalEnergy,
      vocalRatio: clampedRatio,
      activeFraction,
      score,
    };
  }
  return out;
}
