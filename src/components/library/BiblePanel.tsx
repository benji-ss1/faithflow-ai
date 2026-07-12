"use client";
/**
 * BiblePanel — ProPresenter-style scripture panel for the operator cockpit.
 *
 * Replaces the older BibleBrowserMode workspace UI. Features:
 *   - Free-text reference input (parsed via lib/bible-parser)
 *   - Translation dropdown + verse/passage toggle + reference-format selector
 *   - Dark slide-preview cards; grid vs list; card-size slider (persisted)
 *   - Prev/Next verse navigation (uses `withWindow` from /api/bible/lookup)
 *   - Save As... to Quick Access verse bank
 *   - Transition duration slider + style dropdown (from EFFECTS)
 *   - Single click stages; double-click sends to live (or stages if Safe Mode)
 *   - Global Esc / Ctrl+C posts {type:"clear"} on the BroadcastChannel
 *   - Inline AI-detected verse cards with "AI Detected · NN%" green badge
 *   - Optional autopilot auto-send when auto-approve + auto-send-to-live on
 *
 * The panel is stateless w.r.t. the operator's Live/Preview surfaces — it
 * calls the injected handlers so the OperatorConsole stays the source of truth.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Search, Sparkles, Save, Loader2, X, Grid3x3, List } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EFFECTS } from "@/lib/effects";
import type { SlidePayload, TransitionSpec } from "@/lib/broadcast";
import { openLiveChannel, safePost } from "@/lib/broadcast";
import type { Detection } from "@/components/operator/useAudioStream";

type Translation = { id: string; code: string; name: string };
type Verse = { book: string; chapter: number; verse: number; text: string };

export type BiblePanelProps = {
  defaultTranslationCode: string;
  // Live wiring — provided by OperatorConsole
  onSendSlideToLive: (slide: SlidePayload, transition?: TransitionSpec | null) => void;
  onStageSlide: (slide: SlidePayload) => void;
  onBankAdd: (ref: { book: string; chapter: number; verseStart: number; verseEnd: number }) => Promise<unknown>;
  // Transition state (shared with OperatorConsole)
  transitionSpec: TransitionSpec | null;
  onSetTransitionSpec: (t: TransitionSpec | null) => void;
  // AI detection stream (optional)
  detections?: Detection[];
  autoApproveEnabled?: boolean;
  autoApproveThreshold?: number; // 0-100
  autoSendToLive?: boolean;
  onClose?: () => void;
};

const LS_SAFE_MODE = "presentflow.safeMode";
const LS_VIEW = "presentflow.biblePanel.view";
const LS_CARD_SIZE = "presentflow.biblePanel.cardSize";
const LS_REF_FORMAT = "presentflow.biblePanel.refFormat";

function readLS(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch { return fallback; }
}
function writeLS(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, value); } catch { /* noop */ }
}

function refLabel(v: Verse, last?: Verse, translationCode?: string): string {
  const suffix = translationCode ? ` (${translationCode})` : "";
  if (!last || (v.book === last.book && v.chapter === last.chapter && v.verse === last.verse)) {
    return `${v.book} ${v.chapter}:${v.verse}${suffix}`;
  }
  return `${v.book} ${v.chapter}:${v.verse}-${last.verse}${suffix}`;
}

/** Group verses into cards of 1-2 verses each for slide-style pagination. */
function paginateVerses(verses: Verse[], versesPerCard = 1): Verse[][] {
  const out: Verse[][] = [];
  for (let i = 0; i < verses.length; i += versesPerCard) {
    out.push(verses.slice(i, i + versesPerCard));
  }
  return out;
}

/**
 * Best-effort translation-hint extractor.
 * Recognises trailing "in the NLT", "amplified version", "from KJV" style phrases.
 * Returns a canonical translation code (uppercased) or null.
 */
