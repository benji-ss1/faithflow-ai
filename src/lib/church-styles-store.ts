// Per-church styles store (PR B, 2026-09-17).
//
// Scripture Style + per-content-type default themes are now stored per CHURCH
// (church_preferences) instead of per machine. The live send path
// (applyChurchLayout → loadScriptureStyle) is SYNCHRONOUS and compares slide
// identity, so this module keeps a synchronous in-memory cache per churchId:
//   • hydrateChurchStyles() is called from server props in OperatorConsole's
//     FIRST render (useState initializer) — before any send can happen.
//   • reads return the SAME object reference until the value actually changes
//     (an equal re-hydrate keeps the old reference) → identity-stable sends.
//   • before hydrate (tests, library pages, offline) reads fall back to the
//     LEGACY localStorage keys, read-only (kept one release), memoised by raw
//     string so the fallback is identity-stable too.
//
// Pure + window-guarded: on the server every call is a no-op / default, so the
// module-level cache can never leak state across requests or churches. No
// server-action imports here — the network side is injected by
// church-styles-sync.ts (registerChurchStylesRemote), keeping this importable
// from node tests.
import {
  DEFAULT_SCRIPTURE_DESIGN,
  sanitizeScriptureDesign,
  sanitizeContentTypeStyles,
  type ScriptureDesign,
  type ContentTypeStyles,
} from "./scripture-design";

export const SCRIPTURE_STYLE_EVENT = "pf-scripture-style-changed";
export const CONTENT_TYPE_STYLES_EVENT = "presentflow:content-type-styles-changed";
export const CHURCH_STYLES_CHANNEL = "pf-church-styles";
export const LEGACY_SCRIPTURE_KEY = (churchId?: string) => `pf.scriptureStyle.v2.${churchId || "default"}`;
export const LEGACY_CTS_KEY = "presentflow.contentTypeStyles.v1";
export const MIGRATED_KEY = (churchId: string) => `pf.stylesMigrated.${churchId}`;

/** Wire shape passed from server pages / returned by getChurchStyles. */
export type ChurchStylesSnapshot = {
  scriptureStyle: unknown | null;
  contentTypeStyles: unknown;
  scriptureStyleUpdatedAt: string | null;
  /** content_type_styles_updated_at — null = the church never set them. Optional for older cached snapshots. */
  contentTypeStylesUpdatedAt?: string | null;
};

type Entry = {
  scripture: ScriptureDesign | null;
  cts: ContentTypeStyles;
  /** Last *_updated_at seen FROM THE SERVER (never a local clock). */
  serverUpdatedAt: string | null;
  serverCtsUpdatedAt: string | null;
  hydrated: boolean;
};

export type PendingWrites = { scripture?: { v: ScriptureDesign | null }; cts?: { v: ContentTypeStyles } };

/**
 * A remote save's outcome. `ok` = stored (snap = server state after the write).
 * `rejected` = permanently refused (no permission / wrong church): the pending
 * write is DROPPED and the server value (snap, when available) adopted — never
 * retried. A thrown error / null = transient (stays pending, retried on 'online').
 */
export type SaveOutcome =
  | { status: "ok"; snap: ChurchStylesSnapshot }
  | { status: "rejected"; snap: ChurchStylesSnapshot | null; error?: string };

export type ChurchStylesRemote = {
  saveScripture: (churchId: string, design: ScriptureDesign | null) => Promise<SaveOutcome | null>;
  saveContentTypeStyles: (churchId: string, cts: ContentTypeStyles) => Promise<SaveOutcome | null>;
  onFailure?: (what: "scripture" | "cts", kind: "transient" | "rejected", error: unknown) => void;
  /** Persist the current snapshot + any pending writes (survives reload while offline). */
  persistOffline?: (churchId: string, snap: ChurchStylesSnapshot, pending: PendingWrites) => void;
  broadcast?: (churchId: string, snap: ChurchStylesSnapshot) => void;
};

const entries = new Map<string, Entry>();
let activeChurchId: string | null = null;
let remote: ChurchStylesRemote | null = null;
// Pending writes per church: the latest value wins; retried on 'online'.
const pending = new Map<string, PendingWrites>();
const inFlight = new Map<string, number>();
// Churches where the server refused a content-type save → the picker disables.
const ctsEditDenied = new Set<string>();

const hasWindow = () => typeof window !== "undefined";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const newer = (next: string | null | undefined, prev: string | null) =>
  !!next && (prev === null || Date.parse(next) > Date.parse(prev));

