"use client";
/**
 * Persistent, offline-capable Bible chapter store (IndexedDB).
 *
 * The in-memory chapter cache (bible-chapter-cache.ts) is fast but dies on
 * reload and is useless offline. This layer persists every chapter the
 * operator has ever loaded so that:
 *   - a chapter survives an app reload / restart (no re-fetch), and
 *   - a chapter is available with ZERO network when the internet drops
 *     mid-service — the operator can keep projecting scripture offline.
 *
 * Bible text is effectively immutable, so a persisted chapter is always safe
 * to serve — there is no staleness to reconcile. This is also why we can check
 * IndexedDB BEFORE the network (faster AND offline-safe), not just as a
 * fallback.
 *
 * The Bible library is GLOBAL (no church_id — the documented tenancy exception
 * in src/lib/server/bible.ts), so chapters are NOT church-scoped here. The key
 * already namespaces by translation code, so licensed vs public-domain and
 * different translations never collide.
 *
 * Own IndexedDB database (`presentflow-bible`) to avoid version coordination
 * with the service-snapshot DB (`presentflow-offline`). All ops are
 * best-effort: any failure (private mode, quota, no IndexedDB) resolves
 * quietly and the caller falls back to the network.
 */
import type { BibleVerse } from "../bible-client-cache";

export type StoredChapter = { verses: BibleVerse[]; translation: string; at: number };

const DB_NAME = "presentflow-bible";
const DB_VERSION = 2;
const STORE = "chapters";
const META = "meta"; // hydration manifest: which translations are fully downloaded

function idbAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

// A stalled indexedDB.open() would hang the chapter fetch (the offline read is
// on the critical path, before the network). Cap the open at OPEN_TIMEOUT_MS so
// a blocked/stalled open resolves null and the caller falls through to the
// network instead of hanging mid-service.
const OPEN_TIMEOUT_MS = 3000;
let db: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return Promise.resolve(null);
  if (db) return Promise.resolve(db);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let settled = false;
    // On failure/timeout, reset dbPromise so the NEXT call retries — a single
    // transient open failure must not disable persistence for the whole
    // session. A successful connection is cached in `db` and reused.
    const done = (result: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      if (result) db = result; else dbPromise = null;
      resolve(result);
    };
    const timer = setTimeout(() => done(null), OPEN_TIMEOUT_MS);
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "key" });
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: "code" });
      };
      req.onsuccess = () => { clearTimeout(timer); done(req.result); };
      req.onerror = () => { clearTimeout(timer); done(null); };
      req.onblocked = () => { clearTimeout(timer); done(null); };
    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
  return dbPromise;
}

/** Persist a chapter under its chapterKey. Best-effort; never throws. */
export async function saveOfflineChapter(key: string, entry: StoredChapter): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
      try {
        tx.objectStore(STORE).put({ key, ...entry });
      } catch {
        resolve();
      }
    });
  } catch {
    /* best-effort */
  }
}

// Bulk write is CHUNKED (not one giant transaction) so it never holds the
// `chapters` store lock long enough to delay a concurrent live-projection read
// (loadOfflineChapter), and so the synchronous structured-clone cost is broken
// up rather than janking a frame mid-service. Returns true only if EVERY batch
// committed — a partial write must NOT be marked "fully hydrated" by the caller.
const SAVE_CHUNK = 100;
export async function saveOfflineChapters(entries: { key: string; entry: StoredChapter }[]): Promise<boolean> {
  if (entries.length === 0) return true;
  try {
    const database = await openDb();
    if (!database) return false;
    let allOk = true;
    for (let i = 0; i < entries.length; i += SAVE_CHUNK) {
      const batch = entries.slice(i, i + SAVE_CHUNK);
      const ok = await new Promise<boolean>((resolve) => {
        const tx = database.transaction(STORE, "readwrite");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
        try {
          const store = tx.objectStore(STORE);
          for (const { key, entry } of batch) store.put({ key, ...entry });
        } catch {
          resolve(false);
        }
      });
      if (!ok) allOk = false;
      // Yield so a live verse read can interleave between batches.
      await new Promise((r) => setTimeout(r, 0));
    }
    return allOk;
  } catch {
    return false;
  }
}

/** Record that a translation code has been fully hydrated (offline manifest). */
export async function markTranslationHydrated(code: string, at: number): Promise<void> {
  try {
    const database = await openDb();
    if (!database) return;
    await new Promise<void>((resolve) => {
      const tx = database.transaction(META, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
      try { tx.objectStore(META).put({ code: code.toUpperCase(), at }); } catch { resolve(); }
    });
  } catch {
    /* best-effort */
  }
}

/** When (ms) a translation was last fully hydrated, or null. Never throws. */
export async function getTranslationHydratedAt(code: string): Promise<number | null> {
  try {
    const database = await openDb();
    if (!database) return null;
    return await new Promise<number | null>((resolve) => {
      const tx = database.transaction(META, "readonly");
      const req = tx.objectStore(META).get(code.toUpperCase());
      req.onsuccess = () => {
        const v = req.result as { code: string; at: number } | undefined;
        resolve(v && typeof v.at === "number" ? v.at : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Load a persisted chapter, or null if absent / unavailable. Never throws. */
export async function loadOfflineChapter(key: string): Promise<StoredChapter | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise<StoredChapter | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result as (StoredChapter & { key: string }) | undefined;
        if (v && Array.isArray(v.verses)) resolve({ verses: v.verses, translation: v.translation, at: v.at });
        else resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
