"use client";
/**
 * ProPresenter-style operator shell composition.
 * Pure visual composer over the existing OperatorShellCtx prop bag —
 * all state and handlers still live in OperatorConsole.
 *
 * Zone layout:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  TopBar (44px)                                           │
 *   ├──────┬─────────────────────────────────┬─────────────────┤
 *   │ Left │  Center (slide grid / Bible)    │  Right sidebar  │
 *   │ ~160 │                                 │   ~300px        │
 *   ├──────┴─────────────────────────────────┴─────────────────┤
 *   │  BottomBar (40px)                                        │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  MediaStrip (140px, collapsible)                         │
 *   └──────────────────────────────────────────────────────────┘
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { OperatorShellCtx } from "../shell/types";
import { OperatorErrorBoundary } from "../OperatorErrorBoundary";
import { TopBar } from "./TopBar";
import { LibrarySection } from "./left/LibrarySection";
import { PlaylistSection } from "./left/PlaylistSection";
import { MediaSection } from "./left/MediaSection";
import { CenterHeader } from "./center/CenterHeader";
import { SlideGrid } from "./center/SlideGrid";
import { BibleMode } from "./center/BibleMode";
import { SongsBrowser } from "./center/SongsBrowser";
import { MediaBrowser } from "./center/MediaBrowser";
import { LivePreviewPanel } from "./right/LivePreviewPanel";
import { OutputRoutingRow } from "./right/OutputRoutingRow";
import { RightTabs } from "./right/RightTabs";
import { AIDetectionsPanel } from "./right/AIDetectionsPanel";
import { BottomBar } from "./BottomBar";
import { MediaStrip } from "./MediaStrip";
import { useTimerSession, useMessagesSession, useBibleSession } from "./hooks";
import { openLiveChannel, safePost } from "@/lib/broadcast";
import { cachedLookup } from "@/lib/bible-client-cache";
import { cn } from "@/lib/utils";
import { useOperatorHotkeys } from "@/hooks/useOperatorHotkeys";
import { ShortcutsHelpOverlay } from "./ShortcutsHelpOverlay";
import { AICaptionsBanner } from "./AICaptionsBanner";
import { UpdateBanner } from "./UpdateBanner";
import { AudioDebugOverlay } from "../dev/AudioDebugOverlay";
import { useDebouncedInterim } from "./useDebouncedInterim";
import { CONFIDENCE_THRESHOLD } from "@/lib/audio-thresholds";
import { OperatorTour, hasSeenTour } from "@/components/tutorial/OperatorTour";
import { dispatchInternal, isInternalEvent } from "@/lib/internal-events";

// PF trace gate (R2). Mirrors useAudioStream.isDevOrTraceOn — cheap re-impl
// here so the shell doesn't have to receive it via ctx.
function pfTraceOn(): boolean {
  try {
    if (process.env.NODE_ENV !== "production") return true;
    if (typeof localStorage === "undefined") return false;
    const raw = localStorage.getItem("presentflow.aiTrace");
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as { value?: string; exp?: number };
      if (parsed && typeof parsed === "object" && "value" in parsed) {
        if (typeof parsed.exp === "number" && Date.now() > parsed.exp) return false;
        return parsed.value === "1";
      }
    } catch { /* fall through */ }
    return raw === "1";
  } catch { return false; }
}

/**
 * centerMode drives what fills the center pane.
 *   "slides"  → default SlideGrid for the current playlist item
 *   "bible"   → BibleMode (Reference lookup + 66-book Browse)
 *   "songs"   → SongsBrowser (inline song library)
 *   "media"   → MediaBrowser (inline media library)
 * Legacy value "playlist" is aliased to "slides" so older stored state /
 * external callers keep working.
 */
export type CenterMode = "slides" | "bible" | "songs" | "media";

const MEDIA_STRIP_KEY = "presentflow.pro.mediaStripOpen";
const SLIDE_SIZE_KEY = "presentflow.pro.slideSize";
const SAFE_MODE_KEY = "presentflow.operator.safeMode";

/**
 * Compact transcript + AI detection strip pinned above BottomBar.
 * Shows last ~120 chars of transcript (rolling), + up to 3 latest scripture
 * detections as small verse chips with an "AI" badge and confidence %.
 * Hidden entirely when AI listener is idle to keep the shell clean.
 */
