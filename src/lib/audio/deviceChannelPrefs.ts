/**
 * Per-device channel selection persistence for the Pro Operator audio picker.
 *
 * Keyed by MediaDeviceInfo.deviceId so each mixer keeps its own channel/gain
 * memory even if operators swap between multiple USB devices on the same Mac.
 *
 * Default is `mode: "sum-all"` which preserves v0.1.77 behaviour (mono
 * downmix of every USB channel) until the user or the auto-detect
 * suggestion picks a specific channel.
 *
 * Change events fire a window CustomEvent so `useAudioStream` can rebuild
 * capture with the new channel routing without a full reload.
 */

export type DeviceChannelMode = "mono" | "stereo" | "sum-all";

export interface DeviceChannelPref {
  deviceId: string;
  /** Stored for display only when the device disappears; never used for lookup. */
  deviceLabel: string;
  /** sum-all mirrors v0.1.77 fallback (mono sum of every channel). */
  mode: DeviceChannelMode;
  /** [n] for mono, [a, b] for stereo, [] for sum-all. */
  selectedChannels: number[];
  /** -24 .. +24 dB, default 0. */
  gainDb: number;
  /** True when the user accepted an auto-detect suggestion (vs. picking manually). */
  autoDetected: boolean;
  /** Date.now() at last write; enables future TTL or ordering. */
  updatedAt: number;
  /** Operator-assigned labels for channels, e.g. { 0: "Pastor", 2: "Lectern" }. */
  channelLabels?: Record<number, string>;
  /** When true, auto-follow the loudest vocal channel. */
  autoFollow?: boolean;
}

export const DEVICE_CHANNEL_PREFS_KEY =
  "presentflow.pro.deviceChannelPrefs.v1";

export const DEVICE_CHANNEL_PREF_CHANGED_EVENT =
  "presentflow:device-channel-pref-changed";

export interface DeviceChannelPrefChangedDetail {
  deviceId: string;
}

const GAIN_MIN_DB = -24;
const GAIN_MAX_DB = 24;

/**
 * Hard caps for sanitizePref. The picker currently hits ~32ch max on real
 * hardware, but we accept up to MAX_CHANNELS so a future 64-in interface
 * doesn't silently lose entries — anything beyond that is a malformed pref
 * or an attempt to fill localStorage. deviceLabel is capped to prevent a
 * pathological label (e.g. a browser extension prefix) from ballooning
 * the pref store.
 */
const MAX_CHANNELS = 128;
const MAX_DEVICE_LABEL_LEN = 256;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function clampGainDb(gainDb: number): number {
  if (!Number.isFinite(gainDb)) return 0;
  if (gainDb < GAIN_MIN_DB) return GAIN_MIN_DB;
  if (gainDb > GAIN_MAX_DB) return GAIN_MAX_DB;
  return gainDb;
}

function isValidMode(value: unknown): value is DeviceChannelMode {
  return value === "mono" || value === "stereo" || value === "sum-all";
}

function coerceChannelList(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const out: number[] = [];
  for (const v of input) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      const idx = Math.floor(v);
      // Drop any channel index >= MAX_CHANNELS. Guards against a legacy
      // pref pointing at ch 9999 crashing extractChannelStream() on a
      // 2-in device (would fall through to sum-all but log noise).
      if (idx < MAX_CHANNELS) out.push(idx);
    }
  }
  return out;
}

function sanitizePref(raw: unknown): DeviceChannelPref | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const deviceId = typeof r.deviceId === "string" ? r.deviceId : "";
  if (!deviceId) return null;
  const deviceLabel = typeof r.deviceLabel === "string"
    ? r.deviceLabel.slice(0, MAX_DEVICE_LABEL_LEN)
    : "";
  const mode: DeviceChannelMode = isValidMode(r.mode) ? r.mode : "sum-all";
  const selectedChannels = coerceChannelList(r.selectedChannels);
  const gainDb = clampGainDb(
    typeof r.gainDb === "number" ? r.gainDb : 0,
  );
  const autoDetected = r.autoDetected === true;
  const updatedAt =
    typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt)
      ? r.updatedAt
      : Date.now();
  return {
    deviceId,
    deviceLabel,
    mode,
    selectedChannels,
    gainDb,
    autoDetected,
    updatedAt,
  };
}

/**
 * Read every persisted device pref. Returns an empty object on SSR, missing
 * key, JSON errors, or any localStorage failure.
 */
