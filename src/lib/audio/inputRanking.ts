/**
 * inputRanking — unified priority ranking for NATIVE (ffmpeg-enumerated)
 * input devices in the desktop app.
 *
 * 2026-07-27 (unified native input system) — v0.1.80 field-confirmed the
 * native ffmpeg capture path at JPD (Allen & Heath SQ over USB). The native
 * device list is now THE input list in the desktop app, so it needs the
 * same categorize-and-prioritize treatment the browser picker had, plus an
 * auto-pick helper so a fresh install lands on the mixer without any click.
 *
 * Ranks (lower = better):
 *   0 = mixer / USB audio interface (SQ, X32, VID prefixes, …)
 *   1 = NDI virtual input
 *   2 = other virtual / loopback (BlackHole, Blackmagic, Loopback, VB-Cable)
 *   3 = built-in / generic microphone
 *   4 = Bluetooth (100-300ms latency — always last)
 *
 * Reuses the battle-tested regexes in deviceCategorization.ts (VID prefixes
 * + label matching) — do NOT duplicate those patterns here.
 */

import {
  isBluetoothDevice,
  isMixerDevice,
  isNdiDevice,
} from "./deviceCategorization";

export type RankedNativeDeviceInput = {
  index: number;
  name: string;
  channelCount?: number;
};

// Virtual/loopback drivers that are NOT NDI. Note: "blackhole" is also in
// the mixer regex (it's a valid clean-feed bridge), but for auto-pick
// priority a real hardware mixer must beat a loopback driver — so the
// virtual check runs BEFORE the mixer check below.
const VIRTUAL_RE = /blackhole|blackmagic|\bloopback\b|soundflower|vb-?audio|vb-?cable|virtual/i;

// Obvious output devices that occasionally leak into input enumerations.
const OUTPUT_RE = /\b(speaker|speakers|output|headphone|headphones)\b/i;

export function isObviousOutput(name: string): boolean {
  return OUTPUT_RE.test(name ?? "");
}

/**
 * Rank a native device name for auto-pick + list-sort priority.
 * Lower = higher priority.
 */
export function rankNativeDevice(name: string): number {
  const n = name ?? "";
  if (isNdiDevice(n)) return 1;
  if (VIRTUAL_RE.test(n)) return 2;
  if (isMixerDevice(n)) return 0;
  if (isBluetoothDevice(n)) return 4;
  return 3; // built-in / generic microphone
}

/** UI tag for a rank. `null` = no tag (plain microphone). */
export function tagForRank(rank: number): "MIXER" | "NDI" | "VIRTUAL" | "BT" | null {
  switch (rank) {
    case 0: return "MIXER";
    case 1: return "NDI";
    case 2: return "VIRTUAL";
    case 4: return "BT";
    default: return null;
  }
}

/** Human reason string used in the auto-pick toast. */
export function autoPickReason(name: string): "mixer detected" | "NDI feed" | "microphone" {
  const r = rankNativeDevice(name);
  if (r === 0) return "mixer detected";
  if (r === 1) return "NDI feed";
  return "microphone";
}

/**
 * Sort comparator: rank asc → channelCount desc → name asc.
 * Exported so the picker list and the auto-pick use identical ordering.
 */
export function compareNativeDevices(
  a: RankedNativeDeviceInput,
  b: RankedNativeDeviceInput
): number {
  const ra = rankNativeDevice(a.name);
  const rb = rankNativeDevice(b.name);
  if (ra !== rb) return ra - rb;
  const ca = a.channelCount ?? 0;
  const cb = b.channelCount ?? 0;
  if (ca !== cb) return cb - ca; // more channels first (mixer main USB bus)
  return (a.name ?? "").localeCompare(b.name ?? "");
}

/**
 * Pick the best native input device for auto-selection on launch.
 * Excludes obvious output devices; lowest rank wins; ties broken by
 * higher channelCount, then alphabetical name. Returns null if the list
 * is empty (or only contains outputs).
 */
export function pickBestNativeDevice<T extends RankedNativeDeviceInput>(
  devices: T[]
): T | null {
  const candidates = devices.filter((d) => !isObviousOutput(d.name));
  if (candidates.length === 0) return null;
  return [...candidates].sort(compareNativeDevices)[0] ?? null;
}