function dispatch(kinds: { scripture?: boolean; cts?: boolean }) {
  if (!hasWindow()) return;
  try {
    if (kinds.scripture) window.dispatchEvent(new CustomEvent(SCRIPTURE_STYLE_EVENT));
    if (kinds.cts) window.dispatchEvent(new CustomEvent(CONTENT_TYPE_STYLES_EVENT));
  } catch { /* best effort */ }
}
// Never dispatch window events synchronously from inside a React render.
function dispatchLater(kinds: { scripture?: boolean; cts?: boolean }) {
  if (!kinds.scripture && !kinds.cts) return;
  const run = () => dispatch(kinds);
  if (typeof queueMicrotask === "function") queueMicrotask(run); else void Promise.resolve().then(run);
}

// ── legacy read-only fallback (memoised by raw string → stable refs) ─────────
const legacyMemo = new Map<string, { raw: string; value: unknown }>();
function legacyRead<T>(key: string, parse: (raw: string) => T): T | null {
  if (!hasWindow()) return null;
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(key); } catch { return null; }
  if (!raw) return null;
  const m = legacyMemo.get(key);
  if (m && m.raw === raw) return m.value as T;
  let value: T | null = null;
  try { value = parse(raw); } catch { value = null; }
  legacyMemo.set(key, { raw, value });
  return value;
}
export function readLegacyScriptureStyle(churchId?: string): ScriptureDesign | null {
  return legacyRead(LEGACY_SCRIPTURE_KEY(churchId), (raw) => sanitizeScriptureDesign(JSON.parse(raw)));
}
export function readLegacyContentTypeStyles(): ContentTypeStyles | null {
  return legacyRead(LEGACY_CTS_KEY, (raw) => {
    // Legacy values weren't uuid-checked; keep any non-empty string (a foreign
    // id simply misses the church-scoped theme lookup, same as before).
    const p = JSON.parse(raw) as Record<string, unknown>;
    const out: ContentTypeStyles = {};
    for (const k of ["song", "scripture"] as const) if (p && typeof p[k] === "string" && p[k]) out[k] = p[k] as string;
    return out;
  });
}

// ── hydrate ──────────────────────────────────────────────────────────────────

/**
 * Apply a server snapshot for a church. Synchronous. Keeps existing object
 * references when the value is unchanged. Each field (scripture / content-type)
 * is replaced ONLY when (a) no local write is pending for it and (b) its server
 * updated_at is newer than the last server value seen (or on first hydrate, or
 * `force`). A never-set server value (updated_at null) therefore never
 * overwrites a locally seeded legacy value on a refetch. Returns what changed.
 */
export function hydrateChurchStyles(
  churchId: string,
  snap: ChurchStylesSnapshot | null | undefined,
  opts: { force?: boolean; initial?: boolean } = {},
): { scripture: boolean; cts: boolean } {
  const changed = { scripture: false, cts: false };
  if (!hasWindow() || !churchId || !snap) return changed;
  activeChurchId = churchId;
  const prev = entries.get(churchId);
  // Page props are a render-time snapshot: once this window has hydrated, a
  // remount's (possibly stale) props must not roll back a newer value.
  if (opts.initial && prev?.hydrated) return changed;
  const p = pending.get(churchId);
  const first = !prev || !prev.hydrated;
  const ctsAt = snap.contentTypeStylesUpdatedAt ?? null;
  const entry: Entry = prev
    ? { ...prev }
    : { scripture: null, cts: {}, serverUpdatedAt: null, serverCtsUpdatedAt: null, hydrated: false };
  const nextScripture = sanitizeScriptureDesign(snap.scriptureStyle);
  const nextCts = sanitizeContentTypeStyles(snap.contentTypeStyles);
  if (!p?.scripture && (first || opts.force || newer(snap.scriptureStyleUpdatedAt, entry.serverUpdatedAt)) && !same(entry.scripture, nextScripture)) {
    entry.scripture = nextScripture; changed.scripture = true;
  }
  if (!p?.cts && (first || opts.force || newer(ctsAt, entry.serverCtsUpdatedAt)) && !same(entry.cts, nextCts)) {
    entry.cts = nextCts; changed.cts = true;
  }
  if (newer(snap.scriptureStyleUpdatedAt, entry.serverUpdatedAt)) entry.serverUpdatedAt = snap.scriptureStyleUpdatedAt;
  if (newer(ctsAt, entry.serverCtsUpdatedAt)) entry.serverCtsUpdatedAt = ctsAt;
  const wasHydrated = !!prev?.hydrated;
  entry.hydrated = true;
  entries.set(churchId, entry);
  if (wasHydrated) dispatch(changed);
  return changed;
}

