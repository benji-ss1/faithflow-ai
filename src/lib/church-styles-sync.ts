"use client";
// Network side of the per-church styles store (PR B, 2026-09-17): server
// actions, same-machine BroadcastChannel (rule 8 primary path), offline KV
// cache (incl. pending writes), retry-on-online, one-time legacy migration,
// and throttled refetches (focus / visibility / 60s backstop). The synchronous
// cache itself lives in church-styles-store.ts. Never re-sends the live slide.
import { toast } from "sonner";
import { setScriptureStyle, setContentTypeStyles, getChurchStyles } from "./actions";
import {
  CHURCH_STYLES_CHANNEL, LEGACY_CTS_KEY, LEGACY_SCRIPTURE_KEY, MIGRATED_KEY,
  applyPeerChurchStyles, currentSnapshot, flushPending, getPendingWrites, hasPendingChurchStyles,
  hydrateChurchStyles, isChurchStylesHydrated, readLegacyContentTypeStyles,
  readLegacyScriptureStyle, registerChurchStylesRemote, restorePendingWrites,
  type ChurchStylesSnapshot, type PendingWrites, type SaveOutcome,
} from "./church-styles-store";
import { saveKv, loadKv } from "./offline/serviceCache";

export const CHURCH_STYLES_OFFLINE_KEY = "churchStyles";
/** Offline KV record: last snapshot + writes not yet acknowledged by the server. */
export type OfflineChurchStyles = ChurchStylesSnapshot & { pending?: PendingWrites };
export const CHURCH_STYLES_POLL_MS = 60_000;

let channel: BroadcastChannel | null = null;
const started = new Map<string, number>(); // churchId → ref count
const lastToast = { at: 0 };

type ActionData = { churchId?: string; scriptureStyle: unknown; contentTypeStyles: unknown; scriptureStyleUpdatedAt: string | null; contentTypeStylesUpdatedAt?: string | null };
function toSnap(d: ActionData): ChurchStylesSnapshot {
  return {
    scriptureStyle: d.scriptureStyle ?? null, contentTypeStyles: d.contentTypeStyles ?? {},
    scriptureStyleUpdatedAt: d.scriptureStyleUpdatedAt ?? null, contentTypeStylesUpdatedAt: d.contentTypeStylesUpdatedAt ?? null,
  };
}

/** Map a server-action result to a store SaveOutcome (exported for tests). */
export async function toOutcome(
  churchId: string,
  r: { ok: true; data?: ActionData } | { ok: false; error: string },
  fetchServer: () => Promise<ChurchStylesSnapshot | null>,
): Promise<SaveOutcome | null> {
  if (r.ok) return r.data && (r.data.churchId === undefined || r.data.churchId === churchId) ? { status: "ok", snap: toSnap(r.data) } : { status: "rejected", snap: null, error: "Wrong church" };
  if (r.error === "Not permitted") return { status: "rejected", snap: await fetchServer().catch(() => null), error: r.error };
  if (r.error === "Wrong church") return { status: "rejected", snap: null, error: r.error }; // never adopt another church's value
  if (r.error === "Invalid style" || r.error === "Style too large") return { status: "rejected", snap: await fetchServer().catch(() => null), error: r.error };
  return null; // transient → stays pending
}

async function fetchServerFor(churchId: string): Promise<ChurchStylesSnapshot | null> {
  const r = await getChurchStyles();
  return r.ok && r.data && r.data.churchId === churchId ? toSnap(r.data) : null;
}

function persistOffline(churchId: string, snap: ChurchStylesSnapshot, pending: PendingWrites) {
  const rec: OfflineChurchStyles = { ...snap };
  if (pending.scripture || pending.cts) rec.pending = pending;
  void saveKv(churchId, CHURCH_STYLES_OFFLINE_KEY, rec);
}

function ensureRemote() {
  if (typeof window === "undefined") return;
  if (!channel && typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(CHURCH_STYLES_CHANNEL);
      channel.onmessage = (ev: MessageEvent) => {
        const m = ev.data as { churchId?: string; snap?: ChurchStylesSnapshot } | null;
        if (m && typeof m.churchId === "string" && m.snap) applyPeerChurchStyles(m.churchId, m.snap);
      };
    } catch { channel = null; }
  }
  registerChurchStylesRemote({
    saveScripture: async (churchId, design) =>
      toOutcome(churchId, await setScriptureStyle(design, { expectedChurchId: churchId }), () => fetchServerFor(churchId)),
    saveContentTypeStyles: async (churchId, cts) =>
      toOutcome(churchId, await setContentTypeStyles(cts, { expectedChurchId: churchId }), () => fetchServerFor(churchId)),
    onFailure: (what, kind, err) => {
      const now = Date.now();
      if (now - lastToast.at < 4000) return;
      lastToast.at = now;
      const label = what === "scripture" ? "Scripture Style" : "default song/Bible themes";
      if (kind === "rejected") {
        const msg = err instanceof Error ? err.message : "";
        if (msg === "Not permitted") toast.error(`You don't have permission to change the ${label} for your church.`);
        else if (msg !== "Wrong church") toast.error(`Couldn't save the ${label} — your church's saved one is kept.`);
      } else {
        toast.error(`Couldn't sync ${label} to your church — kept on this computer, will retry when online.`);
      }
    },
    persistOffline,
    broadcast: (churchId, snap) => { try { channel?.postMessage({ churchId, snap }); } catch { /* ignore */ } },
  });
}