function AITranscriptTicker({ ctx }: { ctx: OperatorShellCtx }) {
  const audio = ctx.audio;

  const threshold = ctx.confidenceThreshold ?? 50;
  const scriptureCards = audio.suggestions
    .filter((s) => s.type === "scripture" && s.confidence >= threshold)
    .slice(0, 3);
  const songCards = audio.suggestions
    .filter((s) => (s.type === "song" || s.type === "lyric") && s.confidence >= threshold)
    .slice(0, 3);

  // Playlist-aware highlight: songs already in plan are marked in-playlist.
  const playlistSongIds = new Set(
    ctx.plan.items
      .filter((it) => it.type === "song" && it.songId)
      .map((it) => it.songId as string),
  );

  const scrollToPlaylistSong = (songId: string) => {
    const idx = ctx.plan.items.findIndex((it) => it.type === "song" && it.songId === songId);
    if (idx < 0) return;
    ctx.onSetPreviewItem(idx);
    if (typeof window !== "undefined") {
      const el = document.querySelector(`[data-playlist-item-idx="${idx}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("presentflow-song-pulse");
        setTimeout(() => el.classList.remove("presentflow-song-pulse"), 2000);
      }
    }
  };

  const handleSongChipClick = (songId: string, songTitle: string, inPlaylist: boolean) => {
    if (inPlaylist) {
      scrollToPlaylistSong(songId);
      return;
    }
    if (ctx.onAddLibraryItem) {
      // Load slides into the plan; the reload triggered by onAddLibraryItem
      // will surface the new item at the end of the playlist. Do NOT
      // auto-project — per CLAUDE.md rule 7, songs never auto-project.
      void ctx.onAddLibraryItem("song", { id: songId, title: songTitle });
    }
  };

  // CLAUDE.md rule 7 — songs never auto-project. Do not change without sign-off.
  const handleSongChipDoubleClick = (songId: string, songTitle: string, inPlaylist: boolean) => {
    // Safety: even with Safe Mode OFF, songs must NOT auto-send-to-live.
    // Double-click = "load + preview first slide" only. Copyright safety.
    handleSongChipClick(songId, songTitle, inPlaylist);
  };

  // The rolling transcript text has moved to the right-sidebar
  // LiveTranscriptPanel; the AI Live pill in the top-right is the connection
  // status indicator. This strip is now purely an actionable chip row, so
  // hide it entirely when there's nothing to act on.
  if (scriptureCards.length === 0 && songCards.length === 0) return null;

  return (
    <div
      className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 flex items-center gap-3 min-h-[32px]"
      data-testid="ai-transcript-ticker"
    >
      <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)] shrink-0">
        AI chips
      </span>
      {scriptureCards.length > 0 && (
        <div className="flex items-center gap-1.5 shrink-0">
          {scriptureCards.map((s) => {
            if (s.type !== "scripture") return null;
            const ref = `${s.ref.book} ${s.ref.chapter}:${s.ref.verseStart}${s.ref.verseEnd !== s.ref.verseStart ? `-${s.ref.verseEnd}` : ""}`;
            return (
              <div
                key={s.id}
                title={`${ref} (${s.confidence}%)`}
                className="relative flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--color-brand)] bg-[var(--color-elevated)] text-[11px]"
              >
                <span className="font-semibold">{ref}</span>
                <span className="text-[9px] font-mono opacity-60">{s.confidence}%</span>
                <span
                  className="ml-1 text-[8px] font-bold px-1 py-[1px] rounded bg-[var(--color-success,#10b981)] text-white"
                  aria-label="AI detected"
                >
                  AI
                </span>
              </div>
            );
          })}
        </div>
      )}
      {songCards.length > 0 && (
        <div className="flex items-center gap-1.5 shrink-0" data-testid="ai-song-chips">
          {songCards.map((s) => {
            if (s.type !== "song" && s.type !== "lyric") return null;
            const songId = s.match.songId;
            const title = s.match.title;
            const inPlaylist = playlistSongIds.has(songId);
            const rawTip = inPlaylist
              ? `${title} — already in playlist (${s.confidence}%)`
              : `${title} (${s.confidence}%) — click to add`;
            // Y8: keep tooltip DOM attr from ballooning on very long song titles.
            const tip = rawTip.length > 120 ? rawTip.slice(0, 117) + "…" : rawTip;
            // Y6: full a11y label — screen readers get title + confidence +
            // playlist state + affordance.
            const ariaLabel = `${title}, ${s.confidence}% match${inPlaylist ? ", already in playlist" : ", click to add"}`;
            return (
              <button
                key={s.id}
                type="button"
                data-in-playlist={inPlaylist ? "true" : "false"}
                title={tip}
                aria-label={ariaLabel}
                onClick={() => handleSongChipClick(songId, title, inPlaylist)}
                onDoubleClick={() => handleSongChipDoubleClick(songId, title, inPlaylist)}
                className={
                  "relative flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] " +
                  (inPlaylist
                    ? "border border-amber-400/70 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
                    : "border border-[var(--color-brand)] bg-[var(--color-elevated)] hover:bg-[var(--color-panel)]")
                }
              >
                <span aria-hidden className="text-[11px] leading-none">♪</span>
                <span className="font-semibold max-w-[160px] truncate">{title}</span>
                <span className="text-[9px] font-mono opacity-60">{s.confidence}%</span>
                <span
                  className="ml-1 text-[8px] font-bold px-1 py-[1px] rounded bg-[var(--color-success,#10b981)] text-white"
                  aria-label="AI detected"
                >
                  AI
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Live transcript panel — auto-scrolling feed of the last ~30s of transcript
 * (interim + final). Sits between LivePreviewPanel and RecentDetectionsPanel
 * in the right sidebar. Small monospace-adjacent font so the operator can
 * glance at what the mic is actually hearing without leaving the shell.
 */
function LiveTranscriptPanel({ ctx }: { ctx: OperatorShellCtx }) {
  const audio = ctx.audio;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recent = audio.transcript.slice(-8);
  const now = Date.now();
  // Keep only the last 30s of finals for the visible window.
  const windowed = recent.filter((t) => now - t.ts < 30_000);
  // Task 8: debounce interim renders to ≥3 char OR ≥300ms delta.
  const interim = useDebouncedInterim(audio.interim, 3, 300);
  const hasContent = windowed.length > 0 || !!interim;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [audio.transcript, interim]);

  const isRecording = audio.listening && audio.ready;

  return (
    <div className="border-t border-[var(--color-border)] px-2 py-2" data-testid="live-transcript-panel">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Live transcript
        </span>
        {isRecording && (
          <span
            aria-label="recording"
            className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 pf-ai-live-dot"
          />
        )}
      </div>
      <div
        ref={scrollRef}
        className="h-[96px] overflow-y-auto rounded bg-[var(--color-elevated)] border border-[var(--color-border)] px-2 py-1 text-[12px] leading-snug"
        style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      >
        {!hasContent ? (
          <div className="text-[11px] italic text-[var(--color-muted-foreground)] py-1">
            {audio.listening ? "Listening…" : "Say something with AI Live on…"}
          </div>
        ) : (
          <>
            {windowed.map((t) => (
              <div key={t.id} className="text-[var(--color-foreground)] break-words">
                {t.text}
              </div>
            ))}
            {interim && (
              <div className="text-[var(--color-muted-foreground)] break-words opacity-70">
                {interim}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function ProOperatorShell({ ctx }: { ctx: OperatorShellCtx }) {
  const [centerMode, setCenterMode] = useState<CenterMode>("slides");
  const [mediaStripOpen, setMediaStripOpen] = useState(true);
  const [slideSize, setSlideSize] = useState(160);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // Y2: debounce Safe Mode "swallowed Enter" toast to once per 3s so a stuck
  // Enter key doesn't spam the operator.
  const lastSafeToastRef = useRef(0);

  useEffect(() => {
    try {
      const s = window.localStorage.getItem(MEDIA_STRIP_KEY);
      if (s === "0") setMediaStripOpen(false);
      const sz = window.localStorage.getItem(SLIDE_SIZE_KEY);
      if (sz) setSlideSize(Math.max(96, Math.min(240, parseInt(sz, 10) || 160)));
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(MEDIA_STRIP_KEY, mediaStripOpen ? "1" : "0");
    } catch { /* noop */ }
  }, [mediaStripOpen]);

  useEffect(() => {
    // Y9: single source of truth is the `slideSize` prop plumbed to
    // SlideGrid. The CSS var was redundant and drifted from the prop.
    try { window.localStorage.setItem(SLIDE_SIZE_KEY, String(slideSize)); } catch { /* noop */ }
  }, [slideSize]);

  // Task 6: Settings > Audio "Restart AI listener" button dispatches a
  // window event; forward to ctx.onRestartAudio.
  // Y1: depend on ctx.onRestartAudio only (not entire ctx) to avoid re-render churn.
  const onRestartAudio = ctx.onRestartAudio;
  useEffect(() => {
    const h = () => { onRestartAudio?.(); };
    window.addEventListener("presentflow:restart-audio", h);
    return () => window.removeEventListener("presentflow:restart-audio", h);
  }, [onRestartAudio]);

  // Global safety net: any promise that rejects without a handler OR any
  // synchronous throw outside a React tree normally shows up as a red dev
  // overlay AND leaves the operator staring at a silent void. Surface both
  // as a toast so at least the operator knows something's wrong + the
  // support-log line is grep-able.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let recentToasts = 0;
    const bump = () => {
      recentToasts++;
      setTimeout(() => { recentToasts = Math.max(0, recentToasts - 1); }, 3000);
      return recentToasts <= 3; // suppress after 3 in 3s so we don't spam
    };
    const onRej = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const msg = reason instanceof Error ? reason.message : String(reason ?? "unhandled rejection");
      console.error("[operator-global-error] unhandledrejection:", msg, reason);
      if (bump()) toast.error(`Background task failed: ${msg.slice(0, 120)}`);
    };
    const onErr = (e: ErrorEvent) => {
      // React error boundaries catch render errors; this catches
      // event-handler throws and native-callback errors.
      const msg = e.message || String(e.error ?? "unknown error");
      console.error("[operator-global-error] window.onerror:", msg, e.error);
      if (bump()) toast.error(`Runtime error: ${msg.slice(0, 120)}`);
    };
    window.addEventListener("unhandledrejection", onRej);
    window.addEventListener("error", onErr);
    return () => {
      window.removeEventListener("unhandledrejection", onRej);
      window.removeEventListener("error", onErr);
    };
  }, []);

  // Task 9: warm-start the audio pipeline on operator mount (mic muted).
  // First user-toggle then flips from warm → live with zero handshake wait.
  useEffect(() => {
    ctx.onWarmStartAudio?.();
    // Intentionally mount-once; ctx changes shouldn't retrigger warm-start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // R1/R2/Y2: block auto-approve when a low-confidence word actually falls
  // INSIDE the detection's matched span (not the whole utterance). Match by
  // segmentId first — only words from the same transcript chunk as the
  // suggestion's source segment count. If word timestamps or matchedSpan is
  // missing we FAIL OPEN (don't block) — better a false positive than
  // silently blocking every suggestion containing "the".
  const lowConfBlockedSpans = useMemo<Set<string>>(() => {
    const blocked = new Set<string>();
    const transcript = ctx.audio.transcript;
    const suggestions = ctx.audio.suggestions;
    // Build fast lookup: segmentId -> chunk (finals only).
    const bySeg = new Map<string, typeof transcript[number]>();
    for (const t of transcript) bySeg.set(t.id, t);
    for (const s of suggestions) {
      if (s.type !== "scripture") continue;
      const chunk = bySeg.get(s.segmentId);
      // No matching final chunk (e.g. interim segment) → fail open.
      if (!chunk) continue;
      // Server dropped word telemetry (500+ words trimmed on a very long
      // utterance) — fail CLOSED. We can't rule out low-conf fillers in the
      // span without word data, and mis-projecting a bogus verse mid-service
      // is worse than a false-positive block that operator can override.
      if (chunk.wordsDropped) { blocked.add(s.id); continue; }
      if (!chunk.words || chunk.words.length === 0) continue;
      const span = s.matchedSpan;
      // No span info → fail open.
      if (!span) continue;
      // Compute char offset for each word within the transcript text.
      // Deepgram's w might repeat within text; scan left-to-right.
      const lowWords = chunk.words.filter((w) => typeof w.c === "number" && w.c < CONFIDENCE_THRESHOLD);
      if (lowWords.length === 0) continue;
      const text = chunk.text;
      let cursor = 0;
      let hitSpan = false;
      for (const w of chunk.words) {
        const wStr = w.w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
        if (!wStr) continue;
        const idx = text.toLowerCase().indexOf(wStr.toLowerCase(), cursor);
        if (idx < 0) continue;
        const wStart = idx;
        const wEnd = idx + wStr.length;
        cursor = wEnd;
        // Overlap with matched span?
        const overlaps = wStart < span.end && wEnd > span.start;
        if (!overlaps) continue;
        if (typeof w.c === "number" && w.c < CONFIDENCE_THRESHOLD) {
          hitSpan = true;
          if (pfTraceOn()) console.log(`[autopilot] blocked — low-confidence word "${w.w}" in matched span for ${s.id}`);
          break;
        }
      }
      if (hitSpan) blocked.add(s.id);
    }
    return blocked;
  }, [ctx.audio.transcript, ctx.audio.suggestions]);

  // R4/R5: session hooks live at the shell so state survives tab/mode swap.
  const timer = useTimerSession();
  const messages = useMessagesSession();
  const bibleSession = useBibleSession(ctx.defaultTranslationCode);

  // F1/F2: publish timer + message overlays to the live/stage/livestream outputs
  // via BroadcastChannel. The output pages already know how to render these —
  // ProOperatorShell just wasn't posting. Channel is same-machine only per
  // CLAUDE.md rule 8 (primary sync path).
  const overlayChRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    overlayChRef.current = openLiveChannel();
    return () => { try { overlayChRef.current?.close(); } catch { /* noop */ } overlayChRef.current = null; };
  }, []);

  // Publish messages when show toggled or text changes while showing.
  // Track whether we've ever posted a message overlay so we don't spam
  // clear:true on every slide change while the message tab has never been
  // toggled on. Also: previewSlideIdx used to be in the dep list to keep
  // the {{currentSlide}} token fresh — moved to a ref so slide navigation
  // doesn't re-broadcast the same message overlay N times.
  const previewSlideIdxRef = useRef<number | undefined>(undefined);
  useEffect(() => { previewSlideIdxRef.current = ctx.previewSlideIdx; }, [ctx.previewSlideIdx]);
  const messagePostedRef = useRef(false);
  useEffect(() => {
    const ch = overlayChRef.current;
    if (!ch) return;
    if (messages.state.showing && messages.state.text.trim().length > 0) {
      // Simple {{time}}/{{date}}/{{currentSlide}} token expansion at post time.
      const now = new Date();
      const text = messages.state.text
        .replace(/\{\{time\}\}/g, now.toLocaleTimeString())
        .replace(/\{\{date\}\}/g, now.toLocaleDateString())
        .replace(/\{\{currentSlide\}\}/g, String((previewSlideIdxRef.current ?? 0) + 1));
      const DISMISS_MS: Record<string, number | null> = {
        "5s": 5000, "10s": 10000, "30s": 30000, "1min": 60000, "5min": 300000, manual: null,
      };
      safePost(ch, { type: "message", overlay: { text, dismissAfterMs: DISMISS_MS[messages.state.dismiss] ?? null } });
      messagePostedRef.current = true;
    } else if (messagePostedRef.current) {
      // Only broadcast clear:true after at least one show — otherwise every
      // slide navigation on a fresh operator would spam `{clear:true}`.
      safePost(ch, { type: "message", overlay: { clear: true } });
      messagePostedRef.current = false;
    }
  }, [messages.state.showing, messages.state.text, messages.state.dismiss]);

  // Publish timer at ~2Hz while running, plus edge on run/stop/reset.
  // Read `remaining` via a ref inside the interval — putting it in the dep
  // list re-created the interval on every tick, so setInterval never
  // actually fired (was accidentally driven by dep-change edges only).
  const timerStateRef = useRef(timer.state);
  useEffect(() => { timerStateRef.current = timer.state; }, [timer.state]);
  useEffect(() => {
    const ch = overlayChRef.current;
    if (!ch) return;
    const post = () => {
      const s = timerStateRef.current;
      safePost(ch, {
        type: "timer",
        overlay: {
          name: s.name,
          remainingSec: Math.max(-3600, Math.min(24 * 60 * 60, Math.round(s.remaining))),
          running: s.running,
          kind: s.type === "elapsed" ? "elapsed" : "countdown",
        },
      });
    };
    post();
    if (!timer.state.running) return;
    const id = setInterval(post, 500);
    return () => clearInterval(id);
  }, [timer.state.running, timer.state.name, timer.state.type]);

  // Auto-route AI scripture detections into the Bible session so switching
  // into Bible mode shows the detected passage immediately — even if the
  // operator was on the slides / songs / media tab when it fired.
  const lastRoutedScriptureRef = useRef<string | null>(null);
  useEffect(() => {
    const suggestions = ctx.audio.suggestions;
    if (!suggestions || suggestions.length === 0) return;
    const threshold = ctx.confidenceThreshold ?? 50;
    // Newest first (unshift in useAudioStream). Find the freshest confident
    // scripture suggestion.
    const scripture = suggestions.find((s) => s.type === "scripture" && s.confidence >= threshold);
    if (!scripture || scripture.type !== "scripture") return;
    const key = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}-${scripture.ref.verseEnd}`;
    if (lastRoutedScriptureRef.current === key) return;
    lastRoutedScriptureRef.current = key;
    // Optimistic render: show a placeholder card immediately so operator sees
    // detection landed before the DB roundtrip completes. Cache-hit path
    // resolves synchronously below and overwrites — no visible flicker.
    const label = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}${scripture.ref.verseStart !== scripture.ref.verseEnd ? `-${scripture.ref.verseEnd}` : ""} (${bibleSession.state.translation})`;
    bibleSession.setRef(key);
    bibleSession.setCards([{
      id: `ai-placeholder-${key}`,
      label,
      verses: [{ verse: scripture.ref.verseStart, text: "Loading…" }],
      placeholder: true, // R8: never auto-fire the loading card
    }]);
    bibleSession.setSelectedIdx(0);
    (async () => {
      try {
        const res = await cachedLookup({
          book: scripture.ref.book,
          chapter: scripture.ref.chapter,
          verseStart: scripture.ref.verseStart,
          verseEnd: scripture.ref.verseEnd,
          translationCode: bibleSession.state.translation,
        });
        const verses = res.verses;
        const finalLabel = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}${scripture.ref.verseStart !== scripture.ref.verseEnd ? `-${scripture.ref.verseEnd}` : ""} (${res.translation})`;
        const cards = verses.map((v, i) => ({
          id: `ai-${finalLabel}-${i}`,
          label: `${scripture.ref.book} ${scripture.ref.chapter}:${v.verse} (${res.translation})`,
          verses: [{ verse: v.verse, text: v.text }],
        }));
        if (cards.length === 0) {
          // lookup came back empty — replace placeholder with error card.
          // R8: mark as placeholder so auto-fire skips.
          bibleSession.setCards([{
            id: `ai-error-${key}`,
            label,
            verses: [{ verse: scripture.ref.verseStart, text: "(no verse text available)" }],
            placeholder: true,
          }]);
          return;
        }
        bibleSession.setCards(cards);
        bibleSession.setSelectedIdx(0);
      } catch {
        bibleSession.setCards([{
          id: `ai-error-${key}`,
          label,
          verses: [{ verse: scripture.ref.verseStart, text: "(lookup failed)" }],
          placeholder: true,
        }]);
      }
    })();
  }, [ctx.audio.suggestions, ctx.confidenceThreshold, bibleSession]);

  // ── Auto-approve → INSTANT LIVE for scripture ─────────────────────────────
  // Y3: auto-approve flag lives in sessionStorage now (was localStorage). XSS
  // can no longer pre-arm auto-live across tab restarts.
  // R3: 4s min-gap between auto-fires with a single-slot displacement queue.
  // R4: auto-advance interval clears on AutoApprove OFF via custom event.
  // R5: fired-refs persisted to sessionStorage so remounts don't replay.
  // R7: try/catch onSendSlideToLive; surface a re-auth toast on failure.
  // R8: skip placeholder cards (loading / no-text / lookup-failed).
  // R9: unconditionally clear prior interval at the top of the effect body.
  // Y4: useEvent-like ref pattern for ctx.onSendSlideToLive.
  // Y8: "Hold Bible auto-approve during active song" (default OFF) setting.
  const AUTO_APPROVE_KEY_INSTANT = "presentflow.pro.autoApprove.v1";
  const AUTO_ADVANCE_KEY = "presentflow.pro.autoAdvanceSec.v1";
  const AUTO_FIRE_MIN_GAP_KEY = "presentflow.pro.autoFireMinGap.v1"; // R3
  const AUTO_FIRED_SESSION_KEY = "presentflow.pro.autoFired.v1"; // R5
  const HOLD_DURING_SONG_KEY = "presentflow.pro.holdAutoApproveDuringSong.v1"; // Y8
  const DEFAULT_MIN_GAP_MS = 4000;

  // Y4: latest send/kill callbacks captured in refs so stale closures in the
  // interval / queued timer don't fire against a dead callback.
  const sendLiveRef = useRef(ctx.onSendSlideToLive);
  useEffect(() => { sendLiveRef.current = ctx.onSendSlideToLive; });

  // R3: rate-limit bookkeeping.
  const lastAutoFireAtRef = useRef<number>(0);
  const queuedAutoFireRef = useRef<{ slide: import("@/lib/broadcast").SlidePayload; key: string; ref: string; conf: number } | null>(null);
  const queuedTimerRef = useRef<number | null>(null);
  const autoAdvanceIntervalRef = useRef<number | null>(null); // R4/R9
  const lastAutoLiveKeyRef = useRef<string | null>(null);
  const lastLiveWasSongRef = useRef<boolean>(false); // Y8

  // Y8: track whether the last live slide came from a song so we can hold
  // Bible auto-fires during song playback if the operator has opted in.
  useEffect(() => {
    // Heuristic: the ctx doesn't tell us directly, but songs are always sent
    // as text slides with the current live slide populated. We just mirror
    // the current live kind — the shell caller flips lastLiveWasSongRef when
    // it sends a song manually. This is a best-effort hook.
    if (ctx.liveSlide?.kind === "empty") lastLiveWasSongRef.current = false;
  }, [ctx.liveSlide]);

  // R7: wrap send with error handling + toast.
  const safeSendLive = useCallback((slide: import("@/lib/broadcast").SlidePayload): boolean => {
    try {
      const res = sendLiveRef.current(slide) as unknown;
      // Support async callbacks.
      if (res && typeof (res as { then?: unknown }).then === "function") {
        (res as Promise<unknown>).catch(() => {
          toast.error("Live output failed — sign in again to resume");
        });
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Live output failed";
      if (/401|auth|sign in/i.test(msg)) {
        toast.error("AI listener needs re-auth — sign in again to resume");
      } else {
        toast.error(`Live output failed — ${msg}`);
      }
      return false;
    }
  }, []);

  // R3: fire helper — enforces min-gap, queues newer detections.
  const doAutoFire = useCallback((slide: import("@/lib/broadcast").SlidePayload, key: string, ref: string, conf: number) => {
    let minGap = DEFAULT_MIN_GAP_MS;
    try {
      const raw = window.localStorage.getItem(AUTO_FIRE_MIN_GAP_KEY);
      const parsed = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed) && parsed >= 0) minGap = parsed;
    } catch { /* noop */ }
    const now = Date.now();
    const wait = lastAutoFireAtRef.current + minGap - now;
    if (wait <= 0) {
      lastAutoFireAtRef.current = now;
      if (pfTraceOn()) console.log("[auto-approve] firing:", ref, conf);
      safeSendLive(slide);
      // R5: persist fired key to sessionStorage (5min replay window).
      try {
        const raw = window.sessionStorage.getItem(AUTO_FIRED_SESSION_KEY);
        const map: Record<string, number> = raw ? JSON.parse(raw) : {};
        map[key] = now;
        // Trim entries older than 30min on write.
        const cutoff = now - 30 * 60 * 1000;
        for (const k of Object.keys(map)) if (map[k] < cutoff) delete map[k];
        window.sessionStorage.setItem(AUTO_FIRED_SESSION_KEY, JSON.stringify(map));
      } catch { /* noop */ }
      return;
    }
    // Queued: newer displaces older (single-slot).
    if (queuedAutoFireRef.current && pfTraceOn()) {
      console.log("[auto-approve] displaced by newer:", queuedAutoFireRef.current.ref, "->", ref);
    }
    queuedAutoFireRef.current = { slide, key, ref, conf };
    if (queuedTimerRef.current !== null) { window.clearTimeout(queuedTimerRef.current); queuedTimerRef.current = null; }
    queuedTimerRef.current = window.setTimeout(() => {
      queuedTimerRef.current = null;
      const q = queuedAutoFireRef.current;
      queuedAutoFireRef.current = null;
      if (!q) return;
      // Re-check auto-approve is still on before firing the queued one (R4).
      try {
        if (window.sessionStorage.getItem(AUTO_APPROVE_KEY_INSTANT) !== "1"
            && window.localStorage.getItem(AUTO_APPROVE_KEY_INSTANT) !== "1") return;
      } catch { /* noop */ }
      lastAutoFireAtRef.current = Date.now();
      if (pfTraceOn()) console.log("[auto-approve] firing (queued):", q.ref, q.conf);
      safeSendLive(q.slide);
    }, wait);
  }, [safeSendLive]);

  // R4: clear all auto-advance state on AutoApprove OFF.
  const clearAutoAdvance = useCallback(() => {
    if (autoAdvanceIntervalRef.current !== null) {
      window.clearInterval(autoAdvanceIntervalRef.current);
      autoAdvanceIntervalRef.current = null;
    }
    if (queuedTimerRef.current !== null) {
      window.clearTimeout(queuedTimerRef.current);
      queuedTimerRef.current = null;
    }
    queuedAutoFireRef.current = null;
  }, []);

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ on: boolean }>).detail;
      if (detail && detail.on === false) clearAutoAdvance();
    };
    window.addEventListener("presentflow:auto-approve-changed", handler);
    return () => window.removeEventListener("presentflow:auto-approve-changed", handler);
  }, [clearAutoAdvance]);

  useEffect(() => {
    // R9: unconditionally clear prior interval before any early return.
    if (autoAdvanceIntervalRef.current !== null) {
      window.clearInterval(autoAdvanceIntervalRef.current);
      autoAdvanceIntervalRef.current = null;
    }

    const cards = bibleSession.state.cards;
    if (cards.length === 0) return;
    // Y3: auto-approve now in sessionStorage; fall back to localStorage for
    // migration so existing operators aren't dropped mid-service.
    let autoOn = false;
    try {
      autoOn = window.sessionStorage.getItem(AUTO_APPROVE_KEY_INSTANT) === "1"
        || window.localStorage.getItem(AUTO_APPROVE_KEY_INSTANT) === "1";
    } catch { /* noop */ }
    if (!autoOn) return;
    // Y8: hold auto-fire during active song if operator opted in.
    let holdDuringSong = false;
    try { holdDuringSong = window.localStorage.getItem(HOLD_DURING_SONG_KEY) === "1"; } catch { /* noop */ }
    if (holdDuringSong && lastLiveWasSongRef.current && ctx.liveSlide?.kind === "text") {
      if (pfTraceOn()) console.log("[auto-approve] held (song active)");
      return;
    }
    // Need a matching high-confidence detection
    const suggestions = ctx.audio.suggestions || [];
    const scripture = suggestions.find((s) => s.type === "scripture" && s.confidence >= 85 && !lowConfBlockedSpans.has(s.id));
    if (!scripture || scripture.type !== "scripture") return;
    const first = cards[0];
    // R8: skip placeholder cards (loading / no-text / lookup-failed) AND
    // empty-text guard as belt-and-braces.
    if (!first || first.placeholder === true || !first.verses?.length) return;
    const firstText = first.verses[0]?.text ?? "";
    if (!firstText || firstText === "Loading…" || firstText.length === 0) return;

    const key = first.id;
    // R5: check sessionStorage for recent replays (5 min TTL).
    try {
      const raw = window.sessionStorage.getItem(AUTO_FIRED_SESSION_KEY);
      const map: Record<string, number> = raw ? JSON.parse(raw) : {};
      const firedAt = map[key];
      if (typeof firedAt === "number" && Date.now() - firedAt < 5 * 60 * 1000) {
        // Already fired this key within 5 min — don't replay across remount.
        lastAutoLiveKeyRef.current = key;
        return;
      }
    } catch { /* noop */ }
    if (lastAutoLiveKeyRef.current === key) return;
    lastAutoLiveKeyRef.current = key;

    const body = first.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
    const slide: import("@/lib/broadcast").SlidePayload = { kind: "text", text: `${body}\n\n${first.label}` };
    const ref = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}${scripture.ref.verseEnd !== scripture.ref.verseStart ? `-${scripture.ref.verseEnd}` : ""}`;
    doAutoFire(slide, key, ref, scripture.confidence);
    bibleSession.setSelectedIdx(0);
    lastLiveWasSongRef.current = false;

    // Optional auto-advance
    let intervalSec = 0;
    try { intervalSec = Math.max(0, parseInt(window.localStorage.getItem(AUTO_ADVANCE_KEY) || "0", 10) || 0); } catch { /* noop */ }
    if (intervalSec > 0 && cards.length > 1) {
      let i = 1;
      const iv = window.setInterval(() => {
        // R4 belt-and-braces: if operator flipped AutoApprove OFF, stop.
        try {
          if (window.sessionStorage.getItem(AUTO_APPROVE_KEY_INSTANT) !== "1"
              && window.localStorage.getItem(AUTO_APPROVE_KEY_INSTANT) !== "1") {
            window.clearInterval(iv);
            autoAdvanceIntervalRef.current = null;
            return;
          }
        } catch { /* noop */ }
        if (i >= cards.length) { window.clearInterval(iv); autoAdvanceIntervalRef.current = null; return; }
        const c = cards[i];
        if (c.placeholder) { i += 1; return; } // R8
        const b = c.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
        safeSendLive({ kind: "text", text: `${b}\n\n${c.label}` });
        bibleSession.setSelectedIdx(i);
        i += 1;
      }, intervalSec * 1000);
      autoAdvanceIntervalRef.current = iv;
      return () => {
        window.clearInterval(iv);
        if (autoAdvanceIntervalRef.current === iv) autoAdvanceIntervalRef.current = null;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bibleSession.state.cards, ctx.audio.suggestions, ctx.liveSlide, doAutoFire, safeSendLive]);

  // ── Mode-switch live follow ──────────────────────────────────────────────
  // When operator switches centerMode AND auto-approve is ON, auto-send the
  // first available slide of the target mode's content. Empty target → no-op.
  const prevCenterModeRef = useRef(centerMode);
  useEffect(() => {
    if (prevCenterModeRef.current === centerMode) return;
    prevCenterModeRef.current = centerMode;
    let autoOn = false;
    try { autoOn = window.localStorage.getItem(AUTO_APPROVE_KEY_INSTANT) === "1"; } catch { /* noop */ }
    if (!autoOn) return;
    if (centerMode === "bible") {
      const cards = bibleSession.state.cards;
      const first = cards[0];
      if (first && first.verses?.length && first.verses[0].text !== "Loading…") {
        const body = first.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
        ctx.onSendSlideToLive({ kind: "text", text: `${body}\n\n${first.label}` });
      }
    } else if (centerMode === "slides") {
      const item = ctx.plan.items[ctx.previewItemIdx];
      const slide = item?.slides?.[0];
      if (slide) ctx.onSendSlideToLive(slide as unknown as import("@/lib/broadcast").SlidePayload);
    }
    // Songs / Media never auto-project (CLAUDE.md rule 7 + safety).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerMode]);

  // ── Bible-mode verse-nav bridge ──────────────────────────────────────────
  // BottomBar dispatches presentflow:bible-next / bible-prev events. If the
  // current cards list has another slot, move the cursor. If we're at the
  // edge (or only one card is loaded — the common case), advance the ref
  // itself and fetch: John 3:16 → John 3:17 → …
  useEffect(() => {
    if (centerMode !== "bible") return;
    const advanceRef = async (dir: 1 | -1) => {
      const parser = await import("@/lib/bible-parser");
      const parsed = parser.parseReference(bibleSession.state.ref);
      if (!parsed) return;
      // If ref is a whole chapter (verseEnd == null), advancing by "verse"
      // would silently narrow the display from all-verses to a single verse.
      // Refuse and hint the operator that whole-chapter mode uses passage nav.
      if (parsed.verseEnd == null) {
        toast.info("Whole-chapter passage — use Prev/Next Item for chapter navigation");
        return;
      }
      const nextVerse = parsed.verseStart + dir;
      if (nextVerse < 1) {
        toast.info("Start of chapter — use Prev Item for previous passage");
        return;
      }
      const newRef = `${parsed.book} ${parsed.chapter}:${nextVerse}`;
      bibleSession.setRef(newRef);
      // Trigger lookup via the same code path the Bible mode input uses.
      // 3s timeout so a slow Vercel response doesn't leave the operator's
      // "next verse" hotkey feeling dead. On timeout we toast so they know
      // to retry (the hotkey stays available — no state corruption).
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        // /api/bible/lookup expects book+chapter+verseStart+verseEnd, NOT a
        // pre-formatted ref string. Sending {ref, translation} previously
        // returned 400 and the catch silently swallowed it — that's why
        // Verse > appeared dead on chapter change but not verse change.
        const res = await fetch("/api/bible/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            book: parsed.book,
            chapter: parsed.chapter,
            verseStart: nextVerse,
            verseEnd: nextVerse,
            translationCode: bibleSession.state.translation,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          toast.error(err.error || "Verse lookup failed");
          return;
        }
        const data = await res.json() as { verses?: Array<{ verse: number; text: string }> };
        if (!data.verses || data.verses.length === 0) {
          toast.info(`No verse ${nextVerse} in ${parsed.book} ${parsed.chapter} — end of chapter?`);
          return;
        }
        const card = {
          id: `${newRef}-${Date.now()}`,
          label: `${newRef} (${bibleSession.state.translation})`,
          verses: data.verses,
        };
        bibleSession.setCards([card]);
        bibleSession.setSelectedIdx(0);
        sendLiveRef.current({ kind: "text", text: `${card.verses.map((v) => `${v.verse} ${v.text}`).join(" ")}\n\n${card.label}` });
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") {
          toast.error("Verse lookup slow — retrying");
        } else {
          toast.error(err instanceof Error ? err.message : "Verse lookup failed");
          console.error("[verse-nav] lookup failed:", err);
        }
      } finally {
        clearTimeout(timer);
      }
    };
    const send = (dir: 1 | -1) => {
      const cards = bibleSession.state.cards;
      const cur = bibleSession.state.selectedIdx ?? 0;
      // If more cards are loaded and we can move within them, do so.
      if (cards.length > 1) {
        const next = cur + dir;
        if (next >= 0 && next < cards.length) {
          bibleSession.setSelectedIdx(next);
          const c = cards[next];
          sendLiveRef.current({ kind: "text", text: `${c.verses.map((v) => `${v.verse} ${v.text}`).join(" ")}\n\n${c.label}` });
          return;
        }
      }
      // Otherwise walk the reference forward/backward by one verse.
      void advanceRef(dir);
    };
    // Y1: nonce-gated. Ignore any external dispatchEvent from page scripts.
    const nx = (ev: Event) => { if (!isInternalEvent(ev)) return; send(1); };
    const pv = (ev: Event) => { if (!isInternalEvent(ev)) return; send(-1); };
    window.addEventListener("presentflow:bible-next", nx);
    window.addEventListener("presentflow:bible-prev", pv);
    return () => {
      window.removeEventListener("presentflow:bible-next", nx);
      window.removeEventListener("presentflow:bible-prev", pv);
    };
  }, [centerMode, bibleSession]);

  // Priority 4 — global operator hotkeys.
  useOperatorHotkeys({
    onNext: () => {
      const item = ctx.plan.items[ctx.previewItemIdx];
      if (!item) return;
      const nextIdx = ctx.previewSlideIdx + 1;
      if (nextIdx < item.slides.length) {
        ctx.onJumpSlide(ctx.previewItemIdx, nextIdx);
      } else if (ctx.previewItemIdx + 1 < ctx.plan.items.length) {
        ctx.onJumpSlide(ctx.previewItemIdx + 1, 0);
      }
    },
    onPrev: () => {
      if (ctx.previewSlideIdx > 0) {
        ctx.onJumpSlide(ctx.previewItemIdx, ctx.previewSlideIdx - 1);
      } else if (ctx.previewItemIdx > 0) {
        const prev = ctx.plan.items[ctx.previewItemIdx - 1];
        if (prev) ctx.onJumpSlide(ctx.previewItemIdx - 1, Math.max(0, prev.slides.length - 1));
      }
    },
    onSendLive: () => ctx.onSendToLive(),
    onKillLive: () => ctx.onKill(),
    onBlank: () => ctx.onBlank(),
    onLogo: () => ctx.onLogo(),
    onOpenSearch: () => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("presentflow:open-search"));
      }
    },
    onSetCenterMode: (m) => {
      // "playlist" maps to the default "slides" grid.
      if (m === "playlist") setCenterMode("slides");
      else setCenterMode(m);
    },
    onJumpSlide: (idx) => {
      const item = ctx.plan.items[ctx.previewItemIdx];
      if (!item) return;
      if (idx < 0 || idx >= item.slides.length) return;
      ctx.onJumpSlide(ctx.previewItemIdx, idx);
    },
    onOpenShortcutsHelp: () => setShortcutsHelpOpen(true),
    isSafeMode: () => {
      try {
        const raw = window.localStorage.getItem(SAFE_MODE_KEY);
        return raw === "1"; // default OFF — single-click sends live
      } catch { return false; }
    },
    onSafeModeSwallowed: () => {
      // Y2: debounce to once per 3s. Warns the operator that Enter didn't
      // send-live and points at the escape hatch (Shift+Enter).
      const now = Date.now();
      if (now - lastSafeToastRef.current < 3000) return;
      lastSafeToastRef.current = now;
      toast.info("Safe Mode on — press Shift+Enter to send live, or toggle Safe Mode in Settings");
    },
    isSlideJumpEnabled: () => {
      // Only fire 1-9 when a playlist item with slides is selected AND we're
      // in the default slide grid (not Bible / Songs / Media browsers).
      if (centerMode !== "slides") return false;
      const item = ctx.plan.items[ctx.previewItemIdx];
      return !!(item && item.slides.length > 0);
    },
  });

  // Runtime hook for user-added voice commands. useAudioStream matches the
  // transcript against `presentflow.pro.voiceCommands.v1` and dispatches
  // `presentflow:voice-command` with { action, phrase }. Route the action to
  // the matching ctx callback + surface a toast so operator can see it fired.
  useEffect(() => {
    const handler = (ev: Event) => {
      // Y1: require internal nonce so an XSS/extension can't drive the shell.
      if (!isInternalEvent(ev)) return;
      const detail = (ev as CustomEvent<{ nonce: symbol; payload: { action: string; phrase: string } } | { action: string; phrase: string }>).detail as { payload?: { action: string; phrase: string }; action?: string; phrase?: string };
      const p = detail.payload ?? (detail as { action: string; phrase: string });
      if (!p || typeof p.action !== "string") return;
      const { action, phrase } = p;
      switch (action) {
        case "next_verse":
          if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("presentflow:hotkey-next"));
          break;
        case "prev_verse":
          if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("presentflow:hotkey-prev"));
          break;
        case "give_me_niv":
          if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("presentflow:switch-translation", { detail: { code: "NIV" } }));
          break;
        case "blank_screen":
          ctx.onBlank();
          break;
        case "kill_live":
          ctx.onKill();
          break;
        default:
          break;
      }
      toast.info(`Voice command: ${phrase ?? ""}`);
    };
    window.addEventListener("presentflow:voice-command", handler);
    return () => window.removeEventListener("presentflow:voice-command", handler);
  }, [ctx]);

  // Electron Help > Keyboard Shortcuts — main sends IPC, we open the overlay.
  useEffect(() => {
    const w = typeof window !== "undefined" ? (window as Window & { electronAPI?: { on: (c: string, h: () => void) => void; off: (c: string, h: () => void) => void } }) : undefined;
    const api = w?.electronAPI;
    if (!api) return;
    const handler = () => setShortcutsHelpOpen(true);
    api.on("shell:open-shortcuts-help", handler);
    return () => { try { api.off("shell:open-shortcuts-help", handler); } catch { /* noop */ } };
  }, []);

  // Guided tour: opens via Help > Guided Tutorial (IPC) or auto-opens on the
  // first desktop launch. LocalStorage flag `presentflow.tour.seen` gates the
  // auto-open so subsequent launches stay quiet.
  // Web-side: TopBar dispatches window "presentflow:open-tour" from the
  // logo/about menu. Bridge it to the tour opener regardless of Electron
  // availability so the button works in both shell and pure-web contexts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const winHandler = () => setTourOpen(true);
    window.addEventListener("presentflow:open-tour", winHandler);
    return () => window.removeEventListener("presentflow:open-tour", winHandler);
  }, []);

  useEffect(() => {
    const w = typeof window !== "undefined" ? (window as Window & { electronAPI?: { on: (c: string, h: () => void) => void; off: (c: string, h: () => void) => void } }) : undefined;
    const api = w?.electronAPI;
    if (!api) return;
    const handler = () => setTourOpen(true);
    api.on("shell:open-tour", handler);
    // Auto-show on first launch only.
    // Y4: 400ms is enough for the shell mount; polling/observers self-heal
    // late target measurements so we don't need the 800ms cushion.
    // Y5: never auto-pop the tour while a live rehearsal / service is already
    // projecting content — only when the projector is idle (empty).
    if (!hasSeenTour() && ctx.liveSlide?.kind === "empty") {
      const schedule = (cb: () => void) => {
        const w = window as Window & { requestIdleCallback?: (cb: IdleRequestCallback, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
        if (typeof w.requestIdleCallback === "function") {
          const id = w.requestIdleCallback(() => cb(), { timeout: 800 });
          return () => { try { w.cancelIdleCallback?.(id); } catch { /* noop */ } };
        }
        const t = window.setTimeout(cb, 400);
        return () => window.clearTimeout(t);
      };
      const cancel = schedule(() => setTourOpen(true));
      return () => {
        cancel();
        try { api.off("shell:open-tour", handler); } catch { /* noop */ }
      };
    }
    return () => { try { api.off("shell:open-tour", handler); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--color-app-bg)] text-[var(--color-foreground)]">
      <UpdateBanner liveSlide={ctx.liveSlide} listening={ctx.audio?.listening} />
      <AICaptionsBanner ctx={ctx} />
      <div data-tour="top">
        <TopBar
          centerMode={centerMode}
          onCenterMode={setCenterMode}
          onToggleMediaStrip={() => setMediaStripOpen((v) => !v)}
          mediaStripOpen={mediaStripOpen}
          ctx={ctx}
        />
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* LEFT */}
        <aside data-tour="left" className="w-40 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col overflow-y-auto">
          <LibrarySection onCenterMode={setCenterMode} />
          <PlaylistSection ctx={ctx} onCenterMode={setCenterMode} />
          <MediaSection onCenterMode={setCenterMode} />
        </aside>

        {/* CENTER */}
        <main data-tour="center" className="flex-1 min-w-0 flex flex-col bg-[var(--color-app-bg)]">
          <CenterHeader ctx={ctx} centerMode={centerMode} slideSize={slideSize} onSlideSize={setSlideSize} />
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* Error boundary per center-mode panel so a Bible/Songs/Media
                crash doesn't nuke the whole operator UI mid-service — the
                operator can hit "Reload panel" and keep going. */}
            <OperatorErrorBoundary fallbackLabel={`The ${centerMode} panel hit an error`}>
              {centerMode === "bible" ? (
                <BibleMode ctx={ctx} session={bibleSession} />
              ) : centerMode === "songs" ? (
                <SongsBrowser ctx={ctx} onExitToSlides={() => setCenterMode("slides")} />
              ) : centerMode === "media" ? (
                <MediaBrowser ctx={ctx} onExitToSlides={() => setCenterMode("slides")} />
              ) : (
                <SlideGrid ctx={ctx} slideSize={slideSize} />
              )}
            </OperatorErrorBoundary>
          </div>
        </main>

        {/* RIGHT */}
        <aside data-tour="right" className="w-[300px] shrink-0 border-l border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col overflow-hidden">
          {/* Task F polish pass: TopBar right cluster is now the single source of truth
              for output routing indicators. OutputRoutingRow retired from the sidebar to
              reduce duplication. Kept in-tree behind a localStorage flag for A/B: set
              `presentflow.pro.showRoutingRow=1` to re-enable. */}
          {typeof window !== "undefined" && window.localStorage.getItem("presentflow.pro.showRoutingRow") === "1" && (
            <OutputRoutingRow ctx={ctx} />
          )}
          <OperatorErrorBoundary fallbackLabel="Live preview panel error">
            <LivePreviewPanel ctx={ctx} />
          </OperatorErrorBoundary>
          <OperatorErrorBoundary fallbackLabel="Live transcript panel error">
            <LiveTranscriptPanel ctx={ctx} />
          </OperatorErrorBoundary>
          <OperatorErrorBoundary fallbackLabel="AI detections panel error">
            <AIDetectionsPanel ctx={ctx} />
          </OperatorErrorBoundary>
          <div className="flex-1 min-h-0 border-t border-[var(--color-border)]">
            <OperatorErrorBoundary fallbackLabel="Right sidebar tab error">
              <RightTabs ctx={ctx} timer={timer} messages={messages} />
            </OperatorErrorBoundary>
          </div>
        </aside>
      </div>

      <AITranscriptTicker ctx={ctx} />

      <div data-tour="bottom">
        <BottomBar
          ctx={ctx}
          onOpenShortcutsHelp={() => setShortcutsHelpOpen(true)}
          centerMode={centerMode}
        />
      </div>

      {mediaStripOpen && <MediaStrip onCenterMode={setCenterMode} />}

      <ShortcutsHelpOverlay open={shortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen} />
      <AudioDebugOverlay audio={ctx.audio} />
      <OperatorTour open={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}
