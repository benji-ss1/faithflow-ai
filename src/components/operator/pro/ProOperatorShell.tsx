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
import { useEffect, useState } from "react";
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
import { RightTabs } from "./right/RightTabs";
import { BottomBar } from "./BottomBar";
import { MediaStrip } from "./MediaStrip";
import { useTimerSession, useMessagesSession, useBibleSession } from "./hooks";

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

/**
 * Compact transcript + AI detection strip pinned above BottomBar.
 * Shows last ~120 chars of transcript (rolling), + up to 3 latest scripture
 * detections as small verse chips with an "AI" badge and confidence %.
 * Hidden entirely when AI listener is idle to keep the shell clean.
 */
function AITranscriptTicker({ ctx }: { ctx: OperatorShellCtx }) {
  const audio = ctx.audio;
  if (!audio.listening && !audio.error && audio.transcript.length === 0) return null;

  const last = audio.transcript.slice(-3).map((t) => t.text).join(" ");
  const shown = audio.interim
    ? `${last} ${audio.interim}`.slice(-140)
    : last.slice(-140);

  const scriptureCards = audio.suggestions
    .filter((s) => s.type === "scripture" && s.confidence >= (ctx.confidenceThreshold ?? 50))
    .slice(0, 3);

  return (
    <div
      className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 flex items-center gap-3 min-h-[32px]"
      data-testid="ai-transcript-ticker"
    >
      {audio.error ? (
        <span className="text-[11px] font-medium text-[var(--color-destructive)] truncate">
          {audio.error}
        </span>
      ) : (
        <span className="text-[11px] text-[var(--color-muted-foreground)] truncate flex-1 font-mono">
          {shown || (audio.listening ? "Listening…" : "")}
        </span>
      )}
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
    </div>
  );
}

export function ProOperatorShell({ ctx }: { ctx: OperatorShellCtx }) {
  const [centerMode, setCenterMode] = useState<CenterMode>("slides");
  const [mediaStripOpen, setMediaStripOpen] = useState(true);
  const [slideSize, setSlideSize] = useState(160);

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

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--color-app-bg)] text-[var(--color-foreground)]">
      <TopBar
        centerMode={centerMode}
        onCenterMode={setCenterMode}
        onToggleMediaStrip={() => setMediaStripOpen((v) => !v)}
        mediaStripOpen={mediaStripOpen}
        ctx={ctx}
      />

      <div className="flex-1 min-h-0 flex">
        {/* LEFT */}
        <aside className="w-40 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col overflow-y-auto">
          <LibrarySection onCenterMode={setCenterMode} />
          <PlaylistSection ctx={ctx} onCenterMode={setCenterMode} />
          <MediaSection onCenterMode={setCenterMode} />
        </aside>

        {/* CENTER */}
        <main className="flex-1 min-w-0 flex flex-col bg-[var(--color-app-bg)]">
          <CenterHeader ctx={ctx} centerMode={centerMode} />
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
        <aside className="w-[300px] shrink-0 border-l border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col overflow-hidden">
          <LivePreviewPanel ctx={ctx} />
          <div className="flex-1 min-h-0 border-t border-[var(--color-border)]">
            <RightTabs ctx={ctx} timer={timer} messages={messages} />
          </div>
        </aside>
      </div>

      <AITranscriptTicker ctx={ctx} />

      <BottomBar
        ctx={ctx}
        slideSize={slideSize}
        onSlideSize={setSlideSize}
      />

      {mediaStripOpen && <MediaStrip />}
    </div>
  );
}
