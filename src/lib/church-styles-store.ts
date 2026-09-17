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
};

type Entry = {
  scripture: ScriptureDesign | null;
  cts: ContentTypeStyles;
  /** Last scripture_style_updated_at seen FROM THE SERVER (never a local clock). */
  serverUpdatedAt: string | null;
  hydrated: boolean;
};

export type ChurchStylesRemote = {
  saveScripture: (churchId: string, design: ScriptureDesign | null) => Promise<ChurchStylesSnapshot | null>;
  saveContentTypeStyles: (churchId: string, cts: ContentTypeStyles) => Promise<ChurchStylesSnapshot | null>;
  onFailure?: (what: "scripture" | "cts", error: unknown) => void;
  persistOffline?: (churchId: string, snap: ChurchStylesSnapshot) => void;
  broadcast?: (churchId: string, snap: ChurchStylesSnapshot) => void;
};

const entries = new Map<string, Entry>();
let activeChurchId: string | null = null;
let remote: ChurchStylesRemote | null = null;
// Pending writes per church: the latest value wins; retried on 'online'.
const pending = new Map<string, { scripture?: { v: ScriptureDesign | null }; cts?: { v: ContentTypeStyles } }>();
const inFlight = new Map<string, number>();

const hasWindow = () => typeof window !== "undefined";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function dispatch(kinds: { scripture?: boolean; cts?: boolean }) {
  if (!hasWindow()) return;
  try {
    if (kinds.scripture) window.dispatchEvent(new CustomEvent(SCRIPTURE_STYLE_EVENT));
    if (kinds.cts) window.dispatchEvent(new CustomEvent(CONTENT_TYPE_STYLES_EVENT));
  } catch { /* best effort */ }
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
  const v = legacyRead(LEGACY_CTS_KEY, (raw) => {
    // Legacy values weren't uuid-checked; keep any non-empty string (a foreign
    // id simply misses the church-scoped theme lookup, same as before).
    const p = JSON.parse(raw) as Record<string, unknown>;
    const out: ContentTypeStyles = {};
    for (const k of ["song", "scripture"] as const) if (p && typeof p[k] === "string" && p[k]) out[k] = p[k] as string;
    return out;
  });
  return v;
}

// ── hydrate ──────────────────────────────────────────────────────────────────

/**
 * Apply a server snapshot for a church. Synchronous. Keeps existing object
 * references when the value is unchanged. A field with a pending local write
 * is NOT overwritten (the write's response will reconcile). Scripture is only
 * replaced when the server updatedAt is newer than the last server value seen
 * (or on first hydrate). Returns which fields changed.
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
  const nextScripture = sanitizeScriptureDesign(snap.scriptureStyle);
  const nextCts = sanitizeContentTypeStyles(snap.contentTypeStyles);
  const serverNewer = !prev || !prev.hydrated || opts.force ||
    (snap.scriptureStyleUpdatedAt !== null &&
      (prev.serverUpdatedAt === null || Date.parse(snap.scriptureStyleUpdatedAt) > Date.parse(prev.serverUpdatedAt)));
  const entry: Entry = prev
    ? { ...prev }
    : { scripture: null, cts: {}, serverUpdatedAt: null, hydrated: false };
  if (!p?.scripture && serverNewer && !same(entry.scripture, nextScripture)) {
    entry.scripture = nextScripture;
    changed.scripture = true;
  }
  // content_type_styles has no timestamp: adopt whenever it differs and no local write is pending.
  if (!p?.cts && !same(entry.cts, nextCts)) { entry.cts = nextCts; changed.cts = true; }
  if (snap.scriptureStyleUpdatedAt && (entry.serverUpdatedAt === null || Date.parse(snap.scriptureStyleUpdatedAt) > Date.parse(entry.serverUpdatedAt))) {
    entry.serverUpdatedAt = snap.scriptureStyleUpdatedAt;
  }
  const wasHydrated = !!prev?.hydrated;
  entry.hydrated = true;
  entries.set(churchId, entry);
  if (wasHydrated) dispatch(changed);
  return changed;
}

/**
 * First-render hydrate from server page props (OperatorConsole / ThemesManager
 * useState initializer). Also seeds the LEGACY per-machine values locally when
 * the server has none yet and this machine hasn't migrated — so the first send
 * after upgrading looks exactly like before, while church-styles-sync uploads
 * them (ifEmpty, first computer wins) and adopts the server's answer.
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
  if (Object.keys(serverCts).length === 0) {
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
export function getServerScriptureUpdatedAt(churchId: string): string | null {
  return entries.get(churchId)?.serverUpdatedAt ?? null;
}
export function currentSnapshot(churchId: string): ChurchStylesSnapshot {
  const e = entries.get(churchId);
  return { scriptureStyle: e?.scripture ?? null, contentTypeStyles: e?.cts ?? {}, scriptureStyleUpdatedAt: e?.serverUpdatedAt ?? null };
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
  dispatch(changed);
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
    e = { scripture: readLegacyScriptureStyle(churchId), cts: readLegacyContentTypeStyles() ?? {}, serverUpdatedAt: null, hydrated: false };
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

function afterLocalWrite(churchId: string) {
  const snap = currentSnapshot(churchId);
  try { remote?.persistOffline?.(churchId, snap); } catch { /* ignore */ }
  try { remote?.broadcast?.(churchId, snap); } catch { /* ignore */ }
  void flushPending(churchId);
}