/**
 * First-render hydrate from server page props (OperatorConsole useState
 * initializer). Also seeds the LEGACY per-machine values locally when the
 * server has never had them (updated_at null) and this machine hasn't migrated
 * — so the first send after upgrading looks exactly like before, while
 * church-styles-sync uploads them (ifEmpty, first computer wins) and adopts the
 * server's answer. Never dispatches synchronously (runs during render).
 */
export function hydrateChurchStylesInitial(churchId: string, snap: ChurchStylesSnapshot | null | undefined): void {
  if (!hasWindow() || !churchId || !snap) return;
  if (entries.get(churchId)?.hydrated) { activeChurchId = churchId; return; }
  hydrateChurchStyles(churchId, snap, { initial: true });
  let migrated = false;
  try { migrated = !!window.localStorage.getItem(MIGRATED_KEY(churchId)); } catch { migrated = true; }
  if (migrated) return;
  const seed: { scripture?: ScriptureDesign; cts?: ContentTypeStyles } = {};
  if (snap.scriptureStyle == null && snap.scriptureStyleUpdatedAt == null) {
    const legacy = readLegacyScriptureStyle(churchId);
    if (legacy) seed.scripture = legacy;
  }
  const serverCts = sanitizeContentTypeStyles(snap.contentTypeStyles);
  if (Object.keys(serverCts).length === 0 && (snap.contentTypeStylesUpdatedAt ?? null) === null) {
    const legacy = readLegacyContentTypeStyles();
    if (legacy && Object.keys(legacy).length > 0) seed.cts = legacy;
  }
  if (seed.scripture || seed.cts) seedLocalChurchStyles(churchId, seed);
}

/** Same-machine peer update (BroadcastChannel): adopt the value as-is. */
export function applyPeerChurchStyles(churchId: string, snap: ChurchStylesSnapshot): void {
  if (!hasWindow() || !churchId) return;
  const prev = entries.get(churchId);
  if (!prev) return; // this window never loaded this church — nothing to update
  const scripture = sanitizeScriptureDesign(snap.scriptureStyle);
  const cts = sanitizeContentTypeStyles(snap.contentTypeStyles);
  const changed = { scripture: !same(prev.scripture, scripture), cts: !same(prev.cts, cts) };
  if (!changed.scripture && !changed.cts) return;
  entries.set(churchId, {
    ...prev,
    scripture: changed.scripture ? scripture : prev.scripture,
    cts: changed.cts ? cts : prev.cts,
  });
  dispatch(changed);
}

export function isChurchStylesHydrated(churchId: string): boolean {
  return !!entries.get(churchId)?.hydrated;
}
export function getActiveStylesChurchId(): string | null { return activeChurchId; }
/**
 * Record the session's edit_library capability (server page props, hasCap on
 * the session) so the content-type picker is disabled UP FRONT for volunteers.
 * The server still enforces it; a refusal also marks the church denied.
 */
export function setCanEditLibrary(churchId: string, canEdit: boolean): void {
  if (!hasWindow() || !churchId) return;
  if (canEdit) ctsEditDenied.delete(churchId); else ctsEditDenied.add(churchId);
}
export function isContentTypeEditDenied(churchId?: string): boolean {
  const id = churchId || activeChurchId;
  return !!id && ctsEditDenied.has(id);
}
export function currentSnapshot(churchId: string): ChurchStylesSnapshot {
  const e = entries.get(churchId);
  return {
    scriptureStyle: e?.scripture ?? null, contentTypeStyles: e?.cts ?? {},
    scriptureStyleUpdatedAt: e?.serverUpdatedAt ?? null, contentTypeStylesUpdatedAt: e?.serverCtsUpdatedAt ?? null,
  };
}
export function getPendingWrites(churchId: string): PendingWrites {
  const p = pending.get(churchId);
  const out: PendingWrites = {};
  if (p?.scripture) out.scripture = { v: p.scripture.v };
  if (p?.cts) out.cts = { v: p.cts.v };
  return out;
}

/** Optimistically seed a church's local values (legacy migration while the server call runs). */
export function seedLocalChurchStyles(churchId: string, v: { scripture?: ScriptureDesign; cts?: ContentTypeStyles }): void {
  if (!hasWindow()) return;
  const prev = entries.get(churchId);
  if (!prev) return;
  const next = { ...prev };
  const changed = { scripture: false, cts: false };
  if (v.scripture && !same(prev.scripture, v.scripture)) { next.scripture = v.scripture; changed.scripture = true; }
  if (v.cts && !same(prev.cts, v.cts)) { next.cts = v.cts; changed.cts = true; }
  entries.set(churchId, next);
  dispatchLater(changed);
}

