"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";
import { BibleOptionsPopover, useBibleOptions } from "./BibleOptionsPopover";
import { BibleBookBrowser } from "./BibleBookBrowser";
import type { BibleSessionApi, VerseCard } from "../hooks";
import { cn } from "@/lib/utils";
import { cachedLookup } from "@/lib/bible-client-cache";
import { addServiceItem } from "@/lib/actions";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

/**
 * R5: All session state (ref, translation, mode, cards, selectedIdx) is
 * lifted to ProOperatorShell via useBibleSession so switching center-mode
 * (bible ↔ slides) no longer wipes the lookup results.
 * Y1/Y7: reference format + show-verse-numbers + verse/passage mode are
 * driven by BibleOptions (single source of truth). Verse mode = 1 verse per
 * card; Passage mode = up to 4 verses per card.
 */
export function BibleMode({ ctx, session }: { ctx: OperatorShellCtx; session: BibleSessionApi }) {
  const { state, setRef, setTranslation, setCards, setSelectedIdx, setLoading } = session;
  const { ref, translation, cards, selectedIdx, loading } = state;
  const [opts] = useBibleOptions();
  const [tab, setTab] = useState<"reference" | "browse">("reference");
  const searchAbortRef = useRef<AbortController | null>(null);
  // Abort any in-flight search when the component unmounts (mode switch).
  useEffect(() => () => { searchAbortRef.current?.abort(); }, []);
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

  // Build a scripture add payload for a single verse card and dispatch the
  // existing addServiceItem server action. Reused by the per-card `+` button
  // and by the batch "add all" control below.
  const addVerseToPlaylist = useCallback(async (c: VerseCard) => {
    if (!ctx.planId) { toast.info("No plan open"); return; }
    // Prefer a compact "Book Ch:Vs" reference (strip trailing "(TRANS)").
    const ref = c.label.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const verses = c.verses.map((v) => ({ verse: v.verse, text: v.text }));
    const res = await addServiceItem(ctx.planId, "scripture", ref, { reference: ref, verses });
    if (!res.ok) { toast.error(res.error || "Add failed"); return; }
    toast.success(`Added: ${ref}`);
    router.refresh();
  }, [ctx.planId, router]);

  const addAllVerses = useCallback(async () => {
    if (cards.length === 0) return;
    let added = 0;
    for (const c of cards) {
      if (!ctx.planId) break;
      const ref = c.label.replace(/\s*\([^)]*\)\s*$/, "").trim();
      const verses = c.verses.map((v) => ({ verse: v.verse, text: v.text }));
      const res = await addServiceItem(ctx.planId, "scripture", ref, { reference: ref, verses });
      if (res.ok) added++;
    }
    if (added > 0) { toast.success(`Added ${added} verse${added === 1 ? "" : "s"}`); router.refresh(); }
    else toast.error("No verses added");
  }, [cards, ctx.planId, router]);

  const runLookup = useCallback(async (p: { book: string; chapter: number; verseStart: number; verseEnd: number; chapterEnd?: number }) => {
    setLoading(true);
    try {
      const res = await cachedLookup({
        book: p.book, chapter: p.chapter, verseStart: p.verseStart, verseEnd: p.verseEnd,
        chapterEnd: p.chapterEnd, translationCode: translation,
      });
      const verses = res.verses;
      const crossCh = p.chapterEnd && p.chapterEnd !== p.chapter;
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
      if (pages.length === 0) pages.push({ id: label, label, verses: [] });
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
    const treatAsRef = parser.isProbablyReference(ref);
    if (treatAsRef) {
      const parsed = parser.parseReferences(ref);
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
  const cardToSlide = useCallback((c: VerseCard, idx: number, total: number): SlidePayload => {
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
  }, [opts.showVerseNumbers, opts.refFormat, opts.breakOnNewVerse, opts.displayTranslation]);

  return (
    <div className="p-4 flex flex-col gap-4">
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
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(); } }}
            placeholder="John 3:16 or 'The Lord is my shepherd'"
            className="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md px-3 pr-20 h-9 text-sm outline-none focus:border-[var(--color-brand)]"
          />
          <span
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-brand)]/15 text-[var(--color-brand)] font-mono"
            title={isRef ? "Treated as a reference" : "Treated as a phrase search"}
          >
            {isRef ? "REFERENCE" : "PHRASE"}
          </span>
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
          <option value="KJV">King James Version</option>
          <option value="WEB">World English Bible</option>
          <option value="ASV">American Standard Version</option>
        </select>
        <button
          onClick={() => void lookup()}
          disabled={loading}
          className="h-9 px-3 rounded-md bg-[var(--color-brand)] text-black text-sm font-semibold disabled:opacity-60"
        >
          {loading ? "…" : "Lookup"}
        </button>
        <BibleOptionsPopover />
      </div>

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
              <div key={`${label}-${i}`} className="p-3 rounded border border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col gap-1"
                onDoubleClick={() => ctx.onSendSlideToLive(slide)}
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

      {/* Verse cards */}
      {tab === "reference" && cards.length > 1 && (
        <div className="flex justify-end -mb-2">
          <button
            onClick={() => void addAllVerses()}
            className="h-7 px-2 rounded border border-[var(--color-border)] text-[11px] font-mono uppercase tracking-wider hover:bg-[var(--color-elevated)]"
            title="Add every verse as a separate scripture item"
          >
            + Add all verses
          </button>
        </div>
      )}
      {tab === "reference" && (
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
              onClick={() => setSelectedIdx(idx)}
              onDoubleClick={() => ctx.onSendSlideToLive(slide)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // stopPropagation prevents useOperatorHotkeys from ALSO
                  // firing its global Enter handler and pushing the previous
                  // (slides-mode) preview slide live instead of this verse.
                  e.stopPropagation();
                  if (e.shiftKey) ctx.onSendSlideToLive(slide);
                  else setSelectedIdx(idx);
                }
              }}
              className={cn(
                "relative aspect-video rounded-md overflow-hidden border-2 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]",
                selected ? "border-[var(--color-brand)]" : "border-[var(--color-border)] hover:border-[var(--color-muted-foreground)]",
              )}
            >
              <SlideRenderer slide={slide} />
              <div className="absolute top-1 left-1 text-[10px] font-mono text-white/70 bg-black/40 px-1 rounded">
                {idx + 1}
              </div>
              <button
                type="button"
                aria-label={`Add ${c.label} to playlist`}
                title="Add to playlist"
                onClick={(e) => { e.stopPropagation(); void addVerseToPlaylist(c); }}
                onDoubleClick={(e) => e.stopPropagation()}
                className="absolute top-1 right-1 h-5 w-5 inline-flex items-center justify-center rounded bg-black/50 text-white/80 hover:bg-[var(--color-brand)] hover:text-black transition-colors"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
