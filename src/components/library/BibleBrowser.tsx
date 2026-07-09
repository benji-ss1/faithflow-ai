"use client";
import { useCallback, useState, useTransition } from "react";
import { Search, Book, Sparkles, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { addServiceItem } from "@/lib/actions";
import { cn } from "@/lib/utils";

type Translation = { id: string; code: string; name: string };
type BookRow = { book: string; bookOrder: number; chapters: number };
type Verse = { id: string; book: string; bookOrder: number; chapter: number; verse: number; text: string };
type SearchHit = Verse & { distance: number };
type Plan = { id: string; title: string };

type StagedVerse = Verse & { translationCode: string };

export function BibleBrowser({
  translations,
  initialTranslationId,
  initialBooks,
  plans,
  embeddingStatus,
}: {
  translations: Translation[];
  initialTranslationId: string;
  initialBooks: BookRow[];
  plans: Plan[];
  embeddingStatus: { done: number; total: number };
}) {
  const [translationId, setTranslationId] = useState(initialTranslationId);
  const [books, setBooks] = useState<BookRow[]>(initialBooks);
  const [selectedBook, setSelectedBook] = useState<BookRow | null>(null);
  const [chapter, setChapter] = useState<number | null>(null);
  const [chapterVerses, setChapterVerses] = useState<Verse[]>([]);
  const [mode, setMode] = useState<"browse" | "semantic">("browse");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [staged, setStaged] = useState<StagedVerse[]>([]);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const currentTranslation = translations.find((t) => t.id === translationId)!;

  const switchTranslation = useCallback(async (id: string) => {
    setTranslationId(id);
    setLoading(true);
    const res = await fetch(`/api/bible/books?translationId=${id}`).then((r) => r.json());
    setBooks(res.books || []);
    setSelectedBook(null);
    setChapter(null);
    setChapterVerses([]);
    setLoading(false);
  }, []);

  const openChapter = useCallback(async (book: BookRow, ch: number) => {
    setSelectedBook(book);
    setChapter(ch);
    setLoading(true);
    const res = await fetch(`/api/bible/chapter?translationId=${translationId}&book=${encodeURIComponent(book.book)}&chapter=${ch}`).then((r) => r.json());
    setChapterVerses(res.verses || []);
    setLoading(false);
  }, [translationId]);

  const runSemantic = useCallback(async () => {
    if (query.trim().length < 3) { toast.error("Type at least 3 characters"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/bible/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ translationId, query, limit: 25 }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      setHits(res.hits || []);
      if (!res.hits?.length) toast.info("No matches — try different words");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [query, translationId]);

  const stage = useCallback((v: Verse) => {
    setStaged((cur) => {
      if (cur.some((s) => s.id === v.id)) return cur;
      return [...cur, { ...v, translationCode: currentTranslation.code }];
    });
  }, [currentTranslation.code]);

  const unstage = useCallback((id: string) => {
    setStaged((cur) => cur.filter((s) => s.id !== id));
  }, []);

  function stagedReference(): string {
    if (staged.length === 0) return "";
    const first = staged[0];
    const last = staged[staged.length - 1];
    if (first.book === last.book && first.chapter === last.chapter) {
      return `${first.book} ${first.chapter}:${first.verse}${first.verse !== last.verse ? `-${last.verse}` : ""}`;
    }
    return `${first.book} ${first.chapter}:${first.verse} — ${last.book} ${last.chapter}:${last.verse}`;
  }

  function addToPlan(planId: string) {
    if (staged.length === 0) { toast.error("Nothing staged"); return; }
    const ref = stagedReference();
    const slides = staged.map((v) => ({ text: `${v.text}\n\n${v.book} ${v.chapter}:${v.verse} (${v.translationCode})` }));
    startTransition(async () => {
      const res = await addServiceItem(planId, "scripture", ref, { reference: ref, translation: currentTranslation.code, slides });
      if (res.ok) { toast.success(`Added "${ref}" to plan`); setStaged([]); }
      else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 border border-border rounded-md p-0.5">
          <button onClick={() => setMode("browse")}
            className={cn("px-3 h-8 text-xs font-semibold rounded-sm transition-all", mode === "browse" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent")}>
            <Book className="w-3.5 h-3.5 inline mr-1.5" /> Browse
          </button>
          <button onClick={() => setMode("semantic")}
            className={cn("px-3 h-8 text-xs font-semibold rounded-sm transition-all", mode === "semantic" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent")}>
            <Sparkles className="w-3.5 h-3.5 inline mr-1.5" /> Search by meaning
          </button>
        </div>
        <select value={translationId} onChange={(e) => switchTranslation(e.target.value)}
          className="h-9 px-3 border border-border rounded-md bg-background text-sm">
          {translations.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
        </select>
        {mode === "semantic" && embeddingStatus.done < embeddingStatus.total && (
          <span className="text-[10px] text-warning font-medium">
            Embedding: {embeddingStatus.done.toLocaleString()} / {embeddingStatus.total.toLocaleString()} verses indexed
          </span>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left: nav */}
        <aside className="col-span-3 border border-border rounded-md p-3 max-h-[70vh] overflow-y-auto">
          {mode === "browse" ? (
            <>
              <div className="eyebrow text-muted-foreground mb-2">Books</div>
              <div className="space-y-0.5">
                {books.map((b) => (
                  <div key={b.book}>
                    <button onClick={() => setSelectedBook((cur) => cur?.book === b.book ? null : b)}
                      className={cn("w-full text-left px-2 py-1.5 rounded-sm text-sm transition-all",
                        selectedBook?.book === b.book ? "bg-accent font-semibold" : "hover:bg-accent")}>
                      {b.book}
                    </button>
                    {selectedBook?.book === b.book && (
                      <div className="pl-3 pt-1 pb-2 flex flex-wrap gap-1">
                        {Array.from({ length: b.chapters }, (_, i) => i + 1).map((ch) => (
                          <button key={ch} onClick={() => openChapter(b, ch)}
                            className={cn("w-8 h-8 text-xs rounded-sm border transition-all",
                              chapter === ch ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent")}>
                            {ch}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="eyebrow text-muted-foreground mb-2">Search</div>
              <textarea value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. love your enemies, be still and know…"
                rows={4}
                className="w-full px-2 py-1.5 border border-border rounded-md bg-background text-sm resize-none" />
              <button onClick={runSemantic} disabled={loading}
                className="mt-2 w-full h-9 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {loading ? "Searching…" : "Search"}
              </button>
              <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">
                Vector similarity over verse embeddings. Best for finding a passage when you don't know the reference.
              </p>
            </>
          )}
        </aside>

        {/* Center: verses */}
        <section className="col-span-6 border border-border rounded-md p-4 max-h-[70vh] overflow-y-auto">
          {mode === "browse" ? (
            !selectedBook || !chapter ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Select a book and chapter.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold font-display">{selectedBook.book} {chapter}</h2>
                  <div className="eyebrow text-muted-foreground">{currentTranslation.code}</div>
                </div>
                <div className="space-y-2">
                  {chapterVerses.map((v) => <VerseRow key={v.id} verse={v} onStage={stage} />)}
                </div>
              </>
            )
          ) : (
            <>
              <div className="eyebrow text-muted-foreground mb-3">Results</div>
              {hits.length === 0 ? (
                <div className="text-sm text-muted-foreground">Type a query and search.</div>
              ) : (
                <div className="space-y-2">
                  {hits.map((h) => (
                    <VerseRow key={h.id} verse={h} onStage={stage}
                      badge={<span className="text-[10px] text-muted-foreground font-mono">sim {(1 - h.distance).toFixed(3)}</span>} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* Right: staged */}
        <aside className="col-span-3 border border-border rounded-md p-3 max-h-[70vh] overflow-y-auto flex flex-col">
          <div className="eyebrow text-muted-foreground mb-2">Staged for plan</div>
          {staged.length === 0 ? (
            <div className="text-xs text-muted-foreground">Click a verse to stage it.</div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground mb-2">{stagedReference()} · {staged.length} verse{staged.length !== 1 && "s"}</div>
              <ul className="space-y-1 mb-3 flex-1">
                {staged.map((v) => (
                  <li key={v.id} className="flex items-start gap-2 text-xs border border-border rounded-sm p-2">
                    <div className="flex-1">
                      <div className="font-mono text-[10px] text-muted-foreground">{v.book} {v.chapter}:{v.verse}</div>
                      <div className="line-clamp-2">{v.text}</div>
                    </div>
                    <button onClick={() => unstage(v.id)} className="text-muted-foreground hover:text-destructive text-[10px]">✕</button>
                  </li>
                ))}
              </ul>
              <div className="eyebrow text-muted-foreground mb-1">Add to plan</div>
              {plans.length === 0 ? (
                <p className="text-xs text-muted-foreground">Create a service plan first.</p>
              ) : (
                <div className="space-y-1">
                  {plans.map((p) => (
                    <button key={p.id} onClick={() => addToPlan(p.id)}
                      className="w-full text-left px-2 py-1.5 border border-border rounded-sm text-xs hover:bg-accent flex items-center gap-1.5">
                      <Plus className="w-3 h-3" /> {p.title}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function VerseRow({ verse, onStage, badge }: { verse: Verse; onStage: (v: Verse) => void; badge?: React.ReactNode }) {
  return (
    <button onClick={() => onStage(verse)}
      className="w-full text-left flex gap-3 p-2 border border-transparent hover:border-border hover:bg-accent rounded-md transition-all">
      <span className="font-mono text-xs text-muted-foreground w-14 shrink-0 pt-0.5">
        {verse.book !== undefined && verse.book !== null ? `${verse.book.slice(0, 3)} ${verse.chapter}:${verse.verse}` : `${verse.verse}`}
      </span>
      <span className="text-sm flex-1">{verse.text}</span>
      {badge}
    </button>
  );
}
