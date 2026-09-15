/**
 * savedAudioDevices — Audio Lock-In (2026-09-15, hardened after review)
 * -------------------------------------------------------------------------
 * Remembers input configurations that WORKED on this machine (device + channel
 * routing + gain), so a known device is restored automatically whenever it's
 * present. Per-machine by construction (localStorage).
 *
 * Matching never uses the volatile avfoundation index or Web Audio deviceId:
 *   1. CoreAudio uid (stable across replug/reboot) — when several present devices
 *      share a uid (identical models), the exact name must also match
 *   2. exact device name
 *   3. normalized name (strips "(22f0:0019)"-style VID:PID + spacing) AND same channel count
 *
 * Reads are side-effect free. `saveWorkingDevice` never touches the live
 * native pref / capture — callers decide whether to apply a match.
 */

import type { NativeDeviceMode, NativeDevicePref } from "./nativeDeviceStore";

export const SAVED_AUDIO_DEVICES_KEY = "presentflow.pro.savedAudioDevices.v1";
export const MAX_SAVED_DEVICES = 20;

export type SavedDeviceRole = "primary" | "backup";

export interface SavedAudioDevice {
  uid?: string;
  name: string;
  transport?: string;
  channelCount?: number;
  mode: NativeDeviceMode;
  selectedChannels: number[];
  gainDb: number;
  role: SavedDeviceRole;
  savedAt: number;
}

export interface AvailableDevice {
  index: number;
  name: string;
  uid?: string;
  transport?: string;
  channelCount?: number;
}

function hasStorage(): boolean {
  try { return typeof localStorage !== "undefined" && localStorage !== null; } catch { return false; }
}

export function normalizeDeviceName(name: string): string {
  return (name ?? "")
    .replace(/\([0-9a-f]{4}:[0-9a-f]{4}\)/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sanitize(v: unknown): SavedAudioDevice | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name) return null;
  const mode: NativeDeviceMode = o.mode === "mono" || o.mode === "stereo" || o.mode === "sum-all" ? o.mode : "sum-all";
  const chs = Array.isArray(o.selectedChannels)
    ? (o.selectedChannels as unknown[]).filter((c): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) < 256)
    : [];
  const gain = typeof o.gainDb === "number" && Number.isFinite(o.gainDb) ? Math.max(-24, Math.min(24, o.gainDb)) : 0;
  return {
    uid: typeof o.uid === "string" && o.uid ? o.uid : undefined,
    name: o.name.slice(0, 200),
    transport: typeof o.transport === "string" ? o.transport.slice(0, 40) : undefined,
    channelCount: typeof o.channelCount === "number" && Number.isFinite(o.channelCount) ? o.channelCount : undefined,
    mode,
    selectedChannels: chs,
    gainDb: gain,
    role: o.role === "backup" ? "backup" : "primary",
    savedAt: typeof o.savedAt === "number" && Number.isFinite(o.savedAt) ? o.savedAt : 0,
  };
}

export function listSavedDevices(): SavedAudioDevice[] {
  if (!hasStorage()) return [];
  try {
    const raw = localStorage.getItem(SAVED_AUDIO_DEVICES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitize).filter((d): d is SavedAudioDevice => d !== null);
  } catch { return []; }
}

/** Returns false when storage is unavailable or full. */
function writeAll(list: SavedAudioDevice[]): boolean {
  if (!hasStorage()) return false;
  try { localStorage.setItem(SAVED_AUDIO_DEVICES_KEY, JSON.stringify(list.slice(0, MAX_SAVED_DEVICES))); return true; } catch { return false; }
}

function sameDevice(a: { uid?: string; name: string }, b: { uid?: string; name: string }): boolean {
  if (a.uid && b.uid) return a.uid === b.uid && normalizeDeviceName(a.name) === normalizeDeviceName(b.name);
  return normalizeDeviceName(a.name) === normalizeDeviceName(b.name);
}

/** Save (or update) a working configuration. Returns null when it could NOT be persisted.
 *  Only one device may hold the backup role; a replaced backup keeps its config but drops to
 *  an old primary (savedAt 0) so it never outranks the real primary. */
export function saveWorkingDevice(entry: Omit<SavedAudioDevice, "savedAt"> & { savedAt?: number }): SavedAudioDevice | null {
  const clean = sanitize({ ...entry, savedAt: entry.savedAt ?? Date.now() });
  if (!clean) return null;
  let list = listSavedDevices().filter((d) => !sameDevice(d, clean));
  if (clean.role === "backup") list = list.map((d) => (d.role === "backup" ? { ...d, role: "primary" as const, savedAt: 0 } : d));
  return writeAll([clean, ...list]) ? clean : null;
}

export function forgetSavedDevice(target: { uid?: string; name: string }): void {
  writeAll(listSavedDevices().filter((d) => !(target.uid && d.uid ? d.uid === target.uid : normalizeDeviceName(d.name) === normalizeDeviceName(target.name))));
}

export function getBackupDevice(): SavedAudioDevice | null {
  return listSavedDevices().find((d) => d.role === "backup") ?? null;
}

/** Find the best saved config present in `available`. Given role only, most recent first. */
export function matchSavedDevice(
  available: AvailableDevice[],
  saved: SavedAudioDevice[] = listSavedDevices(),
  role: SavedDeviceRole = "primary",
): { saved: SavedAudioDevice; device: AvailableDevice } | null {
  const candidates = saved.filter((s) => s.role === role).sort((a, b) => b.savedAt - a.savedAt);
  for (const s of candidates) {
    if (s.uid) {
      const byUid = available.filter((d) => d.uid && d.uid === s.uid);
      const pick = byUid.length > 1 ? byUid.find((d) => d.name === s.name) : byUid[0];
      if (pick) return { saved: s, device: pick };
    }
    const byName = available.find((d) => d.name === s.name);
    if (byName) return { saved: s, device: byName };
    const norm = normalizeDeviceName(s.name);
    const byNorm = available.find((d) =>
      normalizeDeviceName(d.name) === norm &&
      (s.channelCount == null || d.channelCount == null || d.channelCount === s.channelCount));
    if (byNorm) return { saved: s, device: byNorm };
  }
  return null;
}

/** Build the native pref that restores a saved config onto a present device.
 *  Channels beyond the present device's channel count are dropped (falls back to sum-all). */
export function savedToNativePref(match: { saved: SavedAudioDevice; device: AvailableDevice }): NativeDevicePref {
  const { saved, device } = match;
  const max = device.channelCount;
  const chs = max == null ? saved.selectedChannels : saved.selectedChannels.filter((c) => c < max);
  const needed = saved.mode === "mono" ? 1 : saved.mode === "stereo" ? 2 : 0;
  const valid = chs.length >= needed;
  return {
    index: device.index,
    name: device.name,
    mode: valid ? saved.mode : "sum-all",
    selectedChannels: valid ? chs : [],
    gainDb: saved.gainDb,
  };
}
