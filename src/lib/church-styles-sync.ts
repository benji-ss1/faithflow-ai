"use client";
// Network side of the per-church styles store (PR B, 2026-09-17): server
// actions, same-machine BroadcastChannel (rule 8 primary path), offline KV
// cache, retry-on-online, one-time legacy migration, and a throttled refetch.
// The synchronous cache itself lives in church-styles-store.ts.
import { toast } from "sonner";
import { setScriptureStyle, setContentTypeStyles, getChurchStyles } from "./actions";
import {
  CHURCH_STYLES_CHANNEL, LEGACY_CTS_KEY, LEGACY_SCRIPTURE_KEY, MIGRATED_KEY,
  applyPeerChurchStyles, currentSnapshot, flushPending, hasPendingChurchStyles,
  hydrateChurchStyles, isChurchStylesHydrated, readLegacyContentTypeStyles,
  readLegacyScriptureStyle, registerChurchStylesRemote,
  type ChurchStylesSnapshot,
} from "./church-styles-store";
import { saveKv, loadKv } from "./offline/serviceCache";

const OFFLINE_KEY = "churchStyles";
let channel: BroadcastChannel | null = null;
const started = new Map<string, number>(); // churchId → ref count
const lastToast = { at: 0 };

function toSnap(d: { scriptureStyle: unknown; contentTypeStyles: unknown; scriptureStyleUpdatedAt: string | null }): ChurchStylesSnapshot {
  return { scriptureStyle: d.scriptureStyle ?? null, contentTypeStyles: d.contentTypeStyles ?? {}, scriptureStyleUpdatedAt: d.scriptureStyleUpdatedAt ?? null };
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
    saveScripture: async (_churchId, design) => {
      const r = await setScriptureStyle(design);
      return r.ok && r.data ? toSnap(r.data) : null;
    },
    saveContentTypeStyles: async (_churchId, cts) => {
      const r = await setContentTypeStyles(cts);
      if (!r.ok && r.error === "Not permitted") throw new Error("not-permitted");
      return r.ok && r.data ? toSnap(r.data) : null;
    },
    onFailure: (what, err) => {
      const now = Date.now();
      if (now - lastToast.at < 4000) return;
      lastToast.at = now;
      const label = what === "scripture" ? "Scripture Style" : "default song/Bible themes";
      if (err instanceof Error && err.message === "not-permitted") {
        toast.error(`You don't have permission to change the ${label} for your church.`);
      } else {
        toast.error(`Couldn't sync ${label} to your church — kept on this computer, will retry when online.`);
      }
    },
    persistOffline: (churchId, snap) => { void saveKv(churchId, OFFLINE_KEY, snap); },
    broadcast: (churchId, snap) => { try { channel?.postMessage({ churchId, snap }); } catch { /* ignore */ } },
  });
}

/** One-time legacy localStorage → server migration. First computer wins. */
async function migrateLegacy(churchId: string, server: ChurchStylesSnapshot): Promise<void> {
  try {
    if (window.localStorage.getItem(MIGRATED_KEY(churchId))) return;
  } catch { return; }
  let done = true;
  // Scripture: only this church's key — never the ".default" key.
  const legacyScripture = churchId ? readLegacyScriptureStyle(churchId) : null;
  if (legacyScripture && server.scriptureStyle == null && server.scriptureStyleUpdatedAt == null) {
    try {
      const r = await setScriptureStyle(legacyScripture, { ifEmpty: true });
      if (r.ok && r.data) hydrateChurchStyles(churchId, toSnap(r.data), { force: true }); // loser adopts server
      else done = false;
    } catch { done = false; }
  }
  const legacyCts = readLegacyContentTypeStyles();
  const serverCtsEmpty = !server.contentTypeStyles || (typeof server.contentTypeStyles === "object" && Object.keys(server.contentTypeStyles as object).length === 0);
  if (legacyCts && Object.keys(legacyCts).length > 0 && serverCtsEmpty) {
    try {
      const r = await setContentTypeStyles(legacyCts, { ifEmpty: true });
      if (r.ok && r.data) hydrateChurchStyles(churchId, toSnap(r.data));
      else if (!(r.ok === false && r.error === "Not permitted")) done = false; // a volunteer can't migrate; an editor's computer will
    } catch { done = false; }
  }
  if (done) { try { window.localStorage.setItem(MIGRATED_KEY(churchId), String(Date.now())); } catch { /* ignore */ } }
}

let lastFetch = 0;
/** Refetch from the server and hydrate if newer. Throttled; never re-sends the live slide. */
export async function refreshChurchStylesFromServer(churchId: string, opts: { throttleMs?: number } = {}): Promise<void> {
  if (typeof window === "undefined" || !churchId || !isChurchStylesHydrated(churchId)) return;
  const now = Date.now();
  if (now - lastFetch < (opts.throttleMs ?? 0)) return;
  lastFetch = now;
  try {
    const r = await getChurchStyles();
    if (r.ok && r.data) {
      const snap = toSnap(r.data);
      hydrateChurchStyles(churchId, snap);
      void saveKv(churchId, OFFLINE_KEY, currentSnapshot(churchId));
    }
  } catch { /* offline — keep cache */ }
}

/**
 * Start syncing for a church (idempotent, ref-counted). Call AFTER the
 * synchronous hydrateChurchStyles(churchId, props) in the first render.
 * `server` = the props snapshot (null → try the offline cache).
 */
export function startChurchStylesSync(churchId: string, server: ChurchStylesSnapshot | null): () => void {
  if (typeof window === "undefined" || !churchId) return () => {};
  ensureRemote();
  const count = (started.get(churchId) ?? 0) + 1;
  started.set(churchId, count);
  const onOnline = () => { void flushPending(churchId); };
  const onFocus = () => { if (!hasPendingChurchStyles(churchId)) void refreshChurchStylesFromServer(churchId, { throttleMs: 5000 }); };
  const onVis = () => { if (document.visibilityState === "visible") onFocus(); };
  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVis);
  if (count === 1) {
    if (server) {
      void saveKv(churchId, OFFLINE_KEY, currentSnapshot(churchId));
      void migrateLegacy(churchId, server);
    } else if (!isChurchStylesHydrated(churchId)) {
      void loadKv<ChurchStylesSnapshot>(churchId, OFFLINE_KEY).then((snap) => {
        if (snap && !isChurchStylesHydrated(churchId)) hydrateChurchStyles(churchId, snap);
      });
    }
  }
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVis);
    started.set(churchId, Math.max(0, (started.get(churchId) ?? 1) - 1));
  };
}

// Referenced so the legacy key names stay greppable next to the migration.
export const LEGACY_KEYS = { scripture: LEGACY_SCRIPTURE_KEY, cts: LEGACY_CTS_KEY };