/**
 * One-time legacy localStorage → server migration. First computer wins.
 * The marker is set ONLY when every needed step settled (applied or lost the
 * race); any failure leaves it unset so the next load retries.
 */
export async function migrateLegacy(
  churchId: string,
  server: ChurchStylesSnapshot,
  api: {
    setScripture: (d: unknown, o: { ifEmpty: true; expectedChurchId: string }) => Promise<{ ok: true; data?: ActionData } | { ok: false; error: string }>;
    setCts: (c: unknown, o: { ifEmpty: true; expectedChurchId: string }) => Promise<{ ok: true; data?: ActionData } | { ok: false; error: string }>;
  } = { setScripture: setScriptureStyle, setCts: setContentTypeStyles },
): Promise<boolean> {
  try {
    if (window.localStorage.getItem(MIGRATED_KEY(churchId))) return true;
  } catch { return false; }
  let done = true;
  // Scripture: only this church's key — never the ".default" key.
  const legacyScripture = churchId ? readLegacyScriptureStyle(churchId) : null;
  if (legacyScripture && server.scriptureStyle == null && server.scriptureStyleUpdatedAt == null) {
    try {
      const r = await api.setScripture(legacyScripture, { ifEmpty: true, expectedChurchId: churchId });
      if (r.ok && r.data && (r.data.churchId === undefined || r.data.churchId === churchId)) hydrateChurchStyles(churchId, toSnap(r.data), { force: true }); // loser adopts server
      else done = false;
    } catch { done = false; }
  }
  const legacyCts = readLegacyContentTypeStyles();
  const serverCtsNeverSet = (server.contentTypeStylesUpdatedAt ?? null) === null &&
    (!server.contentTypeStyles || (typeof server.contentTypeStyles === "object" && Object.keys(server.contentTypeStyles as object).length === 0));
  if (legacyCts && Object.keys(legacyCts).length > 0 && serverCtsNeverSet) {
    try {
      const r = await api.setCts(legacyCts, { ifEmpty: true, expectedChurchId: churchId });
      if (r.ok && r.data && (r.data.churchId === undefined || r.data.churchId === churchId)) hydrateChurchStyles(churchId, toSnap(r.data), { force: true });
      else done = false;
    } catch { done = false; }
  }
  if (done) { try { window.localStorage.setItem(MIGRATED_KEY(churchId), String(Date.now())); } catch { /* ignore */ } }
  return done;
}

const lastFetch = new Map<string, number>();
/** Refetch from the server and hydrate if newer. Throttled per church; never re-sends the live slide. */
export async function refreshChurchStylesFromServer(churchId: string, opts: { throttleMs?: number } = {}): Promise<void> {
  if (typeof window === "undefined" || !churchId || !isChurchStylesHydrated(churchId)) return;
  const now = Date.now();
  if (now - (lastFetch.get(churchId) ?? 0) < (opts.throttleMs ?? 0)) return;
  lastFetch.set(churchId, now);
  try {
    const r = await getChurchStyles();
    // Only ever store under the church the SERVER says this session belongs to.
    if (r.ok && r.data && r.data.churchId === churchId) {
      hydrateChurchStyles(churchId, toSnap(r.data));
      persistOffline(churchId, currentSnapshot(churchId), getPendingWrites(churchId));
    }
  } catch { /* offline — keep cache */ }
}

/**
 * Start syncing for a church (idempotent, ref-counted). Call AFTER the
 * synchronous hydrateChurchStylesInitial(churchId, props) in the first render.
 * `server` = the props snapshot (null → try the offline cache).
 */
export function startChurchStylesSync(churchId: string, server: ChurchStylesSnapshot | null): () => void {
  if (typeof window === "undefined" || !churchId) return () => {};
  ensureRemote();
  const count = (started.get(churchId) ?? 0) + 1;
  started.set(churchId, count);
  const onOnline = () => { void flushPending(churchId); };
  const refresh = (throttleMs: number) => { if (!hasPendingChurchStyles(churchId)) void refreshChurchStylesFromServer(churchId, { throttleMs }); };
  const onFocus = () => refresh(5000);
  const onVis = () => { if (document.visibilityState === "visible") onFocus(); };
  // Backstop for Realtime (RLS may block postgres_changes on church_preferences):
  // a full-screen projector computer never gets focus events.
  const poll = window.setInterval(() => { if (document.visibilityState !== "hidden") refresh(CHURCH_STYLES_POLL_MS - 1000); }, CHURCH_STYLES_POLL_MS);
  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVis);
  if (count === 1) {
    void loadKv<OfflineChurchStyles>(churchId, CHURCH_STYLES_OFFLINE_KEY).then((rec) => {
      if (!server && rec && !isChurchStylesHydrated(churchId)) hydrateChurchStyles(churchId, rec);
      // An offline save that never reached the server survives the reload.
      if (rec?.pending) restorePendingWrites(churchId, rec.pending);
      else persistOffline(churchId, currentSnapshot(churchId), getPendingWrites(churchId));
    }).finally(() => {
      if (server) void migrateLegacy(churchId, server);
    });
  }
  return () => {
    window.clearInterval(poll);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVis);
    started.set(churchId, Math.max(0, (started.get(churchId) ?? 1) - 1));
  };
}

// Referenced so the legacy key names stay greppable next to the migration.
export const LEGACY_KEYS = { scripture: LEGACY_SCRIPTURE_KEY, cts: LEGACY_CTS_KEY };
