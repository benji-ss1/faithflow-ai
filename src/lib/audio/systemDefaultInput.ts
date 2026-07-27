/**
 * "Follow Mac system input" support (2026-07-27).
 *
 * Renderer-only technique: Chromium's enumerateDevices() exposes the OS
 * default input as the entry with `deviceId === "default"`, labelled
 * "Default - <actual device name>". Stripping the prefix gives us the
 * system default's human name, which we then match against the native
 * ffmpeg (avfoundation) device list by name. That lets PresentFlow
 * capture WHATEVER macOS System Settings → Sound → Input points at —
 * SQ, NDI, Blackmagic, Bluetooth, any USB — and track it live via the
 * `devicechange` event, all without any main-process/electron changes.
 *
 * SSR/permission-safe: every failure path returns null.
 */

export type NativeDeviceNameRef = { index: number; name: string };

/**
 * Read the macOS system-default input's human name via enumerateDevices.
 * Returns null when unavailable (SSR, permission not granted so labels
 * are empty, no "default" entry, enumeration failure).
 */
export async function getSystemDefaultInputName(): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return null;
  }
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const def = all.find((d) => d.kind === "audioinput" && d.deviceId === "default");
    if (!def || !def.label) return null;
    // Label is usually "Default - SQ - Audio"; some platforms/locales omit
    // the prefix — handle both.
    const name = def.label.replace(/^default\s*-\s*/i, "").trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

function norm(s: string): string {
  return (s ?? "").trim().toLowerCase();
}

/** Strip parenthetical suffixes like "(22f0:0019)" and collapse whitespace. */
function stripParens(s: string): string {
  return s.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Match the system-default input's name against the native ffmpeg device
 * list. Matching ladder (best score wins; ties → first in list):
 *   0 = exact (case-insensitive, trimmed)
 *   1 = prefix either direction
 *   2 = exact after stripping parenthetical suffixes from both
 *   3 = prefix either direction after stripping parentheticals
 *   4 = includes() either direction (last resort)
 * Returns null when nothing matches at all.
 */
export function matchNativeDeviceByName(
  defaultName: string,
  natives: Array<NativeDeviceNameRef>,
): NativeDeviceNameRef | null {
  const target = norm(defaultName);
  if (!target || !Array.isArray(natives) || natives.length === 0) return null;
  const targetStripped = stripParens(target);
  let best: NativeDeviceNameRef | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const d of natives) {
    const n = norm(d.name);
    if (!n) continue;
    let score: number;
    if (n === target) {
      score = 0;
    } else if (n.startsWith(target) || target.startsWith(n)) {
      score = 1;
    } else {
      const nStripped = stripParens(n);
      if (nStripped && targetStripped && nStripped === targetStripped) {
        score = 2;
      } else if (
        nStripped && targetStripped &&
        (nStripped.startsWith(targetStripped) || targetStripped.startsWith(nStripped))
      ) {
        score = 3;
      } else if (n.includes(target) || target.includes(n)) {
        score = 4;
      } else {
        continue;
      }
    }
    if (score < bestScore) {
      bestScore = score;
      best = { index: d.index, name: d.name };
      if (score === 0) break; // can't beat exact
    }
  }
  return best;
}
