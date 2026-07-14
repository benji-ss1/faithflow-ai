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
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { OperatorShellCtx } from "../shell/types";
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
import { cachedLookup } from "@/lib/bible-client-cache";
import { cn } from "@/lib/utils";
import { useOperatorHotkeys } from "@/hooks/useOperatorHotkeys";
import { ShortcutsHelpOverlay } from "./ShortcutsHelpOverlay";
import { OperatorTour, hasSeenTour } from "@/components/tutorial/OperatorTour";

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
  const hasContent = windowed.length > 0 || !!audio.interim;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [audio.transcript, audio.interim]);

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
            {audio.interim && (
              <div className="text-[var(--color-muted-foreground)] break-words opacity-70">
                {audio.interim}
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

  // R4/R5: session hooks live at the shell so state survives tab/mode swap.
  const timer = useTimerSession();
  const messages = useMessagesSession();
  const bibleSession = useBibleSession(ctx.defaultTranslationCode);

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
          // lookup came back empty — replace placeholder with error card
          bibleSession.setCards([{
            id: `ai-error-${key}`,
            label,
            verses: [{ verse: scripture.ref.verseStart, text: "(no verse text available)" }],
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
        }]);
      }
    })();
  }, [ctx.audio.suggestions, ctx.confidenceThreshold, bibleSession]);

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
      const detail = (ev as CustomEvent<{ action: string; phrase: string }>).detail;
      if (!detail) return;
      const { action, phrase } = detail;
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
      toast.info(`Voice command: ${phrase}`);
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
            {centerMode === "bible" ? (
              <BibleMode ctx={ctx} session={bibleSession} />
            ) : centerMode === "songs" ? (
              <SongsBrowser ctx={ctx} onExitToSlides={() => setCenterMode("slides")} />
            ) : centerMode === "media" ? (
              <MediaBrowser ctx={ctx} onExitToSlides={() => setCenterMode("slides")} />
            ) : (
              <SlideGrid ctx={ctx} slideSize={slideSize} />
            )}
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
          <LivePreviewPanel ctx={ctx} />
          <LiveTranscriptPanel ctx={ctx} />
          <AIDetectionsPanel ctx={ctx} />
          <div className="flex-1 min-h-0 border-t border-[var(--color-border)]">
            <RightTabs ctx={ctx} timer={timer} messages={messages} />
          </div>
        </aside>
      </div>

      <AITranscriptTicker ctx={ctx} />

      <div data-tour="bottom">
        <BottomBar
          ctx={ctx}
          onOpenShortcutsHelp={() => setShortcutsHelpOpen(true)}
        />
      </div>

      {mediaStripOpen && <MediaStrip onCenterMode={setCenterMode} />}

      <ShortcutsHelpOverlay open={shortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen} />
      <OperatorTour open={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}
