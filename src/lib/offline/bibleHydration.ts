"use client";
/**
 * Full-Bible offline hydration (increment 2b).
 *
 * On the operator console, once per session while online and idle, download
 * EVERY public-domain translation the church has access to and store all of its
 * chapters in IndexedDB — so ANY verse in those translations projects offline,
 * not just chapters the operator happened to open.
 *
 * Licensed translations (NIV/NKJV/NLT) are deliberately excluded here: they're
 * live API.Bible snapshots on a shared 5k/month quota, so a bulk pull is both
 * infeasible and licensing-sensitive. They're handled on-demand instead (a
 * chapter is cached when actually opened — see bible-chapter-cache.ts). The
 * server's /api/bible/full endpoint independently refuses licensed codes, so
 * even a bug here can't bulk-hit API.Bible.
 *
 * Best-effort throughout: any failure just leaves that translation un-hydrated;
 * the on-demand path still fills it in as chapters are opened.
 */
import { chapterKey } from "../bible-chapter-cache";
import { knownBook } from "../bible-parser";
import {
  saveOfflineChapters, markTranslationHydrated, getTranslationHydratedAt,
  type StoredChapter,
} from "./bibleOfflineStore";

const REHYDRATE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // re-pull at most monthly
let running = false; // prevents overlapping runs; NOT a once-per-session lock
                     // (the per-translation manifest handles once-only work, so
                     // this can be re-invoked safely to RESUME after deferral).

type ApiTranslation = { code: string; name: string; isPublicDomain: boolean; licenseRequired: boolean };
type FullTranslation = {
  code: string; name: string;
  chapters: { book: string; chapter: number; verses: { verse: number; text: string }[] }[];
};

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function hydrateOne(code: string): Promise<void> {
  const last = await getTranslationHydratedAt(code);
  if (last !== null && Date.now() - last < REHYDRATE_TTL_MS) return; // already fresh
  const full = await fetchJson<FullTranslation>(`/api/bible/full?code=${encodeURIComponent(code)}`);
  if (!full || !Array.isArray(full.chapters) || full.chapters.length === 0) return;
  const now = Date.now();
  const entries = full.chapters
    // The full-dump is the authoritative, complete DB copy, so unlike the
    // on-demand network path we do NOT require verses[0]===1 here — that would
    // silently drop legitimate verse-0 Psalm superscriptions. Any chapter with
    // ≥1 verse is stored.
    .filter((c) => Array.isArray(c.verses) && c.verses.length > 0)
    .map((c) => ({
      // Key off the SAME canonical book name the reader uses (knownBook), not
      // the raw DB string, so hydrated chapters are always found on read even
      // for translations whose stored book names differ from the parser's.
      key: chapterKey(full.code, knownBook(c.book) ?? c.book, c.chapter),
      entry: { verses: c.verses, translation: full.code, at: now } as StoredChapter,
    }));
  if (entries.length === 0) return;
  // Only mark fully-hydrated when EVERY chunk committed — a partial save must
  // remain un-marked so it's retried (on-demand fills the gaps meanwhile).
  const ok = await saveOfflineChapters(entries);
  if (ok) await markTranslationHydrated(code, now);
}

/**
 * Kick off background hydration of every accessible public-domain translation.
 * Idempotent + RESUMABLE: safe to call on every mount / whenever the service
 * goes idle. `isBusy()` lets the caller defer while a service is LIVE — we do
 * not want to JSON-parse whole Bibles or hold IndexedDB while verses are being
 * projected. Already-hydrated translations are skipped via the manifest, so a
 * deferred run simply resumes the remaining ones next time it's called.
 */
export function hydratePublicDomainBibleInBackground(isBusy: () => boolean = () => false): void {
  if (running) return;
  if (typeof window === "undefined") return;
  if (!window.navigator.onLine) return; // wait for an online session
  if (isBusy()) return;                  // defer while a service is live

  const run = async () => {
    running = true;
    try {
      const data = await fetchJson<{ translations: ApiTranslation[] }>("/api/bible/translations");
      const codes = (data?.translations ?? [])
        .filter((t) => t.isPublicDomain && !t.licenseRequired)
        .map((t) => t.code);
      for (const code of codes) {
        // Bail the moment a service goes live or the link drops — resumes on a
        // later call (e.g. when audio.listening flips back off).
        if (!window.navigator.onLine || isBusy()) break;
        try { await hydrateOne(code); } catch { /* best-effort per translation */ }
        await new Promise((r) => setTimeout(r, 1500)); // gap between translations
      }
    } finally {
      running = false;
    }
  };

  const kickoff = () => { if (!isBusy()) void run(); };
  // Low priority — wait for idle so first paint / setup isn't slowed. (Idle is
  // only the START hint; isBusy() is the real live-service guard.)
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
  if (typeof ric === "function") ric(kickoff, { timeout: 10_000 });
  else setTimeout(kickoff, 8_000);
}
