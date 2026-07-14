"use client";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";
import { BibleOptionsPopover, useBibleOptions } from "./BibleOptionsPopover";
import { BibleBookBrowser } from "./BibleBookBrowser";
import type { BibleSessionApi, VerseCard } from "../hooks";
import { cn } from "@/lib/utils";

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

  const runLookup = useCallback(async (p: { book: string; chapter: number; verseStart: number; verseEnd: number }) => {
    setLoading(true);
    try {
      const res = await fetch("/api/bible/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book: p.book, chapter: p.chapter, verseStart: p.verseStart, verseEnd: p.verseEnd, translationCode: translation }),
      }).then((r) => r.json());
      if (res.error) { toast.error(res.error); return; }
      const verses: Array<{ verse: number; text: string }> = res.verses || [];
      const label = `${p.book} ${p.chapter}:${p.verseStart}${p.verseStart !== p.verseEnd ? `-${p.verseEnd}` : ""} (${res.translation || translation})`;
      // Passage/verse toggle removed — always render one verse per card. If a
      // reference resolves to a range, each verse gets its own numbered card.
      const pages: VerseCard[] = verses.map((v, i) => ({
        id: `${label}-${i}`,
        label: `${p.book} ${p.chapter}:${v.verse} (${res.translation || translation})`,
        verses: [v],
      }));
      if (pages.length === 0) pages.push({ id: label, label, verses: [] });
      setCards(pages);
      setSelectedIdx(0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, [translation, setCards, setSelectedIdx, setLoading]);

  const [phraseHits, setPhraseHits] = useState<Array<{ book: string; chapter: number; verse: number; text: string; matched?: string }>>([]);

  const lookup = useCallback(async () => {
    const parser = await import("@/lib/bible-parser");
    const treatAsRef = parser.isProbablyReference(ref);
    if (treatAsRef) {
      const parsed = parser.parseReferences(ref);
      if (parsed.length === 0) { toast.info("Couldn't parse reference"); return; }
      const p = parsed[0];
      setPhraseHits([]);
      await runLookup({ book: p.book, chapter: p.chapter, verseStart: p.verseStart, verseEnd: p.verseEnd });
    } else {
      // Phrase search — server requires min 3 chars (pgvector embedding cost).
      // Enforce client-side too so we don't fire a doomed request.
      const trimmed = ref.trim();
      if (trimmed.length < 3) {
        toast.info("Type at least 3 characters to search.");
        return;
      }
      setLoading(true);
      try {
        const res = await fetch("/api/bible/search", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed, translation, limit: 10 }),
        }).then((r) => r.json());
        if (res.error) { toast.error(res.error); return; }
        const hits = (res.hits || res.results || []) as Array<{ book: string; chapter: number; verse: number; text: string }>;
        setPhraseHits(hits.map((h) => ({ ...h, matched: trimmed })));
        setCards([]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Search failed");
      } finally {
        setLoading(false);
      }
    }
  }, [ref, runLookup, translation, setCards, setLoading]);

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

  // Y1/Y7: render each verse honoring showVerseNumbers, and append the
  // reference per refFormat ("each" → every card, "last" → only last card,
  // "none" → never).
  const cardToSlide = useCallback((c: VerseCard, idx: number, total: number): SlidePayload => {
    const body = c.verses
      .map((v) => opts.showVerseNumbers ? `${v.verse} ${v.text}` : v.text)
      .join(" ");
    let text = body;
    const includeRef =
      opts.refFormat === "each" ||
      (opts.refFormat === "last" && idx === total - 1);
    if (includeRef) text = `${body}\n\n${c.label}`;
    return { kind: "text", text };
  }, [opts.showVerseNumbers, opts.refFormat]);

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
          onChange={(e) => setTranslation(e.target.value)}
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
        <div className="grid gap-2">
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
      {tab === "reference" && (
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {cards.length === 0 && (
          <div className="col-span-full text-[12px] text-[var(--color-muted-foreground)] py-8 text-center">
            Enter a reference above and hit Lookup — or switch to Browse.
          </div>
        )}
        {cards.map((c, idx) => {
          const selected = selectedIdx === idx;
          const slide = cardToSlide(c, idx, cards.length);
          return (
            <button
              key={c.id}
              onClick={() => setSelectedIdx(idx)}
              onDoubleClick={() => ctx.onSendSlideToLive(slide)}
              className={cn(
                "relative aspect-video rounded-md overflow-hidden border-2 transition-all",
                selected ? "border-[var(--color-brand)]" : "border-[var(--color-border)] hover:border-[var(--color-muted-foreground)]",
              )}
            >
              <SlideRenderer slide={slide} />
              <div className="absolute top-1 left-1 text-[10px] font-mono text-white/70 bg-black/40 px-1 rounded">
                {idx + 1}
              </div>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
