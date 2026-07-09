"use client";
import { useEffect, useState } from "react";
import { BookOpen, Send, Eye, Search, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SlidePayload } from "@/lib/broadcast";

type Translation = { id: string; code: string; name: string };
type Verse = { book: string; chapter: number; verse: number; text: string };

// Documented "licensed" slots — never embed text for these.
const LICENSED_SLOTS = [
  { code: "NIV",  name: "New International Version" },
  { code: "ESV",  name: "English Standard Version" },
  { code: "NKJV", name: "New King James Version" },
  { code: "NLT",  name: "New Living Translation" },
];

export function BibleBrowserMode({
  onSendPreview, onSendLive, defaultTranslationCode,
}: {
  onSendPreview: (slide: SlidePayload) => void;
  onSendLive: (slide: SlidePayload) => void;
  defaultTranslationCode: string;
}) {
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [translationCode, setTranslationCode] = useState(defaultTranslationCode);
  const [query, setQuery] = useState("");
  const [verses, setVerses] = useState<Verse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<"full" | "lower_third">("full");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/bible/translations").then((r) => r.json()).catch(() => ({ translations: [] }));
        if (cancelled) return;
        setTranslations(r.translations || []);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  async function search() {
    setError(null); setVerses([]);
    if (!query.trim()) return;
    setLoading(true);
    try {
      const parsed = await import("@/lib/bible-parser").then((m) => m.parseReferences(query));
      if (parsed.length === 0) { setError(`Couldn't parse "${query}" as a Bible reference. Try "John 3:16" or "Romans 8:28-30".`); setLoading(false); return; }
      const ref = parsed[0];
      const r = await fetch("/api/bible/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book: ref.book, chapter: ref.chapter,
          verseStart: ref.verseStart, verseEnd: ref.verseEnd,
          translationCode, withWindow: true,
        }),
      }).then((r) => r.json());
      if (r.error) { setError(r.error); setLoading(false); return; }
      setVerses(r.primary || r.verses || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function slideFromCurrent(mode: "full" | "lower_third"): SlidePayload | null {
    if (verses.length === 0) return null;
    const first = verses[0];
    const last = verses[verses.length - 1];
    const text = verses.map((v) => v.text).join(" ");
    const label = `${first.book} ${first.chapter}:${first.verse}${first.verse !== last.verse ? `-${last.verse}` : ""} (${translationCode})`;
    if (mode === "full") return { kind: "text", text: `${text}\n\n${label}` };
    // "lower_third" mode still ships a text slide, but with just the label
    // as leading big text — the livestream output can pick it up specially.
    return { kind: "text", text: `${label}\n\n${text}` };
  }

  function shift(direction: 1 | -1) {
    if (verses.length === 0) return;
    const first = verses[0];
    const next = { book: first.book, chapter: first.chapter, verseStart: first.verse + direction, verseEnd: verses[verses.length - 1].verse + direction };
    if (next.verseStart < 1) return;
    fetch("/api/bible/lookup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...next, translationCode, withWindow: false }),
    }).then((r) => r.json()).then((r) => {
      if (r.verses?.length) setVerses(r.verses);
    }).catch(() => { /* silent */ });
  }

  const licensedNotAvailable = LICENSED_SLOTS.some((l) => l.code === translationCode);

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="h-14 shrink-0 border-b flex items-center gap-2 px-4"
        style={{ borderColor: "var(--color-border)" }}>
        <BookOpen className="w-4 h-4 text-[color:var(--color-brand)]" />
        <div className="relative flex-1 max-w-xl">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder='e.g. "John 3:16" or "Romans 8:28-30" or "Psalm ninety-one"'
            className="h-9 w-full pl-9 pr-3 rounded-md border text-sm bg-[color:var(--color-panel)] border-[color:var(--color-border)] focus:border-[color:var(--color-brand)] outline-none" />
        </div>
        <select value={translationCode} onChange={(e) => setTranslationCode(e.target.value)}
          className="h-9 px-2 rounded-md border text-xs bg-[color:var(--color-panel)] border-[color:var(--color-border)]">
          <optgroup label="Public domain">
            {translations.map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}
          </optgroup>
          <optgroup label="Licensed (not yet available)">
            {LICENSED_SLOTS.map((l) => <option key={l.code} value={l.code}>{l.code} — licensed</option>)}
          </optgroup>
        </select>
        <button onClick={search}
          className="h-9 px-4 rounded-md text-xs font-semibold bg-[color:var(--color-elevated)] hover:bg-[color:var(--color-raised-shell)]">
          Search
        </button>
      </div>

      {/* Licensed warning */}
      {licensedNotAvailable && (
        <div className="shrink-0 border-b flex items-start gap-2 px-4 py-2 text-xs"
          style={{ borderColor: "var(--color-border)", background: "color-mix(in oklab, var(--color-warning) 8%, transparent)" }}>
          <AlertCircle className="w-3.5 h-3.5 text-[color:var(--color-warning)] mt-0.5" />
          <div>
            <div className="text-[color:var(--color-warning)] font-semibold">Licensed translation</div>
            <div className="text-[color:var(--color-muted-foreground)]">
              {LICENSED_SLOTS.find((l) => l.code === translationCode)?.name} requires a paid licensing agreement — no text is embedded.
              Connect your own API.Bible or Bible Gateway key in <code className="font-mono opacity-70">/settings</code> to enable.
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && <div className="text-center text-xs text-[color:var(--color-muted-foreground)]">Loading…</div>}
        {error && <div className="text-center text-xs text-[color:var(--color-destructive)]">{error}</div>}
        {!loading && !error && verses.length === 0 && (
          <div className="text-center text-xs text-[color:var(--color-muted-foreground)]">
            Type a reference and press Enter. Full library at <code className="font-mono opacity-70">/library/bible</code>.
          </div>
        )}
        {verses.length > 0 && (
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="space-y-2">
              {verses.map((v, i) => (
                <div key={i} className="rounded-md p-4 border" style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[color:var(--color-muted-foreground)] mb-1">
                    {v.book} {v.chapter}:{v.verse}
                  </div>
                  <div className="text-base leading-relaxed">{v.text}</div>
                </div>
              ))}
            </div>

            {/* Range controls */}
            <div className="flex items-center gap-2 pt-3 border-t" style={{ borderColor: "var(--color-border)" }}>
              <button onClick={() => shift(-1)}
                className="h-8 px-3 rounded-md text-xs font-semibold border border-[color:var(--color-border)] hover:bg-[color:var(--color-raised-shell)] inline-flex items-center gap-1">
                <ChevronLeft className="w-3 h-3" /> Previous verse
              </button>
              <button onClick={() => shift(1)}
                className="h-8 px-3 rounded-md text-xs font-semibold border border-[color:var(--color-border)] hover:bg-[color:var(--color-raised-shell)] inline-flex items-center gap-1">
                Next verse <ChevronRight className="w-3 h-3" />
              </button>
              <div className="w-px h-6 mx-1" style={{ background: "var(--color-border)" }} />
              <div className="flex items-center rounded-md border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
                <button onClick={() => setRenderMode("full")}
                  className={cn("h-8 px-3 text-[11px] font-semibold", renderMode === "full" ? "bg-[color:var(--color-elevated)]" : "hover:bg-[color:var(--color-raised-shell)]")}>Full slide</button>
                <button onClick={() => setRenderMode("lower_third")}
                  className={cn("h-8 px-3 text-[11px] font-semibold border-l", renderMode === "lower_third" ? "bg-[color:var(--color-elevated)]" : "hover:bg-[color:var(--color-raised-shell)]")}
                  style={{ borderColor: "var(--color-border)" }}>Lower third</button>
              </div>
              <div className="ml-auto flex gap-2">
                <button onClick={() => { const s = slideFromCurrent(renderMode); if (s) onSendPreview(s); }}
                  className="h-9 px-3 rounded-md text-xs font-semibold border border-[color:var(--color-brand)] text-[color:var(--color-brand)] bg-[color:var(--color-brand)]/10 hover:bg-[color:var(--color-brand)]/20 inline-flex items-center gap-1.5">
                  <Eye className="w-3 h-3" /> Send to Preview
                </button>
                <button onClick={() => { const s = slideFromCurrent(renderMode); if (s) onSendLive(s); }}
                  className="h-9 px-3 rounded-md text-xs font-bold bg-[color:var(--color-destructive)] text-white hover:opacity-90 inline-flex items-center gap-1.5">
                  <Send className="w-3 h-3" /> Send to Live
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
