"use client";
// Hybrid Phase 1 — a durable, CHURCH-SCOPED client snapshot of the current
// service plan so it survives an outage (and service-worker cache eviction).
// A snapshot is only ever returned to the church that wrote it — never cross
// church. Raw IndexedDB, no dependency, entirely best-effort (every failure
// resolves quietly so it can never break the online path).

const DB_NAME = "presentflow-offline";
const STORE = "serviceSnapshots";
const KV_STORE = "kv"; // church-scoped key→blob (themes list, settings, …)
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "planId" });
        if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

/** Store a church-scoped blob (e.g. the themes list) for offline fallback. */
export async function saveKv<T>(churchId: string, key: string, value: T): Promise<void> {
  if (!churchId || !key || value == null) return;
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(KV_STORE, "readwrite");
      tx.objectStore(KV_STORE).put({ key: `${churchId}|${key}`, churchId, savedAt: Date.now(), value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch { /* best-effort */ } finally { try { db.close(); } catch { /* ignore */ } }
}

/** Load a church-scoped blob; only returns THIS church's value. */
export async function loadKv<T>(churchId: string, key: string): Promise<T | null> {
  if (!churchId || !key) return null;
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(KV_STORE, "readonly");
      const req = tx.objectStore(KV_STORE).get(`${churchId}|${key}`);
      req.onsuccess = () => {
        const r = req.result as { churchId?: string; value?: T } | undefined;
        resolve(r && r.churchId === churchId ? (r.value as T) : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch { return null; } finally { try { db.close(); } catch { /* ignore */ } }
}

type Snapshot<T> = { planId: string; churchId: string; savedAt: number; plan: T };

/** Persist the current plan for offline use. Best-effort; never throws. */
export async function saveServiceSnapshot<T>(churchId: string, planId: string, plan: T): Promise<void> {
  if (!churchId || !planId || plan == null) return;
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ planId, churchId, savedAt: Date.now(), plan } as Snapshot<T>);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch { /* best-effort */ } finally { try { db.close(); } catch { /* ignore */ } }
}

/**
 * Purge all offline caches — call on logout / account switch so a shared
 * machine can never surface the previous account's cached pages or plan
 * (defense against cross-tenant leakage in the SW navigation cache + this
 * IndexedDB store). Best-effort; never throws.
 */
export function clearOfflineCaches(): void {
  try {
    if (typeof navigator !== "undefined") navigator.serviceWorker?.controller?.postMessage({ type: "PF_CLEAR_CACHES" });
  } catch { /* ignore */ }
  try {
    if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(DB_NAME);
  } catch { /* ignore */ }
}

/**
 * Load a previously-saved plan for offline fallback. Returns null unless the
 * snapshot belongs to THIS church — a hard tenant boundary so a shared machine
 * can never surface another church's service.
 */
export async function loadServiceSnapshot<T>(churchId: string, planId: string): Promise<{ plan: T; savedAt: number } | null> {
  if (!churchId || !planId) return null;
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(planId);
      req.onsuccess = () => {
        const s = req.result as Snapshot<T> | undefined;
        resolve(s && s.churchId === churchId ? { plan: s.plan, savedAt: s.savedAt } : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch { return null; } finally { try { db.close(); } catch { /* ignore */ } }
}
