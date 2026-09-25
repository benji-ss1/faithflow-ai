/**
 * Media library sync + duplicate detection (2026-09-23, user directive:
 * "Media and Media Bin are one and the same" + "never have duplicates").
 *
 * ONE source of truth already exists — every media surface (MediaBrowser,
 * Media Bin dock, Media Bin workspace tab, left rail, search palette, the
 * /library/media page) reads the same `media_assets` rows via
 * /api/media/list. What was missing was a shared "the library changed"
 * signal: each surface kept its own list and only some of them refreshed
 * after an upload/delete elsewhere. `notifyMediaChanged()` is that signal —
 * every write path fires it, every list re-fetches on it.
 *
 * Same-window: a window CustomEvent. Other windows/tabs of the same app
 * (e.g. a popped-out window, the web library page in another tab): a
 * BroadcastChannel, best-effort (absent in some test/SSR envs → no-op).
 *
 * Duplicates: no content hash exists on media_assets (and hashing 500MB
 * videos in the browser is too costly — see scaling audit), so a duplicate is
 * the same KIND + same file name (trimmed, case-insensitive) + exact same
 * byte size. Pure helpers below so the rule is unit-tested in one place.
 */

export const MEDIA_CHANGED_EVENT = "presentflow:media-changed";
const CHANNEL_NAME = "presentflow-media-sync";

let channel: BroadcastChannel | null | undefined;
function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

/** Tell every media list (this window + other windows) to re-fetch. */
export function notifyMediaChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MEDIA_CHANGED_EVENT));
  try { getChannel()?.postMessage({ type: "media-changed" }); } catch { /* best-effort */ }
}

/** Subscribe to media-library changes from this window or any other. Returns unsubscribe. */
export function onMediaChanged(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // Debounced: a bulk action / several windows notifying at once collapse into
  // ONE re-fetch per subscriber (the list route is rate-limited per user).
  let t: ReturnType<typeof setTimeout> | null = null;
  const h = () => { if (t) clearTimeout(t); t = setTimeout(() => { t = null; cb(); }, 150); };
  window.addEventListener(MEDIA_CHANGED_EVENT, h);
  const ch = getChannel();
  const onMsg = (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === "media-changed") h(); };
  ch?.addEventListener("message", onMsg);
  return () => {
    if (t) clearTimeout(t);
    window.removeEventListener(MEDIA_CHANGED_EVENT, h);
    ch?.removeEventListener("message", onMsg);
  };
}

// ── Duplicate detection ──────────────────────────────────────────────────────

export type DupCandidate = { id: string; fileName: string; kind: string; sizeBytes: number; createdAt?: string };

function normKind(kind: string): "image" | "video" | string {
  const k = (kind || "").toLowerCase();
  if (k.startsWith("video")) return "video";
  if (k.startsWith("image")) return "image";
  return k;
}

/** The duplicate key. Returns null when the item can't be meaningfully matched
 *  (unknown size — e.g. an optimistic row with sizeBytes 0 — or empty name),
 *  so we never flag false duplicates. */
export function mediaDupKey(a: { fileName: string; kind: string; sizeBytes: number }): string | null {
  const name = (a.fileName || "").trim().toLowerCase();
  if (!name || !Number.isFinite(a.sizeBytes) || a.sizeBytes <= 0) return null;
  return `${normKind(a.kind)}|${name}|${a.sizeBytes}`;
}

/** Groups of 2+ assets that are duplicates of each other, oldest first within
 *  each group (the oldest is the natural default "keep"). */
export function findMediaDuplicates<T extends DupCandidate>(assets: T[]): T[][] {
  const byKey = new Map<string, T[]>();
  for (const a of assets) {
    const k = mediaDupKey(a);
    if (!k) continue;
    const g = byKey.get(k);
    if (g) g.push(a); else byKey.set(k, [a]);
  }
  const groups: T[][] = [];
  for (const g of byKey.values()) {
    if (g.length < 2) continue;
    groups.push([...g].sort((x, y) => (x.createdAt ?? "").localeCompare(y.createdAt ?? "")));
  }
  return groups;
}

/** id → its duplicate group (only for assets that HAVE duplicates). */
export function duplicateIndex<T extends DupCandidate>(assets: T[]): Map<string, T[]> {
  const idx = new Map<string, T[]>();
  for (const g of findMediaDuplicates(assets)) for (const a of g) idx.set(a.id, g);
  return idx;
}

/** Total number of EXTRA copies (a group of 5 contributes 4). */
export function extraCopyCount(groups: unknown[][]): number {
  return groups.reduce((n, g) => n + Math.max(0, g.length - 1), 0);
}

/** Total copies inside duplicate groups (a group of 5 contributes 5) — the
 *  operator-facing "you currently have 5 duplicates" count. */
export function dupCopyCount(groups: unknown[][]): number {
  return groups.reduce((n, g) => n + g.length, 0);
}

/** For an incoming upload: does it already exist in the library? */
export function isDuplicateUpload(
  file: { name: string; size: number; type: string },
  existing: Array<{ fileName: string; kind: string; sizeBytes: number }>,
): boolean {
  const k = mediaDupKey({ fileName: file.name, kind: file.type, sizeBytes: file.size });
  if (!k) return false;
  return existing.some((a) => mediaDupKey(a) === k);
}

// ── Delete-confirm usage copy ────────────────────────────────────────────────

export type MediaUsageCounts = { playlistItems: number; songs: number; slides: number; themes: number; presets: number };

/** Plain-English "where is this used" line for the delete confirmation, or
 *  null when it isn't used anywhere. Pure (unit-tested). */
export function describeMediaUsage(u: MediaUsageCounts | null | undefined): string | null {
  if (!u) return null;
  const parts: string[] = [];
  const p = (n: number, one: string, many: string) => { if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`); };
  p(u.playlistItems, "playlist item", "playlist items");
  p(u.songs, "song", "songs");
  p(u.slides, "slide", "slides");
  p(u.themes, "theme", "themes");
  p(u.presets, "announcement preset", "announcement presets");
  if (parts.length === 0) return null;
  return `Still used in ${parts.join(", ")}. Those will show without it (playlist items that are just this file are removed).`;
}

/** Resolve `p`, or `fallback` after `ms` — so a slow usage lookup never delays
 *  a delete confirmation (the confirm just shows without the usage line). */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}
