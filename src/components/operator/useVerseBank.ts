"use client";
import { useCallback, useRef, useState } from "react";
import type { SlidePayload } from "@/lib/broadcast";

export type BankedVerse = {
  id: string;                // stable — book|ch|vs|ve
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  translation: string;       // e.g. "KJV"
  text: string;              // rendered slide text (with reference label)
  approvedAt: number;
  // ±5 window preloaded so "next verse" / "back" is instant
  before: { verse: number; text: string }[];
  after:  { verse: number; text: string }[];
};

/**
 * Per-service verse bank. Holds every reference the operator has approved
 * (or that auto-approved), plus a ±5 window around each so contextual
 * "next verse" / "back" / "continue" navigation is instant with no DB
 * roundtrip.
 *
 * The bank is UI state only — the underlying detected_references rows are
 * still the persistent audit trail. Bank is cleared when the operator
 * closes the console.
 */
export function useVerseBank(defaultTranslationCode: string) {
  const [bank, setBank] = useState<BankedVerse[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number | null>(null);
  const currentIdxRef = useRef<number | null>(null);
  currentIdxRef.current = currentIdx;

  const currentRef = currentIdx !== null ? bank[currentIdx] || null : null;

  /** Add a fresh reference to the bank + preload its ±5 window. */
  const addReference = useCallback(async (ref: { book: string; chapter: number; verseStart: number; verseEnd: number }): Promise<BankedVerse | null> => {
    try {
      const res = await fetch("/api/bible/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book: ref.book, chapter: ref.chapter,
          verseStart: ref.verseStart, verseEnd: ref.verseEnd,
          translationCode: defaultTranslationCode, withWindow: true,
        }),
      }).then((r) => r.json());
      if (res.error || !res.primary?.length) return null;

      const primaryText = (res.primary as { text: string }[]).map((v) => v.text).join(" ");
      const label = `${ref.book} ${ref.chapter}:${ref.verseStart}${ref.verseStart !== ref.verseEnd ? `-${ref.verseEnd}` : ""} (${res.translation})`;
      const banked: BankedVerse = {
        id: `${ref.book}|${ref.chapter}|${ref.verseStart}|${ref.verseEnd}`,
        book: ref.book,
        chapter: ref.chapter,
        verseStart: ref.verseStart,
        verseEnd: ref.verseEnd,
        translation: res.translation,
        text: `${primaryText}\n\n${label}`,
        approvedAt: Date.now(),
        before: (res.before as { verse: number; text: string }[]) || [],
        after: (res.after as { verse: number; text: string }[]) || [],
      };
      setBank((cur) => {
        // Dedupe: if this exact reference is already in the bank, move it
        // to the end (most recent).
        const filtered = cur.filter((b) => b.id !== banked.id);
        const next = [...filtered, banked];
        setCurrentIdx(next.length - 1);
        return next;
      });
      return banked;
    } catch {
      return null;
    }
  }, [defaultTranslationCode]);

  /** Advance to next verse (or expand). Uses preloaded window; if we run
   * out, transparently fetches +5 more. */
  const advanceOne = useCallback(async (mode: "next" | "prev" | "continue" | "back"): Promise<BankedVerse | null> => {
    const idx = currentIdxRef.current;
    if (idx === null) return null;
    const cur = bank[idx];
    if (!cur) return null;

    let nextRef: { book: string; chapter: number; verseStart: number; verseEnd: number } | null = null;
    if (mode === "next" || mode === "prev") {
      const delta = mode === "next" ? 1 : -1;
      const vs = cur.verseStart + delta;
      const ve = cur.verseEnd + delta;
      if (vs < 1) return null;
      nextRef = { book: cur.book, chapter: cur.chapter, verseStart: vs, verseEnd: ve };
    } else if (mode === "continue") {
      // Expand range by +1 verse at the end
      nextRef = { book: cur.book, chapter: cur.chapter, verseStart: cur.verseStart, verseEnd: cur.verseEnd + 1 };
    } else if (mode === "back") {
      // Shrink range by -1 verse at the end
      if (cur.verseEnd <= cur.verseStart) return null;
      nextRef = { book: cur.book, chapter: cur.chapter, verseStart: cur.verseStart, verseEnd: cur.verseEnd - 1 };
    }
    if (!nextRef) return null;

    // Try the preloaded window first — instant, no fetch
    if (mode === "next") {
      const preloaded = cur.after.find((v) => v.verse === nextRef!.verseStart);
      if (preloaded) {
        const label = `${nextRef.book} ${nextRef.chapter}:${nextRef.verseStart} (${cur.translation})`;
        // Rebuild "current" bank entry moving the window: shift after by 1
        const banked: BankedVerse = {
          id: `${nextRef.book}|${nextRef.chapter}|${nextRef.verseStart}|${nextRef.verseEnd}`,
          book: nextRef.book, chapter: nextRef.chapter,
          verseStart: nextRef.verseStart, verseEnd: nextRef.verseEnd,
          translation: cur.translation,
          text: `${preloaded.text}\n\n${label}`,
          approvedAt: Date.now(),
          before: [...cur.before, { verse: cur.verseStart, text: "" }].slice(-5),
          after: cur.after.filter((v) => v.verse > nextRef!.verseEnd),
        };
        // If window is getting thin, top it up in background
        if (banked.after.length < 3) {
          fetch("/api/bible/lookup", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              book: banked.book, chapter: banked.chapter,
              verseStart: banked.verseStart, verseEnd: banked.verseEnd,
              translationCode: cur.translation, withWindow: true,
            }),
          }).then((r) => r.json()).then((res) => {
            if (res.after) {
              setBank((b) => b.map((x) => x.id === banked.id ? { ...x, after: res.after, before: res.before } : x));
            }
          }).catch(() => { /* ignore */ });
        }
        setBank((b) => [...b, banked]);
        setCurrentIdx((b) => (b ?? 0) + 1);
        return banked;
      }
    }
    // Fallback — fetch from server
    return addReference(nextRef);
  }, [bank, addReference]);

  const jumpTo = useCallback((idx: number) => {
    if (idx < 0 || idx >= bank.length) return null;
    setCurrentIdx(idx);
    return bank[idx];
  }, [bank]);

  const clear = useCallback(() => {
    setBank([]);
    setCurrentIdx(null);
  }, []);

  const bankedToSlide = useCallback((v: BankedVerse): SlidePayload => ({
    kind: "text",
    text: v.text,
  }), []);

  return { bank, currentRef, currentIdx, addReference, advanceOne, jumpTo, clear, bankedToSlide };
}
