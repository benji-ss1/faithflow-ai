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
          <LibrarySection />
          <PlaylistSection ctx={ctx} />
          <MediaSection />
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

      <BottomBar
        ctx={ctx}
        slideSize={slideSize}
        onSlideSize={setSlideSize}
      />

      {mediaStripOpen && <MediaStrip />}
    </div>
  );
}
