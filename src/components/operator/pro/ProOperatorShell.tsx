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
 *   │ Lib  │                                 │                 │
 *   │ Play │                                 │                 │
 *   │ Media│  (Media Bin is docked in the    │                 │
 *   │ Bin  │   left rail below the Playlist,  │                 │
 *   │      │   collapsible — NOT a bottom     │                 │
 *   │      │   strip; the old MediaStrip is   │                 │
 *   │      │   removed)                       │                 │
 *   ├──────┴─────────────────────────────────┴─────────────────┤
 *   │  BottomBar (40px)                                        │
 *   └──────────────────────────────────────────────────────────┘
 */
import { isWindowsUA } from "@/lib/platform";
import { leftPanelMaxWidth } from "@/lib/panelLayout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Quote, X } from "lucide-react";
import type { OperatorShellCtx } from "../shell/types";
import { OperatorErrorBoundary } from "../OperatorErrorBoundary";
import { TopBar } from "./TopBar";
import { isStaleServerActionError, staleActionRecovery } from "@/lib/stale-action";
import { LibrarySection } from "./left/LibrarySection";
import { PlaylistSection } from "./left/PlaylistSection";
import { MediaSection } from "./left/MediaSection";
import { TransitionsPanel } from "./center/TransitionsPanel";
import { MediaBinSection } from "./left/MediaBinSection";
import { HardwareSection } from "./left/HardwarePanel";
import { CenterHeader } from "./center/CenterHeader";
import { SlideGrid } from "./center/SlideGrid";
import { ArrangementStrip } from "./center/ArrangementStrip";
import { DesktopSlideEditorModal } from "./DesktopSlideEditorModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { MediaImageEditor } from "./center/MediaImageEditor";
import { BibleMode } from "./center/BibleMode";
import { SongsBrowser } from "./center/SongsBrowser";
import { SONG_OPEN_EVENT, type SongSelection } from "@/lib/song-selection";
import { MediaBrowser } from "./center/MediaBrowser";
import { OpenFlowPanel } from "@/components/operator/openflow/OpenFlowPanel";
import { OpenFlowSidebar } from "@/components/operator/openflow/OpenFlowSidebar";
import { LivePreviewPanel } from "./right/LivePreviewPanel";
import { SceneRail } from "./right/SceneRail";
import { SceneBuilderHost } from "./SceneBuilderModal";
import { AnnouncementBar } from "../AnnouncementBar";
import { VideoControlBar } from "../VideoControlBar";
import { OutputRoutingRow } from "./right/OutputRoutingRow";
// 2026-07-25 Phase 3: RightTabs + AIDetectionsPanel replaced by
// RightIconBar. AIDetectionsPanel still imported transitively (via
// RightIconBar's popovers). Old RightTabs.tsx kept in tree, unused.
import { RightIconBar } from "./right/RightIconBar";
import { VerticalClearRail } from "./right/VerticalClearRail";
import { Pp7ClearRail } from "./right/Pp7ClearRail";
import { usePp7Layers } from "@/lib/pp7-layers-flag";
import { usePp7Messages } from "./right/usePp7Layers";
import { TranscriptDisplay } from "./TranscriptDisplay";
import { BottomBar } from "./BottomBar";
import { useTimerSession, useMessagesSession, useBibleSession, useTimersSession, useMessagesBoard, expandMessageTokens, timerTokenValue } from "./hooks";
import { openLiveChannel, safePost, type LiveChannelLike } from "@/lib/broadcast";
import { cachedLookup } from "@/lib/bible-client-cache";
import { setAvailableTranslationCodes, getAvailableTranslationCodes } from "@/lib/translation-commands";
import { BIBLE_MICRO_COOLDOWN_MS, decideBibleAutoFire, parseLiveScriptureRef, isDifferentRefLive, resolvedDetectionAction, navOriginSuppressed, extendNavOrigin, shouldDropForceLive, type NavOrigin } from "@/lib/bible-antireplay";
import { fetchChapterCached, getCachedChapter, chapterKey, prefetchChapter } from "@/lib/bible-chapter-cache";
import { cn } from "@/lib/utils";
import { useOperatorHotkeys } from "@/hooks/useOperatorHotkeys";
import { ShortcutsHelpOverlay } from "./ShortcutsHelpOverlay";
import { AICaptionsBanner } from "./AICaptionsBanner";
import { UpdateBanner } from "./UpdateBanner";
import { AudioDebugOverlay } from "../dev/AudioDebugOverlay";
import { CONFIDENCE_THRESHOLD, BIBLE_AUTOFIRE_CONFIDENCE, BIBLE_SUGGEST_CONFIDENCE } from "@/lib/audio-thresholds";
import { OperatorTour, hasSeenTour } from "@/components/tutorial/OperatorTour";
import { WhatsNewModal } from "../WhatsNewModal";
import { SettingsWindow } from "../settings/SettingsWindow";
import { SarahOverlay } from "@/components/setup/sarah/SarahOverlay";
import { dispatchInternal, isInternalEvent, internalPayload } from "@/lib/internal-events";
import { matchNextSlide, isLikelyEndOfSong, scoreCoverage, slideWords, matchBestSlide } from "@/lib/ai-detection/lyric-position";
import { parseContextCommand, navCommandWordCount } from "@/lib/context-parser";
// Audio Guardian (2026-07-27) — native-capture self-healing watchdog.
// The shell only CONSUMES its state events (toasts + red chip); the state
// machine itself lives in src/lib/audio/audioGuardian.ts, fed by
// useAudioStream's native branch.
import { GUARDIAN_STATE_EVENT, type GuardianStatus } from "@/lib/audio/audioGuardian";
import { shouldHoldSongAutoSwitch, liveOriginKey, resolveLyricIndex } from "@/lib/song-switch-guard";
import { songSlidesChangedPlan, refreshTrackedSong, relocateLyricIndex, type SongSlidesChangedDetail } from "@/lib/song-slides-changed";

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
export type CenterMode = "slides" | "bible" | "songs" | "media" | "openflow" | "transitions";

// OpenFlow ships behind a public flag so the entry only appears where it's
// actually enabled (both this flag AND the server-side OPENFLOW_GROQ_API_KEY).
// Keeps a half-configured prod from showing a dead entry point.
const OPENFLOW_ENABLED = process.env.NEXT_PUBLIC_OPENFLOW_ENABLED === "1";

// Policy constants live in operatorConstants.ts so they are searchable
// without reading this entire file. All sign-off history is documented there.
import {
  MEDIA_STRIP_KEY,
  MEDIA_BIN_HEIGHT_KEY,
  SLIDE_SIZE_KEY,
  SAFE_MODE_KEY,
  LEFT_PANEL_WIDTH_KEY,
  LEFT_PANEL_MIN_WIDTH,
  LEFT_PANEL_DEFAULT_WIDTH,
  SONG_AUTOSTAGE_CONFIRM_KEY,
  SONG_STAGE_CONFIDENCE,
  SONG_AUTOLIVE_CONFIDENCE,
  SONG_DISAMBIG_MARGIN,
  SONG_AUTO_FIRED_SESSION_KEY,
  SONG_AUTO_LIVE_MIN_GAP_MS,
  SONG_JUMP_SUGGEST_CONFIDENCE,
  SONG_SWITCH_WHILE_LIVE_CONFIDENCE,
  AUTO_FIRED_SESSION_KEY,
  AUTO_APPROVE_KEY_INSTANT,
  AUTO_ADVANCE_KEY,
  AUTO_FIRE_MIN_GAP_KEY,
  HOLD_DURING_SONG_KEY,
  DEFAULT_MIN_GAP_MS,
  SONG_SLIDE_FLOOR_MS,
  SONG_SHORT_SLIDE_FLOOR_MS,
  SONG_SILENCE_ADVANCE_MS,
  SONG_COVERAGE_THRESHOLD,
  BIBLE_SLIDE_FLOOR_MS,
  BIBLE_SILENCE_ADVANCE_MS,
  BIBLE_COVERAGE_THRESHOLD,
  BIBLE_NEXT_EVIDENCE_MIN,
} from "./operatorConstants";

/**
 * Compact transcript + AI detection strip pinned above BottomBar.
 * Shows last ~120 chars of transcript (rolling), + up to 3 latest scripture
 * detections as small verse chips with an "AI" badge and confidence %.
 * Hidden entirely when AI listener is idle to keep the shell clean.
 */
