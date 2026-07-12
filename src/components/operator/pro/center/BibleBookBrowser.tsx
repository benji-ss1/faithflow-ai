"use client";
/**
 * Three-column Bible browser: Books → Chapters → Verses.
 * OT books collapsible. Selecting a verse fires onPickVerse which the
 * parent (BibleMode) uses to load the verse into the main verse-card area
 * — same code path as typing a reference and pressing Lookup.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type BookEntry = { book: string; bookOrder: number; chapters: number; testament: "OT" | "NT" };
export type ChapterEntry = { chapter: number; verseCount: number };

export function BibleBookBrowser({
  translation,
  onPickVerse,
}: {
  translation: string;
  onPickVerse: (ref: { book: string; chapter: number; verse: number }) => void;
}) {
  const [books, setBooks] = useState<BookEntry[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [chaptersMap, setChaptersMap] = useState<Record<string, ChapterEntry[]>>({});
  const [otOpen, setOtOpen] = useState(true);
  const [ntOpen, setNtOpen] = useState(true);

  // Load books whenever the translation changes.
  useEffect(() => {
    let cancelled = false;
    setLoadingBooks(true);
    fetch(`/api/bible/books?translation=${encodeURIComponent(translation)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setBooks(data.books || []);
      })
      .catch(() => { if (!cancelled) toast.error("Failed to load books"); })
      .finally(() => { if (!cancelled) setLoadingBooks(false); });
    // Reset selection on translation swap.
    setSelectedBook(null);
    setSelectedChapter(null);
    setChaptersMap({});
    return () => { cancelled = true; };
  }, [translation]);

  // Load chapters for the selected book (cached per book+translation).
  const chapters = selectedBook ? chaptersMap[selectedBook] : undefined;
  useEffect(() => {
    if (!selectedBook) return;
    if (chaptersMap[selectedBook]) return; // cached
    let cancelled = false;
    fetch(`/api/bible/chapters?book=${encodeURIComponent(selectedBook)}&translation=${encodeURIComponent(translation)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setChaptersMap((prev) => ({ ...prev, [selectedBook]: data.chapters || [] }));
      })
      .catch(() => { if (!cancelled) toast.error("Failed to load chapters"); });
    return () => { cancelled = true; };
  }, [selectedBook, translation, chaptersMap]);

  const ot = useMemo(() => books.filter((b) => b.testament === "OT"), [books]);
  const nt = useMemo(() => books.filter((b) => b.testament === "NT"), [books]);
  const currentChapter = selectedChapter && chapters?.find((c) => c.chapter === selectedChapter);

  const pickBook = useCallback((b: string) => {
    setSelectedBook(b);
    setSelectedChapter(null);
  }, []);

  const renderBookList = (list: BookEntry[]) => (
    <div className="flex flex-col">
      {list.map((b) => (
        <button
          key={b.book}
          onClick={() => pickBook(b.book)}
          className={cn(
            "text-left px-2 py-1 text-[12px] rounded hover:bg-[var(--color-elevated)]",
            selectedBook === b.book && "bg-[var(--color-elevated)] text-[var(--color-brand)]",
          )}
        >
          {b.book}
        </button>
      ))}
    </div>
  );

  return (
    <div className="grid gap-2 h-[560px]" style={{ gridTemplateColumns: "220px 1fr 1fr" }}>
      {/* Books column */}
      <div className="border border-[var(--color-border)] rounded-md overflow-y-auto p-1">
        {loadingBooks && <div className="p-2 text-[11px] text-[var(--color-muted-foreground)]">Loading books…</div>}
        {!loadingBooks && books.length === 0 && (
          <div className="p-2 text-[11px] text-[var(--color-muted-foreground)]">No books available for {translation}.</div>
        )}
        {ot.length > 0 && (
          <div>
            <button
              onClick={() => setOtOpen((v) => !v)}
              className="w-full flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] font-mono"
            >
              {otOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Old Testament ({ot.length})
            </button>
            {otOpen && renderBookList(ot)}
          </div>
        )}
        {nt.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setNtOpen((v) => !v)}
              className="w-full flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] font-mono"
            >
              {ntOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              New Testament ({nt.length})
            </button>
            {ntOpen && renderBookList(nt)}
          </div>
        )}
      </div>

      {/* Chapters column */}
      <div className="border border-[var(--color-border)] rounded-md overflow-y-auto p-2">
        {!selectedBook && (
          <div className="text-[11px] text-[var(--color-muted-foreground)] p-2">Select a book.</div>
        )}
        {selectedBook && !chapters && (
          <div className="text-[11px] text-[var(--color-muted-foreground)] p-2">Loading chapters…</div>
        )}
        {selectedBook && chapters && (
          <>
            <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted-foreground)] font-mono mb-2 px-1">
              {selectedBook} · {chapters.length} chapter{chapters.length === 1 ? "" : "s"}
            </div>
            <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(38px, 1fr))" }}>
              {chapters.map((c) => (
                <button
                  key={c.chapter}
                  onClick={() => setSelectedChapter(c.chapter)}
                  className={cn(
                    "h-8 rounded border text-[12px] font-mono",
                    selectedChapter === c.chapter
                      ? "bg-[var(--color-brand)] text-black border-[var(--color-brand)]"
                      : "bg-[var(--color-panel)] border-[var(--color-border)] hover:border-[var(--color-brand)] text-[var(--color-foreground)]",
                  )}
                >
                  {c.chapter}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Verses column */}
      <div className="border border-[var(--color-border)] rounded-md overflow-y-auto p-2">
        {!currentChapter && (
          <div className="text-[11px] text-[var(--color-muted-foreground)] p-2">Select a chapter.</div>
        )}
        {currentChapter && selectedBook && (
          <>
            <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted-foreground)] font-mono mb-2 px-1">
              {selectedBook} {currentChapter.chapter} · {currentChapter.verseCount} verses
            </div>
            <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(38px, 1fr))" }}>
              {Array.from({ length: currentChapter.verseCount }, (_, i) => i + 1).map((v) => (
                <button
                  key={v}
                  onClick={() => onPickVerse({ book: selectedBook, chapter: currentChapter.chapter, verse: v })}
                  className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-panel)] text-[12px] font-mono hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
                >
                  {v}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
