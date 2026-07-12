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
  const { state, setRef, setTranslation, setMode, setCards, setSelectedIdx, setLoading } = session;
  const { ref, translation, mode, cards, selectedIdx, loading } = state;
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
      // Y7: verse=1 per card, passage=up to 4 per card
      const perCard = mode === "verse" ? 1 : 4;
      const pages: VerseCard[] = [];
      for (let i = 0; i < verses.length; i += perCard) {
        const chunk = verses.slice(i, i + perCard);
        pages.push({ id: `${label}-${i}`, label, verses: chunk });
      }
      if (pages.length === 0) pages.push({ id: label, label, verses: [] });
      setCards(pages);
      setSelectedIdx(0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, [translation, mode, setCards, setSelectedIdx, setLoading]);

  const lookup = useCallback(async () => {
    const parseRefs = await import("@/lib/bible-parser").then((m) => m.parseReferences);
    const parsed = parseRefs(ref);
    if (parsed.length === 0) { toast.info("Couldn't parse reference"); return; }
    const p = parsed[0];
    await runLookup({ book: p.book, chapter: p.chapter, verseStart: p.verseStart, verseEnd: p.verseEnd });
  }, [ref, runLookup]);

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
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(); } }}
          placeholder="John 3:16-18"
          className="flex-1 min-w-[200px] bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md px-3 h-9 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        <select
          value={translation}
          onChange={(e) => setTranslation(e.target.value)}
          className="h-9 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md text-sm"
        >
          <option value="KJV">King James Version</option>
          <option value="WEB">World English Bible</option>
          <option value="ASV">American Standard Version</option>
        </select>
        <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden text-[11px] uppercase tracking-wider font-mono h-9">
          {(["verse", "passage"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn("px-2 h-full", mode === m ? "bg-[var(--color-brand)] text-black" : "text-[var(--color-muted-foreground)]")}
            >{m}</button>
          ))}
        </div>
        <button
          onClick={() => void lookup()}
          disabled={loading}
          className="h-9 px-3 rounded-md bg-[var(--color-brand)] text-black text-sm font-semibold disabled:opacity-60"
        >
          {loading ? "…" : "Lookup"}
        </button>
        <BibleOptionsPopover />
      </div>

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
