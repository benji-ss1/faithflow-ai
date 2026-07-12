"use client";
import { useState, useCallback } from "react";
import { toast } from "sonner";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";
import { BibleOptionsPopover } from "./BibleOptionsPopover";
import { cn } from "@/lib/utils";

type VerseCard = { id: string; text: string; label: string };

export function BibleMode({ ctx }: { ctx: OperatorShellCtx }) {
  const [ref, setRef] = useState("John 3:16");
  const [translation, setTranslation] = useState(ctx.defaultTranslationCode || "KJV");
  const [mode, setMode] = useState<"verse" | "passage">("passage");
  const [refFmt, setRefFmt] = useState<"reference" | "with_verse" | "none">("with_verse");
  const [cards, setCards] = useState<VerseCard[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const lookup = useCallback(async () => {
    setLoading(true);
    try {
      const parseRefs = await import("@/lib/bible-parser").then((m) => m.parseReferences);
      const parsed = parseRefs(ref);
      if (parsed.length === 0) { toast.info("Couldn't parse reference"); return; }
      const p = parsed[0];
      const res = await fetch("/api/bible/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book: p.book, chapter: p.chapter, verseStart: p.verseStart, verseEnd: p.verseEnd, translationCode: translation }),
      }).then((r) => r.json());
      if (res.error) { toast.error(res.error); return; }
      const verses: Array<{ verse: number; text: string }> = res.verses || [];
      const label = `${p.book} ${p.chapter}:${p.verseStart}${p.verseStart !== p.verseEnd ? `-${p.verseEnd}` : ""} (${res.translation || translation})`;
      // Paginate 2 verses per card
      const pages: VerseCard[] = [];
      for (let i = 0; i < verses.length; i += 2) {
        const chunk = verses.slice(i, i + 2);
        const text = chunk.map((v) => v.text).join(" ");
        pages.push({ id: `${label}-${i}`, text, label });
      }
      if (pages.length === 0) pages.push({ id: label, text: "—", label });
      setCards(pages);
      setSelectedIdx(0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, [ref, translation]);

  const cardToSlide = (c: VerseCard): SlidePayload => {
    const showRef = refFmt !== "none";
    const text = showRef ? `${c.text}\n\n${c.label}` : c.text;
    return { kind: "text", text };
  };

  return (
    <div className="p-4 flex flex-col gap-4">
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
        <select
          value={refFmt}
          onChange={(e) => setRefFmt(e.target.value as typeof refFmt)}
          className="h-9 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md text-sm"
        >
          <option value="reference">Reference</option>
          <option value="with_verse">With Verse</option>
          <option value="none">No Reference</option>
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

      {/* Verse cards */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {cards.length === 0 && (
          <div className="col-span-full text-[12px] text-[var(--color-muted-foreground)] py-8 text-center">
            Enter a reference above and hit Lookup.
          </div>
        )}
        {cards.map((c, idx) => {
          const selected = selectedIdx === idx;
          return (
            <button
              key={c.id}
              onClick={() => setSelectedIdx(idx)}
              onDoubleClick={() => ctx.onSendSlideToLive(cardToSlide(c))}
              className={cn(
                "relative aspect-video rounded-md overflow-hidden border-2 transition-all",
                selected ? "border-[var(--color-brand)]" : "border-[var(--color-border)] hover:border-[var(--color-muted-foreground)]",
              )}
            >
              <SlideRenderer slide={cardToSlide(c)} />
              <div className="absolute top-1 left-1 text-[10px] font-mono text-white/70 bg-black/40 px-1 rounded">
                {idx + 1}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