export function readAllDeviceChannelPrefs(): Record<string, DeviceChannelPref> {
  if (!isBrowser()) return {};
  try {
    const raw = localStorage.getItem(DEVICE_CHANNEL_PREFS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, DeviceChannelPref> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const pref = sanitizePref(value);
      if (pref && pref.deviceId === id) {
        out[id] = pref;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Read a single device's pref, or null when not stored.
 */
export function readDeviceChannelPref(
  deviceId: string,
): DeviceChannelPref | null {
  if (!deviceId) return null;
  const all = readAllDeviceChannelPrefs();
  return all[deviceId] ?? null;
}

/**
 * Persist a device pref and fire a CustomEvent so listeners can rebuild
 * capture. Silently no-ops on SSR or when storage fails.
 */
export function writeDeviceChannelPref(pref: DeviceChannelPref): void {
  if (!isBrowser()) return;
  const sanitized = sanitizePref({ ...pref, updatedAt: Date.now() });
  if (!sanitized) return;
  try {
    const all = readAllDeviceChannelPrefs();
    all[sanitized.deviceId] = sanitized;
    localStorage.setItem(DEVICE_CHANNEL_PREFS_KEY, JSON.stringify(all));
  } catch {
    // Storage disabled / quota exceeded — ignore.
    return;
  }
  dispatchChanged(sanitized.deviceId);
}

/**
 * Remove a single device's pref. Silently no-ops when absent.
 */
export function clearDeviceChannelPref(deviceId: string): void {
  if (!isBrowser() || !deviceId) return;
  try {
    const all = readAllDeviceChannelPrefs();
    if (!(deviceId in all)) return;
    delete all[deviceId];
    localStorage.setItem(DEVICE_CHANNEL_PREFS_KEY, JSON.stringify(all));
  } catch {
    return;
  }
  dispatchChanged(deviceId);
}

/**
 * Fallback lookup by device label (case-insensitive, trimmed). USB power-cycle
 * or hub renumbering can re-issue a fresh `MediaDeviceInfo.deviceId` for the
 * same physical mixer — without this, an operator's channel selection would
 * be silently forgotten on every reconnect.
 *
 * Returns the FIRST matching pref, or null when no stored label matches.
 * Callers should follow up with `migratePrefDeviceId` to move the entry to
 * the new id and keep future lookups fast.
 */
export function readDeviceChannelPrefByLabel(
  label: string,
): DeviceChannelPref | null {
  if (!label) return null;
  const target = label.trim().toLowerCase();
  if (!target) return null;
  const all = readAllDeviceChannelPrefs();
  for (const pref of Object.values(all)) {
    if (!pref.deviceLabel) continue;
    if (pref.deviceLabel.trim().toLowerCase() === target) {
      return pref;
    }
  }
  return null;
}

/**
 * Copy an existing pref from `oldDeviceId` → `newDeviceId` (same label, all
 * fields preserved), remove the old entry, and fire the change event for
 * the new id. Returns the newly-stored pref, or null on failure / when the
 * old id has no stored pref.
 */
export function migratePrefDeviceId(
  oldDeviceId: string,
  newDeviceId: string,
): DeviceChannelPref | null {
  if (!isBrowser() || !oldDeviceId || !newDeviceId || oldDeviceId === newDeviceId) {
    return null;
  }
  try {
    const all = readAllDeviceChannelPrefs();
    const existing = all[oldDeviceId];
    if (!existing) return null;
    const migrated: DeviceChannelPref = {
      ...existing,
      deviceId: newDeviceId,
      updatedAt: Date.now(),
    };
    const sanitized = sanitizePref(migrated);
    if (!sanitized) return null;
    delete all[oldDeviceId];
    all[newDeviceId] = sanitized;
    localStorage.setItem(DEVICE_CHANNEL_PREFS_KEY, JSON.stringify(all));
    dispatchChanged(newDeviceId);
    return sanitized;
  } catch {
    return null;
  }
}

function dispatchChanged(deviceId: string): void {
  if (typeof window === "undefined") return;
  try {
    const event = new CustomEvent<DeviceChannelPrefChangedDetail>(
      DEVICE_CHANNEL_PREF_CHANGED_EVENT,
      { detail: { deviceId } },
    );
    window.dispatchEvent(event);
  } catch {
    // CustomEvent unavailable (very old runtime) — ignore.
  }
}
