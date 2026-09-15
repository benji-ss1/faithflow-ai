/**
 * savedAudioDevices — Audio Lock-In (2026-09-15)
 * -------------------------------------------------------------------------
 * Remembers input configurations that WORKED on this machine (device + channel
 * routing + gain), so a known device is restored automatically whenever it's
 * present. Per-machine by construction (localStorage).
 *
 * Matching never uses the volatile avfoundation index or Web Audio deviceId:
 *   1. CoreAudio uid (stable across replug/reboot)
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
  return typeof localStorage !== "undefined";
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
    name: o.name,
    transport: typeof o.transport === "string" ? o.transport : undefined,
    channelCount: typeof o.channelCount === "number" && Number.isFinite(o.channelCount) ? o.channelCount : undefined,
    mode,
    selectedChannels: chs,
    gainDb: gain,
    role: o.role === "backup" ? "backup" : "primary",
    savedAt: typeof o.savedAt === "number" ? o.savedAt : 0,
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

function writeAll(list: SavedAudioDevice[]): void {
  if (!hasStorage()) return;
  try { localStorage.setItem(SAVED_AUDIO_DEVICES_KEY, JSON.stringify(list.slice(0, MAX_SAVED_DEVICES))); } catch { /* ignore */ }
}

function sameDevice(a: { uid?: string; name: string }, b: { uid?: string; name: string }): boolean {
  if (a.uid && b.uid) return a.uid === b.uid;
  return normalizeDeviceName(a.name) === normalizeDeviceName(b.name);
}

/** Save (or update) a working configuration. Only one device may hold each role;
 *  saving a new primary/backup demotes nothing else but replaces the same device's entry. */
export function saveWorkingDevice(entry: Omit<SavedAudioDevice, "savedAt"> & { savedAt?: number }): SavedAudioDevice | null {
  const clean = sanitize({ ...entry, savedAt: entry.savedAt ?? Date.now() });
  if (!clean) return null;
  let list = listSavedDevices().filter((d) => !sameDevice(d, clean));
  if (clean.role === "backup") list = list.map((d) => (d.role === "backup" ? { ...d, role: "primary" as const } : d));
  writeAll([clean, ...list]);
  return clean;
}

export function forgetSavedDevice(target: { uid?: string; name: string }): void {
  writeAll(listSavedDevices().filter((d) => !sameDevice(d, target)));
}

export function getBackupDevice(): SavedAudioDevice | null {
  return listSavedDevices().find((d) => d.role === "backup") ?? null;
}

/** Find the best saved config present in `available`. Primary role wins, then most recent. */
export function matchSavedDevice(
  available: AvailableDevice[],
  saved: SavedAudioDevice[] = listSavedDevices(),
  role: SavedDeviceRole = "primary",
): { saved: SavedAudioDevice; device: AvailableDevice } | null {
  const candidates = saved.filter((s) => s.role === role).sort((a, b) => b.savedAt - a.savedAt);
  for (const s of candidates) {
    const byUid = s.uid ? available.find((d) => d.uid && d.uid === s.uid) : undefined;
    if (byUid) return { saved: s, device: byUid };
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