// ── synchronous reads (used by the live send path) ───────────────────────────

export function getScriptureStyle(churchId?: string): ScriptureDesign | null {
  if (!hasWindow()) return null;
  const e = churchId ? entries.get(churchId) : undefined;
  if (e) return e.scripture;
  return readLegacyScriptureStyle(churchId);
}

export function getContentTypeStyles(churchId?: string): ContentTypeStyles {
  if (!hasWindow()) return EMPTY_CTS;
  const id = churchId || activeChurchId || undefined;
  const e = id ? entries.get(id) : undefined;
  if (e) return e.cts;
  return readLegacyContentTypeStyles() ?? EMPTY_CTS;
}
const EMPTY_CTS: ContentTypeStyles = Object.freeze({}) as ContentTypeStyles;

// ── writes ───────────────────────────────────────────────────────────────────

function ensureEntry(churchId: string): Entry {
  let e = entries.get(churchId);
  if (!e) {
    // A save before hydrate (e.g. tests, a page without props): seed from the
    // legacy fallback so the unsaved field keeps its current value.
    e = { scripture: readLegacyScriptureStyle(churchId), cts: readLegacyContentTypeStyles() ?? {}, serverUpdatedAt: null, serverCtsUpdatedAt: null, hydrated: false };
    entries.set(churchId, e);
  }
  return e;
}

export function setLocalScriptureStyle(churchId: string | undefined, design: ScriptureDesign | null): void {
  if (!hasWindow()) return;
  const id = churchId || activeChurchId;
  if (!id) return;
  const e = ensureEntry(id);
  const next = design ? (sanitizeScriptureDesign(design) ?? DEFAULT_SCRIPTURE_DESIGN) : null;
  entries.set(id, { ...e, scripture: next });
  const p = pending.get(id) ?? {};
  p.scripture = { v: next };
  pending.set(id, p);
  dispatch({ scripture: true });
  afterLocalWrite(id);
}

export function setLocalContentTypeStyles(churchId: string | undefined, cts: ContentTypeStyles): void {
  if (!hasWindow()) return;
  const id = churchId || activeChurchId;
  if (!id) return;
  const e = ensureEntry(id);
  const next: ContentTypeStyles = {};
  for (const k of ["song", "scripture"] as const) if (typeof cts?.[k] === "string" && cts[k]) next[k] = cts[k];
  entries.set(id, { ...e, cts: next });
  const p = pending.get(id) ?? {};
  p.cts = { v: next };
  pending.set(id, p);
  dispatch({ cts: true });
  afterLocalWrite(id);
}

/**
 * Restore writes that were still pending when this computer reloaded (offline
 * KV). Only fields with no newer local pending write are restored; they are
 * applied locally and flushed like a fresh save.
 */
export function restorePendingWrites(churchId: string, saved: PendingWrites | null | undefined): void {
  if (!hasWindow() || !churchId || !saved) return;
  const cur = pending.get(churchId);
  if (saved.scripture && !cur?.scripture) setLocalScriptureStyle(churchId, saved.scripture.v);
  if (saved.cts && !pending.get(churchId)?.cts) setLocalContentTypeStyles(churchId, saved.cts.v);
}

function persist(churchId: string) {
  try { remote?.persistOffline?.(churchId, currentSnapshot(churchId), getPendingWrites(churchId)); } catch { /* ignore */ }
}

function afterLocalWrite(churchId: string) {
  persist(churchId);
  try { remote?.broadcast?.(churchId, currentSnapshot(churchId)); } catch { /* ignore */ }
  void flushPending(churchId);
}

export function hasPendingChurchStyles(churchId: string): boolean {
  const p = pending.get(churchId);
  return !!(p && (p.scripture || p.cts));
}

/** Adopt one field from a server snapshot unconditionally (after an ack or a refusal). */
function adoptField(churchId: string, field: "scripture" | "cts", snap: ChurchStylesSnapshot) {
  const e = entries.get(churchId);
  if (!e) return;
  const next = { ...e };
  let changed = false;
  if (field === "scripture") {
    const v = sanitizeScriptureDesign(snap.scriptureStyle);
    if (!same(e.scripture, v)) { next.scripture = v; changed = true; }
    if (newer(snap.scriptureStyleUpdatedAt, e.serverUpdatedAt)) next.serverUpdatedAt = snap.scriptureStyleUpdatedAt;
  } else {
    const v = sanitizeContentTypeStyles(snap.contentTypeStyles);
    if (!same(e.cts, v)) { next.cts = v; changed = true; }
    if (newer(snap.contentTypeStylesUpdatedAt, e.serverCtsUpdatedAt)) next.serverCtsUpdatedAt = snap.contentTypeStylesUpdatedAt ?? null;
  }
  entries.set(churchId, next);
  if (changed) {
    dispatch(field === "scripture" ? { scripture: true } : { cts: true });
    // Other same-machine windows got the optimistic value via BroadcastChannel —
    // send them the corrected (server / refused-revert) value too.
    try { remote?.broadcast?.(churchId, currentSnapshot(churchId)); } catch { /* ignore */ }
  }
}