export function hasPendingChurchStyles(churchId: string): boolean {
  const p = pending.get(churchId);
  return !!(p && (p.scripture || p.cts));
}

/** Push pending writes to the server. Latest value wins; failures stay pending. */
export async function flushPending(churchId: string): Promise<void> {
  if (!remote || !hasWindow()) return;
  if ((inFlight.get(churchId) ?? 0) > 0) return; // the running flush re-checks when it finishes
  const p = pending.get(churchId);
  if (!p || (!p.scripture && !p.cts)) return;
  const startScripture = p.scripture, startCts = p.cts;
  inFlight.set(churchId, 1);
  const r = remote;
  try {
    if (p.scripture) {
      const sent = p.scripture;
      try {
        const snap = await r.saveScripture(churchId, sent.v);
        if (!snap) throw new Error("save failed");
        const cur = pending.get(churchId);
        if (cur?.scripture === sent) delete cur.scripture; // not superseded meanwhile
        const e = entries.get(churchId);
        if (e && snap.scriptureStyleUpdatedAt) entries.set(churchId, { ...e, serverUpdatedAt: snap.scriptureStyleUpdatedAt });
      } catch (err) { r.onFailure?.("scripture", err); }
    }
    const p2 = pending.get(churchId);
    if (p2?.cts) {
      const sent = p2.cts;
      try {
        const snap = await r.saveContentTypeStyles(churchId, sent.v);
        if (!snap) throw new Error("save failed");
        const cur = pending.get(churchId);
        if (cur?.cts === sent) {
          delete cur.cts;
          // Adopt the server's sanitized value (foreign theme ids dropped).
          const e = entries.get(churchId);
          const serverCts = sanitizeContentTypeStyles(snap.contentTypeStyles);
          if (e && !same(e.cts, serverCts)) { entries.set(churchId, { ...e, cts: serverCts }); dispatch({ cts: true }); }
        }
      } catch (err) { r.onFailure?.("cts", err); }
    }
  } finally {
    inFlight.set(churchId, 0);
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
  entries.clear(); pending.clear(); inFlight.clear(); legacyMemo.clear();
  activeChurchId = null; remote = null;
}

/** Server pages: church_preferences row (or null = no row yet) → props snapshot. */
export function churchStylesSnapshotFromPrefs(prefs: {
  scriptureStyle?: unknown;
  contentTypeStyles?: unknown;
  scriptureStyleUpdatedAt?: Date | string | null;
} | null | undefined): ChurchStylesSnapshot {
  const at = prefs?.scriptureStyleUpdatedAt;
  return {
    scriptureStyle: prefs?.scriptureStyle ?? null,
    contentTypeStyles: prefs?.contentTypeStyles ?? {},
    scriptureStyleUpdatedAt: at ? new Date(at).toISOString() : null,
  };
}