function AITranscriptTicker({ ctx }: { ctx: OperatorShellCtx }) {
  const audio = ctx.audio;

  // 2026-08-16 — manual chip housekeeping. The rail auto-caps at the latest 3
  // per kind (older detections roll off on their own), but a busy service can
  // still leave stale chips the operator wants gone. `dismissedIds` hides a
  // chip on its × click; "Clear" hides every chip currently shown. New
  // detections (new ids) still appear, so clearing never blinds the AI.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const dismissChip = (id: string) => setDismissedIds((prev) => { const n = new Set(prev); n.add(id); return n; });
  // Lazy per-song lyric preview for the hover card (C): first line(s) of the
  // song so the operator can disambiguate near-identical titles (e.g. two
  // "Great Is Thy Faithfulness") before pushing live. Cached by songId; one
  // best-effort fetch per song, never blocks and never auto-projects.
  const [songPreview, setSongPreview] = useState<Record<string, string>>({});
  const songPreviewInFlightRef = useRef<Set<string>>(new Set());
  const loadSongPreview = (songId: string) => {
    if (!songId || songPreview[songId] !== undefined || songPreviewInFlightRef.current.has(songId)) return;
    songPreviewInFlightRef.current.add(songId);
    void (async () => {
      try {
        const res = await fetch(`/api/songs/${songId}/slides`).then((r) => r.json());
        const slides = Array.isArray(res.slides) ? (res.slides as { lyrics?: string }[]) : [];
        const first = slides.map((s) => (typeof s.lyrics === "string" ? s.lyrics : "")).find((t) => t.trim().length > 0) ?? "";
        const preview = first.split(/\n+/).slice(0, 2).join(" · ").slice(0, 120);
        setSongPreview((prev) => ({ ...prev, [songId]: preview || "(no lyrics saved)" }));
      } catch { setSongPreview((prev) => ({ ...prev, [songId]: "(couldn't load preview)" })); }
      finally { songPreviewInFlightRef.current.delete(songId); }
    })();
  };
  // Same idea for SCRIPTURE / Whisper chips: a small bubble with a bit of the
  // verse text so the operator can confirm the reference is right BEFORE
  // manually clicking it live. Lazy, cached by ref key, best-effort; never
  // auto-projects. Uses the operator's default translation for the snippet.
  const [versePreview, setVersePreview] = useState<Record<string, string>>({});
  const versePreviewInFlightRef = useRef<Set<string>>(new Set());
  const loadVersePreview = (key: string, ref: { book: string; chapter: number; verseStart: number; verseEnd: number }) => {
    if (!key || versePreview[key] !== undefined || versePreviewInFlightRef.current.has(key)) return;
    versePreviewInFlightRef.current.add(key);
    void (async () => {
      try {
        const res = await cachedLookup({
          book: ref.book, chapter: ref.chapter, verseStart: ref.verseStart, verseEnd: ref.verseEnd,
          translationCode: ctx.defaultTranslationCode || "KJV", source: "ai",
        });
        const text = (res.verses ?? []).map((v) => v.text).join(" ").replace(/\s+/g, " ").trim();
        const snippet = text.length > 160 ? text.slice(0, 157) + "…" : text;
        setVersePreview((prev) => ({ ...prev, [key]: snippet || "(no text found)" }));
      } catch { setVersePreview((prev) => ({ ...prev, [key]: "(couldn't load preview)" })); }
      finally { versePreviewInFlightRef.current.delete(key); }
    })();
  };

  const threshold = ctx.confidenceThreshold ?? 50;
  const scriptureCards = audio.suggestions
    .filter((s) => s.type === "scripture" && s.confidence >= threshold && !dismissedIds.has(s.id))
    .slice(0, 3);
  const songCards = audio.suggestions
    .filter((s) => (s.type === "song" || s.type === "lyric") && s.confidence >= threshold && !dismissedIds.has(s.id))
    .slice(0, 3);
  // Roadmap #2 — canonical (Whisper) corrections chip strip. 8-second
  // staleness ceiling: a Whisper round trip is ~1–3s but under load can
  // stretch to 5s+, and if the operator has already clicked or the AUTO
  // fire has already projected the wrong slide, a purple "Whisper says X
  // instead of Y" chip appearing 6s later is jarring and looks like the
  // AI second-guessing itself mid-sermon. Drop anything older than 8s
  // from the initial detection. Manual-dismissed ones stay hidden.
  const CORRECTION_STALE_MS = 8 * 1000;
  const nowMs = Date.now();
  const activeCorrections = (audio.canonicalCorrections || [])
    .filter((c) => !c.dismissed && nowMs - c.ts < CORRECTION_STALE_MS)
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

  // 2026-07-26 — direct operator click on a song chip fires slide 1 to live.
  // CLAUDE.md rule 7 forbids AI/autopilot from projecting songs below 85%
  // confidence, but it explicitly carves out "direct operator intent is
  // trusted" (see SongsBrowser onClick for the same pattern). A chip click
  // is unambiguous operator intent. 10s per-song cooldown so a jitter of
  // repeat clicks (or the same click landing on the chip + the underlying
  // banner) can't double-fire the same song.
  const songClickFiredAtRef = useRef<Map<string, number>>(new Map());
  const SONG_CLICK_COOLDOWN_MS = 10_000;
  const handleSongChipClick = async (songId: string, songTitle: string, inPlaylist: boolean) => {
    const lastFire = songClickFiredAtRef.current.get(songId) ?? 0;
    if (Date.now() - lastFire < SONG_CLICK_COOLDOWN_MS) {
      // Second click within cooldown — treat as "take me to it in the playlist"
      // (previous click already fired live).
      if (inPlaylist) scrollToPlaylistSong(songId);
      return;
    }
    try {
      // Fetch slides directly instead of waiting on onAddLibraryItem's async
      // reload — the operator wants the projector updated NOW, not on next
      // router.refresh() round trip.
      const res = await fetch(`/api/songs/${songId}/slides`).then((r) => r.json());
      const slides = Array.isArray(res.slides) ? (res.slides as { lyrics: string }[]) : [];
      const firstLyric = slides.map((s) => (typeof s.lyrics === "string" ? s.lyrics : "")).find((t) => t.trim().length > 0);
      if (firstLyric) {
        ctx.onSendSlideToLive({ kind: "text", text: firstLyric }, undefined, { origin: { kind: "song", songId } });
        songClickFiredAtRef.current.set(songId, Date.now());
        toast.success(`"${songTitle}" → LIVE (slide 1)`);
        // Navigate the center panel to slides so the operator sees the song
        // grid immediately after clicking the chip — mirrors how Bible chips
        // dispatch presentflow:bible-goto to switch to Bible mode. The existing
        // show-slides handler has an AUTO-mode guard that prevents the mode-
        // switch live-follow effect from overwriting the song that just went
        // live with a stale previewItem.
        dispatchInternal("presentflow:show-slides", {});
      } else {
        toast.info(`"${songTitle}" has no lyric slides yet — open the song in the library to add lyrics.`);
      }
    } catch (e) {
      console.warn("[song-chip-click] fetch slides failed", e);
      toast.error(`Couldn't load "${songTitle}" — check DevTools console.`);
      return;
    }
    // Add to playlist too if not there yet, so the operator can navigate
    // between slides via the transport bar / SlideGrid afterward.
    if (!inPlaylist && ctx.onAddLibraryItem) {
      try { await ctx.onAddLibraryItem("song", { id: songId, title: songTitle }); }
      catch { /* non-fatal — live already fired */ }
    } else if (inPlaylist) {
      scrollToPlaylistSong(songId);
    }
  };

  // Double-click is intentionally a no-op here: a native double-click
  // already fires two `click` events before `dblclick` fires once, so a
  // single-click add handler already runs twice per double-click. Re-invoking
  // the add here on top was producing 2-3 duplicate playlist rows per
  // double-click (see actions.ts addServiceItem idempotency guard for the
  // server-side backstop). CLAUDE.md rule 7 — songs never auto-project.

  // The rolling transcript text has moved to the right-sidebar
  // LiveTranscriptPanel; the AI Live pill in the top-right is the connection
  // status indicator. This strip is now purely an actionable chip row, so
  // hide it entirely when there's nothing to act on.
  if (scriptureCards.length === 0 && songCards.length === 0 && activeCorrections.length === 0) return null;

  return (
    <div
      className="shrink-0 border-t border-[var(--color-border)] bg-[linear-gradient(180deg,var(--color-panel),var(--color-app-bg))] shadow-[var(--edge-top)] px-3 py-1.5 flex items-center gap-3 min-h-[34px]"
      data-testid="ai-transcript-ticker"
    >
      <span className="eyebrow shrink-0">AI chips</span>
      {scriptureCards.length > 0 && (
        <div className="flex items-center gap-1.5 shrink-0">
          {scriptureCards.map((s) => {
            if (s.type !== "scripture") return null;
            const ref = `${s.ref.book} ${s.ref.chapter}:${s.ref.verseStart}${s.ref.verseEnd !== s.ref.verseStart ? `-${s.ref.verseEnd}` : ""}`;
            const isPhrase = !!s.isPhraseMatch;
            const tip = isPhrase
              ? "Phrase match — quoted text, not a spoken reference. Click to load, Shift+click to send live."
              : `${ref} (${s.confidence}%) — click to load, Shift+click to send live`;
            return (
              <div
                key={s.id}
                className="relative group"
                onMouseEnter={() => loadVersePreview(s.id, { book: s.ref.book, chapter: s.ref.chapter, verseStart: s.ref.verseStart, verseEnd: s.ref.verseEnd })}
                onFocusCapture={() => loadVersePreview(s.id, { book: s.ref.book, chapter: s.ref.chapter, verseStart: s.ref.verseStart, verseEnd: s.ref.verseEnd })}
              >
              <div
                role="button"
                tabIndex={0}
                title={tip}
                aria-label={isPhrase
                  ? `${ref}, phrase match — quoted text, not a spoken reference. Tap to load.`
                  : `${ref}, ${s.confidence}% confidence — click to load, Shift+click to send live`}
                onClick={(e) => dispatchInternal("presentflow:bible-goto", {
                  book: s.ref.book, chapter: s.ref.chapter, verseStart: s.ref.verseStart, verseEnd: s.ref.verseEnd, live: e.shiftKey,
                })}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  dispatchInternal("presentflow:bible-goto", {
                    book: s.ref.book, chapter: s.ref.chapter, verseStart: s.ref.verseStart, verseEnd: s.ref.verseEnd, live: e.shiftKey,
                  });
                }}
                className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] cursor-pointer transition-all backdrop-blur-md hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                style={{
                  border: "1px solid color-mix(in oklab, var(--color-brand) 55%, transparent)",
                  background: "color-mix(in oklab, var(--color-brand) 12%, var(--color-elevated))",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 8px rgba(0,0,0,0.35)",
                }}
              >
                <span className="font-bold tracking-[-0.01em]">{ref}</span>
                <span className="text-[9px] font-mono font-semibold tabular-nums opacity-70">{s.confidence}%</span>
                {isPhrase ? (
                  // Quote badge — a phrase/quoted-text match (not a spoken
                  // reference). Gold, so it reads distinct from the green "AI"
                  // spoken-reference badge at a glance. (Replaced the old purple
                  // ✦ glyph with a proper icon.)
                  <span
                    className="grid place-items-center ml-0.5 w-[15px] h-[15px] rounded-md bg-[var(--color-scripture-gold,#EF9F27)]/20 text-[var(--color-scripture-gold,#EF9F27)]"
                    aria-label="Phrase match — quoted text"
                    data-testid="phrase-match-badge"
                  >
                    <Quote className="w-2.5 h-2.5" strokeWidth={2.6} />
                  </span>
                ) : (
                  <span
                    className="ml-0.5 text-[8px] font-extrabold tracking-wide px-1.5 py-[2px] rounded-md bg-[var(--color-success,#10b981)] text-black shadow-[var(--edge-top)]"
                    aria-label="AI detected"
                  >
                    AI
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Dismiss ${ref}`}
                  title="Dismiss this chip"
                  onClick={(e) => { e.stopPropagation(); dismissChip(s.id); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); dismissChip(s.id); } }}
                  className="ml-0.5 -mr-0.5 text-[12px] leading-none text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer px-0.5"
                >
                  ×
                </span>
              </div>
                {/* Hover bubble (2026-08-16): a bit of the verse text so the
                    operator can confirm the reference is right BEFORE clicking it
                    live. Informational only — no auto-projection. */}
                <div
                  className="pointer-events-none hidden group-hover:block absolute bottom-full left-0 mb-1.5 z-[60] w-max max-w-[360px] rounded-xl px-3 py-2 text-[11px] leading-snug text-white shadow-2xl"
                  style={{ background: "rgba(15,15,17,0.98)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(10px)" }}
                  role="tooltip"
                >
                  <div className="font-semibold text-[12px] mb-0.5">{ref} <span className="font-mono opacity-50 text-[10px]">{s.confidence}%{isPhrase ? " · phrase" : ""}</span></div>
                  <div className="text-white/85">{versePreview[s.id] === undefined ? "loading…" : versePreview[s.id]}</div>
                </div>
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
            // 2026-07-26 tip reflects the new click behavior: chip click
            // fires slide 1 to live (direct operator intent, trusted per
            // rule 7). Second click within 10s = scroll-to-playlist only.
            const rawTip = inPlaylist
              ? `${title} — in playlist (${s.confidence}%) — click to play slide 1 live`
              : `${title} (${s.confidence}%) — click to play slide 1 live (also adds to playlist)`;
            const tip = rawTip.length > 140 ? rawTip.slice(0, 137) + "…" : rawTip;
            const ariaLabel = `${title}, ${s.confidence}% match${inPlaylist ? ", in playlist" : ""}, click to play slide 1 live`;
            const matchedLine = (s.match as { matchedLine?: string }).matchedLine?.trim();
            return (
              <div
                key={s.id}
                className="relative group"
                onMouseEnter={() => loadSongPreview(songId)}
                onFocusCapture={() => loadSongPreview(songId)}
              >
                <div
                  role="button"
                  tabIndex={0}
                  data-in-playlist={inPlaylist ? "true" : "false"}
                  title={tip}
                  aria-label={ariaLabel}
                  onClick={() => handleSongChipClick(songId, title, inPlaylist)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSongChipClick(songId, title, inPlaylist); }}
                  className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] cursor-pointer transition-all backdrop-blur-md hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                  style={inPlaylist
                    ? { border: "1px solid color-mix(in oklab, #f0b35a 60%, transparent)", background: "color-mix(in oklab, #f0b35a 14%, var(--color-elevated))", color: "#f4d9a8", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 8px rgba(0,0,0,0.35)" }
                    : { border: "1px solid color-mix(in oklab, var(--color-brand) 55%, transparent)", background: "color-mix(in oklab, var(--color-brand) 12%, var(--color-elevated))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 8px rgba(0,0,0,0.35)" }}
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
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Dismiss ${title}`}
                    title="Dismiss this chip"
                    onClick={(e) => { e.stopPropagation(); dismissChip(s.id); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); dismissChip(s.id); } }}
                    className="ml-0.5 -mr-0.5 text-[12px] leading-none opacity-60 hover:opacity-100 cursor-pointer px-0.5"
                  >
                    ×
                  </span>
                </div>
                {/* Hover disambiguation card (C, 2026-08-16): shows the matched
                    lyric line + the song's opening line so near-identical titles
                    (two "Great Is Thy Faithfulness") can be told apart BEFORE
                    pushing live. Purely informational — no auto-projection. */}
                <div
                  className="pointer-events-none hidden group-hover:block absolute bottom-full left-0 mb-1.5 z-[60] w-max max-w-[340px] rounded-xl px-3 py-2 text-[11px] leading-snug text-white shadow-2xl"
                  style={{ background: "rgba(15,15,17,0.98)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(10px)" }}
                  role="tooltip"
                >
                  <div className="font-semibold text-[12px] mb-0.5">{title} <span className="font-mono opacity-50 text-[10px]">{s.confidence}%{inPlaylist ? " · in playlist" : ""}</span></div>
                  {matchedLine ? (
                    <div className="text-white/70"><span className="opacity-50">heard:</span> “{matchedLine}”</div>
                  ) : null}
                  <div className="text-white/85 mt-0.5">
                    <span className="opacity-50">song starts:</span>{" "}
                    {songPreview[songId] === undefined ? "loading…" : songPreview[songId]}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {activeCorrections.length > 0 && (
        <div className="flex items-center gap-1.5 shrink-0" data-testid="ai-canonical-corrections">
          <span className="text-[9px] font-mono uppercase tracking-wider text-purple-300/80 shrink-0">
            Whisper says
          </span>
          {activeCorrections.map((c) => {
            const origRef = `${c.original.book} ${c.original.chapter}:${c.original.verseStart}${c.original.verseStart !== c.original.verseEnd ? `-${c.original.verseEnd}` : ""}`;
            const corrRef = `${c.corrected.book} ${c.corrected.chapter}:${c.corrected.verseStart}${c.corrected.verseStart !== c.corrected.verseEnd ? `-${c.corrected.verseEnd}` : ""}`;
            return (
              <div
                key={c.id}
                className="relative group"
                onMouseEnter={() => loadVersePreview(c.id, { book: c.corrected.book, chapter: c.corrected.chapter, verseStart: c.corrected.verseStart, verseEnd: c.corrected.verseEnd })}
                onFocusCapture={() => loadVersePreview(c.id, { book: c.corrected.book, chapter: c.corrected.chapter, verseStart: c.corrected.verseStart, verseEnd: c.corrected.verseEnd })}
              >
              <div
                role="button"
                tabIndex={0}
                title={`Whisper double-check: ${corrRef} (not ${origRef}). Click to load the corrected reference.`}
                aria-label={`Whisper suggests ${corrRef} instead of ${origRef} — click to load`}
                onClick={() => dispatchInternal("presentflow:bible-goto", {
                  book: c.corrected.book, chapter: c.corrected.chapter,
                  verseStart: c.corrected.verseStart, verseEnd: c.corrected.verseEnd,
                  live: false,
                })}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  dispatchInternal("presentflow:bible-goto", {
                    book: c.corrected.book, chapter: c.corrected.chapter,
                    verseStart: c.corrected.verseStart, verseEnd: c.corrected.verseEnd,
                    live: false,
                  });
                }}
                className="relative flex items-center gap-1 px-2 py-0.5 rounded border border-purple-500/60 bg-purple-500/10 text-purple-100 text-[11px] cursor-pointer hover:bg-purple-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
              >
                <span className="text-[9px] font-mono opacity-70">🔁</span>
                <span className="font-semibold">{corrRef}</span>
                <span className="text-[9px] font-mono opacity-60 line-through">{origRef}</span>
              </div>
                <div
                  className="pointer-events-none hidden group-hover:block absolute bottom-full left-0 mb-1.5 z-[60] w-max max-w-[360px] rounded-xl px-3 py-2 text-[11px] leading-snug text-white shadow-2xl"
                  style={{ background: "rgba(15,15,17,0.98)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(10px)" }}
                  role="tooltip"
                >
                  <div className="font-semibold text-[12px] mb-0.5">{corrRef} <span className="font-mono opacity-50 text-[10px]">Whisper</span></div>
                  <div className="text-white/85">{versePreview[c.id] === undefined ? "loading…" : versePreview[c.id]}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {(scriptureCards.length > 0 || songCards.length > 0) && (
        <button
          type="button"
          onClick={() => {
            const ids = [...scriptureCards, ...songCards].map((s) => s.id);
            setDismissedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.add(id)); return n; });
            // Also reset the right-rail detection rows (badges -> 0). Rail-only:
            // audio suggestions / auto-fire untouched; new detections reappear.
            dispatchInternal("presentflow:right-rail-clear");
          }}
          title="Clear the AI chips (new detections still appear)"
          aria-label="Clear AI chips"
          className="ml-auto shrink-0 text-[10px] font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-2 py-0.5 rounded border border-[var(--color-border)] hover:bg-white/5"
        >
          Clear
        </button>
      )}
    </div>
  );
}

/**
 * Legacy LiveTranscriptPanel removed 2026-07-30 — its rich rendering
 * (yellow correction spans, orange trigger highlights, mm:ss timestamps,
 * 30s window, interim/final distinction, Clear button) now lives in
 * `TranscriptDisplay.tsx` (Change 3 wrapper). Confine any further edits
 * to that file.
 */

// ---------------------------------------------------------------------------
// Parts 6-8 — Song auto-stage/auto-live and word-timing slide auto-advance.
//
// Policy (originally user-approved 2026-07-22; threshold-lowered with fresh
// sign-off 2026-07-26 — see CLAUDE.md rule 7): below SONG_AUTOLIVE_CONFIDENCE,
// a song detection only stages (human "G" keypress via `confirmStagedSongLive`
// required to go live). At/above SONG_AUTOLIVE_CONFIDENCE, `autoLiveSong`
// pushes it live with ZERO human action, using the exact same
// anti-replay/min-gap guardrails proven out by Bible's `doAutoFire` (see
// AUTO_APPROVE_KEY_INSTANT effect below): a session-persisted fired-key map
// (5min replay suppression) and a min-gap cooldown between auto-live events
// (falls back to staging, never silently drops, if a second high-confidence
// song lands inside the cooldown). This is a deliberate, documented exception
// to the historical "only one human keypress may call ctx.onSendSlideToLive"
// invariant — the user explicitly accepted the copyright-safety tradeoff.
//
// 2026-07-26 threshold change: 85 → 70 (user sign-off). Rationale from the
// field: at 85% the auto-live band was too narrow — most real detections
// landed in the 60-84% stage-only band, requiring a human G keypress that
// operators often missed. Lowering to 70 widens the zero-click band while
// keeping a ≥10-point gap above SONG_STAGE_CONFIDENCE so the intermediate
// "operator confirms" band still exists. If 70 turns out to still fire
// undesirably, drop to 65 with a fresh sign-off; do not go below 65 without
// a fresh field-data conversation about false-fire risk.
//
// Do not lower SONG_AUTOLIVE_CONFIDENCE further or extend zero-click to
// other content types without new explicit sign-off.
//
// CLAUDE.md rule 7 is enforced upstream in autopilot.ts's isSong branch and
// OperatorConsole's gate — neither is touched here.
// ---------------------------------------------------------------------------

// SONG_AUTOSTAGE_CONFIRM_KEY, SONG_STAGE_CONFIDENCE, SONG_AUTOLIVE_CONFIDENCE,
// SONG_AUTO_FIRED_SESSION_KEY, SONG_AUTO_LIVE_MIN_GAP_MS — imported above from
// operatorConstants.ts. Sign-off history + tuning notes are documented there.

type StagedSongSlides = { songId: string; title: string; slides: string[]; currentIdx: number; confidence: number; source: "detection" | "progression" };
type LiveSongTrack = { songId: string; title: string; slides: string[]; currentIdx: number; confirmedAt: number };

function isAnyOverlayOpen(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.querySelectorAll(
      '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ).length > 0;
  } catch {
    return false;
  }
}

async function fetchSongLyricSlides(songId: string): Promise<string[]> {
  const res = await fetch(`/api/songs/${songId}/slides`).then((r) => r.json());
  const slides = Array.isArray(res.slides) ? (res.slides as { lyrics: string }[]) : [];
  return slides.map((s) => s.lyrics).filter((s) => !!s && s.trim().length > 0);
}

// Normalize a slide's text for identity comparison (collapse whitespace, drop
// case + punctuation). Used to recognise WHICH song+slide is currently live —
// regardless of whether the operator or the AI put it there — so the same-song
// guards stop re-projecting a song that's already up (2026-09-06 fix).
function normalizeLyric(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

// First non-empty line of a slide's lyrics, trimmed for a compact chip label.
function firstLineOf(s: string): string {
  const line = (s ?? "").split(/\n+/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}

/**
 * Part 6/7/8 controller + banner. Mounted once in ProOperatorShell. Reads
 * ctx.audio for detections/transcript and ctx.plan for playlist order; the
 * ONLY ctx write it performs toward live output is the single guarded call
 * inside `confirmStagedSongLive`.
 */
function SongAutopilotStaging({ ctx }: { ctx: OperatorShellCtx }) {
  const [stagedSong, setStagedSong] = useState<StagedSongSlides | null>(null);
  const [autoAdvanceFlash, setAutoAdvanceFlash] = useState(false);
  const liveSongRef = useRef<LiveSongTrack | null>(null);
  // One-shot hint saved when a structural edit clears tracking, so the rebuild
  // relocates the SAME chorus copy (not the first) once the re-fetch lands.
  const structuralEditHintRef = useRef<{ songId: string; slides: string[]; currentIdx: number; liveText: string; at: number } | null>(null);
  const STRUCTURAL_HINT_TTL_MS = 5000;
  const liveSlideForHintRef = useRef(ctx.liveSlide);
  liveSlideForHintRef.current = ctx.liveSlide;
  const [, forceRender] = useState(0); // liveSongRef mutations need a render nudge for the indicator
  // Cache of each plan song's ordered slide texts, so we can recognise which
  // song+slide is currently live (by matching ctx.liveSlide's text) no matter
  // who projected it — the AI, a chip tap, or a manual slide click. This powers
  // the "don't re-project a song that's already up" fix and follows manual
  // navigation. Keyed by songId; entries are {slides, byText} for O(1) lookup.
  const songSlidesCacheRef = useRef<Map<string, { slides: string[]; byText: Map<string, number> }>>(new Map());
  // Bumped whenever the cache gains/loses an entry, so effects that read the
  // ref (which alone wouldn't re-run) can re-reconcile once slides arrive.
  const [cacheVersion, setCacheVersion] = useState(0);
  // Suggest-only "the singer is on slide N — go there?" chip (2026-09-06). The
  // projector NEVER moves on its own within a song; the operator taps to confirm.
  const [slideJumpSuggestion, setSlideJumpSuggestion] = useState<{ songId: string; index: number; text: string; confidence: number } | null>(null);
  // Ref mirror so effects can read the current suggestion without a stale
  // render-closure (and without adding it to their deps → re-run loops).
  const slideJumpSuggestionRef = useRef(slideJumpSuggestion);
  slideJumpSuggestionRef.current = slideJumpSuggestion;

  const stagingInFlightRef = useRef<Set<string>>(new Set());
  // songId -> when it was last staged/auto-lived. A TIME-LIMITED cooldown
  // (was a permanent-for-session Set) — a worship team reprising the same
  // song later in the service, or a preacher returning to it, must be able
  // to trigger detection again. Was previously blocking a songId forever
  // once handled once, matching the same cooldown as SONG_AUTO_FIRED_SESSION_KEY.
  const stagedOrHandledRef = useRef<Map<string, number>>(new Map());
  const SONG_REDETECT_COOLDOWN_MS = 5 * 60 * 1000;
  // 2026-07-25 field bug fix — dismissedSongsRef: when the operator clicks
  // the X on a staged banner, that song must NOT immediately re-stage the
  // next time the same lyric fragment lands (which happens every 5-10 sec
  // during a song). User report was "banner appears 5 times, X doesn't
  // dismiss it." Persistent 10-min dismissal per song so a real re-attempt
  // only happens if the song truly comes back later in the service.
  const dismissedSongsRef = useRef<Map<string, number>>(new Map());
  const SONG_DISMISS_TTL_MS = 10 * 60 * 1000;
  const confirmPendingRef = useRef(false);
  const lastSongAutoLiveAtRef = useRef(0); // min-gap cooldown for Part 6b auto-live
  const promotionInFlightRef = useRef<Set<string>>(new Set()); // dedupe for staged->auto-live promotion
  // 2026-07-26 — set of suggestion ids we've already auto-fired for.
  // Suggestions get replaced-in-place by songId (see useAudioStream:496)
  // so a NEW detection event bumps the id; a stale detection sitting in
  // the array keeps its old id. This ref lets us re-fire on new events
  // without re-firing on stale ones. Bounded to last 200 to prevent
  // unbounded growth over long sessions.
  const firedSuggestionIdsRef = useRef<Set<string>>(new Set());
  // How fresh a suggestion must be to trigger auto-fire — anything older
  // is treated as a stale echo. 8s gives detection + Whisper canonical
  // round-trip time headroom without letting a truly stale one re-fire.
  const SUGGESTION_FRESHNESS_MS = 8 * 1000;
  // 2026-07-26 — hard debounce map keyed by songId: autoLiveSong itself
  // refuses to re-run for the same song within 5s. Belt-and-braces on top
  // of every other guard, catches the case where the outer effect's
  // id-dedup was defeated by Deepgram's interim → final → whisper cascade
  // producing multiple new suggestion IDs for the same utterance.
  const autoLiveDebounceRef = useRef<Map<string, number>>(new Map());

  // Word-tracking buffers for Part 7/8.
  const recentWordsRef = useRef<string[]>([]);
  const lastWordTsRef = useRef<number>(Date.now());
  const matchStreakRef = useRef(0);
  const interimMatchStreakRef = useRef(0); // predictive interim-based advance streak
  const bounceBackStreakRef = useRef(0); // Part 7d: backward detection
  // Stable ref to ctx.onSendSlideToLive for use inside setInterval callbacks
  // where stale closures would otherwise capture an old ctx.
  const sendLiveStableRef = useRef(ctx.onSendSlideToLive);
  const cooldownUntilRef = useRef(0);
  const lastAdvanceTsRef = useRef(0);
  const progressionHandledForRef = useRef<Set<string>>(new Set());
  // ── Anti-oscillation guard (2026-08-15) ────────────────────────────────────
  // Highly repetitive worship songs have near-duplicate slides that share most
  // words (e.g. "The name of Jesus is lifted high, lifted high" vs "...lifted
  // high in this place"). The word-match auto-advance can't tell them apart, so
  // it advances A→B then bounce-backs B→A endlessly — the projector visibly
  // ping-pongs. This guard detects a move that REVERSES the previous one within
  // a short window; after one such reversal it PAUSES all auto-advance for a
  // spell so the slide holds still and the operator navigates with ← →. A clean
  // forward progression resets it. Every auto-move site routes through it.
  const lastAutoMoveRef = useRef<{ from: number; to: number; ts: number } | null>(null);
  const autoOscillationCountRef = useRef(0);
  const OSC_REVERSAL_WINDOW_MS = 9000;
  const OSC_PAUSE_MS = 20000;
  // 2026-08-16 (user sign-off): SONG slide auto-advance is DISABLED. Worship is
  // too repetitive/spontaneous for reliable word-tracking (near-duplicate slides,
  // leaders jumping stanzas) and a wrong auto-advance mid-worship is worse than a
  // manual press. The operator advances song slides manually (← → / click); a
  // strong one-time notification tells them so when a song goes live. VERSE
  // auto-advance (preacher reading on to the next verse) is UNAFFECTED — it lives
  // in the Bible AUTO-approve path, not here. Flip to true to restore word-track.
  const SONG_SLIDE_AUTO_ADVANCE = false;
  // Fire a strong, one-time-per-song notice when a song goes live, telling the
  // operator that song slides do NOT auto-advance (see above) and they must move
  // them manually. Deduped by songId so a re-fire of the same live song is quiet.
  const manualSongNoticeShownRef = useRef<Set<string>>(new Set());
  const notifyManualSongAdvance = (songId: string, title: string) => {
    if (SONG_SLIDE_AUTO_ADVANCE) return;
    if (manualSongNoticeShownRef.current.has(songId)) return;
    manualSongNoticeShownRef.current.add(songId);
    try {
      toast(`Manual mode — advance "${title}" yourself`, {
        description: "Song slides do NOT auto-advance. Press → (or click the next slide) to move through the song. Verses still auto-advance.",
        duration: 7000,
        id: `manual-song-${songId}`,
      });
    } catch { /* noop */ }
  };
  const tryAutoMoveRef = useRef<(from: number, to: number) => boolean>(() => true);
  tryAutoMoveRef.current = (from: number, to: number): boolean => {
    if (!SONG_SLIDE_AUTO_ADVANCE) return false; // songs: manual advance only
    const now = Date.now();
    const lm = lastAutoMoveRef.current;
    const isReversal = !!lm && lm.to === from && lm.from === to && now - lm.ts < OSC_REVERSAL_WINDOW_MS;
    if (isReversal) {
      autoOscillationCountRef.current += 1;
      // Allow ONE legitimate bounce-back (moved too early → correct back), but a
      // second reversal is a confirmed ping-pong on repeated lyrics → pause.
      if (autoOscillationCountRef.current >= 2) {
        cooldownUntilRef.current = now + OSC_PAUSE_MS;
        autoOscillationCountRef.current = 0;
        lastAutoMoveRef.current = null;
        console.warn(`[song-autoprogression] oscillation ${from}<->${to} — pausing auto-advance ${OSC_PAUSE_MS}ms (repeated lyrics); operator navigates manually`);
        try { toast.info("Auto-advance paused — repeated lyrics. Use ← → to move slides.", { id: "song-osc", duration: 4000 }); } catch { /* noop */ }
        return false;
      }
    } else {
      autoOscillationCountRef.current = 0;
    }
    lastAutoMoveRef.current = { from, to, ts: now };
    return true;
  };

  // Keep sendLiveStableRef current every render so the setInterval-based
  // Part 7c (silence ticker) never holds a stale closure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { sendLiveStableRef.current = ctx.onSendSlideToLive; });

  const autoApprove = !!ctx.autoApproveOn;

  // Ref mirror of stagedSong for async callbacks (autoLiveSong isn't keyed on it).
  const stagedSongRef = useRef(stagedSong);
  stagedSongRef.current = stagedSong;
  // Song auto-switch hold (rule 7, 2026-09-14). Conservative "a song is live by
  // ANY evidence" decision — see src/lib/song-switch-guard.ts for the signal choice.
  // POSITIVE-EVIDENCE revision: holds only when a different song is provably live
  // (tracked song, recorded song ORIGIN of the live output, or a plan song item).
  const songSwitchInput = useCallback((songId: string) => {
    const item = ctx.liveItemIdx >= 0 ? (ctx.plan.items[ctx.liveItemIdx] as { type?: string; songId?: string } | undefined) : undefined;
    return {
      targetSongId: songId,
      trackedLiveSongId: liveSongRef.current?.songId,
      liveSlide: ctx.liveSlide,
      liveOrigin: ctx.getLiveOrigin?.() ?? null,
      liveItemType: item?.type,
      liveItemSongId: item?.songId,
    };
  }, [ctx.liveSlide, ctx.liveItemIdx, ctx.plan.items, ctx.getLiveOrigin]);
  const holdSongSwitch = useCallback((songId: string) => shouldHoldSongAutoSwitch(songSwitchInput(songId)), [songSwitchInput]);
  // Dedupe the "SWITCH HELD" log: once per songId per live-origin change (the
  // detection loop re-evaluates on every transcript tick).
  const heldLogKeysRef = useRef<Map<string, string>>(new Map());
  const logSwitchHeld = useCallback((songId: string, msg: string) => {
    // Key = live ORIGIN identity only (not live text) so advancing through the
    // live song's slides does not re-log the same hold on every slide.
    const key = liveOriginKey(songSwitchInput(songId));
    if (heldLogKeysRef.current.get(songId) === key) return;
    if (heldLogKeysRef.current.size > 100) heldLogKeysRef.current.clear();
    heldLogKeysRef.current.set(songId, key);
    console.log(msg);
  }, [songSwitchInput]);

  // ---- Part 6: auto-stage on ≥85% confidence, AUTO on ---------------------
  const stageSong = useCallback(async (songId: string, title: string, confidence: number, source: "detection" | "progression") => {
    if (stagingInFlightRef.current.has(songId)) return;
    if (liveSongRef.current?.songId === songId) return; // already live, nothing to stage
    stagingInFlightRef.current.add(songId);
    try {
      const slides = await fetchSongLyricSlides(songId);
      if (slides.length === 0) return;
      // Pre-select the slide being sung so the operator confirms the RIGHT slide
      // with one keypress (not always slide 1). Conservative; falls back to 0.
      const best = matchBestSlide(recentWordsRef.current, slides);
      const currentIdx = best.index >= 0 && best.confidence >= SONG_JUMP_SUGGEST_CONFIDENCE ? best.index : 0;
      setStagedSong({ songId, title, slides, currentIdx, confidence, source });
      console.log(`[song-autoprogression] staged "${title}" (${songId}) at ${Math.round(confidence)}% via ${source} — awaiting human confirm (press ${SONG_AUTOSTAGE_CONFIRM_KEY.replace("Key", "")})`, { ts: Date.now() });
    } catch {
      /* non-fatal — leave unstaged, detection will resurface naturally */
    } finally {
      stagingInFlightRef.current.delete(songId);
    }
  }, []);

  // ---- Part 6b: zero-click auto-live at SONG_AUTOLIVE_CONFIDENCE+ ---------
  // Mirrors Bible's doAutoFire guardrails: session-persisted fired-key replay
  // suppression + a min-gap cooldown. Unlike Bible's queue-and-fire-later
  // approach, a song that lands inside the cooldown simply falls back to
  // staging (never silently dropped, never double-fires) — simpler and
  // appropriate since this fires per-song, not per-transcript-segment.
  const autoLiveSong = useCallback(async (songId: string, title: string, confidence: number) => {
    if (stagingInFlightRef.current.has(songId)) return;
    if (liveSongRef.current?.songId === songId) return; // already live
    // 2026-09-14 rule-7 sign-off — THE chokepoint: while a DIFFERENT song is live
    // (by ANY evidence, see song-switch-guard.ts) the AI never auto-switches the
    // projector. Keep/stage the song as a chip for the operator instead.
    if (holdSongSwitch(songId)) {
      logSwitchHeld(songId, `[song-autolive] SWITCH HELD — "${title}" ${Math.round(confidence)}% while a different song is live → staged for operator confirm (never auto-switch)`);
      if (!stagedSongRef.current) void stageSong(songId, title, confidence, "detection");
      return;
    }
    // 2026-07-26 hard debounce — the field-report "glitching, repeatedly
    // firing GTF → LIVE toast" that survived v0.1.68's outer-effect guards.
    // Even after id + freshness dedup at the effect layer, Deepgram's
    // interim → final → whisper cascade produces 3-5 new suggestion IDs
    // per single utterance, each replacing the previous in place with
    // fresh id + ts. Add a hard 5s debounce PER SONG at the entry of
    // autoLiveSong so no matter how many times the outer effect calls in
    // for the same song, only the first one in a 5s window actually
    // proceeds. Different songs are unaffected — the map is per-songId.
    const lastAutoLiveAt = autoLiveDebounceRef.current.get(songId) ?? 0;
    if (Date.now() - lastAutoLiveAt < 5000) {
      console.log(`[song-autolive] hard-debounced: "${title}" (${songId}) — last fire ${Date.now() - lastAutoLiveAt}ms ago`);
      return;
    }
    autoLiveDebounceRef.current.set(songId, Date.now());
    // Replay suppression — same 5min-window pattern as AUTO_FIRED_SESSION_KEY.
    // 2026-07-24 fix: apply the guard ONLY when THE SAME song is already
    // live (echo suppression). Any other case — Bible live, media live,
    // different song live, or nothing live — is a legitimate content
    // switch and should be allowed through. Previously we bypassed the
    // guard only when a "different song" was live, which meant a Bible-
    // live scenario blocked a legit song swap. Same-song-already-live is
    // still short-circuited earlier at the top of this function.
    const sameSongAlreadyLive = liveSongRef.current !== null && liveSongRef.current.songId === songId;
    if (sameSongAlreadyLive) {
      try {
        const raw = window.sessionStorage.getItem(SONG_AUTO_FIRED_SESSION_KEY);
        const map: Record<string, number> = raw ? JSON.parse(raw) : {};
        const firedAt = map[songId];
        if (firedAt && Date.now() - firedAt < 5 * 60 * 1000) return;
      } catch { /* noop */ }
    }
    const now = Date.now();
    if (now - lastSongAutoLiveAtRef.current < SONG_AUTO_LIVE_MIN_GAP_MS) {
      // Inside cooldown — fall back to the human-confirm staging path rather
      // than queueing; a second high-confidence song this soon is rare
      // enough that requiring one keypress is the safer default.
      void stageSong(songId, title, confidence, "detection");
      return;
    }
    stagingInFlightRef.current.add(songId);
    try {
      const slides = await fetchSongLyricSlides(songId);
      // 2026-07-24 diagnostic: log slide count so we can see if
      // fetchSongLyricSlides is returning empty (which would silently
      // block auto-live and leave the song showing 0 slides in the
      // playlist too).
      console.log(`[latency] autoLiveSong slides fetched title="${title}" count=${slides.length}`);
      if (slides.length === 0) {
        console.warn(`[latency] autoLiveSong BLOCKED: 0 slides returned for songId=${songId} title="${title}"`);
        return;
      }
      // Start on the slide actually being sung, not always slide 1 (2026-09-06
      // "go to the slide they're singing"). Only when the recent words clearly &
      // unambiguously identify a slide (matchBestSlide is conservative); else
      // fall back to slide 0 — the previous behaviour, so no regression.
      const best = matchBestSlide(recentWordsRef.current, slides);
      const startIdx = best.index >= 0 && best.confidence >= SONG_JUMP_SUGGEST_CONFIDENCE ? best.index : 0;
      const text = slides[startIdx];
      // Re-check after the async fetch — a song may have gone live meanwhile.
      if (holdSongSwitch(songId)) {
        logSwitchHeld(songId, `[song-autolive] SWITCH HELD (post-fetch) — "${title}" while a different song is live → staged`);
        if (!stagedSongRef.current) setStagedSong({ songId, title, slides, currentIdx: startIdx, confidence, source: "detection" });
        return;
      }
      lastSongAutoLiveAtRef.current = now;
      ctx.onSendSlideToLive({ kind: "text", text }, undefined, { origin: { kind: "song", songId } });
      liveSongRef.current = { songId, title, slides, currentIdx: startIdx, confirmedAt: now };
      lastAdvanceTsRef.current = now;
      matchStreakRef.current = 0;
      notifyManualSongAdvance(songId, title);
      // 2026-07-25 field bug fix: when the AI auto-projects a song, also
      // update the operator's visible playlist selection + scroll it into
      // view + pulse-highlight it. Before this, operators had no visual
      // cue that the sidebar's currently-selected item had changed to the
      // song the AI just fired — they'd look for it manually.
      try {
        const playlistIdx = ctx.plan.items.findIndex((it) => (it as unknown as { songId?: string }).songId === songId);
        if (playlistIdx >= 0) {
          ctx.onSetPreviewItem(playlistIdx);
          if (typeof window !== "undefined") {
            const el = document.querySelector(`[data-playlist-item-idx="${playlistIdx}"]`) as HTMLElement | null;
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.classList.add("presentflow-song-pulse");
              setTimeout(() => el.classList.remove("presentflow-song-pulse"), 2000);
            }
          }
        } else if (ctx.onAddLibraryItem) {
          // Bug 3 (2026-08-12): the detected song isn't in the plan yet — add it
          // so its FULL slide set loads into the workspace (all slides viewable /
          // navigable / editable), mirroring the manual chip-click path. Only
          // the song-open flow; no detection/confidence/anti-replay logic.
          try { await ctx.onAddLibraryItem("song", { id: songId, title }); }
          catch { /* non-fatal — live already fired */ }
        }
        // Open the center workspace to the full song (same as the manual
        // handleSongChipClick path). The show-slides handler's AUTO-mode guard
        // prevents it from overwriting the song that just went live.
        dispatchInternal("presentflow:show-slides", {});
      } catch { /* non-fatal — visual polish only */ }
      try {
        const raw = window.sessionStorage.getItem(SONG_AUTO_FIRED_SESSION_KEY);
        const map: Record<string, number> = raw ? JSON.parse(raw) : {};
        map[songId] = now;
        const cutoff = now - 30 * 60 * 1000;
        for (const k of Object.keys(map)) if (map[k] < cutoff) delete map[k];
        window.sessionStorage.setItem(SONG_AUTO_FIRED_SESSION_KEY, JSON.stringify(map));
      } catch { /* noop */ }
      forceRender((n) => n + 1);
      console.log(`[song-autoprogression] AUTO-LIVE (zero-click, ${Math.round(confidence)}% confidence): "${title}" (${songId})`, { ts: now });
      toast.success(`"${title}" → LIVE (auto, ${Math.round(confidence)}%)`);
    } catch {
      /* non-fatal — leave unhandled, detection will resurface naturally */
    } finally {
      stagingInFlightRef.current.delete(songId);
    }
  }, [ctx, stageSong, holdSongSwitch, logSwitchHeld]);

  useEffect(() => {
    // 2026-07-26 policy change (user sign-off): song auto-fire is NO
    // LONGER gated by the AUTO/MANUAL toggle. Rule 7's confidence-tier
    // policy (2026-08-14: ≥85% auto-live — and only if it clearly beats the
    // next-best song — 70-84% manual chip / G-key, <70% ignored) applies
    // unconditionally. The AUTO/MANUAL toggle now only controls Bible
    // auto-approve (its original purpose). Rationale: field report from
    // JPD — operator was in MANUAL mode, Amazing Grace hit 87% but
    // silently no-op'd; user expected the ≥70% policy to fire regardless
    // of the Bible-focused AUTO toggle. Songs have their own auth model
    // (per-confidence-tier + G-key for the mid band); the AUTO toggle was
    // an extra gate that made MANUAL mode useless for song detection.
    // Bible auto-approve still respects `autoApprove` in the AUTO_APPROVE
    // effect further down — that gate is untouched.
    // 2026-07-26 fix — carry the suggestion `id` + `ts` through to the
    // candidate so we can:
    //   (a) skip stale detections (ts older than freshness window)
    //   (b) dedupe by suggestion id (fired-for-this-exact-detection set)
    // Suggestions are UPDATED IN PLACE in useAudioStream by songId key
    // (line ~496) — each new detection replaces the old with a new id +
    // fresh ts. So the freshness check is a valid "is this a NEW detection
    // event or the same one sitting stale in the array?" heuristic.
    const candidates: { songId: string; title: string; confidence: number; suggestionId: string; ts: number }[] = [];
    for (const s of ctx.audio.suggestions) {
      if (s.type !== "song" && s.type !== "lyric") continue;
      if (s.confidence < SONG_STAGE_CONFIDENCE) continue;
      const songId = s.match?.songId;
      if (!songId) continue;
      candidates.push({ songId, title: s.match.title, confidence: s.confidence, suggestionId: s.id, ts: s.ts });
    }
    for (const s of ctx.audio.songSuggestions) {
      if (s.confidence < SONG_STAGE_CONFIDENCE || !s.songId) continue;
      // songSuggestions doesn't carry ts; treat as fresh (server-side pushed).
      candidates.push({ songId: s.songId, title: s.title, confidence: s.confidence, suggestionId: s.suggestionId, ts: Date.now() });
    }
    if (candidates.length === 0) return;
    // Highest confidence first.
    candidates.sort((a, b) => b.confidence - a.confidence);
    // 2026-07-24 diagnostic: single-line log per candidate arrival so
    // we can see what's happening to song auto-fire in the console.
    // Format designed to grep: [latency] song-candidate title="..." conf=X
    console.log(`[latency] song-candidate title="${candidates[0].title}" conf=${candidates[0].confidence} floor=${SONG_AUTOLIVE_CONFIDENCE} staged=${!!stagedSong} liveSong=${liveSongRef.current?.songId || "none"}`);

    // Promotion: a song already sitting staged (marked handled at, say, 62%)
    // whose CONTINUED detection has since climbed to SONG_AUTOLIVE_CONFIDENCE+
    // must not stay stuck waiting for a "G" press forever — being staged once
    // shouldn't permanently exempt a song from the zero-click tier once the
    // AI is actually confident about it. Check this before the normal
    // stagedOrHandledRef skip below.
    if (stagedSong && !ctx.audio.musicSuspected) {
      // WS1 — while music is suspected, a staged song must NOT auto-promote to
      // live on a confidence rise; it waits for the operator's G confirm.
      const risen = candidates.find((c) => c.songId === stagedSong.songId && c.confidence >= SONG_AUTOLIVE_CONFIDENCE);
      // Synchronous dedupe BEFORE the async autoLiveSong call, using a
      // DIFFERENT ref than autoLiveSong's own stagingInFlightRef (which it
      // doesn't set until after its cooldown/replay checks) — `stagedSong`
      // React state won't reflect setStagedSong(null) until the next render,
      // so a second transcript update landing in the same tick could
      // otherwise still see `stagedSong` non-null and re-enter this branch
      // before autoLiveSong's own guards kick in.
      // Rule 7 (2026-09-14): a risen staged song must NOT auto-switch while a
      // different song is live — keep it staged (don't drop it) and fall through.
      // autoLiveSong enforces the same hold; checking here too avoids clearing
      // the staged banner before autoLiveSong would refuse.
      if (risen && holdSongSwitch(risen.songId)) {
        logSwitchHeld(risen.songId, `[song-autolive] SWITCH HELD — risen staged "${risen.title}" ${risen.confidence}% while a different song is live → stays staged`);
      } else if (risen && !promotionInFlightRef.current.has(risen.songId)) {
        promotionInFlightRef.current.add(risen.songId);
        setStagedSong(null);
        void autoLiveSong(risen.songId, risen.title, risen.confidence).finally(() => {
          promotionInFlightRef.current.delete(risen.songId);
        });
        return;
      }
    }

    const now = Date.now();
    // Worship-mode setlist bypass (2026-08-20 field directive "why do I have to
    // push it live?"): during live worship the room is full of instruments +
    // singing, so `musicSuspected` is ~always true and the music gate below
    // downgrades every song to a manual chip — which is exactly the "I had to do
    // it all manually" pain. When the operator has declared Worship mode, a match
    // to a song in TODAY'S plan is trusted enough to zero-click through the music
    // gate (the disambiguation margin still applies, off-plan songs never bypass).
    const worshipMode = ctx.serviceMode === "worship";
    const planSongIdSet = new Set(
      ctx.plan.items.map((it) => (it as unknown as { songId?: string }).songId).filter(Boolean) as string[],
    );
    for (const c of candidates) {
      // 2026-07-26 stale-echo fix — reject old suggestions that are still
      // sitting in the array from an earlier detection. Without this, my
      // v0.1.67 3s floor let stale detections re-fire every 3s (Great Is
      // Thy Faithfulness auto-fired repeatedly because the suggestion
      // persisted at 95% confidence in the array even after the user stopped
      // singing it). A new real detection updates the suggestion IN PLACE
      // (useAudioStream:496) with fresh ts + new id, so freshness + id-dedup
      // together fire on new events only.
      if (now - c.ts > SUGGESTION_FRESHNESS_MS) continue;
      if (firedSuggestionIdsRef.current.has(c.suggestionId)) continue;
      const handledAt = stagedOrHandledRef.current.get(c.songId);
      // Cooldown bypass logic:
      //   - Same song IS live → skip (echo suppression). No point re-firing
      //     the same slide.
      //   - Different content (song or Bible or nothing) is live → let it
      //     through with a floor to prevent chatter. This is the case that
      //     was breaking Amazing Grace auto-live when Bible was on screen:
      //     the previous version only bypassed when a DIFFERENT SONG was
      //     live, so Bible-live + Amazing-Grace-previously-handled = the
      //     high-confidence song detection got silently swallowed.
      // 2026-07-24 fix: check for "this exact song currently live" rather
      // than "some other song is live" — matches operator intent that any
      // legitimate content switch should be allowed to fire.
      // 2026-07-25 field bug: user dismissed staged banner → banner
      // re-appeared within seconds because handledAt was ~15s. Now check
      // dismissedSongsRef first — if operator explicitly X'd this song,
      // skip re-staging for the full dismissal TTL (10 min).
      const dismissedAt = dismissedSongsRef.current.get(c.songId);
      if (dismissedAt && now - dismissedAt < SONG_DISMISS_TTL_MS) continue;
      // 2026-07-26 fix — enable real preacher/worship-leader back-and-forth.
      // The previous 60s floor for the different-song-live case blocked a
      // legitimate return to a song that was fired 30s earlier (Amazing
      // Grace → GTF → Amazing Grace within a couple minutes). autoLiveSong
      // already has its own layered guards: (a) same-song-live short-circuit,
      // (b) 5-min replay map for same-song, (c) 800ms min-gap between any
      // two auto-fires. So the outer effect only needs a THIN quick-refire
      // floor to swallow per-transcript-word chatter during ONE ongoing
      // song, not a 60s brick wall that breaks song swaps.
      //   - same song already live → skip (echo suppression stays 5 min)
      //   - different song / nothing live → allow through if gap ≥ 3s,
      //     which is longer than Deepgram's ~1s finalize cadence but well
      //     under any realistic content-swap interval
      const SONG_QUICK_REFIRE_MS = 3 * 1000;
      const sameSongAlreadyLive = liveSongRef.current !== null && liveSongRef.current.songId === c.songId;
      if (handledAt) {
        const gap = now - handledAt;
        if (sameSongAlreadyLive && gap < SONG_REDETECT_COOLDOWN_MS) continue;
        if (!sameSongAlreadyLive && gap < SONG_QUICK_REFIRE_MS) continue;
      }
      // WS1 — music/choir gate. When the input looks like worship/choir/music
      // (strong signal but persistently low ASR confidence), do NOT zero-click
      // auto-project — a "song" detected off singing is exactly the false
      // trigger we want to avoid. Downgrade to STAGE so the operator confirms
      // with the G key. This only RAISES the bar during music (conservative —
      // CLAUDE.md rule 7); clean confident speech clears musicSuspected and
      // auto-live resumes normally.
      const musicHold = !!ctx.audio.musicSuspected && !(worshipMode && planSongIdSet.has(c.songId));
      // 2026-08-14 similar-song disambiguation (user directive): songs share
      // lyrics with each other, so a high raw confidence isn't enough to
      // ZERO-CLICK project — the top song must also clearly BEAT the next-best
      // DIFFERENT song. If two songs match the sung/spoken words almost equally
      // (within SONG_DISAMBIG_MARGIN), we can't be sure which one it is, so we
      // downgrade to a manual chip (stage) instead of risking the wrong song on
      // the projector. `candidates` is sorted desc, so the first entry with a
      // different songId is the runner-up.
      const runnerUp = candidates.find((x) => x.songId !== c.songId);
      const ambiguous = !!runnerUp && (c.confidence - runnerUp.confidence) < SONG_DISAMBIG_MARGIN;
      if (ambiguous) {
        console.log(`[song-autolive] AMBIGUOUS — "${c.title}" ${c.confidence}% vs "${runnerUp!.title}" ${runnerUp!.confidence}% (< ${SONG_DISAMBIG_MARGIN}pt margin) → staging for manual pick instead of auto-project`);
      }
      // Don't change songs mid-song unless it's a MASSIVE change (2026-09-06
      // user directive). If a DIFFERENT song is already live, a new song must
      // clear the higher SONG_SWITCH_WHILE_LIVE_CONFIDENCE bar to auto-switch
      // the projector; otherwise it's staged as a manual chip (suggest) rather
      // than auto-swapping. Starting a song when nothing/other content is live
      // keeps the normal SONG_AUTOLIVE_CONFIDENCE bar.
      // 2026-09-14 (user directive, supersedes the 95% auto-switch): while a
      // DIFFERENT song is live the AI NEVER switches the projector on its own —
      // even at ≥SONG_SWITCH_WHILE_LIVE_CONFIDENCE it only stages the new song
      // as a manual chip ("give them the option in case you are wrong").
      // Conservative ANY-evidence check (covers library-sent / untracked songs).
      const differentSongLive = holdSongSwitch(c.songId);
      if (differentSongLive && c.confidence >= SONG_SWITCH_WHILE_LIVE_CONFIDENCE) {
        logSwitchHeld(c.songId, `[song-autolive] SWITCH HELD — "${c.title}" ${c.confidence}% while a different song is live → staging for operator confirm (never auto-switch)`);
      }
      if (!differentSongLive && c.confidence >= SONG_AUTOLIVE_CONFIDENCE && !musicHold && !ambiguous) {
        stagedOrHandledRef.current.set(c.songId, now);
        firedSuggestionIdsRef.current.add(c.suggestionId);
        // Prune fired-id set to last 200 entries (LRU-ish via clear+re-add
        // when it grows) — bounds long-session memory without needing a
        // separate timer.
        if (firedSuggestionIdsRef.current.size > 200) {
          const keep = Array.from(firedSuggestionIdsRef.current).slice(-100);
          firedSuggestionIdsRef.current = new Set(keep);
        }
        void autoLiveSong(c.songId, c.title, c.confidence);
        break;
      }
      if (stagedSong) break; // one staged banner at a time
      stagedOrHandledRef.current.set(c.songId, now);
      firedSuggestionIdsRef.current.add(c.suggestionId);
      if (firedSuggestionIdsRef.current.size > 200) {
        const keep = Array.from(firedSuggestionIdsRef.current).slice(-100);
        firedSuggestionIdsRef.current = new Set(keep);
      }
      void stageSong(c.songId, c.title, c.confidence, "detection");
      break;
    }
    // autoApprove intentionally NOT in deps — see 2026-07-26 policy note
    // above (song auto-fire no longer gated on the AUTO/MANUAL toggle).
  }, [ctx.audio.suggestions, ctx.audio.songSuggestions, stagedSong, stageSong, autoLiveSong, holdSongSwitch, logSwitchHeld]);

  // ---- Part 6: THE ONE confirm path that may touch ctx.onSendSlideToLive --
  const confirmStagedSongLive = useCallback(() => {
    if (!stagedSong) return;
    if (confirmPendingRef.current) return; // guard double-fire on key repeat
    confirmPendingRef.current = true;
    try {
      const text = stagedSong.slides[stagedSong.currentIdx];
      if (!text) return;
      // The single explicit human action (keypress) required by CLAUDE.md
      // rule 7 / the task invariant. Every other code path in this module
      // is forbidden from calling this.
      ctx.onSendSlideToLive({ kind: "text", text }, undefined, { origin: { kind: "song", songId: stagedSong.songId } });
      liveSongRef.current = {
        songId: stagedSong.songId,
        title: stagedSong.title,
        slides: stagedSong.slides,
        currentIdx: stagedSong.currentIdx,
        confirmedAt: Date.now(),
      };
      lastAdvanceTsRef.current = Date.now();
      matchStreakRef.current = 0;
      console.log(`[song-autoprogression] human-confirmed LIVE: "${stagedSong.title}" (${stagedSong.songId}) slide ${stagedSong.currentIdx + 1}/${stagedSong.slides.length}`, { ts: Date.now() });
      toast.success(`"${stagedSong.title}" → LIVE`);
      notifyManualSongAdvance(stagedSong.songId, stagedSong.title);
      // Switch center panel to slides so the operator can navigate between
      // song slides after confirming. AUTO-mode guard in the show-slides
      // handler prevents the live-follow effect from re-sending the wrong slide.
      dispatchInternal("presentflow:show-slides", {});
      // Add to playlist if not already there so the center slides panel shows
      // this song's grid rather than the previous playlist item's slides.
      // Fire-and-forget: if it fails, the song is still live; the operator
      // will just see the prior item's slides in the center panel.
      const capturedSong = stagedSong;
      const inPlaylist = ctx.plan.items.some(
        (it) => it.type === "song" && it.songId === capturedSong.songId,
      );
      if (!inPlaylist && ctx.onAddLibraryItem) {
        const addResult = ctx.onAddLibraryItem("song", { id: capturedSong.songId, title: capturedSong.title });
        if (addResult instanceof Promise) addResult.catch(() => { /* non-fatal */ });
      }
      setStagedSong(null);
      forceRender((n) => n + 1);
    } finally {
      confirmPendingRef.current = false;
    }
  }, [stagedSong, ctx]);

  // Confirm keypress listener — single dedicated key, ignores typing
  // contexts and open overlays same as the global hotkey hook.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isAnyOverlayOpen()) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = (target.tagName || "").toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      if (e.code !== SONG_AUTOSTAGE_CONFIRM_KEY) return;
      if (!stagedSong) return;
      e.preventDefault();
      confirmStagedSongLive();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stagedSong, confirmStagedSongLive]);

  // Populate/refresh the plan-song slide cache so we can recognise which song a
  // live slide belongs to. Fetches only songs not already cached; bounded to the
  // plan's songs (a handful). Runs on mount + whenever the plan's songs change.
  const planSongIdsKey = ctx.plan.items.map((it) => (it as unknown as { songId?: string }).songId).filter(Boolean).join(",");
  useEffect(() => {
    let cancelled = false;
    const songIds = Array.from(new Set(
      ctx.plan.items.map((it) => (it as unknown as { songId?: string }).songId).filter((v): v is string => !!v),
    ));
    (async () => {
      let added = false;
      for (const songId of songIds) {
        if (cancelled) return;
        if (songSlidesCacheRef.current.has(songId)) continue;
        try {
          const slides = await fetchSongLyricSlides(songId);
          if (cancelled) return;
          const byText = new Map<string, number>();
          slides.forEach((t, i) => { const n = normalizeLyric(t); if (n && !byText.has(n)) byText.set(n, i); });
          songSlidesCacheRef.current.set(songId, { slides, byText });
          added = true;
        } catch { /* non-fatal — recognition just won't fire for this song */ }
      }
      // Nudge the reconcile effect so a song projected during this async load
      // window (before its slides arrived) gets tracked once they're cached.
      if (added && !cancelled) setCacheVersion((v) => v + 1);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSongIdsKey, cacheVersion]);

  // Invalidate a song's cached slides when it's edited (e.g. Add slide), so the
  // tracker + jump suggestions never use stale text/indices. Fired by the
  // add-slide handlers after createSongSlide succeeds.
  useEffect(() => {
    const onSongEdited = (e: Event) => {
      const detail = (e as CustomEvent).detail as SongSlidesChangedDetail | undefined;
      const plan = songSlidesChangedPlan(detail, liveSongRef.current?.songId);
      if (!plan.invalidate) return;
      songSlidesCacheRef.current.delete(detail!.songId!);
      // Quick edit save passes keepLiveTracking: keep following the live song so a
      // same-song detection can't re-project slide 1 before the re-fetch; the
      // reconcile effect (deps include cacheVersion) re-syncs the index after it.
      if (plan.clearLiveTracking) {
        const cur = liveSongRef.current;
        // Read via the ref: this listener is registered once ([] deps), so ctx.liveSlide would be stale.
        const ls = liveSlideForHintRef.current;
        const lt = ls?.kind === "text" ? ls.text : null;
        structuralEditHintRef.current = cur && lt != null
          ? { songId: cur.songId, slides: cur.slides, currentIdx: cur.currentIdx, liveText: lt, at: Date.now() }
          : null;
        liveSongRef.current = null;
      }
      setSlideJumpSuggestion(null);
      setCacheVersion((v) => v + 1); // trigger a re-fetch + re-reconcile
    };
    window.addEventListener("presentflow:song-slides-changed", onSongEdited);
    return () => window.removeEventListener("presentflow:song-slides-changed", onSongEdited);
  }, []);

  // Keep liveSongRef in sync with WHAT'S ACTUALLY LIVE, from any source. When a
  // text slide goes live, find which cached plan-song contains that exact slide
  // and track it (song id + slide index); when the live content isn't a known
  // song slide (a verse, media, blank, or an un-cached song), stop tracking.
  // This is the linchpin of the "don't re-project a song that's already up" fix:
  // the same-song guards in stageSong/autoLiveSong only work when liveSongRef is
  // set, and previously it was set ONLY by the AI/confirm paths — so a song the
  // operator started by hand wasn't recognised and repeats re-fired slide 1.
  useEffect(() => {
    const liveText = ctx.liveSlide?.kind === "text" ? ctx.liveSlide.text : null;
    if (liveText == null) { liveSongRef.current = null; structuralEditHintRef.current = null; return; }
    const norm = normalizeLyric(liveText);
    let live = liveSongRef.current;
    // A kept track (Quick edit save → keepLiveTracking) must follow the RE-LOADED
    // slides, not the pre-edit list: swap in the fresh cache entry and recompute
    // the index against it (both branches below then read current lyrics). If the
    // live text is gone from the song, drop tracking and fall through to the full
    // search — the same outcome as main's clear-and-rebuild. No-op when the cache
    // entry is the one already tracked.
    if (live) {
      const refreshed = refreshTrackedSong(live, songSlidesCacheRef.current.get(live.songId)?.slides, norm, normalizeLyric);
      if (refreshed !== live) { liveSongRef.current = refreshed; live = refreshed; }
    }
    // Structural-edit hint: consumed (cleared) as soon as its song's fresh slides
    // are cached, whether or not a branch below uses it — never goes stale.
    // Only valid while the SAME text is still live and within ~5s of the edit;
    // dropped if the live slide changed, it expired, or another song is tracked.
    let hint = structuralEditHintRef.current;
    if (hint && (hint.liveText !== liveText || Date.now() - hint.at >= STRUCTURAL_HINT_TTL_MS || (live && live.songId !== hint.songId))) {
      structuralEditHintRef.current = null;
      hint = null;
    }
    const usableHint = hint;
    const hintFor = (songId: string, freshSlides: string[]): number | null => {
      if (!usableHint || usableHint.songId !== songId) return null;
      return relocateLyricIndex(usableHint.slides, usableHint.currentIdx, freshSlides, norm, normalizeLyric);
    };
    if (usableHint && songSlidesCacheRef.current.has(usableHint.songId)) structuralEditHintRef.current = null;
    const declared = ctx.getLiveOrigin?.();
    // A DECLARED (or plan-resolved — not merely inferred) NON-song origin → the operator
    // sent this as non-song content: stop following a song even if the line is
    // shared with one.
    if (declared && declared.kind !== "song" && !declared.inferred) { liveSongRef.current = null; return; }
    // A DECLARED song origin with id wins over lyric matching (a shared line
    // clicked from song A binds to A even if the tracker followed B). Index is
    // resolved NEAREST the tracked position so a repeated chorus stays on the copy
    // auto-advance / bounce-back / jump just set (never snaps to the first copy).
    if (declared?.kind === "song" && declared.songId) {
      const entry = songSlidesCacheRef.current.get(declared.songId);
      if (entry) {
        const prevIdx = live?.songId === declared.songId ? live.currentIdx : null;
        const hinted = prevIdx == null ? hintFor(declared.songId, entry.slides) : null;
        const idx = hinted != null && hinted >= 0 ? hinted : resolveLyricIndex(entry.slides.map(normalizeLyric), norm, prevIdx);
        if (idx >= 0) {
          if (live?.songId !== declared.songId || live.currentIdx !== idx) {
            const title = (ctx.plan.items.find((it) => (it as unknown as { songId?: string }).songId === declared.songId) as { title?: string } | undefined)?.title ?? "";
            liveSongRef.current = live?.songId === declared.songId
              ? { ...live, currentIdx: idx }
              : { songId: declared.songId, title, slides: entry.slides, currentIdx: idx, confirmedAt: Date.now() };
          }
          return;
        }
      }
    }
    // Prefer following the currently-tracked song (handles manual ← → within it),
    // keeping/nearest to the tracked index.
    if (live) {
      const idxInLive = resolveLyricIndex(live.slides.map(normalizeLyric), norm, live.currentIdx);
      if (idxInLive >= 0) { if (idxInLive !== live.currentIdx) liveSongRef.current = { ...live, currentIdx: idxInLive }; return; }
    }
    // Otherwise search all cached plan songs for a slide with this exact text.
    // Collect ALL matches first: if the same line appears in more than one song
    // (worship sets share lines — "hallelujah", "holy holy holy"), binding to
    // the first would mis-attribute the live song, so we leave it untracked.
    // Also ignore trivially-short lines (<3 words) which collide constantly.
    const wordCount = norm.split(" ").filter(Boolean).length;
    const matches: Array<{ songId: string; idx: number }> = [];
    for (const [songId, entry] of songSlidesCacheRef.current) {
      const idx = entry.byText.get(norm);
      if (idx != null) matches.push({ songId, idx });
      if (matches.length > 1) break;
    }
    if (matches.length === 1 && wordCount >= 3) {
      const { songId } = matches[0];
      const entry = songSlidesCacheRef.current.get(songId)!;
      const hinted = hintFor(songId, entry.slides);
      const idx = hinted != null && hinted >= 0 ? hinted : matches[0].idx;
      const title = (ctx.plan.items.find((it) => (it as unknown as { songId?: string }).songId === songId) as { title?: string } | undefined)?.title ?? "";
      liveSongRef.current = { songId, title, slides: entry.slides, currentIdx: idx, confirmedAt: Date.now() };
      setSlideJumpSuggestion(null); // reconciled — clear any stale jump chip
      return;
    }
    // Live content isn't an unambiguously-recognised song slide → stop tracking.
    liveSongRef.current = null;
  }, [ctx.liveSlide, ctx.plan.items, cacheVersion, ctx.getLiveOrigin]);

  // Any OTHER manual operator action (click anywhere, or any keydown that
  // isn't our confirm key) cancels Part 7 auto-advance tracking and starts a
  // cooldown so the AI never fights the operator.
  useEffect(() => {
    const cancelTracking = () => {
      cooldownUntilRef.current = Date.now() + 2000; // 4s → 2s (see Bible cancel note)
      matchStreakRef.current = 0;
      interimMatchStreakRef.current = 0;
    };
    const onClick = () => cancelTracking();
    const onKeyAny = (e: KeyboardEvent) => {
      if (e.code === SONG_AUTOSTAGE_CONFIRM_KEY && !e.metaKey && !e.ctrlKey && !e.altKey) return; // our own confirm — not a "fight"
      cancelTracking();
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyAny, true);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyAny, true);
    };
  }, []);

  // ---- Part 7: word-timing slide auto-advance within the already-live song
  // NOTE on the invariant: this is the one place besides the confirm handler
  // that touches ctx.onSendSlideToLive. It is deliberately narrow: it only
  // fires when `liveSongRef.current` is set, and that ref is ONLY ever set
  // inside `confirmStagedSongLive` above (a human keypress) — never by a
  // detection alone. So every slide it pushes live belongs to a song a human
  // already reviewed in full (Part 6 shows the whole song's lyrics before
  // confirm) and already explicitly sent live. This function moves the
  // ALREADY-LIVE output forward through content the operator has seen, using
  // the same "next slide" semantics manual navigation uses — it never
  // originates a new live push for content nobody has reviewed.
  useEffect(() => {
    const last = ctx.audio.transcript[ctx.audio.transcript.length - 1];
    if (!last) return;
    const words = (last.words?.map((w) => w.w) ?? last.text.split(/\s+/)).filter(Boolean);
    if (words.length === 0) return;
    recentWordsRef.current = [...recentWordsRef.current, ...words].slice(-24);
    lastWordTsRef.current = Date.now();

    const live = liveSongRef.current;
    if (!live) { if (slideJumpSuggestionRef.current) setSlideJumpSuggestion(null); return; }

    // SUGGEST-ONLY within-song jump (2026-09-06, user chose suggest-not-auto):
    // if the singer has clearly moved to a DIFFERENT slide of the live song,
    // surface a one-tap "go to slide N" chip. The projector NEVER moves on its
    // own here (song auto-advance stays disabled). Conservative confidence bar
    // + matchBestSlide's ambiguity guard keep near-duplicate slides quiet.
    {
      const bestNow = matchBestSlide(recentWordsRef.current, live.slides);
      const cur = slideJumpSuggestionRef.current;
      const qualifies = bestNow.index >= 0
        && bestNow.index !== live.currentIdx
        && bestNow.confidence >= SONG_JUMP_SUGGEST_CONFIDENCE;
      if (qualifies) {
        if (cur?.index !== bestNow.index || cur?.songId !== live.songId) {
          setSlideJumpSuggestion({ songId: live.songId, index: bestNow.index, text: live.slides[bestNow.index], confidence: bestNow.confidence });
        }
      } else if (cur) {
        // Signal decayed (back on the live slide, ambiguous, low confidence, or
        // no match) → clear the chip so it never latches on a stale slide.
        setSlideJumpSuggestion(null);
      }
    }

    if (Date.now() < cooldownUntilRef.current) return;
    // Dynamic floor: short slides (<5 content words) need more time to avoid
    // double-advancing on a single sung phrase.
    const slideContentWords = slideWords(live.slides[live.currentIdx]);
    const minFloor = slideContentWords.length < 5 ? SONG_SHORT_SLIDE_FLOOR_MS : SONG_SLIDE_FLOOR_MS;
    if (Date.now() - lastAdvanceTsRef.current < minFloor) return;
    const nextIdx = live.currentIdx + 1;
    if (nextIdx >= live.slides.length) return; // last slide — see Part 8 below

    const result = matchNextSlide(recentWordsRef.current, live.slides[nextIdx]);
    if (result.consecutiveMatches >= 3) {
      matchStreakRef.current += 1;
    } else {
      matchStreakRef.current = 0;
    }
    // Coverage bypass: if 80%+ of the current slide has been spoken, a single
    // transcript match against the next slide is trustworthy enough — no need
    // to wait for a second segment (streak=1 instead of 2).
    const currCoverage = scoreCoverage(recentWordsRef.current, live.slides[live.currentIdx]);
    const requiredStreak = currCoverage >= 0.80 ? 1 : 2;
    if (matchStreakRef.current >= requiredStreak) {
      if (!tryAutoMoveRef.current(live.currentIdx, nextIdx)) { matchStreakRef.current = 0; return; }
      const text = live.slides[nextIdx];
      ctx.onSendSlideToLive({ kind: "text", text }, undefined, { origin: { kind: "song", songId: live.songId } });
      liveSongRef.current = { ...live, currentIdx: nextIdx };
      lastAdvanceTsRef.current = Date.now();
      matchStreakRef.current = 0;
      bounceBackStreakRef.current = 0;
      forceRender((n) => n + 1);
      setAutoAdvanceFlash(true);
      console.log(`[song-autoprogression] auto-advanced "${live.title}" to slide ${nextIdx + 1}/${live.slides.length} (word-match confidence ${result.confidence}%, coverage ${Math.round(currCoverage * 100)}%, streak=${requiredStreak})`, { ts: Date.now() });
      window.setTimeout(() => setAutoAdvanceFlash(false), 2500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.audio.transcript]);

  // ---- Predictive interim-based advance (latency fix) ----------------------
  // The effect above only reacts to finalized/candidate transcript segments,
  // which by design lag a beat behind speech. Deepgram's raw `interim`
  // messages arrive continuously and far sooner — `ctx.audio.interim` is
  // already wired through (useAudioStream.ts) but nothing consumed it for
  // matching. This runs the SAME matchNextSlide scoring against interim text
  // so a real match registers a beat earlier, using a stricter bar than the
  // final-based path (4 consecutive words vs 3, its own independent 2-hit
  // sustain streak) since interim hypotheses can still revise — never a
  // looser guardrail, just a faster read on the same signal. Feeds the exact
  // same liveSongRef-gated call site; never originates a live push on its own.
  useEffect(() => {
    const interimText = ctx.audio.interim;
    if (!interimText) return;
    const words = interimText.split(/\s+/).filter(Boolean);
    if (words.length === 0) return;

    const live = liveSongRef.current;
    if (!live) return;
    if (Date.now() < cooldownUntilRef.current) return;
    const slideContentWordsInterim = slideWords(live.slides[live.currentIdx]);
    const minFloorInterim = slideContentWordsInterim.length < 5 ? SONG_SHORT_SLIDE_FLOOR_MS : SONG_SLIDE_FLOOR_MS;
    if (Date.now() - lastAdvanceTsRef.current < minFloorInterim) return;
    const nextIdx = live.currentIdx + 1;
    if (nextIdx >= live.slides.length) return;

    // Combine committed recent words with the live interim tail so a match
    // spanning a segment boundary (e.g. "...loved the" final + "world" interim)
    // still registers, without permanently committing unconfirmed interim
    // words into recentWordsRef (that stays final-only).
    const combined = [...recentWordsRef.current, ...words].slice(-24);
    const result = matchNextSlide(combined, live.slides[nextIdx], 4);
    if (result.consecutiveMatches >= 4) {
      interimMatchStreakRef.current += 1;
    } else {
      interimMatchStreakRef.current = 0;
    }
    if (interimMatchStreakRef.current >= 2) {
      if (!tryAutoMoveRef.current(live.currentIdx, nextIdx)) { interimMatchStreakRef.current = 0; return; }
      const text = live.slides[nextIdx];
      ctx.onSendSlideToLive({ kind: "text", text }, undefined, { origin: { kind: "song", songId: live.songId } });
      liveSongRef.current = { ...live, currentIdx: nextIdx };
      lastAdvanceTsRef.current = Date.now();
      matchStreakRef.current = 0;
      interimMatchStreakRef.current = 0;
      bounceBackStreakRef.current = 0;
      forceRender((n) => n + 1);
      setAutoAdvanceFlash(true);
      console.log(`[song-autoprogression] predictive interim advance "${live.title}" to slide ${nextIdx + 1}/${live.slides.length} (confidence ${result.confidence}%)`, { ts: Date.now() });
      window.setTimeout(() => setAutoAdvanceFlash(false), 2500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.audio.interim]);

  // ---- Part 7c: silence + coverage advance (500ms ticker) ------------------
  // When a slide has been substantially covered in speech (≥ SONG_COVERAGE_THRESHOLD)
  // AND there has been sustained silence (≥ SONG_SILENCE_ADVANCE_MS), the
  // singer/speaker is done with this slide and has paused — advance.
  // Handles the "reads verse, pauses to explain" pattern where the word-match
  // path (Part 7/7b) never fires because the NEXT slide's words haven't been
  // spoken yet.
  // Uses a setInterval so it can fire during silence when no transcript arrives.
  // All state is accessed via refs to avoid stale closures.
  useEffect(() => {
    const iv = window.setInterval(() => {
      const live = liveSongRef.current;
      if (!live) return;
      if (Date.now() < cooldownUntilRef.current) return;
      const contentWords = slideWords(live.slides[live.currentIdx]);
      const minFloor = contentWords.length < 5 ? SONG_SHORT_SLIDE_FLOOR_MS : SONG_SLIDE_FLOOR_MS;
      if (Date.now() - lastAdvanceTsRef.current < minFloor) return;
      const silenceMs = Date.now() - lastWordTsRef.current;
      if (silenceMs < SONG_SILENCE_ADVANCE_MS) return; // not silent enough yet
      const nextIdx = live.currentIdx + 1;
      if (nextIdx >= live.slides.length) return;
      const cov = scoreCoverage(recentWordsRef.current, live.slides[live.currentIdx]);
      if (cov < SONG_COVERAGE_THRESHOLD) return; // haven't heard enough of this slide
      if (!tryAutoMoveRef.current(live.currentIdx, nextIdx)) return;
      // Silence after ≥ 65% of slide spoken → done, advance
      const text = live.slides[nextIdx];
      sendLiveStableRef.current({ kind: "text", text }, undefined, { origin: { kind: "song", songId: live.songId } });
      liveSongRef.current = { ...live, currentIdx: nextIdx };
      lastAdvanceTsRef.current = Date.now();
      matchStreakRef.current = 0;
      interimMatchStreakRef.current = 0;
      bounceBackStreakRef.current = 0;
      forceRender((n) => n + 1);
      setAutoAdvanceFlash(true);
      console.log(`[song-autoprogression] silence+coverage advance "${live.title}" to slide ${nextIdx + 1}/${live.slides.length} (coverage ${Math.round(cov * 100)}%, silence ${Math.round(silenceMs)}ms)`, { ts: Date.now() });
      window.setTimeout(() => setAutoAdvanceFlash(false), 2500);
    }, 500);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Part 7d: transcript-based bounce-back --------------------------------
  // If recent transcript words strongly match the PREVIOUS slide's opening
  // AND we advanced within the last 6s, we moved too early — reverse.
  // Symmetric speed with forward advance (single streak, minConsecutive=4
  // for higher bar): "bounce back just as quickly."
  useEffect(() => {
    const last = ctx.audio.transcript[ctx.audio.transcript.length - 1];
    if (!last) return;
    const live = liveSongRef.current;
    if (!live || live.currentIdx === 0) return;
    if (Date.now() < cooldownUntilRef.current) return;
    const msSinceAdvance = Date.now() - lastAdvanceTsRef.current;
    // Only valid within a 0.8–6s window after advancing: too soon = just advanced,
    // too late = operator would have noticed and acted manually.
    if (msSinceAdvance < 800 || msSinceAdvance > 6000) return;
    const words = (last.words?.map((w) => w.w) ?? last.text.split(/\s+/)).filter(Boolean);
    const combined = [...recentWordsRef.current, ...words].slice(-24);
    const prevResult = matchNextSlide(combined, live.slides[live.currentIdx - 1], 4);
    if (prevResult.consecutiveMatches >= 4) {
      bounceBackStreakRef.current += 1;
    } else {
      bounceBackStreakRef.current = 0;
    }
    if (bounceBackStreakRef.current >= 1) {
      if (!tryAutoMoveRef.current(live.currentIdx, live.currentIdx - 1)) { bounceBackStreakRef.current = 0; return; }
      const text = live.slides[live.currentIdx - 1];
      ctx.onSendSlideToLive({ kind: "text", text }, undefined, { origin: { kind: "song", songId: live.songId } });
      liveSongRef.current = { ...live, currentIdx: live.currentIdx - 1 };
      lastAdvanceTsRef.current = Date.now();
      matchStreakRef.current = 0;
      interimMatchStreakRef.current = 0;
      bounceBackStreakRef.current = 0;
      forceRender((n) => n + 1);
      console.log(`[song-autoprogression] bounce-back "${live.title}" to slide ${live.currentIdx}/${live.slides.length} (prev match=${prevResult.consecutiveMatches} words)`, { ts: Date.now() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.audio.transcript]);

  // ---- Part 8: song-to-song auto-progression -------------------------------
  // Detect "current live song ending" and, if the NEXT playlist item is
  // another song, auto-stage it via the EXACT SAME Part 6 path (full lyrics,
  // banner, single confirm) — never a silent switch.
  useEffect(() => {
    const live = liveSongRef.current;
    if (!live) return;
    if (stagedSong) return; // never stage more than one ahead
    if (isAnyOverlayOpen()) return; // operator mid-modal — suppress the prompt
    if (progressionHandledForRef.current.has(live.songId)) return;
    const isLastSlide = live.currentIdx >= live.slides.length - 1;
    if (!isLastSlide) return;
    const silenceMs = Date.now() - lastWordTsRef.current;
    const ending = isLikelyEndOfSong({
      isLastSlide,
      recentWords: recentWordsRef.current,
      lastSlideText: live.slides[live.slides.length - 1],
      silenceMs,
    });
    if (!ending) return;
    const curIdx = ctx.plan.items.findIndex((it) => (it as unknown as { songId?: string }).songId === live.songId);
    if (curIdx < 0) return;
    const nextItem = ctx.plan.items[curIdx + 1] as unknown as { songId?: string; title?: string } | undefined;
    if (!nextItem?.songId) return; // next item isn't a song (or there is none) — nothing to progress to
    progressionHandledForRef.current.add(live.songId);
    console.log(`[song-autoprogression] detected end of "${live.title}" (silence ${silenceMs}ms) — auto-staging next song "${nextItem.title}"`, { ts: Date.now() });
    void stageSong(nextItem.songId, nextItem.title || "Untitled", 100, "progression");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.audio.transcript, stagedSong]);

  const dismissStaged = useCallback(() => {
    // 2026-07-25 field bug fix: also record the dismissal so the effect
    // above skips re-staging this song for SONG_DISMISS_TTL_MS. Without
    // this, the banner reappeared within ~15s because the same lyric
    // fragment kept firing detections.
    if (stagedSong) {
      dismissedSongsRef.current.set(stagedSong.songId, Date.now());
    }
    setStagedSong(null);
  }, [stagedSong]);

  // Operator confirms the suggested within-song jump (a click = explicit
  // intent, so this may touch live output). Moves the live slide to the sung
  // one and re-syncs tracking; the projector never got here on its own.
  const applyJumpSuggestion = () => {
    const s = slideJumpSuggestion;
    const live = liveSongRef.current;
    if (!s || !live || live.songId !== s.songId || s.index >= live.slides.length) { setSlideJumpSuggestion(null); return; }
    ctx.onSendSlideToLive({ kind: "text", text: s.text }, undefined, { origin: { kind: "song", songId: live.songId } });
    liveSongRef.current = { ...live, currentIdx: s.index };
    lastAdvanceTsRef.current = Date.now();
    matchStreakRef.current = 0;
    recentWordsRef.current = [];
    setSlideJumpSuggestion(null);
  };
  const showJumpChip = !!slideJumpSuggestion
    && liveSongRef.current?.songId === slideJumpSuggestion.songId
    && slideJumpSuggestion.index !== liveSongRef.current?.currentIdx;

  if (!stagedSong && !autoAdvanceFlash && !showJumpChip) return null;

  return (
    <div className="shrink-0 px-3 py-2 flex flex-col gap-2" data-testid="song-autostage-banner">
      {showJumpChip && slideJumpSuggestion && (
        <div
          className="rounded-xl px-3 py-2 flex items-center gap-2"
          style={{
            background: "rgba(15,15,17,0.96)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderLeft: "3px solid #3b82f6",
            boxShadow: "0 12px 36px rgba(0,0,0,0.5)",
          }}
          role="status"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ color: "#7db3ff", background: "rgba(59,130,246,0.14)", border: "1px solid rgba(59,130,246,0.3)" }}>
            Now singing
          </span>
          <span className="text-[12px] text-white/90 truncate flex-1" title={slideJumpSuggestion.text}>
            Slide {slideJumpSuggestion.index + 1}: {firstLineOf(slideJumpSuggestion.text)}
          </span>
          <button
            onClick={applyJumpSuggestion}
            className="shrink-0 h-7 px-3 rounded-lg text-[11px] font-semibold text-white"
            style={{ background: "#2563eb" }}
            title="Move the projector to the slide being sung"
          >
            Go to slide {slideJumpSuggestion.index + 1}
          </button>
          <button
            onClick={() => setSlideJumpSuggestion(null)}
            className="shrink-0 h-7 w-7 rounded-lg text-white/50 hover:text-white hover:bg-white/10 inline-flex items-center justify-center"
            title="Dismiss"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {stagedSong && (
        <div
          // 2026-08-16: restyled to the clean dark-card look (matches the app's
          // notification toasts) — a premium near-black panel with a thin orange
          // accent instead of the old loud orange-filled box. Orange is retained
          // only where it carries meaning: the STAGED badge, the confidence, the
          // active line, and the GO LIVE action.
          className="rounded-2xl px-4 py-3 flex flex-col gap-2.5"
          style={{
            background: "rgba(15,15,17,0.96)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderLeft: "3px solid #e8501a",
            boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
          }}
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#e8501a] px-2 py-0.5 rounded-full" style={{ background: "rgba(232,80,26,0.14)", border: "1px solid rgba(232,80,26,0.3)" }}>
              AI staged — not live
            </span>
            <span className="text-[13px] font-semibold truncate text-white">{stagedSong.title}</span>
            {/* Show a % only for a real LYRIC/title match. A plan-position
                progression has no match score — showing "100%" read as a confident
                match (field complaint), so it just says "next in plan". */}
            {stagedSong.source !== "progression" && (
              <span className="text-[10px] font-mono text-[#ff9d5c]">{Math.round(stagedSong.confidence)}%</span>
            )}
            {stagedSong.source === "progression" && (
              <span className="text-[9px] font-mono text-white/40">next in plan</span>
            )}
            <button
              type="button"
              aria-label="Dismiss staged song"
              onClick={dismissStaged}
              className="ml-auto text-[13px] leading-none text-white/40 hover:text-white/90 px-1"
            >
              ×
            </button>
          </div>
          <div
            className="max-h-[120px] overflow-y-auto rounded-lg px-2 py-1.5 text-[12px] leading-snug whitespace-pre-wrap"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            {stagedSong.slides.map((s, i) => (
              <div
                key={i}
                role="button"
                tabIndex={0}
                onClick={() => setStagedSong({ ...stagedSong, currentIdx: i })}
                className={cn(
                  "px-1.5 py-0.5 rounded cursor-pointer transition-colors",
                  i === stagedSong.currentIdx
                    ? "font-semibold text-white"
                    : "text-white/60 hover:text-white/90",
                )}
                style={i === stagedSong.currentIdx ? { background: "rgba(232,80,26,0.18)" } : undefined}
              >
                {s}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[11px] font-medium text-white/55">
            {/* 2026-07-25 field bug fix — explicit clickable "Go LIVE" button.
                Some operators didn't realize G was a keyboard hotkey, or the
                key was blocked by focus/overlay. This button is the same
                action, always accessible via mouse. */}
            <button
              type="button"
              onClick={confirmStagedSongLive}
              className="px-3.5 py-1.5 rounded-lg bg-[#e8501a] hover:bg-[#ff8f4d] text-white text-[12px] font-bold shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/60"
              data-testid="staged-song-go-live-btn"
            >
              GO LIVE →
            </button>
            <span>
              Slide {stagedSong.currentIdx + 1} of {stagedSong.slides.length} · or press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white font-mono border border-white/15">G</kbd>
            </span>
          </div>
        </div>
      )}
      {autoAdvanceFlash && (
        <span className="self-start text-[9px] font-mono px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300 border border-orange-400/30" data-testid="song-auto-advance-indicator">
          ● AUTO-ADVANCED (word-match)
        </span>
      )}
    </div>
  );
}

// LEFT_PANEL_WIDTH_KEY, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_DEFAULT_WIDTH —
// imported above from operatorConstants.ts (Change 4, 2026-07-27).
// Bounded [MIN, 50vw] at all times; SSR-safe read post-mount.

// A scripture reference with its optional trailing translation code stripped
// ("John 3:16 (KJV)" → "John 3:16"). Used to identify the currently-live verse
// robustly: the projected slide's `.reference` is code-less when the operator's
// "display translation" toggle is off, while a card's label carries the code —
// so a raw equality would miss. (2026-08-29 auto-advance / translation fixes.)
function stripRefCode(s: string | null | undefined): string {
  return (s ?? "").replace(/\s*\([^)]+\)\s*$/, "").trim();
}

export function ProOperatorShell({ ctx }: { ctx: OperatorShellCtx }) {
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [centerMode, setCenterMode] = useState<CenterMode>("slides");
  // A song the Cmd+K search asked to open. Held HERE (always-mounted shell) and
  // passed to SongsBrowser as a prop, so the pick survives that panel's mount —
  // mirrors the bible-goto pattern (the in-panel listener lost the race).
  const [openSong, setOpenSong] = useState<SongSelection | null>(null);
  // Stable identity so SongsBrowser's [openSong, onSongOpened] effect can't re-run
  // on unrelated shell re-renders (avoids re-applying a stale pick over a manual one).
  const clearOpenSong = useCallback(() => setOpenSong(null), []);
  const [mediaStripOpen, setMediaStripOpen] = useState(true);
  // Media Bin pop-out (field fix 6A): taller strip in the center bottom dock.
  const [mediaBinPoppedOut, setMediaBinPoppedOut] = useState(false);
  // Media Bin manual height (field wave 6E item 1): persisted pull-up resize.
  const [mediaBinHeight, setMediaBinHeight] = useState(148);
  const [slideSize, setSlideSize] = useState(160);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [slideEditorOpen, setSlideEditorOpen] = useState(false);
  // Target-song mode: when the Songs Library "Edit slide" button opens the
  // editor it passes { songId, title } in the event detail. We fetch that
  // song's slides (WITH objectsJson) and hand them to the modal so it edits the
  // song the operator is actually looking at — not the playlist preview item.
  // A SlideGrid double-click dispatches with no detail → targetSong stays null
  // → the modal edits the playlist item (original behavior).
  const [slideEditorTargetSong, setSlideEditorTargetSong] =
    useState<import("./DesktopSlideEditorModal").SlideEditorTargetSong | null>(null);
  // When the "Blank slide" toolbar button opens the editor it passes
  // { blank: true } so the modal drops in and selects a fresh empty slide.
  const [slideEditorBlank, setSlideEditorBlank] = useState(false);
  const [slideEditorAdd, setSlideEditorAdd] = useState(false);
  // Theme Editor (PR 1): the Themes popover pencil dispatches { themeId } so the
  // SAME editor opens on that theme (PP7-style). Mutually exclusive with a song.
  const [slideEditorTargetTheme, setSlideEditorTargetTheme] =
    useState<import("./DesktopSlideEditorModal").SlideEditorTargetTheme | null>(null);
  // Unsaved theme edits (reported by the modal) → confirm before another
  // open-slide-editor event replaces the theme being edited.
  const themeEditorDirtyRef = useRef(false);
  const onThemeEditorDirty = useCallback((dirty: boolean) => { themeEditorDirtyRef.current = dirty; }, []);
  const { confirm: confirmEditorSwitch, dialog: editorSwitchDialog } = useConfirm();
  const confirmEditorSwitchRef = useRef(confirmEditorSwitch);
  confirmEditorSwitchRef.current = confirmEditorSwitch;
  useEffect(() => {
    const open = (e: Event) => {
      if (themeEditorDirtyRef.current) {
        void confirmEditorSwitchRef.current({
          title: "Discard unsaved theme changes?",
          description: "You're editing a theme with unsaved changes. Opening something else discards them.",
          confirmLabel: "Discard and open",
          danger: true,
        }).then((ok) => { if (ok) { themeEditorDirtyRef.current = false; handleOpen(e); } });
        return;
      }
      handleOpen(e);
    };
    const handleOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ songId?: string; title?: string; blank?: boolean; add?: boolean; themeId?: string } | undefined>).detail;
      if (detail?.themeId) {
        const themeId = detail.themeId;
        setSlideEditorBlank(false);
        setSlideEditorAdd(false);
        fetch("/api/themes")
          .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
          .then((data: { themes?: { id: string; name: string; isDefault?: boolean; config?: unknown }[] }) => {
            const t = (data.themes ?? []).find((x) => x.id === themeId);
            if (!t) { toast.error("Couldn't find that theme."); return; }
            setSlideEditorTargetSong(null);
            setSlideEditorTargetTheme({ id: t.id, name: t.name, isDefault: t.isDefault === true, config: (t.config && typeof t.config === "object" ? t.config : {}) as Record<string, unknown> });
            setSlideEditorOpen(true);
          })
          .catch(() => { toast.error("Couldn't load that theme to edit."); });
        return;
      }
      setSlideEditorTargetTheme(null);
      setSlideEditorBlank(!!detail?.blank);
      setSlideEditorAdd(!!detail?.add);
      if (detail?.songId) {
        const songId = detail.songId;
        const title = detail.title ?? "Song";
        // Fetch first so the editor hydrates with the real design on open.
        fetch(`/api/songs/${songId}/slides`)
          .then((r) => r.json())
          .then((data) => {
            setSlideEditorTargetSong({ songId, title, slides: Array.isArray(data.slides) ? data.slides : [] });
            setSlideEditorOpen(true);
          })
          .catch(() => {
            toast.error("Couldn't load that song to edit.");
          });
        return;
      }
      setSlideEditorTargetSong(null);
      setSlideEditorOpen(true);
    };
    window.addEventListener("presentflow:open-slide-editor", open);
    return () => window.removeEventListener("presentflow:open-slide-editor", open);
  }, []);

  // Shared media-image editor — the SAME crop / frame / pan / zoom / blur-fill
  // editor the Media library uses, reachable from ANYWHERE (a playlist media-
  // group child's context menu, the center "Edit image" button) via a window
  // event carrying { id, url, fileName }. Mounted once here so a single instance
  // serves every entry point.
  const [mediaEdit, setMediaEdit] = useState<{ id: string; url: string; fileName: string } | null>(null);
  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent<{ id?: string; url?: string; fileName?: string } | undefined>).detail;
      if (d?.id && d?.url) setMediaEdit({ id: d.id, url: d.url, fileName: d.fileName || "Image" });
    };
    window.addEventListener("presentflow:edit-media-image", open);
    return () => window.removeEventListener("presentflow:edit-media-image", open);
  }, []);
  // Change 4 — Left panel width state. Starts at the persisted value (or the
  // default), clamped once read is verified against window.innerWidth on mount.
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(LEFT_PANEL_DEFAULT_WIDTH);
  const leftResizingRef = useRef(false);
  // Live ref of the current width. onMove writes both state + ref; onUp reads
  // the ref so persist gets the FINAL width instead of a stale closure value.
  // Also lets us drop the per-render persist useEffect that fired on every
  // mousemove tick (60+ times/sec during a drag).
  const leftPanelWidthRef = useRef<number>(LEFT_PANEL_DEFAULT_WIDTH);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LEFT_PANEL_WIDTH_KEY);
      if (raw) {
        const parsed = parseInt(raw, 10);
        if (Number.isFinite(parsed)) {
          const max = leftPanelMaxWidth(window.innerWidth);
          const clamped = Math.min(max, Math.max(LEFT_PANEL_MIN_WIDTH, parsed));
          setLeftPanelWidth(clamped);
          leftPanelWidthRef.current = clamped;
        }
      }
    } catch { /* noop */ }
  }, []);
  // 2026-09-16 Windows round 2 — re-clamp the left panel when the WINDOW is
  // resized (e.g. snapped to half-screen), so a wide saved width can't crush the
  // center. Re-derives from the SAVED preference each time (never persists the
  // clamp), so the operator's width comes back on a bigger window. Windows-only:
  // macOS keeps its original mount/drag-only clamp.
  useEffect(() => {
    if (typeof window === "undefined" || !isWindowsUA()) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        if (leftResizingRef.current) return;
        let preferred = leftPanelWidthRef.current;
        try {
          const saved = parseInt(window.localStorage.getItem(LEFT_PANEL_WIDTH_KEY) ?? "", 10);
          if (Number.isFinite(saved)) preferred = saved;
        } catch { /* noop */ }
        const next = Math.min(leftPanelMaxWidth(window.innerWidth), Math.max(LEFT_PANEL_MIN_WIDTH, preferred));
        if (next !== leftPanelWidthRef.current) {
          leftPanelWidthRef.current = next;
          setLeftPanelWidth(next);
        }
      }, 150);
    };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); if (t) clearTimeout(t); };
  }, []);
  const startLeftResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    leftResizingRef.current = true;
    // Track initial cursor + width so mid-drag math is stable even if the
    // aside momentarily reflows during another render.
    const startX = e.clientX;
    const startWidth = leftPanelWidthRef.current;
    const onMove = (ev: MouseEvent) => {
      if (!leftResizingRef.current) return;
      const maxW = leftPanelMaxWidth(window.innerWidth);
      const next = Math.min(maxW, Math.max(LEFT_PANEL_MIN_WIDTH, startWidth + (ev.clientX - startX)));
      leftPanelWidthRef.current = next;
      setLeftPanelWidth(next);
    };
    const onUp = () => {
      if (!leftResizingRef.current) return;
      leftResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Persist final width once at pointerup — read from the live ref so we
      // never write a stale closure value. Storage survives relaunch, matching
      // the pattern used elsewhere (slideSize, etc).
      try { window.localStorage.setItem(LEFT_PANEL_WIDTH_KEY, String(Math.round(leftPanelWidthRef.current))); } catch { /* noop */ }
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);
  // Y2: debounce Safe Mode "swallowed Enter" toast to once per 3s so a stuck
  // Enter key doesn't spam the operator.
  const lastSafeToastRef = useRef(0);
  // Guards Bible "Next/Prev verse" against rapid repeat presses firing
  // overlapping async advanceRef calls that could read bibleSession state
  // before an earlier call's setCards/setSelectedIdx commits.
  const advanceInFlightRef = useRef(false);
  // 2026-09-14 verse-bounce fix: the last voice-nav hop that actually PROJECTED
  // ({fromRef -> toRef}). AI scripture fires targeting fromRef are suppressed
  // while toRef is still live (navOriginSuppressed, 8s window).
  const navOriginRef = useRef<NavOrigin | null>(null);
  // Voice-nav delivery tracking (2026-09-14): whether the in-flight advance is a
  // voice (live) one, whether it projected, and a preview-only record so a
  // retried final can't double-step the preview when nothing is live.
  const advanceInFlightLiveRef = useRef(false);
  const voiceNavProjectedRef = useRef(false);
  const voiceNavPreviewOnlyRef = useRef<{ dir: 1 | -1; ts: number } | null>(null);

  useEffect(() => {
    try {
      const s = window.localStorage.getItem(MEDIA_STRIP_KEY);
      if (s === "0") setMediaStripOpen(false);
      const sz = window.localStorage.getItem(SLIDE_SIZE_KEY);
      if (sz) setSlideSize(Math.max(96, Math.min(240, parseInt(sz, 10) || 160)));
      const bh = window.localStorage.getItem(MEDIA_BIN_HEIGHT_KEY);
      if (bh) setMediaBinHeight(Math.max(96, Math.min(620, parseInt(bh, 10) || 148)));
    } catch { /* noop */ }
  }, []);

  const handleMediaBinResize = useCallback((px: number) => {
    const clamped = Math.max(96, Math.min(620, Math.round(px)));
    setMediaBinHeight(clamped);
    try { window.localStorage.setItem(MEDIA_BIN_HEIGHT_KEY, String(clamped)); } catch { /* noop */ }
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

  // Stale-action recovery (Wave 3, item 1). A tab open across a Vercel redeploy
  // holds cached chunks referencing Server Action ids the fresh server no longer
  // has → Next.js rejects with a recognisable "Failed to find Server Action"
  // error, which used to surface as an alarming red toast. We detect that ONE
  // failure class and replace it with a calm "PresentFlow updated" notice: if
  // nothing is live we auto-reload; if content IS live we NEVER yank the
  // projector — the operator taps Reload when ready.
  const [staleUpdate, setStaleUpdate] = useState(false);
  const liveSlideRef = useRef(ctx.liveSlide);
  liveSlideRef.current = ctx.liveSlide;
  // Track "is a service in progress" the SAME way UpdateBanner does, so the
  // auto-reload guard never yanks the page mid-service. A momentarily-empty
  // projector while the AI is actively listening (e.g. between songs) is NOT
  // "nothing live" — a full reload there drops the audio/WS + AI session.
  const listeningRef = useRef(ctx.audio?.listening);
  listeningRef.current = ctx.audio?.listening;

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
    // Intercept the stale-action class BEFORE the generic toast. Returns true if
    // handled (so the caller skips the red toast).
    const handleStale = (err: unknown): boolean => {
      if (!isStaleServerActionError(err)) return false;
      // "In service" = anything projected (incl. a "blank"/black-out, which
      // holds restore state in memory) OR the AI actively listening. Strictly
      // MORE conservative than a bare kind!=="empty": only a truly idle shell
      // (nothing projected AND not listening) may auto-reload.
      const contentIsLive = liveSlideRef.current?.kind !== "empty" || !!listeningRef.current;
      // Reload-loop guard: if we already spent our one auto-reload very recently
      // (a stale SW served the same old chunk back and it re-threw), do NOT
      // reload again — fall through to the manual banner instead of spinning.
      let recentlyAutoReloaded = false;
      try {
        const at = Number(window.sessionStorage.getItem("pf-stale-autoreload-at"));
        recentlyAutoReloaded = Number.isFinite(at) && at > 0 && Date.now() - at < 30_000;
      } catch { /* sessionStorage unavailable → treat as not-recent */ }
      const { autoReload } = staleActionRecovery({ contentIsLive, recentlyAutoReloaded });
      if (autoReload) {
        try { window.sessionStorage.setItem("pf-stale-autoreload-at", String(Date.now())); } catch { /* noop */ }
        window.location.reload();
        return true;
      }
      setStaleUpdate(true); // show the calm banner with a Reload button
      return true;
    };
    const onRej = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      if (handleStale(reason)) return;
      const msg = reason instanceof Error ? reason.message : String(reason ?? "unhandled rejection");
      console.error("[operator-global-error] unhandledrejection:", msg, reason);
      if (bump()) toast.error(`Background task failed: ${msg.slice(0, 120)}`);
    };
    const onErr = (e: ErrorEvent) => {
      if (handleStale(e.error ?? e.message)) return;
      // React error boundaries catch render errors; this catches
      // event-handler throws and native-callback errors.
      const msg = e.message || String(e.error ?? "unknown error");
      // 2026-07-25 suppress two well-known Chromium false-positive warnings
      // that fire during normal use and were surfacing as toast errors:
      //   1. "ResizeObserver loop completed with undelivered notifications"
      //      — fires when a ResizeObserver callback triggers a layout that
      //      itself would trigger another observer callback in the same
      //      frame. Harmless; the browser handles it by deferring to the
      //      next frame. AutoFitText's binary-search setState is the
      //      classic trigger. See https://issues.chromium.org/issues/40808324
      //   2. "ResizeObserver loop limit exceeded" — same class, older wording.
      if (msg.startsWith("ResizeObserver loop")) return;
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

  // 2026-07-25 — surface audio start failures + long-silence as visible toasts.
  // `audio.error` is set by useAudioStream when getUserMedia throws (Mac Studio
  // with no mic, permission denied, device busy, etc.) with a specific
  // actionable message per error name. Previously this state existed but was
  // NEVER rendered in the Pro shell, so a volunteer whose USB interface
  // wasn't plugged in got total silence with zero explanation. Duration
  // Infinity so it stays until they act; a single toast per distinct message
  // so a stuck error doesn't spam.
  // 🟡 Stress F6 fix — dedup by the FIRST-SENTENCE prefix (an error class
  // signature) rather than the exact string. NotReadableError messages on
  // Windows sometimes trail the driver name (which varies per reconnect
  // attempt), which meant otherwise-identical errors were producing a
  // toast stack over the course of a backoff. Prefix-match collapses them.
  const lastAudioErrorRef = useRef<string | null>(null);
  const audioError = ctx.audio.error;
  useEffect(() => {
    if (!audioError) {
      lastAudioErrorRef.current = null;
      // 2026-07-26 — dismiss the sticky error toast the moment error clears
      // (reconnect succeeded, operator restarted, etc.). Without this the
      // "Failed to fetch" toast lingered forever even after connectivity
      // recovered.
      toast.dismiss("presentflow-audio-error");
      return;
    }
    const sig = audioError.split(/[.!?—]/, 1)[0].trim().slice(0, 80);
    if (sig === lastAudioErrorRef.current) return;
    lastAudioErrorRef.current = sig;
    // 2026-07-26 — transient network errors get a 10s auto-dismiss instead
    // of sticking forever. If the error truly needs operator action (mic
    // permission denied, no audio device, etc.) it re-surfaces because the
    // state doesn't clear until fixed. Sticky-forever was a footgun for
    // brief Vercel deploy swaps and network flaps.
    const isTransient = /reach the server|network|retry|reconnect|WebSocket/i.test(audioError);
    toast.error(audioError, {
      duration: isTransient ? 10_000 : Infinity,
      id: "presentflow-audio-error",
    });
  }, [audioError]);

  // Long-silence warning — noAudioSignal flips true after 15s of pure silence.
  // 2026-07-27 JPD upgrade — the toast now includes ACTIONABLE diagnostics
  // (device label + negotiated channel count + sample rate) so the operator
  // can distinguish between "wrong channel picked" (32ch negotiated → open
  // channel grid) vs "mixer isn't routing anything to USB" (32ch negotiated,
  // all silent → talk to the audio engineer, open the USB Sends menu on the
  // mixer). Both look identical without this data.
  const lastNoSignalRef = useRef(false);
  const noAudioSignal = ctx.audio.noAudioSignal;
  const streamChannelCount = ctx.audio.streamChannelCount;
  const streamSampleRate = ctx.audio.streamSampleRate;
  useEffect(() => {
    if (noAudioSignal && !lastNoSignalRef.current) {
      lastNoSignalRef.current = true;
      // Pull the friendly device label from the same localStorage key the
      // AudioTab picker writes to — avoids threading it through the whole
      // audio hook state.
      let deviceLabel = "your input device";
      try {
        const raw = localStorage.getItem("presentflow.pro.audioInput.v1");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.label === "string" && parsed.label.length > 0) {
            deviceLabel = parsed.label.replace(/^Default - /, "");
          }
        }
      } catch { /* noop */ }
      const chInfo = streamChannelCount != null
        ? `${streamChannelCount}ch${streamSampleRate ? ` @ ${Math.round(streamSampleRate / 1000)}kHz` : ""} negotiated`
        : "channel count unknown";
      // Guidance branches on what the numbers actually say:
      //   1 channel   → likely a bare mic OR a mixer without the vendor USB driver
      //   >1 channel  → mixer is negotiated multi-ch but sending silence — check USB routing on the mixer
      let guidance: string;
      if (streamChannelCount != null && streamChannelCount > 1) {
        guidance = "PresentFlow IS receiving multi-channel audio but every channel is silent. Most likely your mixer isn't routing anything to its USB send. On your mixer, open its USB / recording routing and send your vocal mic to USB (on a Behringer X32/XR18 that's Routing → Card / USB Sends; on Allen & Heath SQ it's Setup → I/O → USB; other desks have an equivalent USB-send menu). Or pick a specific channel via the channel grid in Settings › Audio.";
      } else {
        guidance = "PresentFlow is receiving a single-channel stream and it's silent. Check: (1) the mixer channel isn't muted, (2) the USB cable is seated, (3) you've picked the correct input in Settings › Audio. If this is a multi-channel mixer, install its USB driver from the manufacturer (Behringer, Allen & Heath, Yamaha, PreSonus, etc.) so its channels appear.";
      }
      // JPD Fix 4: lead with "AI is still ON" — operators read this toast
      // during natural service silences (prayer, communion) as "the AI
      // timed out and turned off" and manually re-toggled it. The AI never
      // stops on silence; this is a signal diagnostic only.
      toast.warning(
        `AI is still ON and listening — but no audio signal for 15s. ${deviceLabel}: ${chInfo}, 0 signal. If this is just a quiet moment in the service, ignore this. Otherwise: ${guidance}`,
        { duration: 20_000, id: "presentflow-no-signal" },
      );
    } else if (!noAudioSignal && lastNoSignalRef.current) {
      lastNoSignalRef.current = false;
      toast.dismiss("presentflow-no-signal");
    }
  }, [noAudioSignal, streamChannelCount, streamSampleRate]);

  // WS3 uplink-congestion warning — mirrors the no-signal toast. When the WS3
  // backpressure valve (useAudioStream) starts shedding audio because the
  // internet uplink to the transcription bridge is saturated, tell the operator
  // — in plain language — that the lag is a NETWORK problem, not the AI, with
  // the concrete fix. This is the operator-visible half of `uplinkCongested`;
  // the compact "UPLINK BUSY" chip in TopBar is a separate (other-lane) surface.
  // The valve only trips on a sustained ~3s stall, so a flip here is already a
  // real event; we still throttle re-shows to once per 30s and let the toast
  // auto-expire so brief stalls don't flash it repeatedly during a service.
  const lastUplinkCongestedRef = useRef(false);
  const lastUplinkToastAtRef = useRef(0);
  const uplinkCongested = ctx.audio.uplinkCongested;
  useEffect(() => {
    if (uplinkCongested && !lastUplinkCongestedRef.current) {
      lastUplinkCongestedRef.current = true;
      const now = Date.now();
      if (now - lastUplinkToastAtRef.current < 30_000) return; // throttle re-shows
      lastUplinkToastAtRef.current = now;
      toast.warning(
        "AI is still ON — but this computer's internet uplink is busy, so the transcription is holding a few seconds behind to stay caught up (words may lag or drop briefly). This is a NETWORK issue, not the AI. If it keeps happening during services: put this PC on wired Ethernet and keep the livestream upload off this machine's connection.",
        { duration: 15_000, id: "presentflow-uplink-congested" },
      );
    } else if (!uplinkCongested && lastUplinkCongestedRef.current) {
      lastUplinkCongestedRef.current = false;
    }
  }, [uplinkCongested]);

  // Audio Guardian (2026-07-27) — consume the watchdog's state events.
  //   "switched"    → success toast (guardian auto-swapped to a live input)
  //   "recovering"  → subtle deduped info toast while the ladder runs
  //   "needs-human" → persistent red "⚠ AUDIO" chip next to the TopBar;
  //                   clicking it opens Settings › Audio in the right
  //                   sidebar (via presentflow:open-audio-settings, handled
  //                   in RightIconBar where the popover state lives)
  //   "healthy" after needs-human → chip clears + "Audio recovered" toast
  const [guardianAlert, setGuardianAlert] = useState<GuardianStatus | null>(null);
  const guardianWasAlertRef = useRef(false);
  useEffect(() => {
    const onGuardianState = (ev: Event) => {
      const status = (ev as CustomEvent<GuardianStatus>).detail;
      if (!status || typeof status.state !== "string") return;
      switch (status.state) {
        case "switched":
          toast.success(
            `Audio input switched to ${status.detail} — previous input went silent`,
            { id: "presentflow-guardian-switched", duration: 12_000 },
          );
          break;
        case "recovering":
          toast.info(`Audio guardian: ${status.detail}`, {
            id: "presentflow-guardian-recovering",
            duration: 6_000,
          });
          break;
        case "silent":
          // Pre-escalation awareness only — the existing 15s no-signal
          // toast already covers the operator-facing messaging here.
          break;
        case "needs-human":
          guardianWasAlertRef.current = true;
          setGuardianAlert(status);
          toast.error(`Audio needs attention — ${status.detail}`, {
            id: "presentflow-guardian-needs-human",
            duration: Infinity,
          });
          break;
        case "healthy":
          toast.dismiss("presentflow-guardian-recovering");
          toast.dismiss("presentflow-guardian-needs-human");
          setGuardianAlert(null);
          if (guardianWasAlertRef.current) {
            guardianWasAlertRef.current = false;
            toast.success("Audio recovered", { duration: 5_000 });
          }
          break;
      }
    };
    window.addEventListener(GUARDIAN_STATE_EVENT, onGuardianState);
    return () => window.removeEventListener(GUARDIAN_STATE_EVENT, onGuardianState);
  }, []);

  // 2026-07-24 T4 fix — batch preload every image URL in the current plan
  // when the operator opens/updates it. Without this, an image slide
  // firing to live had to fetch + decode AFTER the projector's <img>
  // mounted, producing a black frame followed by pop-in (50-300 ms
  // depending on network + file size). Preloading via `new Image()`
  // seeds the browser cache in the background so by the time any of
  // these fires to live, decode is done. Idempotent — the browser
  // dedupes same-URL requests. Cheap — a few MB of PNGs downloaded
  // over a warm connection once per plan open.
  const preloadedUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const urls = new Set<string>();
    for (const item of ctx.plan.items) {
      for (const slide of item.slides ?? []) {
        if (slide && slide.kind === "image" && typeof slide.url === "string" && slide.url.length > 0) {
          urls.add(slide.url);
        }
      }
    }
    for (const url of urls) {
      if (preloadedUrlsRef.current.has(url)) continue;
      preloadedUrlsRef.current.add(url);
      // `new Image()` in the DOM API triggers the browser's HTTP cache
      // + decode pipeline without ever attaching to the tree. No CSP
      // implications (same-origin/S3-presigned URLs already whitelisted).
      const img = new Image();
      img.src = url;
    }
  }, [ctx.plan.items]);

  // 2026-07-24 — replacement for the removed reconnect spinner.
  // Silent for fast (< 5s) reconnects — the binary AI pill stays green,
  // no visual affordance next to it. Slow reconnects (5s+) surface as a
  // bottom-corner Sonner toast — decoupled from the pill so there's no
  // "AI is stopping" perception, auto-dismisses on recovery, upgrades to
  // a longer-lived warning if it drags past 20s.
  //
  // Trigger is the actual WebSocket reconnect state (reconnectAttempts +
  // !ready + listening), not any UI churn — so a React re-render on an
  // unrelated update never spawns a toast. State is intentionally kept
  // in refs so the effect can dedupe without re-firing.
  const reconnectStartRef = useRef<number | null>(null);
  const reconnectSlowToastIdRef = useRef<string | number | null>(null);
  const reconnectVerySlowFiredRef = useRef(false);
  useEffect(() => {
    const isReconnecting = ctx.audio.listening
      && !ctx.audio.reconnectFailed
      && !ctx.audio.ready
      && ctx.audio.reconnectAttempts > 0;
    if (!isReconnecting) {
      // Recovered: dismiss any slow-toast we surfaced and reset trackers.
      if (reconnectSlowToastIdRef.current !== null) {
        toast.dismiss(reconnectSlowToastIdRef.current);
        toast.success("AI reconnected", { duration: 2000 });
        reconnectSlowToastIdRef.current = null;
      }
      reconnectStartRef.current = null;
      reconnectVerySlowFiredRef.current = false;
      return;
    }
    // Reconnect in progress. Start clock if new.
    if (reconnectStartRef.current === null) reconnectStartRef.current = Date.now();
    const elapsed = Date.now() - reconnectStartRef.current;
    // Escalation tiers — fast (< 5s) silent, slow (5-20s) toast, very slow (20s+) sticky warning.
    if (elapsed < 5000) {
      // Silent — check back in 500ms to see if we crossed 5s.
      const t = window.setTimeout(() => {
        // Force re-eval by nudging a ref-only value. Cheapest way is a
        // no-op setState — but we don't have one. Instead just rely on
        // the next real ctx.audio state update to re-fire this effect
        // (reconnectAttempts changes or ready flips). If the reconnect
        // resolves silently, no toast — perfect.
      }, 500);
      return () => window.clearTimeout(t);
    }
    if (elapsed >= 5000 && reconnectSlowToastIdRef.current === null) {
      reconnectSlowToastIdRef.current = toast.loading("AI reconnecting…", {
        description: "Silent background retry. Pipeline stays ON.",
        duration: Infinity,
      });
    }
    if (elapsed >= 20000 && !reconnectVerySlowFiredRef.current) {
      reconnectVerySlowFiredRef.current = true;
      if (reconnectSlowToastIdRef.current !== null) {
        toast.dismiss(reconnectSlowToastIdRef.current);
        reconnectSlowToastIdRef.current = null;
      }
      reconnectSlowToastIdRef.current = toast.warning("AI still reconnecting…", {
        description: `Been offline ${Math.round(elapsed / 1000)}s. If it doesn't recover, try toggling AI OFF then ON.`,
        duration: Infinity,
      });
    }
  }, [
    ctx.audio.listening,
    ctx.audio.reconnectFailed,
    ctx.audio.ready,
    ctx.audio.reconnectAttempts,
  ]);

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
  const timers = useTimersSession();        // Wave 7 — multi named timers
  const messagesBoard = useMessagesBoard();  // Wave 7 — templates + active messages
  // ProPresenter 7 layer UI (on by default; kill switch in pp7-layers-flag): clear rail beside the
  // preview + F-key clears + Media Bin clicks go behind the words.
  const pp7Layers = usePp7Layers() && ctx.layersEngineOn;
  // PP7: timers ride the Messages layer, so they light it and clear with it
  // (F6 / the Messages row / Clear All all take a live countdown off screen).
  // ONE implementation, shared with the PP7 Layers panel (right/usePp7Layers).
  const { active: pp7MessagesActive, clear: pp7ClearMessages } = usePp7Messages({ messages, messagesBoard, timer, timers });
  const bibleSession = useBibleSession(ctx.defaultTranslationCode);
  // Always-current handle to the session so the callback below (captured by
  // effects that don't re-subscribe on every grid change) never reads a stale
  // grid — the source of the intermittent "sometimes collapses" behaviour.
  const bibleSessionRef = useRef(bibleSession);
  bibleSessionRef.current = bibleSession;
  // Always-current live slide, readable from the early instant-fire effect
  // (which runs before safeSendLive/bibleLiveSlideRef exist in hook order).
  // Used to skip re-projecting a verse that is ALREADY on the projector.
  const currentLiveSlideRef = useRef(ctx.liveSlide);
  currentLiveSlideRef.current = ctx.liveSlide;

  // Sync the CENTER Bible grid to an auto-detected/projected verse WITHOUT
  // collapsing a loaded chapter. Field request (2026-08-19 video): after "Load
  // Chapter", when the preacher says a bare verse of the SAME chapter (e.g.
  // "verse one"), the whole-chapter grid must stay on screen and only the
  // orange selection moves to that verse (which is separately projected). Only a
  // genuinely NEW scripture — one whose verse ISN'T already a tile in the
  // current grid — replaces the grid.
  const syncBibleCenterToDetection = useCallback((
    ref: { book: string; chapter: number; verseStart: number; verseEnd: number },
    fallbackRef: string,
    fallbackCards: import("./hooks").VerseCard[],
  ): void => {
    const bs = bibleSessionRef.current;
    const detBook = ref.book.toLowerCase().replace(/\s+/g, " ");
    // A single-verse detection whose exact verse is already a tile in the loaded
    // grid = navigation within the same (usually full-chapter) view.
    const idx = ref.verseStart === ref.verseEnd
      ? bs.state.cards.findIndex((c) => {
          const r = parseLiveScriptureRef(c.label);
          return r != null && r.book === detBook && r.chapter === ref.chapter
            && r.verseStart === ref.verseStart && r.verseStart === r.verseEnd;
        })
      : -1;
    if (idx >= 0) {
      // Keep the whole grid; just move the selection to the called verse.
      bs.setSelectedIdx(idx);
      return;
    }
    // New scripture (not in the current grid) → replace with its cards.
    bs.setRef(fallbackRef);
    bs.setCards(fallbackCards);
    bs.setSelectedIdx(0);
  }, []);

  // F1/F2: publish timer + message overlays to the live/stage/livestream outputs
  // via BroadcastChannel. The output pages already know how to render these —
  // ProOperatorShell just wasn't posting. Channel is same-machine only per
  // CLAUDE.md rule 8 (primary sync path).
  const overlayChRef = useRef<LiveChannelLike | null>(null);
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
  // Symmetry with the timer heartbeat below: while showing, re-post the full
  // message overlay at 1Hz so (a) a /live reload mid-service recovers the
  // message within a second, and (b) the renderer-side 5s stale sweep can
  // take a `dismiss: manual` message down if this operator page crashes.
  // Renderers only (re)arm their client-side dismiss countdown when message
  // CONTENT changes (text + dismissAfterMs), so heartbeats never restart it.
  const messagesStateRef = useRef(messages.state);
  useEffect(() => { messagesStateRef.current = messages.state; }, [messages.state]);
  // Wave 7: current timers + active board messages, read inside the interval so
  // the {{timer}} token stays live and the extras array is always fresh.
  const timersSlotsRef = useRef(timers.slots);
  useEffect(() => { timersSlotsRef.current = timers.slots; }, [timers.slots]);
  const boardActiveRef = useRef(messagesBoard.active);
  useEffect(() => { boardActiveRef.current = messagesBoard.active; }, [messagesBoard.active]);
  const messagePostedRef = useRef(false);
  const legacyActive = messages.state.showing && messages.state.text.trim().length > 0;
  const boardCount = messagesBoard.active.length;
  useEffect(() => {
    const ch = overlayChRef.current;
    if (!ch) return;
    if (!legacyActive && boardCount === 0) {
      if (messagePostedRef.current) {
        // Only broadcast clear:true after at least one show — otherwise every
        // slide navigation on a fresh operator would spam `{clear:true}`.
        // `messages: []` so outputs drop board (extra) messages immediately —
        // without it they only reconcile when the array is present and linger
        // until the 5s stale sweep.
        safePost(ch, { type: "message", overlay: { clear: true }, messages: [] });
        messagePostedRef.current = false;
      }
      return;
    }
    const DISMISS_MS: Record<string, number | null> = {
      "5s": 5000, "10s": 10000, "30s": 30000, "1min": 60000, "5min": 300000, manual: null,
    };
    // Build the {{timer}} token map from the live timers snapshot.
    const timerTokens = (): { map: Record<string, string>; first?: string } => {
      const slots = timersSlotsRef.current;
      const map: Record<string, string> = {};
      for (const s of slots) map[s.def.id] = timerTokenValue(s.remaining);
      const firstShown = slots.find((s) => s.shown) ?? slots[0];
      return { map, first: firstShown ? timerTokenValue(firstShown.remaining) : undefined };
    };
    const post = () => {
      const s = messagesStateRef.current;
      const now = new Date();
      const { map, first } = timerTokens();
      // Legacy single message (authoritative slot "default"). Kept EXACTLY as
      // before (time/date/currentSlide tokens); clear:true when not showing so
      // the "default" slot is emptied while extras keep painting.
      const overlay = legacyActive
        ? {
            text: s.text
              .replace(/\{\{time\}\}/g, now.toLocaleTimeString())
              .replace(/\{\{date\}\}/g, now.toLocaleDateString())
              .replace(/\{\{currentSlide\}\}/g, String((previewSlideIdxRef.current ?? 0) + 1)),
            dismissAfterMs: DISMISS_MS[s.dismiss] ?? null,
            position: s.position,
            allowWeb: s.allowWeb,
            ...(s.scroll ? { scroll: true, scrollDir: s.scrollDir, scrollSec: s.scrollSec } : {}),
          }
        : { clear: true as const };
      // Extra simultaneous messages (Wave 7). Each keyed by its own id; the
      // {{timer}} token renders the bound timer's live clock.
      const extras = boardActiveRef.current
        .filter((m) => !m.hidden) // hidden messages stay listed for re-show but leave the wire
        .map((m) => ({
          id: m.id,
          text: expandMessageTokens(m.text, { now, currentSlide: previewSlideIdxRef.current, timers: map, firstTimer: first }),
          dismissAfterMs: DISMISS_MS[m.dismiss] ?? null,
          position: m.position,
          allowWeb: m.allowWeb,
          ...(m.scroll ? { scroll: true, scrollDir: m.scrollDir, scrollSec: m.scrollSec } : {}),
        })).filter((m) => m.text.trim().length > 0);
      safePost(ch, { type: "message", overlay, messages: extras });
      messagePostedRef.current = true;
    };
    post();
    const id = setInterval(post, 1000);
    return () => clearInterval(id);
  }, [legacyActive, boardCount, messages.state.showing, messages.state.text, messages.state.dismiss, messages.state.position, messages.state.allowWeb, messages.state.scroll, messages.state.scrollDir, messages.state.scrollSec]);

  // JPD Fix 1: timer overlay is projected ONLY while `shown` (explicit
  // "Show on screen" toggle in the Timers tab). While shown we heartbeat at
  // 1Hz even when paused — the operator side owns the countdown and each post
  // fully re-materializes the overlay, so a /live reload mid-service recovers
  // within a second. Hiding sends {clear:true}. Ownership lives here at the
  // shell (useTimerSession is shell-level), so closing the Timers tab/popover
  // never kills the on-screen timer.
  // Read `remaining` via a ref inside the interval — putting it in the dep
  // list re-created the interval on every tick, so setInterval never
  // actually fired (was accidentally driven by dep-change edges only).
  const timerStateRef = useRef(timer.state);
  useEffect(() => { timerStateRef.current = timer.state; }, [timer.state]);
  const timerPostedRef = useRef(false);
  useEffect(() => {
    const ch = overlayChRef.current;
    if (!ch) return;
    if (!timer.state.shown) {
      if (timerPostedRef.current) {
        safePost(ch, { type: "timer", overlay: { clear: true } });
        timerPostedRef.current = false;
      }
      return;
    }
    const post = () => {
      const s = timerStateRef.current;
      safePost(ch, {
        type: "timer",
        overlay: {
          name: s.name,
          remainingSec: Math.max(-3600, Math.min(24 * 60 * 60, Math.round(s.remaining))),
          running: s.running,
          kind: s.type === "elapsed" ? "elapsed" : "countdown",
          position: s.position,
        },
      });
      timerPostedRef.current = true;
    };
    post();
    const id = setInterval(post, 1000);
    return () => clearInterval(id);
  }, [timer.state.shown, timer.state.running, timer.state.name, timer.state.type, timer.state.position]);

  // Wave 7: publish each SHOWN named timer as a KEYED TimerOverlay (id = its
  // slot id), heartbeating at 1Hz like the legacy timer. When a timer stops
  // being shown (hidden/deleted) we send a per-id clear so the projector drops
  // just that one. Reads the live slots via ref inside the interval so ticking
  // never re-creates the interval. The legacy timer (slot "default") is
  // untouched by this effect — the two coexist on the wire by id.
  const shownTimerIdsRef = useRef<Set<string>>(new Set());
  const shownTimerKey = timers.slots.filter((s) => s.shown).map((s) => `${s.def.id}:${s.position}:${s.scale}`).join(",");
  useEffect(() => {
    const ch = overlayChRef.current;
    if (!ch) return;
    const post = () => {
      const slots = timersSlotsRef.current;
      const nowShown = new Set<string>();
      for (const s of slots) {
        if (!s.shown) continue;
        nowShown.add(s.def.id);
        safePost(ch, {
          type: "timer",
          overlay: {
            id: s.def.id,
            name: s.def.name,
            remainingSec: Math.max(-3600, Math.min(24 * 60 * 60, Math.round(s.remaining))),
            running: s.def.type === "countdown_to" ? true : s.runtime.running,
            kind: s.def.type === "elapsed" ? "elapsed" : "countdown",
            position: s.position,
            overrun: s.overrun,
            scale: s.scale,
          },
        });
      }
      // Clear any timer that WAS shown last tick but isn't now.
      for (const id of shownTimerIdsRef.current) {
        if (!nowShown.has(id)) safePost(ch, { type: "timer", overlay: { clear: true, id } });
      }
      shownTimerIdsRef.current = nowShown;
    };
    post();
    const id = setInterval(post, 1000);
    return () => clearInterval(id);
  }, [shownTimerKey]);

  // Wave 7: engine/macro TIMER_COMMAND entry point (ctx.onTimerCommand emits
  // this CustomEvent). "default" routes to the legacy quick timer; any other id
  // routes to the named-timer session.
  useEffect(() => {
    const onCmd = (e: Event) => {
      // Nonce guard (Y1): drop any timer-command event that didn't come through
      // dispatchInternal (XSS / browser extension can't forge the module nonce).
      if (!isInternalEvent(e)) return;
      const d = internalPayload<{ timerId?: string; command?: "start" | "stop" | "reset" }>(e);
      if (!d?.command) return;
      if (d.timerId === "default" || !d.timerId) {
        if (d.command === "reset") timer.reset();
        else if (d.command === "start" && !timer.state.running) timer.toggleRun();
        else if (d.command === "stop" && timer.state.running) timer.toggleRun();
        return;
      }
      timers.command(d.timerId, d.command);
    };
    window.addEventListener("presentflow:timer-command", onCmd);
    return () => window.removeEventListener("presentflow:timer-command", onCmd);
  }, [timer, timers]);

  // Auto-route AI scripture detections into the Bible session so switching
  // into Bible mode shows the detected passage immediately — even if the
  // operator was on the slides / songs / media tab when it fired.
  const lastRoutedScriptureRef = useRef<string | null>(null);
  // v1 (2026-08-18 user directive): a NEW on-screen verse box should appear
  // ONLY when a genuinely NEW scripture is spoken. These track the last-routed
  // reference + when, so the interim→final→whisper cascade (and rapid
  // re-utterances) of the SAME reference don't each spawn a fresh box.
  const lastRoutedRefKeyRef = useRef<string | null>(null);
  const lastRoutedRefTsRef = useRef<number>(0);
  // ── LATENCY: pre-warm today's plan's scripture CHAPTERS at session start ──
  // (2026-08-21, field "there's a heavy delay"). So the FIRST time the preacher
  // reads a PLANNED verse, the instant hard-cut already has the whole chapter
  // cached and projects with zero network. Runs once per plan, deferred ~1.5s so
  // it never competes with first paint; best-effort, deduped per book:chapter.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const { parseReference } = await import("@/lib/bible-parser");
          const translation = bibleSession.state.translation;
          const seen = new Set<string>();
          for (const it of ctx.plan.items) {
            if (cancelled) return;
            if (it.type !== "scripture") continue;
            const ref = parseReference(it.title);
            if (!ref) continue;
            const k = `${ref.book}:${ref.chapter}`;
            if (seen.has(k)) continue;
            seen.add(k);
            prefetchChapter(ref.book, ref.chapter, translation);
          }
        } catch { /* best-effort — a cold verse just re-fetches on demand */ }
      })();
    }, 1500);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.plan.id]);

  useEffect(() => {
    const suggestions = ctx.audio.suggestions;
    if (!suggestions || suggestions.length === 0) return;
    const threshold = ctx.confidenceThreshold ?? 50;
    // Newest first (unshift in useAudioStream). Find the freshest confident
    // scripture suggestion.
    const scripture = suggestions.find((s) => s.type === "scripture" && s.confidence >= threshold);
    if (!scripture || scripture.type !== "scripture") return;
    // ── LATENCY: warm the WHOLE chapter the INSTANT a reference is detected ──
    // (2026-08-21, field video "there's a heavy delay"). The "instant hard-cut"
    // path below only projects with zero network when `getCachedChapter` hits;
    // that cache was almost never warm for a freshly-preached verse (the session
    // pre-warm fills a DIFFERENT per-verse cache), so most verses fell to a
    // blocking /api/bible/lookup round-trip (120-500ms+) — the visible delay.
    // Firing prefetchChapter here, on the FIRST (even interim, even sub-auto)
    // sight of the reference, warms getCachedChapter for THIS verse and every
    // following verse in the chapter (a preacher reading a passage), so the
    // hard-cut lands instantly. Fire-and-forget + deduped by fetchChapterCached's
    // in-flight/cache map, so re-detections cost nothing. Skip phrase matches so
    // a coincidental worship-phrase psalm doesn't warm a wrong chapter.
    if (!scripture.isPhraseMatch) {
      prefetchChapter(scripture.ref.book, scripture.ref.chapter, bibleSession.state.translation);
    }
    // Dedup key can keep the "-verseEnd" suffix unconditionally — it's never
    // shown to the operator. The visible reference-box text must NOT: it was
    // reusing this same string via setRef(key), which put a bogus "-1" on
    // every single-verse detection ("Philippians 4:1-1" instead of "Philippians 4:1").
    const key = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}-${scripture.ref.verseEnd}`;
    // Dedup by suggestion ID (not reference key) so the same verse spoken
    // again later — a new Deepgram detection with a new ID — routes through
    // and re-populates the Bible panel fresh each time. The 3 s micro-cooldown
    // in decideBibleAutoFire absorbs interim→final→whisper duplicate firings of
    // a single utterance; here we only prevent the same suggestion object from
    // triggering a redundant setCards call on every React re-render.
    if (lastRoutedScriptureRef.current === scripture.id) return;
    lastRoutedScriptureRef.current = scripture.id;
    // v1: suppress re-routing the SAME reference within the micro-cooldown so
    // the interim→final→whisper cascade of one spoken verse (all sharing this
    // refKey but carrying different suggestion ids) creates ONE box, not a new
    // box each time. A DIFFERENT reference — including the next verse the
    // preacher moves to — has a different refKey and always passes through.
    // The projector-fire paths below keep their own anti-replay cooldowns, so
    // this only governs box creation, and anything already cooled-down there
    // would have been suppressed anyway.
    const routeRefKey = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}`;
    const nowRoute = Date.now();
    if (lastRoutedRefKeyRef.current === routeRefKey && nowRoute - lastRoutedRefTsRef.current < BIBLE_MICRO_COOLDOWN_MS) {
      return;
    }
    lastRoutedRefKeyRef.current = routeRefKey;
    lastRoutedRefTsRef.current = nowRoute;
    const refText = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}${scripture.ref.verseStart !== scripture.ref.verseEnd ? `-${scripture.ref.verseEnd}` : ""}`;
    // Populate cards for auto-fire + AI-chip display only.
    // DO NOT call setSelectedIdx here — that would hijack the center Bible
    // panel to show the detected verse even in MANUAL mode, which the operator
    // sees as a glitch ("verses appearing in preview when not mentioned").
    // selectedIdx is only set AFTER the operator or auto-fire explicitly sends
    // a verse to live (see the auto-approve effect below at line 2174/2197).
    const label = `${refText} (${bibleSession.state.translation})`;
    // ProPresenter-style instant-fire: project the reference label immediately,
    // then update with full verse text once the async lookup completes. This
    // eliminates the 5-15s cachedLookup network round-trip from the critical path.
    //
    // Step 1: Instant-fire a label-only slide if AUTO is on and confidence qualifies.
    // Uses sendLiveRef directly (doAutoFire isn't defined yet in hook order).
    // HARD floor (JPD sign-off 2026-08-14): auto-fire ONLY at >= 75. No forceLive
    // bypass — a repeated/whisper-band verse below 75 must SUGGEST, never fire.
    const isHighConf = scripture.confidence >= BIBLE_AUTOFIRE_CONFIDENCE;
    let autoOn = false;
    try { autoOn = window.sessionStorage.getItem(AUTO_APPROVE_KEY_INSTANT) === "1"; } catch { /* noop */ }
    // FADE/FLASH FIX (2026-08-20): if this reference is ALREADY the live slide,
    // the verse is on the projector — re-detecting it (preacher re-reads / says
    // "did I say John 3:16?") must NOT re-fire. Firing again flashes the
    // label-only placeholder (black screen + the reference) and replays the
    // fade — the audience-visible pulse. Skip the instant label-fire entirely
    // when the ref is already live; the full-text step below is separately
    // guarded by exact-text identity.
    // Feed the reference too (2026-08-29): the projected slide keeps the label in
    // a SEPARATE `.reference` field, so passing body-only `.text` made
    // parseLiveScriptureRef always return null → the already-live suppression was
    // silently defeated. Re-embed the reference so the guard can read it.
    const liveGuardSlide = currentLiveSlideRef.current;
    const liveTextForGuard = liveGuardSlide?.kind === "text"
      ? `${liveGuardSlide.text}${liveGuardSlide.reference ? `\n\n${liveGuardSlide.reference}` : ""}`
      : null;
    const refAlreadyLive = !isDifferentRefLive(liveTextForGuard, scripture.ref);
    // Verse-bounce fix: never re-project the verse voice nav just moved away from.
    const navOriginHold = !scripture.voiceCommand && navOriginSuppressed(navOriginRef.current, scripture.ref, liveTextForGuard, Date.now());
    // Mark a held origin HANDLED so auto-approve can't fire it later when the
    // window lapses or liveSlide changes.
    if (navOriginHold) lastHandledAutoFireSuggestionIdRef.current = scripture.id;
    if (autoOn && isHighConf && !refAlreadyLive && !navOriginHold) {
      const fireKey = `ai-instant-${key}`;
      // Anti-replay check before instant-fire (same 3s cooldown as the full path).
      const nowInstant = Date.now();
      const lastFired = bibleFiredMapRef.current[fireKey];
      if (typeof lastFired !== "number" || nowInstant - lastFired >= BIBLE_MICRO_COOLDOWN_MS) {
        bibleFiredMapRef.current[fireKey] = nowInstant;
        lastHandledAutoFireSuggestionIdRef.current = scripture.id;
        // NO REFERENCE-ONLY FLASH + FASTER (2026-08-20, user directive): never
        // project a bare "Book C:V" placeholder before the verse. If the verse
        // is ALREADY in the chapter cache, project the FULL verse INSTANTLY
        // (hard cut) here — zero perceived latency, no ref-only flash. On a
        // cache miss, leave the current slide up and let the async lookup below
        // project the full verse the moment it resolves. Either way the audience
        // only ever sees a complete verse.
        try {
          const ck = chapterKey(bibleSession.state.translation, scripture.ref.book, scripture.ref.chapter);
          const cached = getCachedChapter(ck);
          const cv = cached?.verses.filter((v) => v.verse >= scripture.ref.verseStart && v.verse <= scripture.ref.verseEnd) ?? [];
          if (cv.length > 0) {
            // 2026-08-31 field fix (JPD recording — "you have 10, 11, and 12
            // here"): a multi-verse RANGE (e.g. "Exodus 3:10-12") must go LIVE
            // ONE VERSE AT A TIME — the same per-verse slides the operator sees
            // in the preview grid — NOT all verses concatenated into one wall of
            // text. Project only the FIRST verse of the range here (the async
            // path below already fires cards[0] = first verse), so live matches
            // the preview and the operator advances 10→11→12 with next-verse.
            const firstV = cv[0];
            const body = `${firstV.verse} ${firstV.text}`;
            const cachedLabel = `${scripture.ref.book} ${scripture.ref.chapter}:${firstV.verse} (${cached!.translation})`;
            sendLiveRef.current({ kind: "text", text: body, reference: cachedLabel }, null, { instant: true });
          }
        } catch { /* async lookup below still projects the full verse */ }
        // Sync preview
        bibleSession.setRef(refText);
        lastLiveWasSongRef.current = false;
        console.log(`[latency] instant-fire ref="${refText}" conf=${scripture.confidence} (full verse if cached, else lookup pending)`);
      }
    }
    // Step 2: Populate placeholder cards for auto-approve fallback.
    autoFireCardsRef.current = [{
      id: `ai-placeholder-${key}`,
      label,
      verses: [{ verse: scripture.ref.verseStart, text: "Loading…" }],
      placeholder: true,
    }];
    // Step 3: Async lookup — update projector with full verse text when ready.
    (async () => {
      try {
        const res = await cachedLookup({
          book: scripture.ref.book,
          chapter: scripture.ref.chapter,
          verseStart: scripture.ref.verseStart,
          verseEnd: scripture.ref.verseEnd,
          translationCode: bibleSession.state.translation,
          source: "ai",
        });
        const verses = res.verses;
        const finalLabel = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}${scripture.ref.verseStart !== scripture.ref.verseEnd ? `-${scripture.ref.verseEnd}` : ""} (${res.translation})`;
        const cards = verses.map((v, i) => ({
          id: `ai-${finalLabel}-${i}`,
          label: `${scripture.ref.book} ${scripture.ref.chapter}:${v.verse} (${res.translation})`,
          verses: [{ verse: v.verse, text: v.text }],
        }));
        if (cards.length === 0) {
          // AI-detected reference returned no verses. Distinguish a genuinely
          // non-existent verse ("Genesis 1:102") from a transient/unknown
          // failure by probing verse 1 of the same chapter: if that EXISTS, the
          // chapter is real and the requested verse number is out of range, so
          // it's not a real verse → show the friendly notice (and replace the
          // label-only slide already on the projector). If verse 1 is also empty
          // (garbled book/chapter, or a transient failure), keep the neutral
          // placeholder — so a mangled mishearing never projects "not in the
          // Bible" to the congregation.
          let chapterExists = false;
          try {
            const probe = await cachedLookup({
              book: scripture.ref.book, chapter: scripture.ref.chapter,
              verseStart: 1, verseEnd: 1,
              translationCode: bibleSession.state.translation, source: "ai",
            });
            chapterExists = probe.verses.length > 0;
          } catch { /* treat as unknown */ }

          if (chapterExists) {
            // 2026-08-30: an out-of-range verse (valid chapter but no such verse —
            // e.g. present in KJV but not the church's loaded translation, or one
            // that slipped past the parser's verse-range guard) must NOT project a
            // "not in the Bible" notice to LIVE and must NOT strand a notice card in
            // the preview (field report: an invalid "Romans 8:80" notice card stuck
            // in the center while the live verse moved on). Inform the operator with
            // a toast only; leave the projector AND the center panel untouched — a
            // complete no-op on screen.
            const refLabel = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}${scripture.ref.verseStart !== scripture.ref.verseEnd ? `-${scripture.ref.verseEnd}` : ""}`;
            autoFireCardsRef.current = [];
            toast.warning(`"${refLabel}" isn't a verse in the Bible — check the reference.`);
            setAutoFireCardsTick((t) => t + 1);
            return;
          }

          autoFireCardsRef.current = [{
            id: `ai-error-${key}`,
            label,
            verses: [{ verse: scripture.ref.verseStart, text: "(no verse text available)" }],
            placeholder: true,
          }];
          return;
        }
        autoFireCardsRef.current = cards;
        // Update projector with full verse text if we already instant-fired the label.
        // RECENCY GUARD (2026-08-20): async lookups race — during rapid verse
        // changes an OLDER detection's late-resolving lookup used to re-project a
        // STALE verse over the newer one ("detected but didn't project"). Only
        // the MOST RECENT routed detection may drive the projector; a superseded
        // lookup no-ops here (lastRoutedScriptureRef is set to the newest id on
        // every routing-effect run above).
        if (autoOn && isHighConf && lastRoutedScriptureRef.current === scripture.id) {
          const first = cards[0];
          const body = first.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
          const fullSlide: import("@/lib/broadcast").SlidePayload = { kind: "text", text: body, reference: first.label };
          // 2026-08-30 verse-repeat deeper fix: decide from the REFERENCE (via
          // resolvedDetectionAction), recomputed against the CURRENT live slide
          // post-await. When this re-detection is the ALREADY-LIVE verse, do NOT
          // re-send to the projector (was a raw text-identity check that re-pulsed
          // on formatting/translation body differences) AND do NOT churn the
          // center/preview panel (previously synced unconditionally — the reported
          // "hearing the correct verse yet pushing something else"). A DIFFERENT
          // ref (swap-back / next verse / new passage) still projects and syncs.
          const liveNowFull = currentLiveSlideRef.current;
          // SEND uses the post-fire live state (don't re-pulse an identical live
          // verse); the PREVIEW sync below uses the PRE-fire refAlreadyLive.
          // Verse-bounce fix (Cause B): a slow lookup for the ORIGIN verse that
          // resolves after voice nav moved on must neither re-send nor re-sync.
          const liveNowGuardText = liveNowFull?.kind === "text"
            ? `${liveNowFull.text}${liveNowFull.reference ? `\n\n${liveNowFull.reference}` : ""}`
            : null;
          const navOriginHoldNow = !scripture.voiceCommand && navOriginSuppressed(navOriginRef.current, scripture.ref, liveNowGuardText, Date.now());
          const shouldSend = resolvedDetectionAction(liveNowFull, scripture.ref).send && !navOriginHoldNow;
          try {
            // Transition-replay guard: fade only on the first projection of
            // this reference family; cascade re-fires hard-cut (see aiShouldFade).
            if (shouldSend) sendLiveRef.current(fullSlide, null, aiShouldFade(fullSlide.text) ? { preserveConfiguredTransition: true } : { instant: true });
          } catch { /* noop */ }
          // Sync the center preview to the detected verse. 2026-08-30 REGRESSION
          // FIX: the sync must key off the PRE-fire `refAlreadyLive` (computed at
          // the top of this effect, before instant-fire), NOT the post-await live
          // slide via `shouldSync`. Instant-fire puts a FRESH verse LIVE before
          // this async block runs, so `shouldSync` (post-fire same-ref) was false
          // even for a brand-new verse → the center preview never followed it and
          // stayed on a STALE verse (field report: LIVE = 1 Corinthians 4:7 while
          // the preview was stuck on Matthew 5:7). `refAlreadyLive` is true ONLY
          // for a genuine re-hearing of an already-live verse → we skip the sync
          // only then, preserving the anti-churn behaviour.
          if (!refAlreadyLive && !navOriginHoldNow) syncBibleCenterToDetection(scripture.ref, refText, cards);
          console.log(`[latency] verse-text-update ref="${refText}" (full text now on projector)`);
        }
        // Bump tick so the auto-approve effect re-runs for non-instant-fire cases
        // (e.g., AUTO was off when detected, operator toggles it on later).
        setAutoFireCardsTick((t) => t + 1);
      } catch (e) {
        autoFireCardsRef.current = [{
          id: `ai-error-${key}`,
          label,
          verses: [{ verse: scripture.ref.verseStart, text: e instanceof Error ? e.message : "(lookup failed)" }],
          placeholder: true,
        }];
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // AUTO_APPROVE_KEY_INSTANT, AUTO_ADVANCE_KEY, AUTO_FIRE_MIN_GAP_KEY,
  // AUTO_FIRED_SESSION_KEY, HOLD_DURING_SONG_KEY, DEFAULT_MIN_GAP_MS —
  // imported at module top from operatorConstants.ts.

  // Y4: latest send/kill callbacks captured in refs so stale closures in the
  // interval / queued timer don't fire against a dead callback.
  const sendLiveRef = useRef(ctx.onSendSlideToLive);
  useEffect(() => { sendLiveRef.current = ctx.onSendSlideToLive; });

  // R3: rate-limit bookkeeping.
  const lastAutoFireAtRef = useRef<number>(0);
  const queuedAutoFireRef = useRef<{ slide: import("@/lib/broadcast").SlidePayload; key: string; ref: string; conf: number } | null>(null);
  const queuedTimerRef = useRef<number | null>(null);
  const autoAdvanceIntervalRef = useRef<number | null>(null); // R4/R9
  // 2026-07-29 crash fix: one auto-fire per detection event (see effect below).
  const lastHandledAutoFireSuggestionIdRef = useRef<string | null>(null);
  const lastLiveWasSongRef = useRef<boolean>(false); // Y8
  // 2026-07-30 anti-replay race guard: synchronous in-memory mirror of the
  // sessionStorage fired-map. Written BEFORE the projector fires so two
  // Deepgram interims arriving in the same JS tick can't both slip past the
  // 3s micro-cooldown. sessionStorage is still written (fire-and-forget)
  // for cross-tab observability / analytics — this ref is the timing
  // authority for the same-tab hot path.
  const bibleFiredMapRef = useRef<Record<string, number>>({});

  // Bug-fix 2026-08-11 (transition replays 4-6×): 0.1.131 gave AI-fired slides
  // a 150ms fade — which made the AI cascade's pre-existing multi-fire VISIBLE.
  // One spoken verse legitimately projects several distinct content states in
  // quick succession (label placeholder → evolving partial refs from streaming
  // interims → corrected final → Whisper correction), and each used to be an
  // invisible 0ms hard cut. Rule: only the FIRST projection of a reference
  // family (book+chapter) inside a short window gets the fade; every re-fire
  // of that family within the window is a hard cut (the legacy look), so the
  // cascade collapses back to exactly one visible fade per spoken verse. The
  // window (8s) comfortably covers the interim→final→whisper settle (~2-5s)
  // while a genuinely new reading of the same chapter minutes later still
  // fades. Manual sends and the operator's configured transition are untouched
  // (this guards only the two AI fire chokepoints below).
  // AI-projection transition (2026-08-20, user directive): the operator asked
  // for AI auto-fires to be an INSTANT HARD CUT — no fade flicker when a spoken
  // verse lands on the projector. So this always returns false (never fade); the
  // two AI fire chokepoints below then send with `{ instant: true }`. Manual
  // sends and the operator's configured transition are unaffected. (The former
  // per-reference-family "fade once, then hard-cut the cascade" logic is
  // retired — always-cut supersedes it and removes the split-second dip.)
  const aiShouldFade = useCallback((_slideText: string): boolean => false, []);

  // Part 2 (verse forward-continuation): word-timing tracking buffers, same
  // shape as the song version in SongAutopilotStaging but scoped to Bible
  // verse cards. Only advances a verse that is ALREADY live (manually
  // clicked or auto-fired via doAutoFire above) — never originates a fresh
  // push, mirroring the song invariant.
  const bibleRecentWordsRef = useRef<string[]>([]);
  const bibleMatchStreakRef = useRef(0);
  const bibleInterimMatchStreakRef = useRef(0); // Part 2b: interim-based advance
  const bibleCooldownUntilRef = useRef(0);
  const bibleLastAdvanceTsRef = useRef(0);
  const bibleLastWordTsRef = useRef<number>(Date.now()); // for silence detection
  // Refs that mirror state/props for the setInterval-based Part 2c ticker
  // (stale-closure prevention — same pattern as the song silence ticker).
  // Initialized with safe stubs; updated via keep-current effects defined
  // after safeSendLive and bibleSession are in scope.
  const bibleCardsRef = useRef(bibleSession.state.cards);
  // Stores the most recently AI-detected verse cards for the auto-fire path.
  // Kept separate from bibleSession so auto-detections never hijack the center
  // Bible panel — that only updates on explicit operator lookups or chip clicks.
  const autoFireCardsRef = useRef<import("./hooks").VerseCard[]>([]);
  // Tick counter: bumped when autoFireCardsRef is populated with real (non-placeholder)
  // cards after an async lookup. The auto-approve effect depends on this so it re-runs
  // immediately when cards are ready, instead of waiting for the next Deepgram message.
  const [autoFireCardsTick, setAutoFireCardsTick] = useState(0);
  const bibleSelectedIdxRef = useRef<number | null>(bibleSession.state.selectedIdx ?? null);
  const bibleLiveSlideRef = useRef(ctx.liveSlide ?? null);
  // Stubs — overwritten by keep-current effects after first render.
  const safeSendLiveRef = useRef<((s: import("@/lib/broadcast").SlidePayload) => boolean)>(() => false);
  const bibleSetSelectedIdxRef = useRef<(idx: number) => void>(() => {});

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
      // 2026-08-16 ANTI-FLICKER: if this EXACT slide is already live, do NOT
      // re-send it. A preacher repeating a verse that's already on the screen
      // used to re-fire it, causing a visible flicker / re-transition back to the
      // same verse. If it's already showing, just leave it there. (Only skips an
      // identical CURRENTLY-live slide — a repeat after moving to something else
      // still re-projects, preserving the "preacher repeats a verse" behaviour.)
      const liveNow = bibleLiveSlideRef.current;
      // Compare the REFERENCE too, not just the body: two DIFFERENT verses can
      // have byte-identical bodies (e.g. a Psalm 136 / call-and-response refrain
      // with verse numbers off), and a text-only check would swallow the advance
      // to the next verse. Mirror slideOutputIdentity (text + reference).
      if (slide.kind === "text" && liveNow?.kind === "text"
          && liveNow.text === slide.text
          && (liveNow.reference ?? "") === (slide.reference ?? "")) {
        return true;
      }
      // AI auto-fire uses an instant one-shot transition while preserving the
      // operator's configured transition for subsequent manual sends.
      // Transition-replay guard: fade only on the first projection of this
      // reference family; cascade re-fires hard-cut (see aiShouldFade).
      const opts = slide.kind === "text" && !aiShouldFade(slide.text)
        ? { instant: true as const }
        : { preserveConfiguredTransition: true as const };
      const res = sendLiveRef.current(slide, null, opts) as unknown;
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
  }, [aiShouldFade]);

  // Keep-current effects for Bible Part 2c ticker refs (stale-closure prevention).
  // These run after every render, keeping the setInterval callback fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { safeSendLiveRef.current = safeSendLive; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { bibleSetSelectedIdxRef.current = bibleSession.setSelectedIdx; });
  useEffect(() => {
    // bibleCardsRef mirrors the auto-fire cards (not bibleSession) so the
    // Part 2c silence-advance and voice-nav effects read the right data.
    bibleCardsRef.current = autoFireCardsRef.current;
  });
  useEffect(() => { bibleSelectedIdxRef.current = bibleSession.state.selectedIdx ?? null; }, [bibleSession.state.selectedIdx]);
  useEffect(() => { bibleLiveSlideRef.current = ctx.liveSlide ?? null; }, [ctx.liveSlide]);

  // R3: fire helper — enforces min-gap, queues newer detections. `skipMinGap`
  // is set for forceLive/voiceCommand detections — a deliberate repeat or an
  // explicit "verse N" navigation phrase shouldn't wait behind the general
  // anti-chatter rate limit meant for passive/incidental scripture mentions.
  const doAutoFire = useCallback((slide: import("@/lib/broadcast").SlidePayload, key: string, ref: string, conf: number, skipMinGap = false) => {
    let minGap = DEFAULT_MIN_GAP_MS;
    if (!skipMinGap) {
      try {
        const raw = window.localStorage.getItem(AUTO_FIRE_MIN_GAP_KEY);
        const parsed = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(parsed) && parsed >= 0) minGap = parsed;
      } catch { /* noop */ }
    } else {
      minGap = 0;
    }
    const now = Date.now();
    const wait = lastAutoFireAtRef.current + minGap - now;
    if (wait <= 0) {
      lastAutoFireAtRef.current = now;
      // 2026-07-24 span instrumentation: unconditional single-line log so
      // ops can see end-to-end latency without enabling PF_TRACE. Format
      // designed to grep: "[latency] auto-fire ref=<...> conf=<...> det-to-fire=<N>ms"
      const detToFireMs = (slide as unknown as { __detToFireMs?: number }).__detToFireMs;
      const timing = typeof detToFireMs === "number" ? ` det-to-fire=${detToFireMs}ms` : "";
      console.log(`[latency] auto-fire ref="${ref}" conf=${conf}${timing}`);
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
        // 2026-07-25 security fix (review 🔴): sessionStorage ONLY — the
        // localStorage "migration" fallback let XSS pre-arm auto-live across
        // restarts, the exact hole Y3 closed. Migration window is over.
        if (window.sessionStorage.getItem(AUTO_APPROVE_KEY_INSTANT) !== "1") return;
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

    const cards = autoFireCardsRef.current;
    if (cards.length === 0) return;
    // Y3: auto-approve now in sessionStorage; fall back to localStorage for
    // migration so existing operators aren't dropped mid-service.
    let autoOn = false;
    try {
      // 2026-07-25 security fix (review 🔴): sessionStorage ONLY — see the
      // queued-fire re-check above for why the localStorage fallback is gone.
      autoOn = window.sessionStorage.getItem(AUTO_APPROVE_KEY_INSTANT) === "1";
    } catch { /* noop */ }
    if (!autoOn) return;
    // 2026-07-25 field bug fix: if the operator is actively typing in a
    // text input (reference lookup field, song search, message body,
    // etc.), don't yank the projector out from under them. Auto-fire
    // resumes the moment they blur the input. Doesn't affect chip clicks
    // or explicit send-to-live actions — only the AUTO scripture path.
    try {
      const el = typeof document !== "undefined" ? document.activeElement as HTMLElement | null : null;
      if (el) {
        const tag = (el.tagName || "").toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable) {
          if (pfTraceOn()) console.log("[auto-approve] held (operator typing in input)");
          return;
        }
      }
    } catch { /* noop */ }
    // Y8: hold auto-fire during active song if operator opted in.
    let holdDuringSong = false;
    try { holdDuringSong = window.localStorage.getItem(HOLD_DURING_SONG_KEY) === "1"; } catch { /* noop */ }
    if (holdDuringSong && lastLiveWasSongRef.current && ctx.liveSlide?.kind === "text") {
      if (pfTraceOn()) console.log("[auto-approve] held (song active)");
      return;
    }
    // Need a matching high-confidence detection
    const suggestions = ctx.audio.suggestions || [];
    // forceLive (set client-side when the SAME reference is spoken a second
    // time, even minutes apart) bypasses the normal 85% floor — restating a
    // verse is itself the "make sure this is on screen" signal. AUTO mode
    // being on (the `autoOn` check above) is still required either way.
    // isPhraseMatch exclusion — phrase-quote matches are capped at 74 and
    // never carry forceLive, so this filter is belt-and-braces on top of
    // those source guards (2026-07-28 sign-off: phrase matches NEVER auto-fire).
    // 2026-08-01: fromInterim gate REMOVED — interims now fire immediately
    // (200-400ms earlier than finals). The 3s micro-cooldown in decideBibleAutoFire
    // absorbs interim→final duplicate detections. The routing effect's instant-fire
    // handles the primary path; this effect is the fallback.
    // Tiers (JPD sign-off 2026-08-14 — raised 70 → 75, HARD floor):
    //   >= 75%  → auto-fires immediately (preacher clearly spoke a ref).
    //   65..74% → SUGGEST ONLY: a confirmation toast the operator must accept.
    //   < 65%   → nothing (too shaky to even ask about).
    // NO forceLive bypass — a repeated/mis-heard-as-command verse below 75 must
    // never push itself live; it can only suggest. isPhraseMatch and whisper
    // corrections are excluded from both paths.
    const scripture = suggestions.find((s) => s.type === "scripture" && !s.isPhraseMatch && s.confidence >= BIBLE_AUTOFIRE_CONFIDENCE && !lowConfBlockedSpans.has(s.id));
    // Manual-accept prompt path: the best sub-75 suggestion that hasn't been
    // handled yet. Shows a toast with a "Push LIVE" button — never auto-fires.
    if (!scripture || scripture.type !== "scripture") {
      const lowConf = suggestions.find((s) => s.type === "scripture" && !s.isPhraseMatch && s.confidence >= BIBLE_SUGGEST_CONFIDENCE && s.confidence < BIBLE_AUTOFIRE_CONFIDENCE && !lowConfBlockedSpans.has(s.id));
      if (lowConf && lowConf.type === "scripture" && lastHandledAutoFireSuggestionIdRef.current !== lowConf.id) {
        lastHandledAutoFireSuggestionIdRef.current = lowConf.id;
        const lowCards = autoFireCardsRef.current;
        const lowFirst = lowCards[0];
        if (lowFirst && !lowFirst.placeholder && lowFirst.verses?.length) {
          const lowBody = lowFirst.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
          const lowSlide: import("@/lib/broadcast").SlidePayload = { kind: "text", text: lowBody, reference: lowFirst.label };
          const lowRef = `${lowConf.ref.book} ${lowConf.ref.chapter}:${lowConf.ref.verseStart}${lowConf.ref.verseEnd !== lowConf.ref.verseStart ? `-${lowConf.ref.verseEnd}` : ""}`;
          toast(`We think we heard ${lowRef} (${lowConf.confidence}%) — put it live?`, {
            duration: 8000,
            action: {
              label: "Put LIVE",
              onClick: () => {
                safeSendLive(lowSlide);
                lastLiveWasSongRef.current = false;
              },
            },
          });
        }
      }
      return;
    }
    // 2026-07-29 crash fix (Maximum update depth exceeded): this effect depends
    // on ctx.liveSlide, so a fire re-runs it. forceLive/voiceCommand suggestions
    // bypass BOTH the min-gap and the 5-min replay guard, so the SAME suggestion
    // object re-fired on every re-render → synchronous render loop. Dedupe by
    // suggestion id: one fire per detection EVENT. A preacher restating the
    // reference later produces a NEW suggestion (new id) and still fires.
    if (lastHandledAutoFireSuggestionIdRef.current === scripture.id) return;
    const first = cards[0];
    // R8: skip placeholder cards (loading / no-text / lookup-failed) AND
    // empty-text guard as belt-and-braces.
    if (!first || first.placeholder === true || !first.verses?.length) return;
    // HARD-floor integrity (2026-08-14): the fire GATE selected the frontmost
    // >=75 suggestion, but `cards[0]` is populated from the frontmost >=50
    // routed suggestion — in a rare ordering those differ (a fresh 66% detection
    // ahead of an older 80%). Never project cards[0] unless it IS the >=75 verse
    // we gated on, otherwise a sub-75 verse's TEXT could slip live. Mismatch →
    // skip this cycle (Path 1 handles the real >=75 fire; cards re-populate next).
    const gateRef = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}${scripture.ref.verseEnd !== scripture.ref.verseStart ? `-${scripture.ref.verseEnd}` : ""}`;
    const cardRef = /^(.+?:\d+(?:-\d+)?)/.exec(first.label ?? "")?.[1];
    if (cardRef !== gateRef) return;
    const firstText = first.verses[0]?.text ?? "";
    // 2026-07-29 field bug fix: error cards ("(no verse text available)" for a
    // nonexistent verse like John 3:60, "(lookup failed)") must never project —
    // previously only the "Loading…" placeholder text was screened here.
    if (!firstText || firstText === "Loading…" || firstText.startsWith("(no verse text") || firstText.startsWith("(lookup failed")) return;

    const key = first.id;
    // Anti-replay (2026-07-30 policy — see CLAUDE.md rule 7):
    //   Old policy: 5-minute session-persistent suppression per reference.
    //   That blocked legitimate sermon-long repeats — a preacher citing
    //   Psalm 23:4 three times over 20 minutes only got the first fire.
    //   New policy: 3s micro-cooldown per reference — enough to absorb
    //   Deepgram interim/final/whisper duplicate detections of a SINGLE
    //   utterance, never enough to block a real restatement.
    //
    //   Delegated to a pure helper (`decideBibleAutoFire` in
    //   `src/lib/bible-antireplay.ts`) so the decision is directly unit-
    //   testable and the ordering (forceLive → voiceCommand → different
    //   ref live → cooldown check) lives in one place. The sessionStorage
    //   schema is preserved for observability / future analytics.
    //
    //   Songs keep their 5-minute policy (SONG_AUTO_FIRED_SESSION_KEY).
    //   Scope of this change is Bible only.
    const liveKind = ctx.liveSlide?.kind;
    // Re-embed the reference (see the liveTextForGuard note above) so
    // decideBibleAutoFire's already-live check sees the current verse's ref.
    const currentLiveText = liveKind === "text"
      ? `${ctx.liveSlide.text}${ctx.liveSlide.reference ? `\n\n${ctx.liveSlide.reference}` : ""}`
      : "";
    // Merge the sessionStorage snapshot into the synchronous in-memory ref.
    // The ref wins on conflicts because it's always the more-recent value
    // (any write we did this tick has already landed there but may not have
    // flushed to sessionStorage yet). This closes the race where two
    // Deepgram interims 200ms apart both read an empty sessionStorage before
    // either write-back completed.
    try {
      const raw = window.sessionStorage.getItem(AUTO_FIRED_SESSION_KEY);
      const stored: Record<string, number> = raw ? JSON.parse(raw) : {};
      for (const k of Object.keys(stored)) {
        const refVal = bibleFiredMapRef.current[k];
        if (typeof refVal !== "number" || stored[k] > refVal) {
          bibleFiredMapRef.current[k] = stored[k];
        }
      }
    } catch { /* noop */ }
    const nowTs = Date.now();
    // WS1 — music/choir gate is INTENTIONALLY NOT applied to Bible auto-approve.
    // Review (2026-08-10): RCCG/Pentecostal services frequently preach OVER a
    // music bed ("ministration") — loud + lower ASR confidence — which is
    // exactly when the music heuristic engages. Holding legitimate preached
    // scripture there would be a worse failure than the rare mis-heard verse.
    // The music gate is scoped to SONG auto-live only (a wrong song popping up
    // off the choir is the canonical worship false-trigger; a spurious well-
    // formed Book chapter:verse from singing is far rarer). If field data shows
    // spurious Bible fires during worship, add a tuned Bible hold then.
    const decision = decideBibleAutoFire({
      key,
      firedMap: bibleFiredMapRef.current,
      now: nowTs,
      liveText: currentLiveText,
      target: scripture.ref,
      forceLive: !!scripture.forceLive,
      voiceCommand: !!scripture.voiceCommand,
      cooldownMs: BIBLE_MICRO_COOLDOWN_MS,
      navOrigin: navOriginRef.current,
    });
    if (decision.suppress) {
      if (decision.markHandled) lastHandledAutoFireSuggestionIdRef.current = scripture.id;
      if (pfTraceOn()) console.log(`[auto-approve] suppressed same-ref within ${BIBLE_MICRO_COOLDOWN_MS}ms:`, key);
      return;
    }
    // Write to the ref SYNCHRONOUSLY, BEFORE any downstream call. Even if
    // doAutoFire queues (min-gap not yet met) or the sessionStorage.setItem
    // in doAutoFire is delayed by a tick, subsequent effect invocations
    // reading the merged map above will see this entry and correctly suppress.
    bibleFiredMapRef.current[key] = nowTs;

    const body = first.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
    const slide: import("@/lib/broadcast").SlidePayload = { kind: "text", text: body, reference: first.label };
    const ref = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}${scripture.ref.verseEnd !== scripture.ref.verseStart ? `-${scripture.ref.verseEnd}` : ""}`;
    // 2026-07-24 latency instrumentation: measure detection-received-at →
    // auto-fire-decided-at. Detection.ts is set upstream in useAudioStream.
    // Logs the delta to console (visible in devtools). Complements the
    // existing lastLatencyMs which measures first-chunk → first-transcript.
    // Together with the min-gap cut (4000→400ms) this is the primary
    // client-side lever for cutting perceived latency.
    if (typeof scripture.ts === "number") {
      const detToFireMs = Date.now() - scripture.ts;
      // Only log the informative case (auto-fire actually happening now,
      // not queued/blocked) — logged AFTER min-gap check inside doAutoFire.
      (slide as unknown as { __detToFireMs: number }).__detToFireMs = detToFireMs;
    }
    lastHandledAutoFireSuggestionIdRef.current = scripture.id;
    // #8: a restatement (forceLive) only loses its bypass when its ref is already
    // live or held by the voice-nav chain — "go back to Matthew 5:5" still swaps back.
    const effectiveForceLive = !!scripture.forceLive && !shouldDropForceLive(scripture.ref, currentLiveText, navOriginRef.current, Date.now());
    doAutoFire(slide, key, ref, scripture.confidence, effectiveForceLive || !!scripture.voiceCommand);
    // Update the center Bible panel so the operator sees the auto-projected
    // verse in the preview — keeps preview and LIVE in sync. If the verse is
    // already a tile in the loaded grid (Load Chapter), keep the whole grid and
    // just move the selection instead of collapsing to a single box.
    syncBibleCenterToDetection(scripture.ref, ref, cards);
    lastLiveWasSongRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.audio.suggestions, ctx.liveSlide, doAutoFire, safeSendLive, autoFireCardsTick]);

  // ── Part 2: transcript-aware verse forward-continuation ─────────────────
  // Unlike the fixed-interval AUTO_ADVANCE_KEY timer above (dumb, time-based,
  // no awareness of what's actually being said), this tracks real speech
  // against the NEXT verse card's text — same matchNextSlide primitive the
  // song word-timing effect uses. Activates only once the currently
  // SELECTED card is confirmed as what's actually live (ctx.liveSlide text
  // matches it) — never advances speculatively past content nobody has
  // actually put on screen. No copyright concern (Bible text), so this can
  // run whenever a verse is live, independent of the SONG_AUTOLIVE_CONFIDENCE
  // policy gate that applies to songs only.
  useEffect(() => {
    const last = ctx.audio.transcript[ctx.audio.transcript.length - 1];
    if (!last) return;
    const words = (last.words?.map((w) => w.w) ?? last.text.split(/\s+/)).filter(Boolean);
    if (words.length === 0) return;
    bibleRecentWordsRef.current = [...bibleRecentWordsRef.current, ...words].slice(-24);
    bibleLastWordTsRef.current = Date.now(); // for silence-based advance (Part 2c)

    if (Date.now() < bibleCooldownUntilRef.current) return;
    if (Date.now() - bibleLastAdvanceTsRef.current < BIBLE_SLIDE_FLOOR_MS) return;

    const cards = bibleSession.state.cards;
    const idx = bibleSession.state.selectedIdx;
    if (idx == null || !cards[idx] || cards[idx].placeholder) return;
    const nextIdx = idx + 1;
    const nextCard = cards[nextIdx];
    if (!nextCard || nextCard.placeholder || !nextCard.verses?.length) return;

    // Only continue a verse that's actually confirmed live right now.
    const current = cards[idx];
    const currentBody = current.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
    // Match the live verse by BODY or code-stripped REFERENCE. The slide stores
    // the body in `text` and the reference in a SEPARATE `.reference` field, so
    // the old `body\n\n label` equality never matched → auto-advance never fired.
    const liveIsThisVerse = ctx.liveSlide?.kind === "text" && (
      ctx.liveSlide.text === currentBody ||
      stripRefCode(ctx.liveSlide.reference) === stripRefCode(current.label)
    );
    if (!liveIsThisVerse) return;

    const nextBody = nextCard.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
    const result = matchNextSlide(bibleRecentWordsRef.current, nextBody);
    if (result.consecutiveMatches >= 3) {
      bibleMatchStreakRef.current += 1;
    } else {
      bibleMatchStreakRef.current = 0;
    }
    // Coverage bypass: if ≥ 80% of current verse spoken, single segment suffices.
    const currCovBible = scoreCoverage(bibleRecentWordsRef.current, currentBody);
    const bibleRequiredStreak = currCovBible >= 0.80 ? 1 : 2;
    if (bibleMatchStreakRef.current >= bibleRequiredStreak) {
      safeSendLive({ kind: "text", text: nextBody, reference: nextCard.label });
      bibleSession.setSelectedIdx(nextIdx);
      bibleLastAdvanceTsRef.current = Date.now();
      bibleMatchStreakRef.current = 0;
      bibleInterimMatchStreakRef.current = 0;
      console.log(`[bible-autoprogression] word-match advance to card ${nextIdx + 1}/${cards.length} (${nextCard.label}, confidence ${result.confidence}%, coverage ${Math.round(currCovBible * 100)}%, streak=${bibleRequiredStreak})`, { ts: Date.now() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.audio.transcript]);

  // Any manual operator action cancels Bible forward-continuation tracking
  // too, same guardrail philosophy as the song version's cancelTracking.
  useEffect(() => {
    const cancel = () => {
      // 2026-08-29: 4s → 2s. This armed on ANY window click/keypress, so during a
      // live service the operator's constant interaction chained 4s windows that
      // routinely stalled hands-free auto-advance. 2s still absorbs a deliberate
      // manual action without fighting the operator, but recovers twice as fast.
      bibleCooldownUntilRef.current = Date.now() + 2000;
      bibleMatchStreakRef.current = 0;
      bibleInterimMatchStreakRef.current = 0;
    };
    window.addEventListener("click", cancel, true);
    window.addEventListener("keydown", cancel, true);
    return () => {
      window.removeEventListener("click", cancel, true);
      window.removeEventListener("keydown", cancel, true);
    };
  }, []);

  // ── Part 2b: predictive interim-based Bible verse advance ───────────────
  // Mirrors the song's interim path (ProOperatorShell.tsx lines ~937-974) but
  // for Bible verse cards. Fires from `ctx.audio.interim` (continuous Deepgram
  // interim messages arriving before finalization) for ~300-500ms latency gain.
  // Stricter bar than final: minConsecutive=4 (songs use 4, Bible uses 4) and
  // streak=2 so a single interim revision doesn't cause a false advance.
  useEffect(() => {
    const interimText = ctx.audio.interim;
    if (!interimText) return;
    const words = interimText.split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    if (Date.now() < bibleCooldownUntilRef.current) return;
    if (Date.now() - bibleLastAdvanceTsRef.current < BIBLE_SLIDE_FLOOR_MS) return;
    const cards = bibleSession.state.cards;
    const idx = bibleSession.state.selectedIdx;
    if (idx == null || !cards[idx] || cards[idx].placeholder) return;
    const nextIdx = idx + 1;
    const nextCard = cards[nextIdx];
    if (!nextCard || nextCard.placeholder || !nextCard.verses?.length) return;
    // Confirm current card is actually live before advancing past it.
    const current = cards[idx];
    const currentBody = current.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
    // Match the live verse by BODY or code-stripped REFERENCE. The slide stores
    // the body in `text` and the reference in a SEPARATE `.reference` field, so
    // the old `body\n\n label` equality never matched → auto-advance never fired.
    const liveIsThisVerse = ctx.liveSlide?.kind === "text" && (
      ctx.liveSlide.text === currentBody ||
      stripRefCode(ctx.liveSlide.reference) === stripRefCode(current.label)
    );
    if (!liveIsThisVerse) return;
    const combined = [...bibleRecentWordsRef.current, ...words].slice(-24);
    const nextBody = nextCard.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
    const result = matchNextSlide(combined, nextBody, 4); // stricter than final=3
    if (result.consecutiveMatches >= 4) {
      bibleInterimMatchStreakRef.current += 1;
    } else {
      bibleInterimMatchStreakRef.current = 0;
    }
    if (bibleInterimMatchStreakRef.current >= 2) {
      safeSendLive({ kind: "text", text: nextBody, reference: nextCard.label });
      bibleSession.setSelectedIdx(nextIdx);
      bibleLastAdvanceTsRef.current = Date.now();
      bibleMatchStreakRef.current = 0;
      bibleInterimMatchStreakRef.current = 0;
      console.log(`[bible-autoprogression] predictive interim advance to card ${nextIdx + 1}/${cards.length} (${nextCard.label}, confidence ${result.confidence}%)`, { ts: Date.now() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.audio.interim]);

  // ── Part 2c: silence + coverage advance for Bible (500ms ticker) ─────────
  // Same philosophy as song Part 7c: if the preacher has spoken ≥ 60% of the
  // current verse's non-stopword words AND there's been ≥ 2.5s of silence,
  // they've finished reading and paused — advance to the next verse.
  // Uses refs-only in the setInterval callback to avoid stale closures.
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (Date.now() < bibleCooldownUntilRef.current) return;
      if (Date.now() - bibleLastAdvanceTsRef.current < BIBLE_SLIDE_FLOOR_MS) return;
      const cards = bibleCardsRef.current;
      const idx = bibleSelectedIdxRef.current;
      if (idx == null || !cards[idx] || cards[idx].placeholder) return;
      const nextIdx = idx + 1;
      const nextCard = cards[nextIdx];
      if (!nextCard || nextCard.placeholder || !nextCard.verses?.length) return;
      // Only advance the verse that's currently confirmed live.
      const current = cards[idx];
      const currentBody = current.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
      const liveSlideNow = bibleLiveSlideRef.current;
      const liveIsThisVerse = liveSlideNow?.kind === "text" && (
        liveSlideNow.text === currentBody ||
        stripRefCode(liveSlideNow.reference) === stripRefCode(current.label)
      );
      if (!liveIsThisVerse) return;
      const silenceMs = Date.now() - bibleLastWordTsRef.current;
      if (silenceMs < BIBLE_SILENCE_ADVANCE_MS) return; // not silent enough
      const cov = scoreCoverage(bibleRecentWordsRef.current, currentBody);
      if (cov < BIBLE_COVERAGE_THRESHOLD) return; // verse not sufficiently covered
      const nextBody = nextCard.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
      // 2026-08-30 REPEAT-HOLD: coverage-of-current + silence ALONE must not
      // advance. African-Pentecostal preachers re-read/repeat the live verse and
      // pause constantly ("John 3:16… let's go to John 3:16… John 3:16") — that
      // used to jump the screen to the next verse "just because it was already
      // up". Require positive evidence the NEXT verse is actually being read; a
      // pure repeat has none → HOLD. Genuine forward reading (the preacher has
      // started the next verse then paused) still advances quickly. A verbatim
      // "next verse" voice command is a different path and is unaffected.
      //
      // CRITICAL: match against the verse TEXT ONLY (no "17 " number prefix).
      // matchNextSlide anchors every run at the target's FIRST token; the spoken
      // stream never contains the verse NUMBER, so feeding the numbered body made
      // the match always 0 and would have stranded genuine forward reading. With
      // the number stripped, continuous reading of the next verse matches, while a
      // repeat of the current verse still does not (it doesn't contain the next
      // verse's opening words).
      const nextText = nextCard.verses.map((v) => v.text).join(" ");
      const nextEvidence = matchNextSlide(bibleRecentWordsRef.current, nextText);
      if (nextEvidence.consecutiveMatches < BIBLE_NEXT_EVIDENCE_MIN) return; // repeat / no forward motion → hold
      // Verse covered + silence + next-verse evidence = preacher moved on → advance
      safeSendLiveRef.current({ kind: "text", text: nextBody, reference: nextCard.label });
      bibleSetSelectedIdxRef.current(nextIdx);
      bibleLastAdvanceTsRef.current = Date.now();
      bibleMatchStreakRef.current = 0;
      bibleInterimMatchStreakRef.current = 0;
      bibleRecentWordsRef.current = []; // reset so we don't chain-advance immediately
      console.log(`[bible-autoprogression] silence+coverage+nextEvidence advance to ${nextCard.label} (cov=${Math.round(cov * 100)}%, silence=${Math.round(silenceMs)}ms, nextMatch=${nextEvidence.consecutiveMatches})`, { ts: Date.now() });
    }, 500);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Voice verse-navigation commands ("next verse", "continue", "go back",
  // "again", etc.) ──────────────────────────────────────────────────────────
  // Distinct from the word-timing forward-continuation effect above (which
  // silently follows lyrics/verses as they're spoken) — this reacts to the
  // preacher/operator EXPLICITLY saying a navigation phrase. Reuses
  // `parseContextCommand` (src/lib/context-parser.ts), which only fires when
  // hasVerseContext is true (a verse is already showing) and requires
  // anchored phrases, not lone words, for anything but the lowest-confidence
  // patterns. Dispatches the SAME `presentflow:bible-next/prev` internal
  // events the manual Verse ▸/◂ buttons use, BUT with a { live: true } payload
  // so voice commands PROJECT IMMEDIATELY while the manual buttons stay
  // preview-only (2026-08-18 user directive). This restores the fast voice
  // auto-advance that the 2026-08-16 preview-only change had disabled.
  // Shared echo-guard for voice nav so the SAME spoken command can't fire twice
  // when it arrives first as a Deepgram interim (fast path, ~0.5s) and again as
  // the finalized segment ~1s later. Keyed by DIRECTION (next/prev), not exact
  // text, within a short window — long enough to absorb interim→final settle,
  // short enough that a genuinely separate command a beat later still fires.
  const voiceNavEchoRef = useRef<{ dir: string; ts: number } | null>(null);
  const NAV_ECHO_MS = 1500;
  const navDir = (verb: string) =>
    verb === "next_verse" || verb === "continue" ? "next"
    : verb === "prev_verse" || verb === "back" ? "prev"
    : verb;
  const isNavEcho = (verb: string) => {
    const e = voiceNavEchoRef.current;
    return !!e && e.dir === navDir(verb) && Date.now() - e.ts < NAV_ECHO_MS;
  };
  const recordNavFire = (verb: string) => {
    voiceNavEchoRef.current = { dir: navDir(verb), ts: Date.now() };
  };

  // 2026-08-31 field fix (JPD recording — "I mentioned next verse. It didn't go
  // next verse"): the STANDALONE word-count guards below use terseCommandWordCount
  // (politeness/filler stripped before counting) so a natural "Continue to the
  // next verse, please." fires, while narration still stays blocked. See
  // context-parser.ts for the helper + rationale.

  // FAST PATH: early-fire relative verse-nav from the live Deepgram INTERIM
  // (arrives ~200ms+ before the finalized segment). Only the terse, unambiguous
  // relative commands ("next verse", "continue", "go back") early-fire here —
  // repeat / absolute-jump wait for the stable final. Mirrors the final path's
  // guards exactly (confidence floor, reading guard, standalone guard); the
  // shared echo-guard collapses this interim fire and its eventual final into a
  // single advance. If no interim is delivered, the final path fires normally.
  useEffect(() => {
    const interimText = (ctx.audio.interim ?? "").trim();
    if (!interimText) return;
    const cards = bibleSession.state.cards;
    const idx = bibleSession.state.selectedIdx;
    // Verse context = a verse card is selected in the Bible panel OR a scripture
    // verse is currently LIVE on the projector. The live-slide fallback (2026-08-20)
    // covers the common service case: an auto-fired verse whose bibleSession card
    // is still a "Loading…" placeholder, or running purely off AI chips without
    // ever opening the Bible panel — previously both left hasVerseContext false so
    // "next verse" never dispatched. advanceRef anchors on bibleSession.state.ref,
    // which auto-fire keeps pointed at the live verse, so the advance still works.
    const hasVerseContext =
      (cards.length > 0 && idx != null && !!cards[idx] && !cards[idx].placeholder) ||
      (ctx.liveSlide?.kind === "text" && !!ctx.liveSlide.reference);
    if (!hasVerseContext) return;
    const cmd = parseContextCommand(interimText, { hasVerseContext, hasSlideContext: false, hasSongContext: false });
    if (!cmd) return;
    if (cmd.confidence < 70) return;
    const isRelNav =
      cmd.verb === "next_verse" || cmd.verb === "continue" ||
      cmd.verb === "prev_verse" || cmd.verb === "back";
    if (!isRelNav) return;
    const matched = (cmd.matchedText ?? "").toLowerCase().trim();
    const liveText = (ctx.liveSlide?.kind === "text" ? ctx.liveSlide.text : "").toLowerCase();
    if (matched && liveText.includes(matched)) return; // reading guard
    if (navCommandWordCount(interimText, cmd) > 5) return; // standalone guard (politeness-stripped, command tail)
    if (isNavEcho(cmd.verb)) return; // already fired this command (prior interim tick or final)
    if (navDir(cmd.verb) === "prev") {
      dispatchInternal("presentflow:bible-prev", { live: true });
      toast.info(`Voice: "${cmd.matchedText}" → previous verse`);
    } else {
      dispatchInternal("presentflow:bible-next", { live: true });
      toast.info(`Voice: "${cmd.matchedText}" → next verse`);
    }
    recordNavFire(cmd.verb);
    bibleLastAdvanceTsRef.current = Date.now();
    bibleMatchStreakRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.audio.interim]);

  const processedVoiceSegmentsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const last = ctx.audio.transcript[ctx.audio.transcript.length - 1];
    if (!last) return;
    if (processedVoiceSegmentsRef.current.has(last.id)) return;
    processedVoiceSegmentsRef.current.add(last.id);
    if (processedVoiceSegmentsRef.current.size > 200) {
      // Trim — this Set only needs to dedupe recent segments, not grow forever.
      const arr = Array.from(processedVoiceSegmentsRef.current);
      processedVoiceSegmentsRef.current = new Set(arr.slice(-100));
    }
    const cards = bibleSession.state.cards;
    const idx = bibleSession.state.selectedIdx;
    // Verse context = a verse card is selected in the Bible panel OR a scripture
    // verse is currently LIVE on the projector. The live-slide fallback (2026-08-20)
    // covers the common service case: an auto-fired verse whose bibleSession card
    // is still a "Loading…" placeholder, or running purely off AI chips without
    // ever opening the Bible panel — previously both left hasVerseContext false so
    // "next verse" never dispatched. advanceRef anchors on bibleSession.state.ref,
    // which auto-fire keeps pointed at the live verse, so the advance still works.
    const hasVerseContext =
      (cards.length > 0 && idx != null && !!cards[idx] && !cards[idx].placeholder) ||
      (ctx.liveSlide?.kind === "text" && !!ctx.liveSlide.reference);
    if (!hasVerseContext) return;
    const cmd = parseContextCommand(last.text, { hasVerseContext, hasSlideContext: false, hasSongContext: false });
    if (!cmd) return;
    // parseContextCommand's own `confidence` field isn't gated anywhere
    // upstream — it returns the first pattern match regardless of score.
    // Below CONFIRM_FLOOR we drop entirely; CONFIRM_FLOOR..70 offers a one-tap
    // confirmation toast (handled after the guards); >=70 fires immediately.
    const NAV_CONFIRM_FLOOR = 55;
    if (cmd.confidence < NAV_CONFIRM_FLOOR) return;
    // CONTEXT AWARENESS (2026-08-20 user directive): "go back" / "continue" /
    // "next verse" also occur in ordinary preaching AND inside the verses being
    // read aloud. Only act when it's a genuine, terse COMMAND — never on
    // incidental speech or scripture. Two guards:
    const utterance = last.text.trim();
    const matched = (cmd.matchedText ?? "").toLowerCase().trim();
    //  (1) READING guard — if the matched phrase is part of the verse currently
    //      on the projector, the preacher is READING it, not commanding. Skip.
    const liveText = (ctx.liveSlide?.kind === "text" ? ctx.liveSlide.text : "").toLowerCase();
    if (matched && liveText.includes(matched)) return;
    //  (2) STANDALONE guard — a real command is terse ("next verse", "go back",
    //      "go to the next verse"), not buried in a sentence ("we're gonna see
    //      this in the next verse", "go back to what I said earlier"). Require a
    //      short utterance so a phrase embedded in narration never fires.
    const wordCount = navCommandWordCount(utterance, cmd);
    if (wordCount > 5) return;
    const navFireFloor = 70;
    // CONFIDENCE-GATED CONFIRMATION (2026-08-20 field directive): when the
    // command is plausible but not certain (CONFIRM_FLOOR..69) — e.g. "go on",
    // "moving on" — don't silently act OR silently drop. Surface a one-tap
    // confirmation toast so the operator decides. processedVoiceSegmentsRef has
    // already deduped this segment, so the toast shows at most once per phrase.
    // High confidence (>= navFireFloor) skips this and fires instantly below.
    if (cmd.confidence < navFireFloor) {
      const dir =
        cmd.verb === "prev_verse" || cmd.verb === "back" ? "prev"
        : cmd.verb === "next_verse" || cmd.verb === "continue" ? "next"
        : null;
      if (dir && !isNavEcho(dir === "next" ? "next_verse" : "prev_verse")) {
        toast.info(`Did they say "${cmd.matchedText}"?`, {
          description: `Tap to go ${dir === "next" ? "to the next verse" : "back a verse"}`,
          action: {
            label: dir === "next" ? "Next verse" : "Back",
            onClick: () => {
              dispatchInternal(dir === "next" ? "presentflow:bible-next" : "presentflow:bible-prev", { live: true });
              recordNavFire(dir === "next" ? "next_verse" : "prev_verse");
              bibleLastAdvanceTsRef.current = Date.now();
              bibleMatchStreakRef.current = 0;
            },
          },
          duration: 6000,
        });
      }
      return;
    }
    // EXPLICIT spoken navigation ("next verse", "go back", "continue") is a
    // direct operator command — it must project immediately. Unlike the
    // AUTO word-match / silence paths, it deliberately BYPASSES the 4s manual
    // cooldown (bibleCooldownUntilRef) so an operator click a moment earlier
    // doesn't freeze the spoken command, and uses only a short same-utterance
    // dedupe floor (300ms) to absorb Deepgram interim→final duplicates of the
    // SAME phrase rather than the full 1s BIBLE_SLIDE_FLOOR_MS min-gap.
    const VOICE_NAV_DEDUPE_MS = 300;
    if (Date.now() - bibleLastAdvanceTsRef.current < VOICE_NAV_DEDUPE_MS) return;
    // Echo-guard: if the interim fast-path already fired this same command, the
    // finalized segment for it must NOT advance again.
    const isRelNav =
      cmd.verb === "next_verse" || cmd.verb === "continue" ||
      cmd.verb === "prev_verse" || cmd.verb === "back";
    if (isRelNav && isNavEcho(cmd.verb)) return;
    if (cmd.verb === "next_verse" || cmd.verb === "continue") {
      dispatchInternal("presentflow:bible-next", { live: true });
      recordNavFire(cmd.verb);
      bibleLastAdvanceTsRef.current = Date.now();
      bibleMatchStreakRef.current = 0;
      toast.info(`Voice: "${cmd.matchedText}" → next verse`);
    } else if (cmd.verb === "prev_verse" || cmd.verb === "back") {
      dispatchInternal("presentflow:bible-prev", { live: true });
      recordNavFire(cmd.verb);
      bibleLastAdvanceTsRef.current = Date.now();
      bibleMatchStreakRef.current = 0;
      toast.info(`Voice: "${cmd.matchedText}" → previous verse`);
    } else if (cmd.verb === "repeat_verse") {
      // idx can be null now that hasVerseContext also trips on a live scripture
      // slide (running off AI chips, no selected card). Guard the card deref and
      // fall back to re-sending whatever verse is currently on the projector.
      const c = idx != null ? cards[idx] : undefined;
      if (c) {
        const body = c.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
        ctx.onSendSlideToLive({ kind: "text", text: body, reference: c.label }, undefined, { preserveConfiguredTransition: true }); // voice: fast AI fade, never theme-slowed (PR 2)
      } else if (ctx.liveSlide?.kind === "text" && ctx.liveSlide.reference) {
        ctx.onSendSlideToLive({ kind: "text", text: ctx.liveSlide.text, reference: ctx.liveSlide.reference }, undefined, { preserveConfiguredTransition: true }); // voice: fast AI fade, never theme-slowed (PR 2)
      } else {
        return;
      }
      bibleLastAdvanceTsRef.current = Date.now();
      toast.info(`Voice: "${cmd.matchedText}" → repeated`);
    } else if (cmd.verb === "goto_bible_verse") {
      // Absolute jump to a verse NUMBER within the current chapter — "from
      // verse 11", "from 13" — distinct from next/prev's relative +/-1 step.
      // Anchor on the selected card's label, or (when running off chips with no
      // card) the live scripture slide's reference — never deref cards[idx!].
      const verseNumber = (cmd.payload as { verseNumber?: number } | undefined)?.verseNumber;
      const anchorLabel = (idx != null ? cards[idx]?.label : undefined)
        ?? (ctx.liveSlide?.kind === "text" ? (ctx.liveSlide.reference ?? undefined) : undefined);
      const m = anchorLabel ? /^(.+?)\s+(\d+):\d+/.exec(anchorLabel) : null;
      if (verseNumber && m) {
        const book = m[1];
        const chapter = parseInt(m[2], 10);
        bibleLastAdvanceTsRef.current = Date.now();
        void (async () => {
          try {
            const chapterRes = await fetchChapterCached(book, chapter, bibleSession.state.translation);
            const hit = chapterRes.verses.find((v) => v.verse === verseNumber);
            if (!hit) { toast.error(`Verse ${verseNumber} not found in ${book} ${chapter}`); return; }
            const label = `${book} ${chapter}:${verseNumber} (${chapterRes.translation})`;
            const card = { id: `${label}-${Date.now()}`, label, verses: [{ verse: hit.verse, text: hit.text }] };
            const existing = bibleSession.state.cards;
            const dupIdx = existing.findIndex((c) => c.label === card.label);
            const newIdx = dupIdx >= 0 ? dupIdx : existing.length;
            if (dupIdx < 0) bibleSession.setCards([...existing, card]);
            bibleSession.setSelectedIdx(newIdx);
            ctx.onSendSlideToLive({ kind: "text", text: hit.text, reference: label }, undefined, { preserveConfiguredTransition: true }); // voice: fast AI fade, never theme-slowed (PR 2)
            toast.info(`Voice: "${cmd.matchedText}" → verse ${verseNumber}`);
          } catch {
            toast.error("Verse lookup failed");
          }
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.audio.transcript]);

  // ── Jump-to-verse from the Bible Detections panel / AI chips ─────────────
  // Clicking a detection row or chip previously called ctx.onBankAddReference
  // — a completely different, invisible piece of state (OperatorConsole's
  // legacy "bank") than bibleSession, which is what actually drives the
  // visible Bible panel/cards here. The click showed a "Loaded" toast while
  // nothing on screen changed. This listens for the internal event those
  // callers now dispatch instead, and does the real thing: fetch the verse,
  // append/select it as a card (same shape applyAdvancedVerse uses), switch
  // to the Bible center panel so the operator actually sees it land, and —
  // for the double-click/"send live" variant — push it live too.
  useEffect(() => {
    const handler = (ev: Event) => {
      const payload = internalPayload<{ book: string; chapter: number; verseStart: number; verseEnd: number; live: boolean }>(ev);
      if (!payload) return;
      const { book, chapter, verseStart, verseEnd, live } = payload;
      void (async () => {
        try {
          // 2026-08-16 (user directive): if the operator has a WHOLE CHAPTER
          // loaded (Load Chapter) and the requested verse is inside it, just
          // SELECT that verse — do NOT collapse the chapter down to one verse.
          // Keeps the full chapter in the centre; the preview moves to the verse.
          const loaded = bibleSession.state.cards;
          if (loaded.length > 1) {
            const prefix = `${book} ${chapter}:`;
            const idxInChapter = loaded.findIndex(
              (c) => (c.label ?? "").startsWith(prefix) && c.verses?.[0]?.verse === verseStart,
            );
            if (idxInChapter >= 0) {
              bibleSession.setSelectedIdx(idxInChapter);
              setCenterMode("bible");
              if (live) {
                const card = loaded[idxInChapter];
                const body = card.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
                ctx.onSendSlideToLive({ kind: "text", text: body, reference: card.label }, undefined, { instant: true });
              }
              return;
            }
          }
          const res = await cachedLookup({ book, chapter, verseStart, verseEnd, translationCode: bibleSession.state.translation });
          if (!res.verses || res.verses.length === 0) return;
          // Each reference owns its own Bible slides section: jumping to a new
          // reference REPLACES the grid rather than stacking on top of a
          // previous reference's cards. Chip history persists in the AI chip
          // strip / Bible Detections panel (separate state), so operators can
          // still swap between references by clicking. Ranges fan out to N
          // one-verse cards, matching runLookup() in BibleMode.tsx.
          const refText = `${book} ${chapter}:${verseStart}${verseStart !== verseEnd ? `-${verseEnd}` : ""}`;
          const cards = res.verses.map((v, i) => ({
            id: `goto-${refText}-${v.verse}-${Date.now()}-${i}`,
            label: `${book} ${chapter}:${v.verse} (${res.translation})`,
            verses: [{ verse: v.verse, text: v.text }],
          }));
          bibleSession.setRef(refText);
          bibleSession.setCards(cards);
          bibleSession.setSelectedIdx(0);
          setCenterMode("bible");
          if (live) {
            const first = cards[0];
            const body = first.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
            ctx.onSendSlideToLive({ kind: "text", text: body, reference: first.label }, undefined, { instant: true });
          }
        } catch {
          toast.error("Verse lookup failed");
        }
      })();
    };
    window.addEventListener("presentflow:bible-goto", handler);
    return () => window.removeEventListener("presentflow:bible-goto", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bibleSession, ctx]);

  // ── Cmd+K search → open a song in the Songs library ───────────────────────
  // Always-mounted here so the synchronous event fired while switching INTO songs
  // mode is never missed (the conditionally-mounted SongsBrowser can't catch it).
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<SongSelection>).detail;
      if (!d || !d.id) return;
      setOpenSong({
        id: d.id, title: d.title, artist: d.artist ?? null,
        ...(typeof d.slideOrder === "number" ? { slideOrder: d.slideOrder } : {}),
      });
      setCenterMode("songs");
    };
    window.addEventListener(SONG_OPEN_EVENT, handler);
    return () => window.removeEventListener(SONG_OPEN_EVENT, handler);
  }, []);

  // ── Song chip → switch center to slides so operator sees it land ──────────
  // AIDetectionsPanel dispatches this after a song-chip click goes live.
  // Without this the projector updates but the operator's center panel stays
  // wherever it was (songs browser, bible, media…) and nothing looks like it
  // changed. Mirrors the setCenterMode("bible") call in the bible-goto handler.
  //
  // AUTO-mode guard: the mode-switch live follow effect (below) re-sends
  // items[previewItemIdx].slides[0] whenever centerMode changes to "slides"
  // while AUTO is on. At the time this event fires, onAddLibraryItem's async
  // setPreview hasn't completed yet, so previewItemIdx still points to the OLD
  // item — that would overwrite the song that just went live. Skip the mode
  // switch in AUTO mode; the "→ LIVE" toast is sufficient confirmation there.
  useEffect(() => {
    const handler = (ev: Event) => {
      // isInternalEvent() checks a module-local JS Symbol nonce attached by
      // dispatchInternal(). Symbols are non-serializable and non-enumerable —
      // a frame dispatching a synthetic CustomEvent cannot forge the nonce even
      // with same-origin access. ev.isTrusted is intentionally NOT checked
      // because dispatchInternal() uses window.dispatchEvent(), which always
      // produces isTrusted=false by spec for programmatic events.
      if (!isInternalEvent(ev)) return;
      let autoOn = false;
      try { autoOn = window.sessionStorage.getItem(AUTO_APPROVE_KEY_INSTANT) === "1"; } catch { /* noop */ }
      // Skip in AUTO mode: setCenterMode("slides") would trigger the mode-switch
      // live follow effect (~line 2293) which re-sends items[previewItemIdx].slides[0]
      // — but previewItemIdx hasn't updated yet (onAddLibraryItem is async),
      // overwriting the song that just went live with the previous item's slide.
      if (autoOn) return;
      setCenterMode("slides");
    };
    window.addEventListener("presentflow:show-slides", handler);
    return () => window.removeEventListener("presentflow:show-slides", handler);
  }, []);

  // ── Mode-switch live follow: REMOVED 2026-08-16 ──────────────────────────
  // This effect used to auto-send the first slide of the target mode to LIVE
  // when the operator switched centerMode in AUTO — which meant simply clicking
  // "Bible" in the top bar instantly projected a verse, and clicking a playlist
  // item (which switches to "slides") projected it. Both are the "don't go live
  // just because I navigated" bugs the operator reported. Switching modes /
  // navigating is now PREVIEW-ONLY across the board. To go live: click the slide
  // in the centre panel, right-click a playlist item → Send to live, click an AI
  // chip, or let the AI auto-fire path project it. (Nothing else references the
  // old prevCenterModeRef.)

  // ── Bible-mode verse-nav bridge ──────────────────────────────────────────
  // BottomBar dispatches presentflow:bible-next / bible-prev events. If the
  // current cards list has another slot, move the cursor. If we're at the
  // edge (or only one card is loaded — the common case), advance the ref
  // itself and fetch: John 3:16 → John 3:17 → …
  useEffect(() => {
    // 2026-08-20 field-test fix: this listener used to be gated on
    // `centerMode === "bible"`, so during a live service — when the centre panel
    // is on slides / AI-chips (the default), NOT the Bible lookup panel — a
    // VOICE "next verse" / "continue" / "go back" command dispatched
    // presentflow:bible-next/prev into the void and nothing projected. ("go to
    // verse 5" still worked because absolute jumps take a different,
    // unconditional path.) The handler resolves the target verse from
    // `bibleSession`, not from what panel is visible, so it is now mounted
    // UNCONDITIONALLY. Detection-side gating (hasVerseContext, ≥70 floor) still
    // decides whether an event is dispatched at all.
    // Applies a resolved next verse (book/chapter/verse/text) to session
    // state + live output. Shared by the cache-hit (sync) and cache-miss
    // (network) paths below so the append/dedupe/send-live behavior is
    // identical regardless of data source.
    const applyAdvancedVerse = (
      dir: 1 | -1,
      book: string,
      chapter: number,
      verse: number,
      text: string,
      translationCode: string,
      live = false,
    ) => {
      const newRef = `${book} ${chapter}:${verse}`;
      bibleSession.setRef(newRef);
      const label = `${newRef} (${translationCode})`;
      const card = {
        id: `${newRef}-${Date.now()}`,
        label,
        verses: [{ verse, text }],
      };
      // ProPresenter-style: APPEND (or prepend on reverse) rather than
      // replace, so operator can keep pressing Verse > to build up a
      // series of cards for the whole passage they're preaching through.
      const existing = bibleSession.state.cards;
      const dupIdx = existing.findIndex((c) => c.label === card.label);
      if (dupIdx >= 0) {
        bibleSession.setSelectedIdx(dupIdx);
      } else {
        const next = dir > 0 ? [...existing, card] : [card, ...existing];
        bibleSession.setCards(next);
        bibleSession.setSelectedIdx(dir > 0 ? next.length - 1 : 0);
      }
      // 2026-08-16 (user directive): the MANUAL Verse ◀ / ▶ buttons are
      // PREVIEW-ONLY (live === false) — they advance the verse in the centre
      // Bible panel but DO NOT push to the projector; the operator clicks the
      // slide to go live once it's the right verse.
      // 2026-08-18 (user directive): VOICE-driven "next verse"/"go back"
      // commands pass live === true so they project immediately (instant hard
      // cut — no transition flicker on rapid advance). This restores the fast
      // voice auto-advance that the 2026-08-16 change had inadvertently
      // disabled by routing voice through the same preview-only event.
      // 2026-09-01 fix (operator report: "when nothing is live, if the preacher
      // says 'go back' it shouldn't project anything unless something is
      // currently live"): only PROJECT when a SCRIPTURE verse is already on the
      // projector (i.e. we're advancing within a displayed passage). If the
      // screen is blank/idle or showing non-scripture, advance the PREVIEW only —
      // never resurrect a verse onto a blank screen from a stale selected card.
      const liveNow = currentLiveSlideRef.current;
      const liveRefText = liveNow?.kind === "text"
        ? `${liveNow.text}${liveNow.reference ? `\n\n${liveNow.reference}` : ""}`
        : null;
      const scriptureIsLive = liveRefText != null && parseLiveScriptureRef(liveRefText) != null;
      if (live && scriptureIsLive) {
        try {
          const fromLive = parseLiveScriptureRef(liveRefText);
          sendLiveRef.current({ kind: "text", text, reference: label }, undefined, { instant: true });
          voiceNavProjectedRef.current = true;
          // Verse-bounce fix: remember the hop so a late re-detection of the
          // origin verse can't swap the projector back (navOriginSuppressed).
          if (fromLive) {
            // Chain-aware (16→17→18 holds a late 16 and 17); window extends per hop.
            navOriginRef.current = extendNavOrigin(
              navOriginRef.current,
              { book: fromLive.book, chapter: fromLive.chapter, verseStart: fromLive.verseStart, verseEnd: fromLive.verseEnd },
              { book, chapter, verseStart: verse, verseEnd: verse },
              Date.now(),
            );
          }
        } catch (e) {
          console.error("[verse-nav] live send failed:", e);
        }
      } else if (live) {
        voiceNavPreviewOnlyRef.current = { dir, ts: Date.now() };
      }
    };

    // Background prefetch of the adjacent chapter once the operator is
    // within a few verses of the edge of the currently cached chapter —
    // makes the boundary-crossing click (verse 1 of the next chapter) a
    // cache hit in practice instead of a network round trip.
    const maybePrefetchAdjacentChapter = (
      book: string, chapter: number, verse: number, verseNumbers: number[], translationCode: string,
    ) => {
      if (verseNumbers.length === 0) return;
      const maxVerse = Math.max(...verseNumbers);
      const minVerse = Math.min(...verseNumbers);
      if (maxVerse - verse <= 3) prefetchChapter(book, chapter + 1, translationCode);
      if (verse - minVerse <= 3) prefetchChapter(book, chapter - 1, translationCode);
    };

    // Shared by both the cached-hit-miss path and the cold-cache-miss path
    // below — advancing past either edge of a chapter (nextVerse < 1 going
    // backward, or nextVerse > max going forward) needs the identical
    // "fetch the neighboring chapter, land on its first/last verse" logic
    // regardless of which path discovered the boundary.
    const crossChapterBoundary = async (dir: 1 | -1, book: string, chapter: number, translationCode: string, live = false) => {
      const targetChapter = dir > 0 ? chapter + 1 : chapter - 1;
      if (targetChapter < 1) {
        toast.info("Start of book — use Prev Item for previous passage");
        return;
      }
      try {
        const chapterRes = await fetchChapterCached(book, targetChapter, translationCode);
        if (chapterRes.verses.length === 0) {
          toast.info(dir > 0 ? "End of book — no next chapter" : "Start of book — no previous chapter");
          return;
        }
        const targetVerse = dir > 0 ? 1 : Math.max(...chapterRes.verses.map((v) => v.verse));
        const found = chapterRes.verses.find((v) => v.verse === targetVerse);
        if (!found) return;
        applyAdvancedVerse(dir, book, targetChapter, targetVerse, found.text, chapterRes.translation, live);
        maybePrefetchAdjacentChapter(book, targetChapter, targetVerse, chapterRes.verses.map((v) => v.verse), translationCode);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Verse lookup failed — press Next again.");
        console.error("[verse-nav] chapter fetch failed:", err);
      }
    };

    const advanceRef = async (dir: 1 | -1, live = false) => {
      const parser = await import("@/lib/bible-parser");
      // Base the advance on the CURRENTLY SELECTED card's label so pressing
      // Verse > walks: John 3:16 → 3:17 → 3:18 (not stuck on the input ref).
      // With no selected card, anchor on the verse ACTUALLY on the projector
      // (2026-08-21 parity fix — matches repeat_verse/goto_bible_verse) rather
      // than bibleSession.state.ref, which can be stale from an earlier lookup;
      // ref lives as a dedicated field OR the last "\n\n" line of text.
      const cards = bibleSession.state.cards;
      const curIdx = bibleSession.state.selectedIdx ?? (cards.length - 1);
      // #7: read the FRESH live slide — this listener is keyed on [bibleSession],
      // so a captured ctx.liveSlide can be stale.
      const liveSlideNow = currentLiveSlideRef.current;
      const liveRefRaw = liveSlideNow?.kind === "text"
        ? (liveSlideNow.reference ?? liveSlideNow.text.split("\n\n").pop() ?? "")
        : "";
      const liveAnchor = liveRefRaw.trim().replace(/\s*\([^)]+\)\s*$/, ""); // strip "(KJV)"
      // 2026-09-14: a VOICE (live) advance anchors on the verse ACTUALLY on the
      // projector first -- the selected preview card can lag/lead the live verse.
      const liveAnchorParses = live && !!liveAnchor && !!parser.parseReference(liveAnchor);
      if (live && !liveAnchorParses) {
        // Nothing (parseable) live: a retried voice final must not double-step
        // the preview the interim already advanced.
        const po = voiceNavPreviewOnlyRef.current;
        if (po && po.dir === dir && Date.now() - po.ts < 1500) return;
      }
      const anchorRef = liveAnchorParses
        ? liveAnchor
        : cards[curIdx]?.label
          ? cards[curIdx].label.replace(/\s*\([^)]+\)\s*$/, "") // strip "(KJV)"
          : (liveAnchor || bibleSession.state.ref);
      try { console.log("[verse-nav] advanceRef", { dir, anchorRef, cardCount: cards.length, curIdx }); } catch { /* ignore */ }
      const parsed = parser.parseReference(anchorRef);
      if (!parsed) {
        // 2026-07-25 field fix — previous silent return read as "button
        // does nothing". Surface why so the operator knows to type a
        // reference first (or reload the app if the anchor got corrupted).
        toast.info("Type a Bible reference (e.g. John 3:16) and press Lookup first — nothing loaded to advance.");
        return;
      }
      // If ref is a whole chapter (verseEnd == null), advancing by "verse"
      // would silently narrow the display from all-verses to a single verse.
      // Refuse and hint the operator that whole-chapter mode uses passage nav.
      if (parsed.verseEnd == null) {
        toast.info("Whole-chapter passage — use Prev/Next Item for chapter navigation");
        return;
      }
      // Y2: nextVerse can legitimately be 0 here (Prev at verse 1) — that
      // must fall through to the chapter-boundary-crossing logic below
      // (dir<0 → chapter-1, last verse), not dead-end immediately. An
      // earlier version returned right here for any nextVerse < 1, which
      // meant "Prev verse" at v1 could never cross backward into the
      // previous chapter even though forward crossing worked correctly.
      const nextVerse = parsed.verseStart + dir;
      const translationCode = bibleSession.state.translation;
      const book = parsed.book;
      const chapter = parsed.chapter;

      // ── Pure local path: the current chapter is already cached. ──────────
      const key = chapterKey(translationCode, book, chapter);
      const cached = getCachedChapter(key);
      if (cached) {
        const hit = cached.verses.find((v) => v.verse === nextVerse);
        if (hit) {
          applyAdvancedVerse(dir, book, chapter, nextVerse, hit.text, cached.translation, live);
          maybePrefetchAdjacentChapter(book, chapter, nextVerse, cached.verses.map((v) => v.verse), translationCode);
          return;
        }
        // nextVerse isn't in this chapter (either < 1 going backward, or
        // > this chapter's max going forward) — advancing crosses a
        // chapter boundary.
        await crossChapterBoundary(dir, book, chapter, translationCode, live);
        return;
      }

      // ── Cache miss: this chapter hasn't been fetched yet. Fetch the whole
      // chapter (via cachedLookup under the hood) so this AND all subsequent
      // Next/Prev clicks within it become local. One automatic retry on a
      // transient abort/timeout before giving up. ─────────────────────────
      const attempt = async () => fetchChapterCached(book, chapter, translationCode);
      let chapterRes: Awaited<ReturnType<typeof attempt>> | null = null;
      try {
        chapterRes = await attempt();
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") {
          try {
            chapterRes = await attempt(); // one real retry, not just a relabeled failure
          } catch (retryErr) {
            toast.error("Verse lookup failed — press Next again.");
            console.error("[verse-nav] retry failed:", retryErr);
            return;
          }
        } else {
          toast.error(err instanceof Error ? err.message : "Verse lookup failed");
          console.error("[verse-nav] lookup failed:", err);
          return;
        }
      }
      if (!chapterRes || chapterRes.verses.length === 0) {
        await crossChapterBoundary(dir, book, chapter, translationCode, live);
        return;
      }
      const hit = chapterRes.verses.find((v) => v.verse === nextVerse);
      if (!hit) {
        // Same boundary case as the cached-hit-miss path above, just
        // reached via the cold-cache-fetch branch instead.
        await crossChapterBoundary(dir, book, chapter, translationCode, live);
        return;
      }
      applyAdvancedVerse(dir, book, chapter, nextVerse, hit.text, chapterRes.translation, live);
      maybePrefetchAdjacentChapter(book, chapter, nextVerse, chapterRes.verses.map((v) => v.verse), translationCode);
    };
    const send = (dir: 1 | -1, live = false) => {
      // Always advance the reference and append a new card — this is the
      // ProPresenter model. Every press of Verse > appends the next verse
      // as its own card in the grid. dedupe handles double-clicks by
      // selecting the existing card instead of duplicating.
      // Ignore repeat presses while a prior advance is still in flight —
      // otherwise two overlapping calls can both read the pre-update
      // bibleSession state and race on which one's setCards/setSelectedIdx
      // wins, skipping or duplicating a verse.
      // `live` is false for the manual buttons (preview-only) and true for
      // voice commands (project immediately) — see applyAdvancedVerse.
      if (advanceInFlightRef.current) {
        // 2026-09-14: a voice command dropped behind a NON-voice advance must not
        // leave an echo record behind, or the final is suppressed and the
        // command silently does nothing. (Behind a voice advance it IS the echo.)
        if (live && !advanceInFlightLiveRef.current) voiceNavEchoRef.current = null;
        return;
      }
      advanceInFlightRef.current = true;
      advanceInFlightLiveRef.current = live;
      voiceNavProjectedRef.current = false;
      void advanceRef(dir, live).finally(() => {
        advanceInFlightRef.current = false;
        advanceInFlightLiveRef.current = false;
        // Record-on-project: the echo guard only suppresses the final when the
        // voice advance actually projected (or moved the preview with nothing
        // live). Otherwise clear it so the final retries.
        const po = voiceNavPreviewOnlyRef.current;
        const previewMoved = !!po && po.dir === dir && Date.now() - po.ts < 1500;
        if (live && !voiceNavProjectedRef.current && !previewMoved) voiceNavEchoRef.current = null;
      });
    };
    // Y1: nonce-gated. Ignore any external dispatchEvent from page scripts.
    // Voice commands attach { live: true } in the payload; manual buttons don't.
    const nx = (ev: Event) => { if (!isInternalEvent(ev)) return; send(1, internalPayload<{ live?: boolean }>(ev)?.live === true); };
    const pv = (ev: Event) => { if (!isInternalEvent(ev)) return; send(-1, internalPayload<{ live?: boolean }>(ev)?.live === true); };
    window.addEventListener("presentflow:bible-next", nx);
    window.addEventListener("presentflow:bible-prev", pv);
    return () => {
      window.removeEventListener("presentflow:bible-next", nx);
      window.removeEventListener("presentflow:bible-prev", pv);
    };
  }, [bibleSession]);

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

  // JPD Fix 6 — hydrate the spoken-translation-switch detector with the
  // translations that actually exist in the DB (public-domain only; the
  // /api/bible/translations route already filters licensed slots). Detector
  // falls back to the seeded public-domain list until this resolves.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bible/translations").then((r) => r.json());
        const codes = Array.isArray(res?.translations)
          ? (res.translations as Array<{ code?: string }>).map((t) => String(t.code || "")).filter(Boolean)
          : [];
        if (!cancelled && codes.length > 0) setAvailableTranslationCodes(codes);
      } catch { /* keep seeded fallback */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Tracks the last translation code fully APPLIED to the live output (session +
  // live re-render), so the picker-sync effect (below applyTranslationSwitch)
  // doesn't redundantly re-apply a code that a voice switch already handled.
  const lastAppliedTranslationRef = useRef((bibleSession.state.translation ?? "").toUpperCase());

  // JPD Fix 6 — apply a spoken translation switch: update the shared Bible
  // session (Bible panel dropdown + all subsequent detections/lookups read
  // bibleSession.state.translation), notify OperatorConsole's
  // defaultTranslationCode listener (same event the built-in "give_me_niv"
  // voice command uses), and — if a scripture verse is currently live —
  // re-fetch it in the new translation and re-send it to the live output.
  const applyTranslationSwitch = useCallback(async (code: string, spokenPhrase: string) => {
    // 2026-07-30 "not available" fallback (Change 1 to-100):
    //   The recogniser now catches every mention of NIV/ESV/NLT/NASB/CSB/MSG
    //   etc. The seeded DB only carries public-domain codes (KJV, WEB, ASV,
    //   DRC, YLT, DARBY, GEN1599). When the preacher requests a licensed
    //   code that isn't loaded, WARN the operator and do NOT mutate the
    //   session translation — silently switching to something the user
    //   didn't ask for would be worse than the current-translation output.
    const upper = code.toUpperCase();
    const available = getAvailableTranslationCodes().map((c) => c.toUpperCase());
    if (!available.includes(upper)) {
      const current = bibleSession.state.translation;
      toast.warning(`${upper} not available — showing ${current} instead`, {
        id: "translation-switch",
        description: `Heard "${spokenPhrase}". Ask an admin to enable ${upper} — see docs/BIBLE_TRANSLATIONS.md for the ESV.org path.`,
      });
      return;
    }
    // Remember the outgoing translation so "switch back" can revert to it.
    const outgoing = bibleSession.state.translation;
    if (outgoing && outgoing.toUpperCase() !== upper) prevTranslationRef.current = outgoing.toUpperCase();
    bibleSession.setTranslation(upper);
    // Mark that THIS code has been fully applied (session + live re-render below),
    // so the picker-sync effect doesn't redundantly re-apply it.
    lastAppliedTranslationRef.current = upper;
    try {
      window.dispatchEvent(new CustomEvent("presentflow:switch-translation", { detail: { code: upper } }));
    } catch { /* noop */ }
    // Re-fetch the Bible panel cards in the new translation so the center
    // preview updates. 2026-08-18 latency fix: this is now DEFERRED until AFTER
    // the live-verse re-render below. A full-chapter card set fires 50+
    // concurrent cachedLookup calls here; running them first starved the single
    // live-verse lookup that reaches the projector of a connection, so NKJV→NIV
    // took seconds to appear on screen. Projecting the live verse first, then
    // rebuilding the preview cards, makes the on-screen swap prompt.
    const existingCards = bibleSession.state.cards;
    const rebuildPanelCards = () => {
      if (existingCards.length === 0 || existingCards[0]?.placeholder) return;
      const cardLabelRe = /^(.+?)\s+(\d+):(\d+)(?:-(\d+))?\s+\([A-Za-z0-9]+\)$/;
      void (async () => {
        try {
          const newCards = await Promise.all(
            existingCards.map(async (card) => {
              const m = cardLabelRe.exec((card.label ?? "").trim());
              if (!m) return card;
              const [, book, chStr, vsStr, veStr] = m;
              const chapter = Number(chStr);
              const verseStart = Number(vsStr);
              const verseEnd = veStr ? Number(veStr) : verseStart;
              const res = await cachedLookup({ book, chapter, verseStart, verseEnd, translationCode: upper, source: "ai" });
              if (!res.verses.length) return card;
              const newLabel = `${book} ${chapter}:${verseStart}${verseEnd !== verseStart ? `-${verseEnd}` : ""} (${res.translation})`;
              return {
                ...card,
                id: `ai-${newLabel}`,
                label: newLabel,
                verses: res.verses.map((v) => ({ verse: v.verse, text: v.text })),
              };
            }),
          );
          bibleSession.setCards(newCards);
        } catch { /* non-fatal — preview re-fetch is best-effort */ }
      })();
    };
    // Live scripture re-render. Bible slides go live as
    // `${text}\n\n${Book C:V[-V] (CODE)}` — parse the label off the live
    // slide; anything that doesn't match that shape (songs, plain slides)
    // is left alone. The toast is HONEST: we only claim the live slide
    // changed when sendLive actually fired (or it was already in the target
    // translation); otherwise we say the next verse will use the new code.
    let liveUpdated = false;
    const live = ctx.liveSlide;
    if (live?.kind === "text" && typeof live.text === "string") {
      // Reference lives under TWO conventions in this console: a dedicated
      // `.reference` field (cardToSlide / auto-fire / voice paths) OR embedded as
      // the last "\n\n"-separated line of `.text`. Reading only the embedded form
      // (the old bug's mirror) silently no-ops for verses projected via the
      // dedicated-field paths, so a voice translation-switch wouldn't re-render
      // the live verse. Accept either.
      const label = (live.reference ?? live.text.split("\n\n").pop() ?? "").trim();
      // 2026-08-29 FIX (voice translation-switch not re-projecting): the old regex
      // REQUIRED a trailing "(CODE)" suffix, but when the operator's "display
      // translation" toggle is OFF the projected reference is code-less ("John
      // 3:16"), so it returned null → the live verse never re-rendered on the
      // projector (only the dropdown path, which uses this lenient shape, worked).
      // Parse leniently; decide "already in target" from the OUTGOING session
      // translation (the code isn't necessarily on the label).
      // 2026-08-29 PROJECTOR RE-PUSH FIX (field JPD: switch changed the preview +
      // LIVE box but NOT the real 2nd-screen projector). Two bugs, both here:
      // (1) "already in target" was decided from `outgoing` — the SESSION's
      //     translation. When the switch is driven by the picker-sync effect
      //     (dropdown, or any setTranslation-first path) the session is ALREADY
      //     the target by the time this runs, so `outgoing === upper` was true
      //     and the live verse was never re-projected. Decide from the LIVE
      //     SLIDE's OWN code instead (JPD shows it: "John 3:17 (NLT)"); when the
      //     reference is code-less, fall through and re-project (can't prove it's
      //     already correct — the sender's force-post below is idempotent).
      // (2) the re-push used a fade WITHOUT force, so the sender's already-live
      //     skip could silently drop it. Match the known-good dropdown path
      //     (reprojectLiveInTranslation): send with { instant, force }.
      const m = /^(.+?)\s+(\d+):(\d+)(?:-(\d+))?(?:\s*\(([A-Za-z0-9]+)\))?/.exec(label.slice(0, 200));
      if (m) {
        const [, book, chapterStr, startStr, endStr, liveCode] = m;
        if (liveCode && liveCode.toUpperCase() === upper) {
          liveUpdated = true; // live slide is ALREADY in the target translation — output is correct
        } else {
          const chapter = Number(chapterStr);
          const verseStart = Number(startStr);
          const verseEnd = endStr ? Number(endStr) : verseStart;
          try {
            const res = await cachedLookup({ book, chapter, verseStart, verseEnd, translationCode: upper, source: "ai" });
            if (res.verses.length > 0) {
              // Honor the operator's Bible display prefs so the re-render
              // matches how BibleMode's cardToSlide would format the slide
              // (verse numbers + one-verse-per-line). BibleMode owns these
              // opts via BibleOptionsProvider, but persists them to the
              // shared localStorage key — read that directly here since the
              // formatter itself lives inside BibleMode (WIP, off-limits).
              let showVerseNumbers = true;
              let breakOnNewVerse = false;
              try {
                const raw = window.localStorage.getItem("presentflow.pro.bible.v1");
                if (raw) {
                  const o = JSON.parse(raw) as { showVerseNumbers?: boolean; breakOnNewVerse?: boolean };
                  if (typeof o.showVerseNumbers === "boolean") showVerseNumbers = o.showVerseNumbers;
                  if (typeof o.breakOnNewVerse === "boolean") breakOnNewVerse = o.breakOnNewVerse;
                }
              } catch { /* keep defaults (match BibleOptionsPopover DEFAULT) */ }
              const newLabel = `${book} ${chapter}:${verseStart}${verseEnd !== verseStart ? `-${verseEnd}` : ""} (${res.translation})`;
              const newText = res.verses
                .map((v) => showVerseNumbers ? `${v.verse} ${v.text}` : v.text)
                .join(breakOnNewVerse ? "\n" : " ");
              // Same-window diagnostics / future extension (transcript UI or
              // badge fade hooks).
              try {
                window.dispatchEvent(new CustomEvent("presentflow:live-translation-swap", {
                  detail: { code: upper, book, chapter, verseStart, verseEnd },
                }));
              } catch { /* noop */ }
              // Send exactly like the known-good dropdown path
              // (reprojectLiveInTranslation): { instant, force }. `force` bypasses
              // the sender's already-live identity skip so a same-reference,
              // new-translation re-render always reaches the projector; `instant`
              // is a hard cut (no forced fade) — the same reliable path a fresh
              // verse fire uses to reach the 2nd screen.
              sendLiveRef.current({ kind: "text", text: newText, reference: newLabel }, undefined, { instant: true, force: true });
              liveUpdated = true;
            }
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not re-render live verse in new translation");
          }
        }
      }
    }
    // Live verse is now projecting in the new translation — rebuild the preview
    // cards in the background so they no longer compete for the connection.
    rebuildPanelCards();
    toast.success(
      liveUpdated
        ? `Switched to ${upper} — "${spokenPhrase}"`
        : `Switched to ${upper} — next verse will use it`,
      { id: "translation-switch" },
    );
  }, [bibleSession, ctx.liveSlide]);
  const applyTranslationSwitchRef = useRef(applyTranslationSwitch);
  useEffect(() => { applyTranslationSwitchRef.current = applyTranslationSwitch; }, [applyTranslationSwitch]);

  // 2026-08-16 — LIVE VERSE FOLLOWS THE VERSION, ALWAYS. Previously only the
  // VOICE switch path re-rendered the live scripture; if the session translation
  // changed another way (the operator picks it from the Bible-mode dropdown, or a
  // voice switch fired but its re-render was missed), the projected verse stayed
  // on the OLD version even though the picker showed the new one — exactly the
  // "it never changed on screen" report (1 Cor 7:4 stuck on NIV while the picker
  // read NKJV). This effect watches the shared session translation and, whenever
  // it changes to a code that hasn't been applied to the live output yet,
  // re-projects the current verse in that version. Guarded by
  // lastAppliedTranslationRef so the voice path (which already re-rendered) never
  // double-fires, and applyTranslationSwitch no-ops when the live verse is
  // already in the target code — so there is no loop.
  useEffect(() => {
    const target = (bibleSession.state.translation ?? "").toUpperCase();
    if (!target || lastAppliedTranslationRef.current === target) return;
    lastAppliedTranslationRef.current = target;
    void applyTranslationSwitchRef.current(target, "translation picker");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bibleSession.state.translation]);

  // "Switch back" — revert to the translation active before the last switch.
  // Reuses applyTranslationSwitch so the current live verse + preview re-render.
  const prevTranslationRef = useRef<string | null>(null);
  const revertTranslation = useCallback((spokenPhrase: string) => {
    const prev = prevTranslationRef.current;
    if (!prev) { toast.info(`Heard "${spokenPhrase}" — no previous translation to switch back to.`, { id: "translation-switch" }); return; }
    void applyTranslationSwitchRef.current(prev, spokenPhrase);
  }, []);
  const revertTranslationRef = useRef(revertTranslation);
  useEffect(() => { revertTranslationRef.current = revertTranslation; }, [revertTranslation]);

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
      // JPD Fix 6 — parameterized translation switch from the spoken
      // detector (`switch_translation:NLT`). AUTO (auto-approve armed):
      // switch immediately. CO-PILOT/manual: tap-to-confirm suggestion via
      // a toast action — direct operator tap is trusted, mirroring chips.
      if (action.startsWith("switch_translation:")) {
        const code = action.slice("switch_translation:".length).toUpperCase();
        if (!/^[A-Z0-9]{2,10}$/.test(code)) return;
        if (ctx.autoApproveOn) {
          void applyTranslationSwitchRef.current(code, phrase ?? code);
        } else {
          toast.info(`Switch to ${code}? — heard "${phrase ?? code}"`, {
            id: "translation-switch",
            duration: 12000,
            action: {
              label: `Switch to ${code}`,
              onClick: () => { void applyTranslationSwitchRef.current(code, phrase ?? code); },
            },
          });
        }
        return; // handled — skip generic "Voice command" toast below
      }
      // Revert to the previous translation ("switch back", "go back to the
      // previous version"). AUTO fires immediately; manual offers a tap-confirm.
      if (action === "revert_translation") {
        const prev = prevTranslationRef.current;
        if (!prev) { toast.info(`Heard "${phrase}" — no previous translation to switch back to.`, { id: "translation-switch" }); return; }
        if (ctx.autoApproveOn) {
          void revertTranslationRef.current(phrase ?? "switch back");
        } else {
          toast.info(`Switch back to ${prev}? — heard "${phrase ?? "switch back"}"`, {
            id: "translation-switch",
            duration: 12000,
            action: { label: `Back to ${prev}`, onClick: () => { void revertTranslationRef.current(phrase ?? "switch back"); } },
          });
        }
        return;
      }
      switch (action) {
        case "next_verse":
          if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("presentflow:hotkey-next"));
          break;
        case "prev_verse":
          if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("presentflow:hotkey-prev"));
          break;
        case "give_me_niv":
          // Route through applyTranslationSwitch (same as switch_translation:NIV)
          // so the live-slide re-render fires. The old dispatchEvent path skipped
          // the re-render — security review 🟡 2026-07-31.
          void applyTranslationSwitchRef.current("NIV", "give me NIV");
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
  // Settings window deep-link (2026-09-16): open the in-app Songs / Media browser
  // in the centre panel instead of sending the desktop user to the web app.
  useEffect(() => {
    const onMode = (e: Event) => {
      const m = (e as CustomEvent<{ mode?: CenterMode }>).detail?.mode;
      if (m === "songs" || m === "media" || m === "slides" || m === "bible") setCenterMode(m);
    };
    window.addEventListener("presentflow:set-center-mode", onMode);
    return () => window.removeEventListener("presentflow:set-center-mode", onMode);
  }, []);

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

  // Read-only slice of the live audio state for the Sarah setup overlay. Memoized so
  // the overlay isn't handed a fresh object on every ASR frame; the overlay itself
  // renders nothing while closed.
  const sarahLive = useMemo(() => ({
    listening: !!ctx.audio?.listening,
    ready: !!ctx.audio?.ready,
    transcript: (ctx.audio?.transcript ?? []).slice(-2).map((t) => t.text).join(" ").trim() || undefined,
    interim: ctx.audio?.interim,
    // Scripture detections only, with a human reference. The engine's suggestions carry
    // ref:{book,chapter,verseStart,verseEnd} — there is no ready-made "reference" string.
    suggestions: (ctx.audio?.suggestions ?? [])
      .filter((x) => x.type === "scripture" && !x.isPhraseMatch)
      .map((x) => {
        const sc = x as { ref: { book: string; chapter: number; verseStart: number; verseEnd: number }; confidence: number; fromInterim?: boolean; voiceCommand?: boolean };
        const r = sc.ref;
        return {
          id: x.id, ref: r, confidence: sc.confidence, fromInterim: !!sc.fromInterim, voiceCommand: !!sc.voiceCommand,
          reference: `${r.book} ${r.chapter}:${r.verseStart}${r.verseEnd !== r.verseStart ? `-${r.verseEnd}` : ""}`,
        };
      }),
    liveHasContent: !!ctx.liveSlide && (ctx.liveSlide as { kind?: string }).kind !== "empty",
    onListen: ctx.onListenToggle,
    noAudioSignal: ctx.audio?.noAudioSignal,
    clipping: ctx.audio?.clipping,
    reconnectAttempts: ctx.audio?.reconnectAttempts,
    reconnectFailed: !!ctx.audio?.reconnectFailed,
  }), [ctx.audio?.listening, ctx.audio?.ready, ctx.audio?.transcript, ctx.audio?.interim, ctx.audio?.suggestions, ctx.onListenToggle,
       ctx.audio?.noAudioSignal, ctx.audio?.clipping, ctx.audio?.reconnectAttempts, ctx.audio?.reconnectFailed, ctx.liveSlide]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--color-app-bg)] text-[var(--color-foreground)]">
      <AnnouncementBar />
      {staleUpdate && (
        <div role="status" className="flex items-center gap-3 px-4 py-2 text-[12.5px] font-medium bg-[var(--color-brand)]/15 border-b border-[var(--color-brand)]/40 text-[var(--color-foreground)]">
          <span className="flex-1">PresentFlow updated — reload to continue. Nothing on the projector will change until you do.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 px-3 py-1 rounded-md bg-[var(--color-brand)] text-white font-semibold hover:opacity-90 active:scale-95 transition"
          >
            Reload
          </button>
        </div>
      )}
      <UpdateBanner liveSlide={ctx.liveSlide} listening={ctx.audio?.listening} />
      <AICaptionsBanner ctx={ctx} />
      <div data-tour="top" className="relative">
        <TopBar
          centerMode={centerMode}
          onCenterMode={setCenterMode}
          onToggleMediaStrip={() => setMediaStripOpen((v) => !v)}
          mediaStripOpen={mediaStripOpen}
          ctx={ctx}
          guardianAlert={guardianAlert}
        />
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* LEFT — resizable (Change 4, 2026-07-27). Fixed pixel width via
            inline style; drag handle at the right edge updates state on
            mousemove. Playlist + Bible-plan items (via BiblePlansSection
            inside PlaylistSection) get more room when operators widen it. */}
        <aside
          data-tour="left"
          className="relative shrink-0 border-r border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col overflow-y-auto"
          style={{ width: leftPanelWidth }}
        >
          <LibrarySection onCenterMode={setCenterMode} />
          <PlaylistSection ctx={ctx} onCenterMode={setCenterMode} />
          {/* Media Bin relocated (field fix 6A): it now docks the CENTER column's
              bottom strip (below the slide grid + stage), not the left rail. See
              the <main> block below. The TopBar media toggle still drives it via
              mediaStripOpen. */}
          {OPENFLOW_ENABLED ? (
            <OpenFlowSidebar
              active={centerMode === "openflow"}
              onOpen={() => setCenterMode(centerMode === "openflow" ? "slides" : "openflow")}
            />
          ) : null}
          <MediaSection onCenterMode={setCenterMode} centerMode={centerMode} />
          <HardwareSection />
          {/* Drag handle — 4px hit target on the right edge. Visible on hover
              via the brand tint. Absolutely positioned so it doesn't take
              layout space (aside width is authoritative). */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize left panel"
            onMouseDown={startLeftResize}
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-[var(--color-brand)]/60 active:bg-[var(--color-brand)] transition-colors z-10"
          />
        </aside>

        {/* CENTER */}
        {/* The panel stays plain black; the team/theme + Background Template now
            render INSIDE each slide card (ThemedSlideCard) so every slide box is
            WYSIWYG with the projector, rather than flooding the whole workspace. */}
        <main data-tour="center" className="relative flex-1 min-w-0 flex flex-col bg-black">
          <div className="relative z-[1] flex flex-col min-h-0 flex-1">
          {/* OpenFlow takes the whole center area (its own full-panel UI), so the
              slide/song CenterHeader is hidden while it's active. */}
          {centerMode !== "openflow" ? (
            <CenterHeader ctx={ctx} centerMode={centerMode} slideSize={slideSize} onSlideSize={setSlideSize} />
          ) : null}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* Error boundary per center-mode panel so a Bible/Songs/Media
                crash doesn't nuke the whole operator UI mid-service — the
                operator can hit "Reload panel" and keep going. */}
            <OperatorErrorBoundary fallbackLabel={`The ${centerMode} panel hit an error`}>
              {centerMode === "openflow" && OPENFLOW_ENABLED ? (
                <OpenFlowPanel ctx={ctx} />
              ) : centerMode === "bible" ? (
                <BibleMode ctx={ctx} session={bibleSession} />
              ) : centerMode === "songs" ? (
                <SongsBrowser ctx={ctx} onExitToSlides={() => setCenterMode("slides")} openSong={openSong} onSongOpened={clearOpenSong} />
              ) : centerMode === "media" ? (
                <MediaBrowser ctx={ctx} onExitToSlides={() => setCenterMode("slides")} />
              ) : centerMode === "transitions" ? (
                <TransitionsPanel />
              ) : (
                <>
                  {/* Groups & Arrangements strip (wave 6D) — renders only for a
                      previewed song that uses groups; no-op otherwise. */}
                  <ArrangementStrip ctx={ctx} />
                  <SlideGrid ctx={ctx} slideSize={slideSize} onOpenEditor={() => setSlideEditorOpen(true)} />
                </>
              )}
            </OperatorErrorBoundary>
          </div>
          {/* Media Bin — CENTER bottom strip (field fix 6A). Sits below the slide
              grid + stage as a non-scrolling dock, pushing the stage strip up.
              Collapsible (slim header when closed) + pop-out (taller when open).
              Hidden while OpenFlow owns the whole center. */}
          {centerMode !== "openflow" && (
            <MediaBinSection
              open={mediaStripOpen}
              onToggle={() => setMediaStripOpen((v) => !v)}
              onCenterMode={setCenterMode}
              poppedOut={mediaBinPoppedOut}
              onTogglePopout={() => setMediaBinPoppedOut((v) => !v)}
              ctx={ctx}
              height={mediaBinHeight}
              onResize={handleMediaBinResize}
            />
          )}
          </div>
        </main>

        {/* RIGHT */}
        {/* 2026-07-25 field bug fix — sidebar was 300px which forced the
            LivePreviewPanel below to a cramped 300×220 box that clipped
            long verses mid-word. Bumped to 360px so the preview reads
            comfortably at the sanctuary-readability floor without shrinking
            text or paginating away words. Center panel gives up 60px of
            width but the operator's primary attention is the live preview. */}
        <aside data-tour="right" className="w-[360px] shrink-0 border-l border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col overflow-y-auto pf-transcript-scroll">
          {/* Task F polish pass: TopBar right cluster is now the single source of truth
              for output routing indicators. OutputRoutingRow retired from the sidebar to
              reduce duplication. Kept in-tree behind a localStorage flag for A/B: set
              `presentflow.pro.showRoutingRow=1` to re-enable. */}
          {typeof window !== "undefined" && window.localStorage.getItem("presentflow.pro.showRoutingRow") === "1" && (
            <OutputRoutingRow ctx={ctx} />
          )}
          <OperatorErrorBoundary fallbackLabel="Live preview panel error">
            {pp7Layers ? (
              <LivePreviewPanel
                ctx={ctx}
                onVideoRef={(el) => { previewVideoRef.current = el; }}
                hideClearButton
                rail={<Pp7ClearRail ctx={ctx} messagesActive={pp7MessagesActive} onClearMessages={pp7ClearMessages} />}
              />
            ) : (
              <LivePreviewPanel ctx={ctx} onVideoRef={(el) => { previewVideoRef.current = el; }} />
            )}
          </OperatorErrorBoundary>
          {ctx.liveSlide?.kind === "video" && <VideoControlBar videoRef={previewVideoRef} />}
          {/* SCENES (2026-09-16) — always-visible one-tap Scene Rail (spec §22.2),
              placed directly under the preview so the operator sees the routing
              and its effect together (spec §21.7 component order). Gated on the
              env kill-switch AND the per-church opt-in: zero DOM when off, so the
              sidebar layout (and the locked h-[280px] preview) is untouched. */}
          {ctx.scenesUiOn && (
            <OperatorErrorBoundary fallbackLabel="Scene rail error">
              <SceneRail ctx={ctx} />
            </OperatorErrorBoundary>
          )}
          {/* Change 3 (revised 2026-07-30) — transcript render block.
              TranscriptDisplay wraps the RICH renderer (yellow
              auto-correction spans + hover, orange trigger-phrase
              highlights, mm:ss timestamps + hover, Clear button,
              30s window, interim/final distinction) inside the fixed
              height + drag-resize + minimizable chrome introduced in
              Change 3. Minimizing does NOT stop capture. */}
          <OperatorErrorBoundary fallbackLabel="Live transcript panel error">
            <TranscriptDisplay ctx={ctx} />
          </OperatorErrorBoundary>
          {/* 2026-07-25 Phase 3: RightIconBar replaces both
              AIDetectionsPanel (Bible/Songs/XRefs sections stacked
              vertically, took up ~half the sidebar even when empty) AND
              RightTabs (Audio/Stage/Timers/Messages/Themes/Macros
              6-tab bar buried below the fold). Single horizontal
              toolbar with lucide-react icons + popovers on click.
              Old components still exist in the tree (unused after
              this change) for easy rollback if this regresses; will
              be deleted in a follow-up ship. */}
          <OperatorErrorBoundary fallbackLabel="Right icon bar error">
            <RightIconBar ctx={ctx} timer={timer} messages={messages} timers={timers} messagesBoard={messagesBoard} />
          </OperatorErrorBoundary>
          {/* Placeholder keeps the sidebar flex column filling the
              available height so the icon bar sits at the bottom of the
              sidebar rather than floating mid-column. */}
          <div className="flex-1 min-h-0" />
        </aside>

        {/* Decoupling Phase 3b — CLEAR-CUES RAIL. A slim, ALWAYS-visible strip of
            per-layer clear cues at the far right edge (ProPresenter parity):
            each cue lights in the layer accent when that layer is live, click
            clears that layer, the bottom X (guarded hold) clears all. It reuses
            the same useLiveLayers rows/actions as the LayersPanel popover — no
            duplicated state. Gated on ctx.layersEngineOn (env kill-switch AND
            church opt-in): OFF ⇒ VerticalClearRail returns null AND this branch
            reserves no column ⇒ zero DOM, byte-identical legacy layout. Sits as
            its own flex column to the right of the sidebar, so it never overlaps
            or shifts the sidebar's inline popovers. */}
        {ctx.layersEngineOn && !pp7Layers && (
          <OperatorErrorBoundary fallbackLabel="Clear-cues rail error">
            <VerticalClearRail ctx={ctx} />
          </OperatorErrorBoundary>
        )}
      </div>

      {/* Scenes builder — mounted once; opens on the Scene Rail's Edit button.
          Renders null when Scenes is off for this church. */}
      <SceneBuilderHost ctx={ctx} />
      <SongAutopilotStaging ctx={ctx} />
      <AITranscriptTicker ctx={ctx} />
      <DesktopSlideEditorModal ctx={ctx} open={slideEditorOpen} targetSong={slideEditorTargetSong} targetTheme={slideEditorTargetTheme} onThemeDirtyChange={onThemeEditorDirty} openBlank={slideEditorBlank} openAdd={slideEditorAdd} onClose={() => { setSlideEditorOpen(false); setSlideEditorTargetSong(null); setSlideEditorTargetTheme(null); setSlideEditorBlank(false); setSlideEditorAdd(false); themeEditorDirtyRef.current = false; }} />
      {editorSwitchDialog}
      {mediaEdit ? (
        <MediaImageEditor
          asset={mediaEdit}
          ctx={ctx}
          onClose={() => setMediaEdit(null)}
          // "Remove flat background" saves a NEW transparent asset. There's no safe
          // in-place updater for the originating playlist/media-group slide here
          // (it would rewrite plan data mid-service), so the original slide is left
          // untouched and the operator is told where the new picture lives.
          onAssetReplaced={(a) => {
            setMediaEdit(a);
            toast("Background removed — saved as a new picture in your Media library", { position: "top-center" });
          }}
        />
      ) : null}

      <div data-tour="bottom">
        <BottomBar
          ctx={ctx}
          onOpenShortcutsHelp={() => setShortcutsHelpOpen(true)}
          centerMode={centerMode}
          videoRef={previewVideoRef}
        />
      </div>

      {/* Bottom "Media Library / Recent" strip removed (user directive
          2026-08-20) — the operator surface now ends at the transport bar. */}

      <ShortcutsHelpOverlay open={shortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen} />
      <AudioDebugOverlay audio={ctx.audio} />
      <OperatorTour open={tourOpen} onClose={() => setTourOpen(false)} />
      <WhatsNewModal />
      <SettingsWindow ctx={ctx} />
      <SarahOverlay live={sarahLive} />
    </div>
  );
}
