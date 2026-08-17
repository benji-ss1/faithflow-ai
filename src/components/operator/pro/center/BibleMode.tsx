"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";
import { BibleOptionsPopover, BibleOptionsProvider, useBibleOptions } from "./BibleOptionsPopover";
import { BibleBookBrowser } from "./BibleBookBrowser";
import type { BibleSessionApi, VerseCard } from "../hooks";
import { cn } from "@/lib/utils";
import { cachedLookup } from "@/lib/bible-client-cache";
import { bibleSearchCacheKey, getBibleSearchCached, setBibleSearchCached } from "@/lib/bible-search-cache";
import { fetchChapterCached } from "@/lib/bible-chapter-cache";
import { addServiceItem, addServiceItems } from "@/lib/actions";
import { Plus, Pencil, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { isInternalEvent } from "@/lib/internal-events";
import { phraseSearch, findPhraseByReference, type PhraseSearchResult } from "@/services/bible/phraseSearch";

/**
 * R5: All session state (ref, translation, mode, cards, selectedIdx) is
 * lifted to ProOperatorShell via useBibleSession so switching center-mode
 * (bible ↔ slides) no longer wipes the lookup results.
 * Y1/Y7: reference format + show-verse-numbers + verse/passage mode are
 * driven by BibleOptions (single source of truth). Verse mode = 1 verse per
 * card; Passage mode = up to 4 verses per card.
 */
export function BibleMode(props: { ctx: OperatorShellCtx; session: BibleSessionApi }) {
  // R4: single Provider mounted here, above both consumers of
  // useBibleOptions (BibleModeInner below, and BibleOptionsPopover it
  // renders as a child) — replaces two independent useState instances that
  // never re-synced with each other.
  return (
    <BibleOptionsProvider>
      <BibleModeInner {...props} />
    </BibleOptionsProvider>
  );
}

function BibleModeInner({ ctx, session }: { ctx: OperatorShellCtx; session: BibleSessionApi }) {
  const { state, setRef, setTranslation, setCards, setSelectedIdx, setLoading } = session;
  const { ref, translation, cards, selectedIdx, loading } = state;
  const [opts] = useBibleOptions();
  const [tab, setTab] = useState<"reference" | "browse">("reference");
  const searchAbortRef = useRef<AbortController | null>(null);
  // Abort any in-flight search when the component unmounts (mode switch).
  useEffect(() => () => { searchAbortRef.current?.abort(); }, []);
  // Shared view mode from CenterHeader / BottomBar toggle. In "list" mode
  // Bible renders a Songs-Library-style layout: compact verse rows on the
  // left, big selected preview card on the right.
  const [viewMode, setViewMode] = useState<"grid" | "list" | "text">("grid");
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("presentflow.operator.slideViewMode");
      if (raw === "grid" || raw === "list" || raw === "text") setViewMode(raw);
    } catch { /* noop */ }
    const handler = (e: Event) => {
      const d = (e as CustomEvent<"grid" | "list" | "text">).detail;
      if (d === "grid" || d === "list" || d === "text") setViewMode(d);
    };
    window.addEventListener("presentflow:slide-view-mode", handler);
    return () => window.removeEventListener("presentflow:slide-view-mode", handler);
  }, []);
  // Session-scoped edit overrides: verse card id → user-edited text. Lives
  // only in this session — doesn't touch the Bible DB. The projector renders
  // the edited text when it exists, original text otherwise.
  const [editOverrides, setEditOverrides] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>("");
  // Shared card size from the CenterHeader slider (same key + event as SongsBrowser).
  const [cardSize, setCardSize] = useState(280);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("presentflow.center.slideSize");
      const n = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n >= 120 && n <= 480) setCardSize(n);
    } catch { /* noop */ }
    const handler = (e: Event) => {
      const d = (e as CustomEvent<number>).detail;
      if (typeof d === "number" && d >= 120 && d <= 480) setCardSize(d);
    };
    window.addEventListener("presentflow:center-slide-size", handler);
    return () => window.removeEventListener("presentflow:center-slide-size", handler);
  }, []);
  const router = useRouter();

  // Phrase-search dropdown (client-side, curated corpus). When the input
  // doesn't look like a reference we debounce and show inline suggestions
  // directly below the input — separate from the server-side pgvector phrase
  // search that the Lookup button triggers.
  const [dropdownHits, setDropdownHits] = useState<PhraseSearchResult[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownHighlight, setDropdownHighlight] = useState(-1);
  const [dropdownNoResults, setDropdownNoResults] = useState(false);
  const [showAllCrossRefs, setShowAllCrossRefs] = useState(false);
  const dropdownDebounceRef = useRef<number | null>(null);

  // Translation options — fetched from /api/bible/translations so the picker
  // shows EVERY version available to this church (public-domain KJV/WEB/ASV plus
  // any licensed NIV/NKJV/NLT unlocked by the church's own key OR the platform
  // global key). Previously these were hardcoded to KJV/WEB/ASV, so licensed
  // translations never appeared in the operator's Bible picker even when active.
  // Seeded with the public-domain trio so the control is never empty on first paint.
  const [translationOptions, setTranslationOptions] = useState<Array<{ code: string; name: string }>>([
    { code: "KJV", name: "King James Version" },
    { code: "WEB", name: "World English Bible" },
    { code: "ASV", name: "American Standard Version" },
  ]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bible/translations").then((r) => r.json());
        const list = Array.isArray(res?.translations)
          ? (res.translations as Array<{ code?: string; name?: string }>)
              .map((t) => ({ code: String(t.code || "").toUpperCase(), name: String(t.name || t.code || "") }))
              .filter((t) => t.code)
          : [];
        if (!cancelled && list.length > 0) setTranslationOptions(list);
      } catch { /* keep the seeded public-domain trio */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Pending guards against duplicate-add: a rapid double-click or impatient
  // repeat-click on the `+` button (or the batch "add all" button) could
  // fire the add action twice while the first call is still in flight. Track
  // per-card ids currently in-flight, plus a single flag for the batch add.
  const [pendingVerseIds, setPendingVerseIds] = useState<Set<string>>(new Set());
  const [addAllPending, setAddAllPending] = useState(false);

  // Build a scripture add payload for a single verse card and dispatch the
  // existing addServiceItem server action. Reused by the per-card `+` button
  // and by the batch "add all" control below.
  const addVerseToPlaylist = useCallback(async (c: VerseCard) => {
    if (!ctx.planId) { toast.info("No plan open"); return; }
    if (pendingVerseIds.has(c.id)) return; // already in flight
    setPendingVerseIds((prev) => new Set(prev).add(c.id));
    try {
      // Prefer a compact "Book Ch:Vs" reference (strip trailing "(TRANS)").
      const ref = c.label.replace(/\s*\([^)]*\)\s*$/, "").trim();
      const verses = c.verses.map((v) => ({ verse: v.verse, text: v.text }));
      const res = await addServiceItem(ctx.planId, "scripture", ref, { reference: ref, verses });
      if (!res.ok) { toast.error(res.error || "Add failed"); return; }
      toast.success(`Added: ${ref}`);
      router.refresh();
    } finally {
      setPendingVerseIds((prev) => {
        const next = new Set(prev);
        next.delete(c.id);
        return next;
      });
    }
  }, [ctx.planId, router, pendingVerseIds]);

  // 2026-07-25 Fix 6 — "Load Chapter" loads every verse of the currently
  // displayed reference's chapter into the grid (was previously only
  // possible by manually typing "Book Chapter:1-99" and pressing Lookup).
  // Distinct from "Add to Playlist" which adds displayed cards to the plan.
  const loadWholeChapter = useCallback(async () => {
    if (cards.length === 0) { toast.info("Load a reference first"); return; }
    // Derive book + chapter from the currently selected card (or card 0).
    const anchorIdx = selectedIdx ?? 0;
    const label = cards[anchorIdx]?.label || cards[0]?.label || "";
    const stripped = label.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const parser = await import("@/lib/bible-parser");
    const parsed = parser.parseReference(stripped);
    if (!parsed) { toast.error("Couldn't derive chapter — try re-entering the reference"); return; }
    try {
      const chapterRes = await fetchChapterCached(parsed.book, parsed.chapter, translation);
      if (chapterRes.verses.length === 0) { toast.error("Chapter has no verses"); return; }
      const pages: VerseCard[] = chapterRes.verses.map((v, i) => ({
        id: `${parsed.book}-${parsed.chapter}-${v.verse}-${i}-${Date.now()}`,
        label: `${parsed.book} ${parsed.chapter}:${v.verse} (${chapterRes.translation})`,
        verses: [{ verse: v.verse, text: v.text }],
      }));
      setCards(pages);
      // Keep the operator ON the verse they were viewing (e.g. Psalm 91:5),
      // not verse 1. Loading the whole chapter should widen the surrounding
      // context WITHOUT scrolling them out of scope of their current slide.
      // Fall back to the first verse only if the current verse isn't found.
      const keepIdx = pages.findIndex((p) => p.verses[0]?.verse === parsed.verseStart);
      setSelectedIdx(keepIdx >= 0 ? keepIdx : 0);
      toast.success(`Loaded ${pages.length} verses of ${parsed.book} ${parsed.chapter}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chapter load failed");
    }
  }, [cards, selectedIdx, translation, setCards, setSelectedIdx]);

  const addAllVerses = useCallback(async () => {
    if (cards.length === 0 || addAllPending) return;
    if (!ctx.planId) { toast.info("No plan open"); return; }
    setAddAllPending(true);
    try {
      // Build the full batch once, then a single round trip — previously
      // this awaited `addServiceItem` once per card (N sequential inserts +
      // N sequential "read existing items" queries for a Psalm-119-sized
      // lookup). addServiceItems does the dedup check once and inserts the
      // survivors in one `db.insert(...).values([...])` call.
      const items = cards.map((c) => {
        const ref = c.label.replace(/\s*\([^)]*\)\s*$/, "").trim();
        const verses = c.verses.map((v) => ({ verse: v.verse, text: v.text }));
        return { type: "scripture" as const, title: ref, payload: { reference: ref, verses } };
      });
      const res = await addServiceItems(ctx.planId, items);
      if (!res.ok) { toast.error(res.error || "Add failed"); return; }
      const { inserted, skipped } = res.data ?? { inserted: 0, skipped: 0 };
      if (inserted > 0) {
        toast.success(`Added ${inserted} verse${inserted === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} already in plan)` : ""}`);
        router.refresh();
      } else {
        toast.error(skipped > 0 ? "All verses already in plan" : "No verses added");
      }
    } finally {
      setAddAllPending(false);
    }
  }, [cards, ctx.planId, router, addAllPending]);

  const runLookup = useCallback(async (p: { book: string; chapter: number; verseStart: number; verseEnd: number; chapterEnd?: number }) => {
    setLoading(true);
    try {
      const crossCh = !!(p.chapterEnd && p.chapterEnd !== p.chapter);
      // Track whether the CHAPTER itself loaded (has any verses) so we can tell a
      // genuinely-non-existent verse ("Genesis 1:102") apart from a load failure.
      let chapterHadVerses = true;
      // Single-chapter lookups fetch the WHOLE chapter once (and cache it),
      // so subsequent Next/Prev-verse navigation in ProOperatorShell can be
      // a local, zero-network index move instead of a fetch per click. Only
      // the requested verseStart..verseEnd slice is shown here; the rest of
      // the chapter sits ready in bible-chapter-cache. Cross-chapter ranges
      // keep the previous exact-range fetch — whole-chapter caching doesn't
      // map cleanly onto a range spanning chapter boundaries.
      const res = crossCh
        ? await cachedLookup({
            book: p.book, chapter: p.chapter, verseStart: p.verseStart, verseEnd: p.verseEnd,
            chapterEnd: p.chapterEnd, translationCode: translation,
          })
        : await (async () => {
            const chapterRes = await fetchChapterCached(p.book, p.chapter, translation);
            chapterHadVerses = chapterRes.verses.length > 0;
            return {
              verses: chapterRes.verses.filter((v) => v.verse >= p.verseStart && v.verse <= p.verseEnd),
              translation: chapterRes.translation,
            };
          })();
      const verses = res.verses;
      const rangeLabel = crossCh
        ? `${p.chapter}:${p.verseStart}-${p.chapterEnd}:${p.verseEnd}`
        : `${p.chapter}:${p.verseStart}${p.verseStart !== p.verseEnd ? `-${p.verseEnd}` : ""}`;
      const label = `${p.book} ${rangeLabel} (${res.translation})`;
      // Always one verse per card so a range fans out to N cards.
      const pages: VerseCard[] = verses.map((v, i) => {
        const ch = (v as { chapter?: number }).chapter ?? p.chapter;
        return {
          id: `${label}-${i}`,
          label: `${p.book} ${ch}:${v.verse} (${res.translation})`,
          verses: [{ verse: v.verse, text: v.text }],
        };
      });
      if (pages.length === 0) {
        // No verses came back. If the CHAPTER loaded fine (single-chapter path)
        // but the requested verse simply isn't in it, the reference points at a
        // verse that doesn't exist in the Bible — e.g. "Genesis 1:102" (Genesis
        // 1 has 31 verses). Surface a friendly notice instead of a blank slide,
        // so on the projector the congregation sees a clear "not a real verse"
        // message rather than an empty screen. If the chapter itself failed to
        // load (network/transient), fall back to the neutral empty placeholder.
        const refNoTrans = `${p.book} ${rangeLabel}`;
        if (!crossCh && chapterHadVerses) {
          const notice = `This verse isn't in the Bible.\nPlease check the reference.`;
          pages.push({
            id: label,
            label: refNoTrans,
            verses: [{ verse: p.verseStart, text: notice }],
            invalid: notice,
            placeholder: true, // never auto-fires; operator can still send it manually
          });
          toast.warning(`"${refNoTrans}" isn't a verse in the Bible — check the reference.`);
        } else {
          pages.push({ id: label, label, verses: [], placeholder: true });
        }
      }
      setCards(pages);
      setSelectedIdx(0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, [translation, setCards, setSelectedIdx, setLoading]);

  // Session-scoped: results survive tab switches (Songs / Media / Bible).
  // Local state would be wiped when Radix Tabs unmounts BibleMode.
  const { phraseHits, phraseQuery, resultsLimit } = session.state;
  const { setPhraseHits, setPhraseQuery, setResultsLimit } = session;

  const lookup = useCallback(async () => {
    const parser = await import("@/lib/bible-parser");
    // Try the typed-input parser FIRST — it expands short abbreviations
    // (`ex 2 1`, `am 1`) that isProbablyReference doesn't recognize via
    // its parser-backed confirm path. Fall back to the shape heuristic
    // for anything else that "looks like" a reference.
    const typedFirst = parser.parseTypedReference(ref);
    const treatAsRef = typedFirst.length > 0 || parser.isProbablyReference(ref);
    if (treatAsRef) {
      // parseTypedReference is a strict superset of parseReferences that
      // also expands typed-only book abbreviations (`ex`, `ru`, `is`, `am`,
      // `ac`, `re`, `ph`, `jd`) that are deliberately excluded from live
      // ASR parsing to avoid collisions with ordinary English.
      const parsed = parser.parseTypedReference(ref);
      if (parsed.length === 0) { toast.info("Couldn't parse reference"); return; }
      const p = parsed[0];
      setPhraseHits([]);
      await runLookup({ book: p.book, chapter: p.chapter, verseStart: p.verseStart, verseEnd: p.verseEnd, chapterEnd: p.chapterEnd });
    } else {
      // Phrase search — server requires min 3 chars (pgvector embedding cost).
      // Enforce client-side too so we don't fire a doomed request.
      const trimmed = ref.trim();
      if (trimmed.length < 3) {
        toast.info("Type at least 3 characters to search.");
        return;
      }
      // Part 3: session-scoped cache for repeat/refined phrase searches —
      // same pattern as bible-client-cache.ts's verse-lookup cache. Avoids
      // paying the full embedding round trip (server model cold-start being
      // the actual latency culprit, see src/lib/embeddings.ts) when the
      // operator re-runs or slightly re-types the same search mid-session.
      const cacheKey = bibleSearchCacheKey(translation, trimmed, resultsLimit);
      const cached = getBibleSearchCached(cacheKey);
      if (cached) {
        setPhraseHits(cached.hits.map((h) => ({ ...h, matched: trimmed })));
        setPhraseQuery(trimmed);
        setCards([]);
        return;
      }
      setLoading(true);
      // Abort in-flight search if the operator triggers a new one or flips
      // away from Bible mode — otherwise a slow stale response can land
      // AFTER they've picked something and overwrite phraseHits.
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const res = await fetch("/api/bible/search", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed, translation, limit: resultsLimit }),
          signal: controller.signal,
        }).then((r) => r.json());
        if (controller.signal.aborted) return;
        if (res.error) { toast.error(res.error); return; }
        const hits = (res.hits || res.results || []) as Array<{ book: string; chapter: number; verse: number; text: string }>;
        setPhraseHits(hits.map((h) => ({ ...h, matched: trimmed })));
        setPhraseQuery(trimmed);
        setCards([]);
        if (hits.length > 0) setBibleSearchCached(cacheKey, hits, translation);
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return; // superseded — silent
        toast.error(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (searchAbortRef.current === controller) searchAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [ref, runLookup, translation, setCards, setLoading, resultsLimit, setPhraseHits, setPhraseQuery]);

  const isRef = (() => {
    try {
      // Sync heuristic; import is dynamic elsewhere but safe here for a hint.
      const s = ref.trim();
      if (!s) return true;
      if (/\d+\s*:\s*\d+/.test(s)) return true;
      if (/^\s*(1|2|3|I{1,3})?\s*[A-Za-z][A-Za-z\s\.]{1,}\s+\d+\b/.test(s)) return true;
      return false;
    } catch { return true; }
  })();

  useEffect(() => {
    if (dropdownDebounceRef.current !== null) {
      window.clearTimeout(dropdownDebounceRef.current);
      dropdownDebounceRef.current = null;
    }
    const trimmed = ref.trim();
    if (isRef || trimmed.length < 3) {
      setDropdownHits([]);
      setDropdownOpen(false);
      setDropdownHighlight(-1);
      setDropdownNoResults(false);
      return;
    }
    dropdownDebounceRef.current = window.setTimeout(() => {
      const hits = phraseSearch(trimmed);
      setDropdownHits(hits);
      setDropdownOpen(true);
      setDropdownHighlight(-1);
      setDropdownNoResults(hits.length === 0);
    }, 200);
    return () => {
      if (dropdownDebounceRef.current !== null) {
        window.clearTimeout(dropdownDebounceRef.current);
        dropdownDebounceRef.current = null;
      }
    };
  }, [ref, isRef]);

  const loadPhraseHit = useCallback(async (hit: PhraseSearchResult) => {
    const e = hit.entry;
    setRef(e.reference);
    setDropdownOpen(false);
    setDropdownHits([]);
    setDropdownHighlight(-1);
    setDropdownNoResults(false);
    setPhraseHits([]);
    setShowAllCrossRefs(false);
    await runLookup({
      book: e.book,
      chapter: e.chapter,
      verseStart: e.verse,
      verseEnd: e.verseEnd ?? e.verse,
    });
  }, [runLookup, setRef, setPhraseHits]);

  const loadReferenceString = useCallback(async (referenceStr: string) => {
    const parser = await import("@/lib/bible-parser");
    const parsed = parser.parseTypedReference(referenceStr);
    if (parsed.length === 0) { toast.info(`Couldn't parse "${referenceStr}"`); return; }
    const p = parsed[0];
    setRef(referenceStr);
    setDropdownOpen(false);
    setDropdownHits([]);
    setPhraseHits([]);
    setShowAllCrossRefs(false);
    await runLookup({
      book: p.book, chapter: p.chapter,
      verseStart: p.verseStart, verseEnd: p.verseEnd,
      chapterEnd: p.chapterEnd,
    });
  }, [runLookup, setRef, setPhraseHits]);

  // Called from the Browse tab: single verse → load into card area & switch tab.
  const pickBrowsedVerse = useCallback((r: { book: string; chapter: number; verse: number }) => {
    setRef(`${r.book} ${r.chapter}:${r.verse}`);
    setTab("reference");
    void runLookup({ book: r.book, chapter: r.chapter, verseStart: r.verse, verseEnd: r.verse });
  }, [runLookup, setRef]);

  // Y1/Y7: render each verse honoring options. `breakOnNewVerse` puts each
  // verse on its own line (a soft "slide within a slide" effect since we
  // don't currently split into multiple cards per verse). `displayTranslation`
  // strips the "(KJV)" trailing tag from the ref label when off.
  // 2026-07-25 field bug fix — the CenterHeader ▶ Play button dispatches
  // `presentflow:bible-play-current` when in Bible mode. Handle it here
  // (where we have access to the loaded cards + selection) by firing the
  // currently selected verse to live. Falls back to card 0 if no
  // selection yet, and shows a toast if nothing is loaded.
  useEffect(() => {
    const handler = (ev: Event) => {
      if (!isInternalEvent(ev)) return;
      const idx = selectedIdx ?? 0;
      const card = cards[idx];
      if (!card) {
        toast.info("No Bible verse loaded — type a reference and press Lookup first.");
        return;
      }
      try { console.log("[bible-play-current] firing", { idx, label: card.label }); } catch { /* ignore */ }
      ctx.onSendSlideToLive(cardToSlideRef.current(card, idx, cards.length), undefined, { instant: true });
      toast.success(`${card.label} → LIVE`, { duration: 1500 });
    };
    window.addEventListener("presentflow:bible-play-current", handler);
    return () => window.removeEventListener("presentflow:bible-play-current", handler);
  }, [cards, selectedIdx, ctx]);
  // Keep cardToSlide stable across renders for the play-current handler
  // (which reads it via a ref to avoid re-binding the listener when opts
  // change — the useCallback below already handles that upstream).
  const cardToSlideRef = useRef<(c: VerseCard, idx: number, total: number) => SlidePayload>(() => ({ kind: "text", text: "" }));

  const cardToSlide = useCallback((c: VerseCard, idx: number, total: number): SlidePayload => {
    // Session edit override wins over the fetched text so the operator can
    // fix a typo / adjust line breaks without touching the DB.
    const override = editOverrides[c.id];
    if (typeof override === "string" && override.trim().length > 0) {
      return { kind: "text", text: override };
    }
    // Invalid-verse notice — render the friendly message with the reference
    // below it (no verse numbers). This is what projects if the operator sends
    // a non-existent reference like "Genesis 1:102".
    if (c.invalid) {
      return { kind: "text", text: `${c.invalid}\n\n${c.label}` };
    }
    const separator = opts.breakOnNewVerse ? "\n" : " ";
    const body = c.verses
      .map((v) => opts.showVerseNumbers ? `${v.verse} ${v.text}` : v.text)
      .join(separator);
    let text = body;
    const includeRef =
      opts.refFormat === "each" ||
      (opts.refFormat === "last" && idx === total - 1);
    if (includeRef) {
      const label = opts.displayTranslation
        ? c.label
        : c.label.replace(/\s*\([^)]+\)\s*$/, "");
      text = `${body}\n\n${label}`;
    }
    return { kind: "text", text };
  }, [opts.showVerseNumbers, opts.refFormat, opts.breakOnNewVerse, opts.displayTranslation, editOverrides]);
  // Sync ref for the bible-play-current handler above.
  useEffect(() => { cardToSlideRef.current = cardToSlide; }, [cardToSlide]);

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* 2026-08-16: STICKY search header — stays pinned at the top of the panel
          so the operator can look up a verse without scrolling all the way back
          up a loaded chapter. */}
      <div className="sticky top-0 z-30 -mx-4 -mt-4 px-4 pt-4 pb-3 bg-[var(--color-panel)] border-b border-[var(--color-border)] flex flex-col gap-4">
      {/* Reference / Browse tab switcher */}
      <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden text-[11px] uppercase tracking-wider font-mono h-8 w-fit">
        {(["reference", "browse"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 h-full",
              tab === t ? "bg-[var(--color-brand)] text-black" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
            )}
          >{t}</button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && dropdownOpen && dropdownHits.length > 0) {
                e.preventDefault();
                setDropdownHighlight((h) => (h + 1) % dropdownHits.length);
                return;
              }
              if (e.key === "ArrowUp" && dropdownOpen && dropdownHits.length > 0) {
                e.preventDefault();
                setDropdownHighlight((h) => (h <= 0 ? dropdownHits.length - 1 : h - 1));
                return;
              }
              if (e.key === "Escape" && dropdownOpen) {
                e.preventDefault();
                setDropdownOpen(false);
                return;
              }
              if (e.key === "Tab" && dropdownOpen) {
                setDropdownOpen(false);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                if (dropdownOpen && dropdownHits.length > 0) {
                  const idx = dropdownHighlight >= 0 ? dropdownHighlight : 0;
                  void loadPhraseHit(dropdownHits[idx]);
                  return;
                }
                void lookup();
              }
            }}
            onFocus={() => { if (dropdownHits.length > 0) setDropdownOpen(true); }}
            onBlur={() => { window.setTimeout(() => setDropdownOpen(false), 150); }}
            placeholder="John 3:16 or 'The Lord is my shepherd'"
            className="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md px-3 pr-20 h-9 text-sm outline-none focus:border-[var(--color-brand)]"
          />
          <span
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-brand)]/15 text-[var(--color-brand)] font-mono"
            title={isRef ? "Treated as a reference" : "Treated as a phrase search"}
          >
            {isRef ? "REFERENCE" : "PHRASE"}
          </span>
          {dropdownOpen && (dropdownHits.length > 0 || dropdownNoResults) && (
            <div
              className="absolute left-0 right-0 top-full mt-1 z-30"
              style={{
                background: "#1E1E1E",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "0 0 8px 8px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                maxHeight: 400,
                overflowY: "auto",
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              {dropdownHits.length === 0 && dropdownNoResults && (
                <div className="px-3 py-2 text-[12px]" style={{ color: "#6B6A66" }}>
                  No results found. Try a verse reference like &quot;John 3:16&quot;
                </div>
              )}
              {dropdownHits.map((hit, i) => {
                const e = hit.entry;
                const highlighted = i === dropdownHighlight;
                const filled = Math.max(0, Math.min(5, Math.round((e.popularity ?? 0) / 2)));
                const truncated = e.fullText.length > 80 ? `${e.fullText.slice(0, 80)}…` : e.fullText;
                return (
                  <div
                    key={e.id}
                    role="option"
                    aria-selected={highlighted}
                    onMouseEnter={() => setDropdownHighlight(i)}
                    onClick={() => { void loadPhraseHit(hit); }}
                    className="flex items-start gap-2 px-3 py-2 cursor-pointer"
                    style={{
                      background: highlighted ? "rgba(232,116,42,0.06)" : "transparent",
                    }}
                  >
                    <span
                      style={{
                        background: "rgba(232,116,42,0.10)",
                        color: "#E8742A",
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: 4,
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {e.reference}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 14, color: "#F1EFE8", fontWeight: 500 }} className="truncate">
                        {e.phrase}
                      </div>
                      <div style={{ fontSize: 12, color: "#6B6A66" }} className="truncate">
                        {truncated}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span
                        style={{
                          fontSize: 10,
                          padding: "1px 6px",
                          borderRadius: 999,
                          background: "rgba(255,255,255,0.06)",
                          color: "rgba(255,255,255,0.55)",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {e.category}
                      </span>
                      <span style={{ fontSize: 10, color: "rgba(232,116,42,0.75)", letterSpacing: 1 }}>
                        {"●".repeat(filled)}{"○".repeat(5 - filled)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <select
          value={translation}
          onChange={(e) => {
            const next = e.target.value;
            setTranslation(next);
            // Immediately re-fetch so the visible cards reflect the new
            // translation. Was previously updating only the trailing label
            // "(KJV)" while the verse text stayed the previous translation
            // — operator could send the wrong translation live.
            if (cards.length > 0 || phraseHits.length > 0) {
              setTimeout(() => void lookup(), 0);
            }
          }}
          className="h-9 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md text-sm"
        >
          {translationOptions.map((t) => (
            <option key={t.code} value={t.code}>{t.name}</option>
          ))}
        </select>
        <button
          onClick={() => {
            if (!isRef && dropdownHits.length > 0) {
              void loadPhraseHit(dropdownHits[0]);
              return;
            }
            if (!isRef && dropdownNoResults) {
              toast.info("No results found. Try a verse reference like \"John 3:16\"");
              return;
            }
            void lookup();
          }}
          disabled={loading}
          className="h-9 px-3 rounded-md bg-[var(--color-brand)] text-black text-sm font-semibold disabled:opacity-60"
        >
          {loading ? "…" : "Lookup"}
        </button>
        <button
          type="button"
          title={editingId ? "Exit edit mode (Esc)" : "Edit the selected verse card"}
          aria-label="Edit selected verse"
          aria-pressed={!!editingId}
          onClick={() => {
            if (editingId) { setEditingId(null); return; }
            const idx = selectedIdx ?? 0;
            const card = cards[idx];
            if (!card) { toast.info("Select a verse card first"); return; }
            const slide = cardToSlide(card, idx, cards.length);
            const current = editOverrides[card.id] ?? (slide.kind === "text" ? slide.text : "");
            setEditDraft(current);
            setEditingId(card.id);
          }}
          className={cn(
            "h-9 w-9 flex items-center justify-center rounded-md border transition-colors",
            editingId
              ? "border-[var(--color-brand)] bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
              : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
          )}
        >
          <Pencil className="w-4 h-4" />
        </button>
        <BibleOptionsPopover />
      </div>
      </div>{/* end sticky search header */}

      {editingId && (
        <div className="flex flex-col gap-2 border-2 border-dashed border-[var(--color-brand)] rounded-md p-3 bg-[var(--color-elevated)]">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-brand)]">
            Editing verse — changes apply to this session only, not the Bible library
          </div>
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setEditingId(null); return; }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                setEditOverrides((prev) => ({ ...prev, [editingId]: editDraft }));
                setEditingId(null);
                toast.success("Verse edited (session)");
              }
            }}
            rows={5}
            className="w-full px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-panel)] text-sm resize-y font-mono"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditingId(null)}
              className="h-8 px-3 rounded border border-[var(--color-border)] text-[12px]"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setEditOverrides((prev) => {
                  const next = { ...prev };
                  delete next[editingId];
                  return next;
                });
                setEditingId(null);
                toast.info("Reverted to original text");
              }}
              className="h-8 px-3 rounded border border-[var(--color-border)] text-[12px]"
            >
              Revert
            </button>
            <button
              onClick={() => {
                setEditOverrides((prev) => ({ ...prev, [editingId]: editDraft }));
                setEditingId(null);
                toast.success("Verse edited (session)");
              }}
              className="h-8 px-3 rounded bg-[var(--color-brand)] text-black text-[12px] font-semibold inline-flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" /> Save edit
            </button>
          </div>
        </div>
      )}

      <div className="text-[11px] text-[var(--color-muted-foreground)] -mt-2">
        Try a reference (John 3:16) or a phrase (The Lord is my shepherd)
      </div>

      {tab === "reference" && phraseHits.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--color-muted-foreground)]">
            <span>
              {phraseHits.length} result{phraseHits.length === 1 ? "" : "s"} for &quot;{phraseQuery}&quot; in {translation}
            </span>
            <label className="flex items-center gap-1">
              <span className="uppercase tracking-wider text-[9px] font-mono">Limit</span>
              <select
                value={resultsLimit}
                onChange={(e) => setResultsLimit(parseInt(e.target.value, 10))}
                className="h-6 px-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded text-[11px]"
                aria-label="Results limit"
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          {phraseHits.map((h, i) => {
            const label = `${h.book} ${h.chapter}:${h.verse}`;
            const slide: SlidePayload = { kind: "text", text: `${h.text}\n\n${label}` };
            const parts = h.matched ? h.text.split(new RegExp(`(${h.matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i")) : [h.text];
            return (
              <div key={`${label}-${i}`} className="p-3 rounded border border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col gap-1 cursor-pointer"
                onClick={() => ctx.onSendSlideToLive(slide, undefined, { instant: true })}
                title="Click to send verse to live"
              >
                <div className="text-[10px] font-mono text-[var(--color-muted-foreground)]">{label}</div>
                <div className="text-sm">
                  {parts.map((p, idx) => h.matched && p.toLowerCase() === h.matched.toLowerCase()
                    ? <mark key={idx} className="bg-[color:var(--color-brand)]/25 rounded">{p}</mark>
                    : <span key={idx}>{p}</span>)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "browse" && (
        <BibleBookBrowser translation={translation} onPickVerse={pickBrowsedVerse} />
      )}

      {/* Verse cards — 2026-07-25 Fix 6: split into TWO distinct actions.
          "Load Chapter" (ghost) loads every verse of the current chapter
          into the grid. "Add to Playlist" (primary orange) adds all
          currently-displayed cards to the playlist. Both were previously
          conflated in a single ambiguous "+ Add all verses" button. */}
      {tab === "reference" && cards.length > 0 && (
        <div className="flex justify-end gap-2 -mb-2">
          <button
            onClick={() => void loadWholeChapter()}
            className="h-7 px-2 rounded border border-[var(--color-border)] text-[11px] font-mono uppercase tracking-wider hover:bg-[var(--color-elevated)]"
            title="Load every verse of the current chapter into the grid (does not add to playlist)"
          >
            Load Chapter
          </button>
          {cards.length > 1 && (
            <button
              onClick={() => void addAllVerses()}
              disabled={addAllPending}
              className={cn(
                "h-7 px-3 rounded text-[11px] font-mono uppercase tracking-wider text-white bg-[var(--color-brand)] hover:brightness-110",
                addAllPending && "opacity-50 cursor-not-allowed pointer-events-none",
              )}
              title="Add each displayed verse to the playlist as its own scripture item"
            >
              + Add to Playlist
            </button>
          )}
        </div>
      )}
      {tab === "reference" && viewMode === "list" && cards.length > 0 && (
        // Songs-Library-style split: compact verse-row list left, big
        // selected preview right. Same click semantics as the grid (single
        // = select, double = send live, + button = add to playlist).
        <div className="grid gap-3 h-full min-h-[400px]" style={{ gridTemplateColumns: "minmax(240px, 320px) 1fr" }}>
          <div className="flex flex-col border border-[var(--color-border)] rounded-md overflow-hidden">
            <div className="px-3 py-2 border-b border-[var(--color-border)] eyebrow text-[var(--color-muted-foreground)]">
              {cards.length} verse{cards.length === 1 ? "" : "s"}
            </div>
            <ul className="flex-1 overflow-y-auto">
              {cards.slice(0, 200).map((c, idx) => {
                const selected = selectedIdx === idx;
                const preview = c.verses[0]?.text?.slice(0, 80) ?? "";
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => { setSelectedIdx(idx); ctx.onSendSlideToLive(cardToSlide(c, idx, cards.length), undefined, { instant: true }); }}
                      title="Click to send verse to live"
                      className={cn(
                        "w-full text-left px-3 py-2 border-b border-[var(--color-border)] hover:bg-[var(--color-elevated)]",
                        selected && "bg-[var(--color-elevated)] border-l-2 border-l-[var(--color-brand)]",
                      )}
                    >
                      <div className="text-[12px] font-semibold truncate">{c.label}</div>
                      {preview && (
                        <div className="text-[11px] text-[var(--color-muted-foreground)] truncate mt-0.5">{preview}{c.verses[0]?.text && c.verses[0].text.length > 80 ? "…" : ""}</div>
                      )}
                    </button>
                  </li>
                );
              })}
              {cards.length > 200 && (
                <li className="px-3 py-2 text-[11px] text-[var(--color-muted-foreground)]">Showing first 200 of {cards.length}</li>
              )}
            </ul>
          </div>
          <div className="flex flex-col border border-[var(--color-border)] rounded-md overflow-hidden">
            <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center gap-2">
              <div className="flex-1 text-[12px] font-medium truncate">
                {selectedIdx != null && cards[selectedIdx] ? cards[selectedIdx].label : "Select a verse to preview"}
              </div>
            </div>
            {/* R5: whole preview is click-to-live now, matching the grid
                cards and list rows (which already send live on a single
                click) — the separate "Send to live" button was the last
                inconsistent control in this file. */}
            <div
              className={cn(
                "flex-1 p-3",
                selectedIdx != null && cards[selectedIdx] && "cursor-pointer",
              )}
              role={selectedIdx != null && cards[selectedIdx] ? "button" : undefined}
              tabIndex={selectedIdx != null && cards[selectedIdx] ? 0 : undefined}
              title={selectedIdx != null && cards[selectedIdx] ? "Click to send verse to live" : undefined}
              onClick={() => {
                if (selectedIdx == null || !cards[selectedIdx]) return;
                ctx.onSendSlideToLive(cardToSlide(cards[selectedIdx], selectedIdx, cards.length), undefined, { instant: true });
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (selectedIdx == null || !cards[selectedIdx]) return;
                e.stopPropagation();
                ctx.onSendSlideToLive(cardToSlide(cards[selectedIdx], selectedIdx, cards.length), undefined, { instant: true });
              }}
            >
              {selectedIdx != null && cards[selectedIdx] ? (
                <div className="aspect-video rounded overflow-hidden border border-[var(--color-border)]">
                  <SlideRenderer slide={cardToSlide(cards[selectedIdx], selectedIdx, cards.length)} />
                </div>
              ) : (
                <div className="text-[11px] text-[var(--color-muted-foreground)] text-center py-8">Click a verse in the list.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "reference" && viewMode !== "list" && (
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` }}>
        {cards.length === 0 && (
          <div className="col-span-full text-[12px] text-[var(--color-muted-foreground)] py-8 text-center">
            Enter a reference above and hit Lookup — or switch to Browse.
          </div>
        )}
        {/* Cap the visible grid at 50 previews — a full-Psalm 119 lookup
            returns 176 verses which would render 176 aspect-video previews
            in one grid and jank the shell. Full text is still in `cards`
            and reachable via next-verse nav; this only trims the DOM. */}
        {cards.length > 50 && (
          <div className="col-span-full text-[11px] text-[var(--color-muted-foreground)] py-2 text-center">
            Showing first 50 of {cards.length} verses — refine the range or use the Verse ▸ button to walk through them all.
          </div>
        )}
        {cards.slice(0, 50).map((c, idx) => {
          const selected = selectedIdx === idx;
          const slide = cardToSlide(c, idx, cards.length);
          return (
            // Outer is a div (not a button) so the inner "+ add to playlist"
            // control can be a real <button> without nested-interactive-role
            // hydration warnings. Keyboard support: Enter selects, Shift+Enter
            // sends to live (mirrors the single-click / double-click mouse UX).
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => { setSelectedIdx(idx); ctx.onSendSlideToLive(slide, undefined, { instant: true }); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // stopPropagation prevents useOperatorHotkeys from ALSO
                  // firing its global Enter handler and pushing the previous
                  // (slides-mode) preview slide live instead of this verse.
                  e.stopPropagation();
                  setSelectedIdx(idx);
                  ctx.onSendSlideToLive(slide, undefined, { instant: true });
                }
              }}
              // 2026-07-25 field fix — long verses were clipping at the
              // sanctuary-readability floor (24px). Grid thumbnails aren't
              // audience-facing so we can safely drop the floor to 14px
              // and keep pagination on so long verses split cleanly across
              // pages with a page indicator (matches SlideGrid's card
              // policy). `title` gives the operator the full raw text on
              // hover regardless.
              title={c.verses.map((v) => `${v.verse} ${v.text}`).join("\n")}
              className={cn(
                "relative aspect-video rounded-md overflow-hidden border-2 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]",
                selected ? "border-[var(--color-brand)]" : "border-[var(--color-border)] hover:border-[var(--color-muted-foreground)]",
              )}
            >
              <SlideRenderer slide={slide} textMinPx={14} />
              <div className="absolute top-1 left-1 text-[10px] font-mono text-white/70 bg-black/40 px-1 rounded">
                {idx + 1}
              </div>
              <button
                type="button"
                aria-label={`Add ${c.label} to playlist`}
                title="Add to playlist"
                disabled={pendingVerseIds.has(c.id)}
                onClick={(e) => { e.stopPropagation(); void addVerseToPlaylist(c); }}
                onDoubleClick={(e) => e.stopPropagation()}
                className={cn(
                  "absolute top-1 right-1 h-5 w-5 inline-flex items-center justify-center rounded bg-black/50 text-white/80 hover:bg-[var(--color-brand)] hover:text-black transition-colors",
                  pendingVerseIds.has(c.id) && "opacity-50 cursor-not-allowed pointer-events-none",
                )}
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      )}

      {tab === "reference" && cards.length > 0 && (() => {
        const anchorIdx = selectedIdx ?? 0;
        const anchorLabel = cards[anchorIdx]?.label || "";
        const strippedRef = anchorLabel.replace(/\s*\([^)]*\)\s*$/, "").trim();
        const phraseEntry = findPhraseByReference(strippedRef);
        const refs = phraseEntry?.crossRefs || [];
        if (refs.length === 0) return null;
        const visible = showAllCrossRefs ? refs : refs.slice(0, 5);
        return (
          <div className="flex flex-col gap-2">
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.5)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Related Verses
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              {visible.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { void loadReferenceString(r); }}
                  style={{
                    background: "rgba(155,143,232,0.08)",
                    color: "#9B8FE8",
                    fontSize: 12,
                    fontWeight: 500,
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "none",
                    cursor: "pointer",
                    transition: "background 120ms ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(155,143,232,0.15)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(155,143,232,0.08)"; }}
                >
                  {r}
                </button>
              ))}
              {refs.length > 5 && !showAllCrossRefs && (
                <button
                  type="button"
                  onClick={() => setShowAllCrossRefs(true)}
                  style={{
                    fontSize: 12,
                    color: "#9B8FE8",
                    background: "transparent",
                    border: "none",
                    padding: "4px 6px",
                    cursor: "pointer",
                  }}
                >
                  Show more →
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