async function flushField(churchId: string, field: "scripture" | "cts", r: ChurchStylesRemote): Promise<void> {
  const sent = pending.get(churchId)?.[field];
  if (!sent) return;
  try {
    const out = field === "scripture"
      ? await r.saveScripture(churchId, (sent as { v: ScriptureDesign | null }).v)
      : await r.saveContentTypeStyles(churchId, (sent as { v: ContentTypeStyles }).v);
    if (!out) throw new Error("save failed");
    const cur = pending.get(churchId);
    const superseded = cur?.[field] !== sent;
    if (out.status === "rejected") {
      // Permanent refusal: drop THIS write (never retry / re-toast) and fall
      // back to the server's value. A newer local write queued meanwhile is kept.
      if (!superseded && cur) delete cur[field];
      if (field === "cts") { ctsEditDenied.add(churchId); dispatch({ cts: true }); }
      if (!superseded && out.snap) adoptField(churchId, field, out.snap);
      r.onFailure?.(field, "rejected", new Error(out.error ?? "rejected"));
      return;
    }
    if (!superseded && cur) {
      delete cur[field];
      // Adopt the server's sanitized value (e.g. foreign theme ids dropped).
      adoptField(churchId, field, out.snap);
    } else {
      const e = entries.get(churchId);
      if (e) {
        if (field === "scripture" && newer(out.snap.scriptureStyleUpdatedAt, e.serverUpdatedAt)) entries.set(churchId, { ...e, serverUpdatedAt: out.snap.scriptureStyleUpdatedAt });
        if (field === "cts" && newer(out.snap.contentTypeStylesUpdatedAt, e.serverCtsUpdatedAt)) entries.set(churchId, { ...e, serverCtsUpdatedAt: out.snap.contentTypeStylesUpdatedAt ?? null });
      }
    }
  } catch (err) {
    r.onFailure?.(field, "transient", err);
  }
}

/** Push pending writes to the server. Latest value wins; transient failures stay pending. */
export async function flushPending(churchId: string): Promise<void> {
  if (!remote || !hasWindow()) return;
  if ((inFlight.get(churchId) ?? 0) > 0) return; // the running flush re-checks when it finishes
  const p = pending.get(churchId);
  if (!p || (!p.scripture && !p.cts)) return;
  const startScripture = p.scripture, startCts = p.cts;
  inFlight.set(churchId, 1);
  const r = remote;
  try {
    await flushField(churchId, "scripture", r);
    await flushField(churchId, "cts", r);
  } finally {
    inFlight.set(churchId, 0);
    persist(churchId);
  }
  const after = pending.get(churchId);
  // Re-run only if a NEW value was queued during the flush (failures wait for 'online').
  if (after && ((after.scripture && after.scripture !== startScripture) || (after.cts && after.cts !== startCts))) {
    void flushPending(churchId);
  }
}

export function registerChurchStylesRemote(next: ChurchStylesRemote | null): void {
  remote = next;
  if (next) for (const id of pending.keys()) void flushPending(id);
}

/** Test-only reset. */
export function __resetChurchStylesStore(): void {
  entries.clear(); pending.clear(); inFlight.clear(); legacyMemo.clear(); ctsEditDenied.clear();
  activeChurchId = null; remote = null;
}

/** Server pages: church_preferences row (or null = no row yet) → props snapshot. */
export function churchStylesSnapshotFromPrefs(prefs: {
  scriptureStyle?: unknown;
  contentTypeStyles?: unknown;
  scriptureStyleUpdatedAt?: Date | string | null;
  contentTypeStylesUpdatedAt?: Date | string | null;
} | null | undefined): ChurchStylesSnapshot {
  const at = prefs?.scriptureStyleUpdatedAt;
  const ctsAt = prefs?.contentTypeStylesUpdatedAt;
  return {
    scriptureStyle: prefs?.scriptureStyle ?? null,
    contentTypeStyles: prefs?.contentTypeStyles ?? {},
    scriptureStyleUpdatedAt: at ? new Date(at).toISOString() : null,
    contentTypeStylesUpdatedAt: ctsAt ? new Date(ctsAt).toISOString() : null,
  };
}