function extractTranslationHint(text: string, availableCodes: string[]): string | null {
  const upper = text.toUpperCase();
  // Direct code match e.g. "NLT" "KJV" "ESV"
  for (const code of availableCodes) {
    const c = code.toUpperCase();
    if (new RegExp(`\\b${c}\\b`).test(upper)) return c;
  }
  // Named-version phrases
  const named: Record<string, string> = {
    "AMPLIFIED": "AMP",
    "NEW LIVING": "NLT",
    "KING JAMES": "KJV",
    "ENGLISH STANDARD": "ESV",
    "NEW INTERNATIONAL": "NIV",
    "WORLD ENGLISH": "WEB",
    "NEW KING JAMES": "NKJV",
  };
  for (const [phrase, code] of Object.entries(named)) {
    if (upper.includes(phrase)) return code;
  }
  return null;
}

export function BiblePanel({
  defaultTranslationCode,
  onSendSlideToLive,
  onStageSlide,
  onBankAdd,
  transitionSpec,
  onSetTransitionSpec,
  detections = [],
  autoApproveEnabled = false,
  autoApproveThreshold = 90,
  autoSendToLive = false,
  onClose,
}: BiblePanelProps) {
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [translationCode, setTranslationCode] = useState(defaultTranslationCode);
  const [reference, setReference] = useState("");
  const [verses, setVerses] = useState<Verse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passageMode, setPassageMode] = useState<"verse" | "passage">("verse");
  const [refFormat, setRefFormat] = useState<"reference" | "with_text">(
    readLS(LS_REF_FORMAT, "with_text") === "reference" ? "reference" : "with_text",
  );
  const [view, setView] = useState<"grid" | "list">(readLS(LS_VIEW, "grid") === "list" ? "list" : "grid");
  const [cardSize, setCardSize] = useState<number>(Number(readLS(LS_CARD_SIZE, "260")) || 260);
  const [safeMode, setSafeMode] = useState<boolean>(readLS(LS_SAFE_MODE, "false") === "true");
  const [stagedCardIdx, setStagedCardIdx] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState<number>(transitionSpec?.durationMs ?? 400);
  const [effectId, setEffectId] = useState<string>(transitionSpec?.effectId ?? "fade_in");

  useEffect(() => { writeLS(LS_VIEW, view); }, [view]);
  useEffect(() => { writeLS(LS_CARD_SIZE, String(cardSize)); }, [cardSize]);
  useEffect(() => { writeLS(LS_SAFE_MODE, String(safeMode)); }, [safeMode]);
  useEffect(() => { writeLS(LS_REF_FORMAT, refFormat); }, [refFormat]);

  // Push transition spec upward whenever it changes
  useEffect(() => {
    const spec: TransitionSpec = { effectId, durationMs, easing: "ease-in-out" };
    onSetTransitionSpec(spec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectId, durationMs]);

  // Load translations
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/bible/translations").then((r) => r.json()).catch(() => ({ translations: [] }));
        if (cancelled) return;
        setTranslations(r.translations || []);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const translationCodes = useMemo(() => translations.map((t) => t.code), [translations]);

  // Global Esc / Ctrl+C → clear live via BroadcastChannel
  useEffect(() => {
    const ch = openLiveChannel();
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Only intercept when NOT typing in an input/textarea
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "Escape" || (e.key.toLowerCase() === "c" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        safePost(ch, { type: "clear" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      ch?.close();
    };
  }, []);

  const doLookup = useCallback(async (refText: string, overrideTranslation?: string): Promise<Verse[]> => {
    setError(null);
    if (!refText.trim()) return [];
    const parsed = await import("@/lib/bible-parser").then((m) => m.parseReferences(refText));
    if (parsed.length === 0) {
      setError(`Couldn't parse "${refText}" as a Bible reference. Try "John 3:16" or "Romans 8:28-30".`);
      return [];
    }
    const ref = parsed[0];
    const useCode = overrideTranslation || translationCode;
    const res = await fetch("/api/bible/lookup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        book: ref.book, chapter: ref.chapter,
        verseStart: ref.verseStart, verseEnd: ref.verseEnd,
        translationCode: useCode, withWindow: true,
      }),
    }).then((r) => r.json());
    if (res.error) { setError(res.error); return []; }
    return (res.primary || res.verses || []) as Verse[];
  }, [translationCode]);

  const search = useCallback(async () => {
    if (!reference.trim()) return;
    setLoading(true);
    setStagedCardIdx(null);
    try {
      const v = await doLookup(reference);
      setVerses(v);
    } finally {
      setLoading(false);
    }
  }, [reference, doLookup]);

  const shift = useCallback(async (direction: 1 | -1) => {
    if (verses.length === 0) return;
    const first = verses[0];
    const last = verses[verses.length - 1];
    const vs = first.verse + direction;
    const ve = last.verse + direction;
    if (vs < 1) return;
    setLoading(true);
    try {
      const res = await fetch("/api/bible/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book: first.book, chapter: first.chapter,
          verseStart: vs, verseEnd: ve,
          translationCode, withWindow: false,
        }),
      }).then((r) => r.json());
      if (res.error) { setError(res.error); return; }
      const next = (res.verses || res.primary || []) as Verse[];
      if (next.length > 0) {
        setVerses(next);
        setReference(`${first.book} ${first.chapter}:${vs}${vs !== ve ? `-${ve}` : ""}`);
        setStagedCardIdx(null);
      }
    } finally { setLoading(false); }
  }, [verses, translationCode]);

  // Build card list from current verses
  const cards = useMemo<Verse[][]>(() => {
    if (verses.length === 0) return [];
    if (passageMode === "passage") {
      // 2 verses per card for a passage view
      return paginateVerses(verses, 2);
    }
    return paginateVerses(verses, 1);
  }, [verses, passageMode]);

  const slideFromCard = useCallback((card: Verse[], translationOverride?: string): SlidePayload => {
    const first = card[0];
    const last = card[card.length - 1];
    const label = refLabel(first, last, translationOverride ?? translationCode);
    if (refFormat === "reference") {
      return { kind: "text", text: label };
    }
    const text = card.map((v) => v.text).join(" ");
    return { kind: "text", text: `${text}\n\n${label}` };
  }, [refFormat, translationCode]);

  const sendCardLive = useCallback((card: Verse[]) => {
    const slide = slideFromCard(card);
    const spec: TransitionSpec = { effectId, durationMs, easing: "ease-in-out" };
    onSendSlideToLive(slide, spec);
  }, [slideFromCard, onSendSlideToLive, effectId, durationMs]);

  const stageCard = useCallback((card: Verse[], idx: number) => {
    setStagedCardIdx(idx);
    onStageSlide(slideFromCard(card));
  }, [onStageSlide, slideFromCard]);

  const saveCurrentToBank = useCallback(async () => {
    if (verses.length === 0) { toast.info("Nothing to save"); return; }
    const first = verses[0];
    const last = verses[verses.length - 1];
    const banked = await onBankAdd({
      book: first.book, chapter: first.chapter,
      verseStart: first.verse, verseEnd: last.verse,
    });
    if (banked) toast.success(`Saved ${refLabel(first, last)} to Quick Access`);
    else toast.error("Save failed");
  }, [verses, onBankAdd]);

  // --- Inline AI-detected verse cards --------------------------------------
  // Fetch detected verses on demand and cache by detection.id
  type DetectedCard = { detection: Detection; verses: Verse[]; translation: string };
  const [detectedCards, setDetectedCards] = useState<Record<string, DetectedCard>>({});
  const detectionFetchedRef = useRef<Set<string>>(new Set());
  const autoSentRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const d of detections) {
      if (detectionFetchedRef.current.has(d.id)) continue;
      detectionFetchedRef.current.add(d.id);
      const hint = extractTranslationHint(d.matchedText, translationCodes);
      const useCode = hint ?? translationCode;
      (async () => {
        try {
          const res = await fetch("/api/bible/lookup", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              book: d.book, chapter: d.chapter,
              verseStart: d.verseStart, verseEnd: d.verseEnd,
              translationCode: useCode,
            }),
          }).then((r) => r.json());
          if (res.error || !(res.primary || res.verses)?.length) return;
          setDetectedCards((cur) => ({ ...cur, [d.id]: {
            detection: d,
            verses: (res.primary || res.verses) as Verse[],
            translation: res.translation || useCode,
          }}));
        } catch { /* noop */ }
      })();
    }
  }, [detections, translationCode, translationCodes]);

  // Autopilot: auto-send when enabled + confidence >= threshold + auto-send on
  useEffect(() => {
    if (!autoApproveEnabled || !autoSendToLive) return;
    for (const d of detections) {
      if (autoSentRef.current.has(d.id)) continue;
      if (d.confidence < autoApproveThreshold) continue;
      const card = detectedCards[d.id];
      if (!card) continue; // wait for lookup
      autoSentRef.current.add(d.id);
      const slide = slideFromCard(card.verses, card.translation);
      const spec: TransitionSpec = { effectId, durationMs, easing: "ease-in-out" };
      onSendSlideToLive(slide, spec);
      toast.info(`Autopilot → LIVE · ${refLabel(card.verses[0], card.verses[card.verses.length - 1], card.translation)}`, { duration: 1800 });
    }
  }, [detections, detectedCards, autoApproveEnabled, autoApproveThreshold, autoSendToLive, effectId, durationMs, onSendSlideToLive, slideFromCard]);

  // ---------- render ------------------------------------------------------
  return (
    <div className="h-full flex flex-col" style={{ background: "#171c1c", color: "#e4e4e7" }}>
      {/* Top bar */}
      <div className="shrink-0 border-b flex flex-wrap items-center gap-2 px-3 py-2" style={{ borderColor: "#2a3232" }}>
        <BookOpen className="w-4 h-4 text-teal-300 shrink-0" />
        <div className="relative flex-1 min-w-[220px] max-w-xl">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
            placeholder='e.g. "John 3:16" or "2 Corinthians 2:2-7"'
            className="h-8 w-full pl-9 pr-3 rounded-md text-sm outline-none border"
            style={{ background: "#1a2020", borderColor: "#2a3232", color: "#e4e4e7" }}
          />
        </div>
        <select
          value={translationCode}
          onChange={(e) => setTranslationCode(e.target.value)}
          className="h-8 px-2 rounded-md text-xs border"
          style={{ background: "#1a2020", borderColor: "#2a3232", color: "#e4e4e7" }}
          title="Translation"
        >
          {translations.map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}
        </select>
        <div className="flex items-center rounded-md border overflow-hidden" style={{ borderColor: "#2a3232" }}>
          <button
            onClick={() => setPassageMode("verse")}
            className={cn("h-8 px-2 text-[11px] font-semibold", passageMode === "verse" ? "bg-teal-500/20 text-teal-200" : "text-zinc-400 hover:bg-white/5")}
            title="One verse per card"
          >Verse</button>
          <button
            onClick={() => setPassageMode("passage")}
            className={cn("h-8 px-2 text-[11px] font-semibold border-l", passageMode === "passage" ? "bg-teal-500/20 text-teal-200" : "text-zinc-400 hover:bg-white/5")}
            style={{ borderColor: "#2a3232" }}
            title="Two verses per card"
          >Passage</button>
        </div>
        <select
          value={refFormat}
          onChange={(e) => setRefFormat(e.target.value as "reference" | "with_text")}
          className="h-8 px-2 rounded-md text-xs border"
          style={{ background: "#1a2020", borderColor: "#2a3232", color: "#e4e4e7" }}
          title="Reference format"
        >
          <option value="with_text">With verse text</option>
          <option value="reference">Reference only</option>
        </select>
        <button
          onClick={search}
          disabled={loading || !reference.trim()}
          className="h-8 px-3 rounded-md text-xs font-semibold bg-teal-500/20 text-teal-100 border border-teal-500/40 hover:bg-teal-500/30 disabled:opacity-40 inline-flex items-center gap-1"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
          Search
        </button>
        <div className="flex items-center rounded-md border overflow-hidden" style={{ borderColor: "#2a3232" }} title="View mode">
          <button onClick={() => setView("grid")}
            className={cn("h-8 px-2", view === "grid" ? "bg-teal-500/20 text-teal-200" : "text-zinc-400 hover:bg-white/5")}>
            <Grid3x3 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setView("list")}
            className={cn("h-8 px-2 border-l", view === "list" ? "bg-teal-500/20 text-teal-200" : "text-zinc-400 hover:bg-white/5")}
            style={{ borderColor: "#2a3232" }}>
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
        <label className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400" title="Safe Mode: double-click stages instead of going live">
          <input type="checkbox" checked={safeMode} onChange={(e) => setSafeMode(e.target.checked)} />
          Safe Mode
        </label>
        {onClose && (
          <button onClick={onClose} className="ml-auto h-8 w-8 flex items-center justify-center text-zinc-400 hover:text-zinc-100" title="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Content — cards */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && <div className="text-xs text-red-300 mb-3">{error}</div>}

        {/* AI-detected cards */}
        {Object.values(detectedCards).length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 mb-2 inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-emerald-400" /> AI Detected
            </div>
            <div className={cn(view === "grid" ? "grid gap-3" : "flex flex-col gap-2")} style={view === "grid" ? { gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` } : undefined}>
              {Object.values(detectedCards).map(({ detection, verses: dv, translation }) => (
                <SlideCard
                  key={detection.id}
                  verses={dv}
                  translationCode={translation}
                  refFormat={refFormat}
                  view={view}
                  size={cardSize}
                  aiBadge={{ confidence: detection.confidence, translation: translation !== translationCode ? translation : undefined }}
                  onClick={() => {
                    const slide = slideFromCard(dv, translation);
                    onStageSlide(slide);
                  }}
                  onDoubleClick={() => {
                    const slide = slideFromCard(dv, translation);
                    if (safeMode) onStageSlide(slide);
                    else onSendSlideToLive(slide, { effectId, durationMs, easing: "ease-in-out" });
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Manual cards */}
        {cards.length === 0 && Object.values(detectedCards).length === 0 && !loading && !error && (
          <div className="h-full min-h-[240px] flex items-center justify-center text-xs text-zinc-500">
            Type a reference and press Enter.
          </div>
        )}
        {cards.length > 0 && (
          <div className={cn(view === "grid" ? "grid gap-3" : "flex flex-col gap-2")} style={view === "grid" ? { gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` } : undefined}>
            {cards.map((card, idx) => (
              <SlideCard
                key={idx}
                verses={card}
                translationCode={translationCode}
                refFormat={refFormat}
                view={view}
                size={cardSize}
                staged={stagedCardIdx === idx}
                onClick={() => stageCard(card, idx)}
                onDoubleClick={() => {
                  if (safeMode) { stageCard(card, idx); return; }
                  sendCardLive(card);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="shrink-0 border-t px-3 py-2 flex flex-wrap items-center gap-3" style={{ borderColor: "#2a3232" }}>
        <button
          onClick={() => shift(-1)}
          disabled={verses.length === 0 || loading}
          className="h-8 px-2 rounded-md text-xs font-semibold border inline-flex items-center gap-1 disabled:opacity-40"
          style={{ borderColor: "#2a3232", background: "#1a2020" }}
        >
          <ChevronLeft className="w-3 h-3" /> Verse
        </button>
        <button
          onClick={() => shift(1)}
          disabled={verses.length === 0 || loading}
          className="h-8 px-2 rounded-md text-xs font-semibold border inline-flex items-center gap-1 disabled:opacity-40"
          style={{ borderColor: "#2a3232", background: "#1a2020" }}
        >
          Verse <ChevronRight className="w-3 h-3" />
        </button>
        <button
          onClick={saveCurrentToBank}
          disabled={verses.length === 0}
          className="h-8 px-2 rounded-md text-xs font-semibold border inline-flex items-center gap-1 disabled:opacity-40"
          style={{ borderColor: "#2a3232", background: "#1a2020" }}
          title="Save current reference to Quick Access"
        >
          <Save className="w-3 h-3" /> Save As...
        </button>
        {safeMode && (
          <button
            onClick={() => {
              // Send the currently staged card to live
              const idx = stagedCardIdx ?? 0;
              const card = cards[idx];
              if (!card) { toast.info("Nothing staged"); return; }
              sendCardLive(card);
            }}
            className="h-8 px-3 rounded-md text-xs font-bold bg-red-500/80 hover:bg-red-500 text-white"
          >
            Send to Live
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 inline-flex items-center gap-2" title="Card size (grid view)">
            Size
            <input type="range" min={180} max={420} step={10} value={cardSize} onChange={(e) => setCardSize(Number(e.target.value))} className="w-24" />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 inline-flex items-center gap-2" title="Transition duration">
            Duration
            <input type="range" min={0} max={5000} step={50} value={durationMs} onChange={(e) => setDurationMs(Number(e.target.value))} className="w-28" />
            <span className="text-[10px] font-mono text-zinc-400 w-10 text-right">{durationMs}ms</span>
          </label>
          <select
            value={effectId}
            onChange={(e) => setEffectId(e.target.value)}
            className="h-8 px-2 rounded-md text-xs border"
            style={{ background: "#1a2020", borderColor: "#2a3232", color: "#e4e4e7" }}
            title="Transition style"
          >
            {EFFECTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

function SlideCard({
  verses, translationCode, refFormat, view, size, staged, aiBadge, onClick, onDoubleClick,
}: {
  verses: Verse[];
  translationCode: string;
  refFormat: "reference" | "with_text";
  view: "grid" | "list";
  size: number;
  staged?: boolean;
  aiBadge?: { confidence: number; translation?: string };
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const first = verses[0];
  const last = verses[verses.length - 1];
  const label = refLabel(first, last, translationCode);
  const text = verses.map((v) => v.text).join(" ");
  const isGrid = view === "grid";
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "text-left rounded-md border-2 transition-all overflow-hidden flex flex-col",
        staged ? "border-teal-400 ring-2 ring-teal-400/40" : "border-zinc-800 hover:border-zinc-600",
      )}
      style={{
        background: "#0a0e0e",
        color: "#f7f7f8",
        minHeight: isGrid ? Math.round(size * 9 / 16) : 68,
        padding: isGrid ? 14 : 10,
      }}
    >
      {aiBadge && (
        <div className="mb-1 inline-flex items-center gap-1 text-[10px] font-mono self-start rounded-sm px-1.5 py-0.5"
          style={{ background: "rgba(16,185,129,0.18)", color: "#6ee7b7" }}>
          <Sparkles className="w-2.5 h-2.5" /> AI Detected · {aiBadge.confidence}%
          {aiBadge.translation && <span className="ml-1 text-emerald-200/80">{aiBadge.translation}</span>}
        </div>
      )}
      {refFormat === "with_text" && (
        <div className={cn("flex-1", isGrid ? "text-[13px] leading-snug" : "text-[12px] leading-snug")}
          style={{ display: "-webkit-box", WebkitLineClamp: isGrid ? 6 : 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {text}
        </div>
      )}
      <div className={cn("mt-2 text-[10px] font-mono", refFormat === "reference" ? "text-white text-base" : "text-zinc-400")}>
        {label}
      </div>
    </button>
  );
}
