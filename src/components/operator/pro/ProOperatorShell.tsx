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
import { HardwareSection } from "./left/HardwarePanel";
import { CenterHeader } from "./center/CenterHeader";
import { SlideGrid } from "./center/SlideGrid";
import { BibleMode } from "./center/BibleMode";
import { SongsBrowser } from "./center/SongsBrowser";
import { MediaBrowser } from "./center/MediaBrowser";
import { LivePreviewPanel } from "./right/LivePreviewPanel";
import { OutputRoutingRow } from "./right/OutputRoutingRow";
// 2026-07-25 Phase 3: RightTabs + AIDetectionsPanel replaced by
// RightIconBar. AIDetectionsPanel still imported transitively (via
// RightIconBar's popovers). Old RightTabs.tsx kept in tree, unused.
import { RightIconBar } from "./right/RightIconBar";
import { TranscriptDisplay } from "./TranscriptDisplay";
import { BottomBar } from "./BottomBar";
import { MediaStrip } from "./MediaStrip";
import { useTimerSession, useMessagesSession, useBibleSession } from "./hooks";
import { openLiveChannel, safePost } from "@/lib/broadcast";
import { cachedLookup } from "@/lib/bible-client-cache";
import { setAvailableTranslationCodes, getAvailableTranslationCodes } from "@/lib/translation-commands";
import { BIBLE_MICRO_COOLDOWN_MS, decideBibleAutoFire } from "@/lib/bible-antireplay";
import { fetchChapterCached, getCachedChapter, chapterKey, prefetchChapter } from "@/lib/bible-chapter-cache";
import { cn } from "@/lib/utils";
import { useOperatorHotkeys } from "@/hooks/useOperatorHotkeys";
import { ShortcutsHelpOverlay } from "./ShortcutsHelpOverlay";
import { AICaptionsBanner } from "./AICaptionsBanner";
import { UpdateBanner } from "./UpdateBanner";
import { AudioDebugOverlay } from "../dev/AudioDebugOverlay";
import { CONFIDENCE_THRESHOLD } from "@/lib/audio-thresholds";
import { OperatorTour, hasSeenTour } from "@/components/tutorial/OperatorTour";
import { WhatsNewModal } from "../WhatsNewModal";
import { dispatchInternal, isInternalEvent, internalPayload } from "@/lib/internal-events";
import { matchNextSlide, isLikelyEndOfSong, scoreCoverage, slideWords } from "@/lib/ai-detection/lyric-position";
import { parseContextCommand } from "@/lib/context-parser";
// Audio Guardian (2026-07-27) — native-capture self-healing watchdog.
// The shell only CONSUMES its state events (toasts + red chip); the state
// machine itself lives in src/lib/audio/audioGuardian.ts, fed by
// useAudioStream's native branch.
import { GUARDIAN_STATE_EVENT, type GuardianStatus } from "@/lib/audio/audioGuardian";

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

// Policy constants live in operatorConstants.ts so they are searchable
// without reading this entire file. All sign-off history is documented there.
import {
  MEDIA_STRIP_KEY,
  SLIDE_SIZE_KEY,
  SAFE_MODE_KEY,
  LEFT_PANEL_WIDTH_KEY,
  LEFT_PANEL_MIN_WIDTH,
  LEFT_PANEL_DEFAULT_WIDTH,
  SONG_AUTOSTAGE_CONFIRM_KEY,
  SONG_STAGE_CONFIDENCE,
  SONG_AUTOLIVE_CONFIDENCE,
  SONG_AUTO_FIRED_SESSION_KEY,
  SONG_AUTO_LIVE_MIN_GAP_MS,
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
} from "./operatorConstants";

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
        ctx.onSendSlideToLive({ kind: "text", text: firstLyric });
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
            const isPhrase = !!s.isPhraseMatch;
            const tip = isPhrase
              ? "Phrase match — quoted text, not a spoken reference. Tap to load."
              : `${ref} (${s.confidence}%) — click to load, Shift+click to send live`;
            return (
              <div
                key={s.id}
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
                className="relative flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--color-brand)] bg-[var(--color-elevated)] text-[11px] cursor-pointer hover:bg-[var(--color-elevated-hover,var(--color-elevated))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
              >
                <span className="font-semibold">{ref}</span>
                <span className="text-[9px] font-mono opacity-60">{s.confidence}%</span>
                {isPhrase ? (
                  // ✦ phrase-match badge — visually distinct from the "AI"
                  // hard-reference badge so operators can tell a fuzzy quote
                  // match from a spoken reference at a glance.
                  <span
                    className="ml-1 text-[8px] font-bold px-1 py-[1px] rounded bg-violet-500/80 text-white"
                    aria-label="Phrase match"
                    data-testid="phrase-match-badge"
                  >
                    ✦
                  </span>
                ) : (
                  <span
                    className="ml-1 text-[8px] font-bold px-1 py-[1px] rounded bg-[var(--color-success,#10b981)] text-white"
                    aria-label="AI detected"
                  >
                    AI
                  </span>
                )}
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
            return (
              <button
                key={s.id}
                type="button"
                data-in-playlist={inPlaylist ? "true" : "false"}
                title={tip}
                aria-label={ariaLabel}
                onClick={() => handleSongChipClick(songId, title, inPlaylist)}
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
            );
          })}
        </div>
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
  const [, forceRender] = useState(0); // liveSongRef mutations need a render nudge for the indicator

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

  // Keep sendLiveStableRef current every render so the setInterval-based
  // Part 7c (silence ticker) never holds a stale closure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { sendLiveStableRef.current = ctx.onSendSlideToLive; });

  const autoApprove = !!ctx.autoApproveOn;

  // ---- Part 6: auto-stage on ≥85% confidence, AUTO on ---------------------
  const stageSong = useCallback(async (songId: string, title: string, confidence: number, source: "detection" | "progression") => {
    if (stagingInFlightRef.current.has(songId)) return;
    if (liveSongRef.current?.songId === songId) return; // already live, nothing to stage
    stagingInFlightRef.current.add(songId);
    try {
      const slides = await fetchSongLyricSlides(songId);
      if (slides.length === 0) return;
      setStagedSong({ songId, title, slides, currentIdx: 0, confidence, source });
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
      const text = slides[0];
      lastSongAutoLiveAtRef.current = now;
      ctx.onSendSlideToLive({ kind: "text", text });
      liveSongRef.current = { songId, title, slides, currentIdx: 0, confirmedAt: now };
      lastAdvanceTsRef.current = now;
      matchStreakRef.current = 0;
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
        }
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
  }, [ctx, stageSong]);

  useEffect(() => {
    // 2026-07-26 policy change (user sign-off): song auto-fire is NO
    // LONGER gated by the AUTO/MANUAL toggle. Rule 7's confidence-tier
    // policy (≥70% auto-live, 60-69% stage+G, <60% chip only) applies
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
    if (stagedSong) {
      const risen = candidates.find((c) => c.songId === stagedSong.songId && c.confidence >= SONG_AUTOLIVE_CONFIDENCE);
      // Synchronous dedupe BEFORE the async autoLiveSong call, using a
      // DIFFERENT ref than autoLiveSong's own stagingInFlightRef (which it
      // doesn't set until after its cooldown/replay checks) — `stagedSong`
      // React state won't reflect setStagedSong(null) until the next render,
      // so a second transcript update landing in the same tick could
      // otherwise still see `stagedSong` non-null and re-enter this branch
      // before autoLiveSong's own guards kick in.
      if (risen && !promotionInFlightRef.current.has(risen.songId)) {
        promotionInFlightRef.current.add(risen.songId);
        setStagedSong(null);
        void autoLiveSong(risen.songId, risen.title, risen.confidence).finally(() => {
          promotionInFlightRef.current.delete(risen.songId);
        });
        return;
      }
    }

    const now = Date.now();
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
      if (c.confidence >= SONG_AUTOLIVE_CONFIDENCE) {
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
  }, [ctx.audio.suggestions, ctx.audio.songSuggestions, stagedSong, stageSong, autoLiveSong]);

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
      ctx.onSendSlideToLive({ kind: "text", text });
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

  // If the live output changes to content that doesn't match what
  // liveSongRef thinks is live (operator manually navigated to a different
  // song/verse/slide by some path other than confirmStagedSongLive or this
  // component's own auto-advance), stop tracking it — otherwise a stale ref
  // could resume auto-advancing a song that's no longer actually on screen
  // if the operator returns to it within the cooldown window.
  useEffect(() => {
    const live = liveSongRef.current;
    if (!live) return;
    const expected = live.slides[live.currentIdx];
    const liveText = ctx.liveSlide?.kind === "text" ? ctx.liveSlide.text : null;
    if (liveText !== expected) {
      liveSongRef.current = null;
    }
  }, [ctx.liveSlide]);

  // Any OTHER manual operator action (click anywhere, or any keydown that
  // isn't our confirm key) cancels Part 7 auto-advance tracking and starts a
  // cooldown so the AI never fights the operator.
  useEffect(() => {
    const cancelTracking = () => {
      cooldownUntilRef.current = Date.now() + 4000;
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
    if (!live) return;
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
      const text = live.slides[nextIdx];
      ctx.onSendSlideToLive({ kind: "text", text });
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
      const text = live.slides[nextIdx];
      ctx.onSendSlideToLive({ kind: "text", text });
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
      // Silence after ≥ 65% of slide spoken → done, advance
      const text = live.slides[nextIdx];
      sendLiveStableRef.current({ kind: "text", text });
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
      const text = live.slides[live.currentIdx - 1];
      ctx.onSendSlideToLive({ kind: "text", text });
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

  if (!stagedSong && !autoAdvanceFlash) return null;

  return (
    <div className="shrink-0 px-3 py-2 flex flex-col gap-2" data-testid="song-autostage-banner">
      {stagedSong && (
        <div
          className="border-2 border-orange-500 bg-orange-500/10 rounded-lg px-3 py-2 flex flex-col gap-1.5 shadow-lg"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-orange-300 px-1.5 py-0.5 rounded bg-orange-500/20">
              AI staged — not live
            </span>
            <span className="text-[13px] font-semibold truncate">{stagedSong.title}</span>
            <span className="text-[10px] font-mono text-orange-300">{Math.round(stagedSong.confidence)}%</span>
            {stagedSong.source === "progression" && (
              <span className="text-[9px] font-mono text-[var(--color-muted-foreground)]">next in plan</span>
            )}
            <button
              type="button"
              aria-label="Dismiss staged song"
              onClick={dismissStaged}
              className="ml-auto text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-1"
            >
              ×
            </button>
          </div>
          <div className="max-h-[120px] overflow-y-auto rounded bg-[var(--color-elevated)] border border-[var(--color-border)] px-2 py-1 text-[12px] leading-snug whitespace-pre-wrap">
            {stagedSong.slides.map((s, i) => (
              <div
                key={i}
                role="button"
                tabIndex={0}
                onClick={() => setStagedSong({ ...stagedSong, currentIdx: i })}
                className={cn(
                  "px-1 py-0.5 rounded cursor-pointer",
                  i === stagedSong.currentIdx ? "bg-orange-500/20 font-semibold" : "opacity-70 hover:opacity-100",
                )}
              >
                {s}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[11px] font-bold text-orange-200">
            {/* 2026-07-25 field bug fix — explicit clickable "Go LIVE" button.
                Some operators didn't realize G was a keyboard hotkey, or the
                key was blocked by focus/overlay. This button is the same
                action, always accessible via mouse. */}
            <button
              type="button"
              onClick={confirmStagedSongLive}
              className="px-3 py-1.5 rounded bg-orange-500 hover:bg-orange-600 text-white text-[12px] font-bold shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
              data-testid="staged-song-go-live-btn"
            >
              GO LIVE →
            </button>
            <span>
              Slide {stagedSong.currentIdx + 1} of {stagedSong.slides.length} · or press <kbd className="px-1.5 py-0.5 rounded bg-orange-500 text-white font-mono">G</kbd>
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

export function ProOperatorShell({ ctx }: { ctx: OperatorShellCtx }) {
  const [centerMode, setCenterMode] = useState<CenterMode>("slides");
  const [mediaStripOpen, setMediaStripOpen] = useState(true);
  const [slideSize, setSlideSize] = useState(160);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
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
          const max = Math.floor(window.innerWidth * 0.5);
          const clamped = Math.min(max, Math.max(LEFT_PANEL_MIN_WIDTH, parsed));
          setLeftPanelWidth(clamped);
          leftPanelWidthRef.current = clamped;
        }
      }
    } catch { /* noop */ }
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
      const maxW = Math.floor(window.innerWidth * 0.5);
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
        guidance = "PresentFlow IS receiving multi-channel audio but every channel is silent. Most likely: your mixer isn't routing anything to USB Sends. Open the mixer's USB Send menu (Home → Setup → I/O → USB on Allen & Heath SQ) and route your vocal mic to USB. Or pick a specific channel via the channel grid in Settings › Audio.";
      } else {
        guidance = "PresentFlow is receiving a single-channel stream and it's silent. Check: (1) mixer channel isn't muted, (2) USB cable is seated, (3) you've picked the correct input in Settings › Audio. If this is a multi-channel mixer, install the vendor USB driver (e.g. Allen & Heath SQ driver from allen-heath.com).";
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
  // Symmetry with the timer heartbeat below: while showing, re-post the full
  // message overlay at 1Hz so (a) a /live reload mid-service recovers the
  // message within a second, and (b) the renderer-side 5s stale sweep can
  // take a `dismiss: manual` message down if this operator page crashes.
  // Renderers only (re)arm their client-side dismiss countdown when message
  // CONTENT changes (text + dismissAfterMs), so heartbeats never restart it.
  const messagesStateRef = useRef(messages.state);
  useEffect(() => { messagesStateRef.current = messages.state; }, [messages.state]);
  const messagePostedRef = useRef(false);
  useEffect(() => {
    const ch = overlayChRef.current;
    if (!ch) return;
    if (!(messages.state.showing && messages.state.text.trim().length > 0)) {
      if (messagePostedRef.current) {
        // Only broadcast clear:true after at least one show — otherwise every
        // slide navigation on a fresh operator would spam `{clear:true}`.
        safePost(ch, { type: "message", overlay: { clear: true } });
        messagePostedRef.current = false;
      }
      return;
    }
    const post = () => {
      const s = messagesStateRef.current;
      // Simple {{time}}/{{date}}/{{currentSlide}} token expansion at post time.
      const now = new Date();
      const text = s.text
        .replace(/\{\{time\}\}/g, now.toLocaleTimeString())
        .replace(/\{\{date\}\}/g, now.toLocaleDateString())
        .replace(/\{\{currentSlide\}\}/g, String((previewSlideIdxRef.current ?? 0) + 1));
      const DISMISS_MS: Record<string, number | null> = {
        "5s": 5000, "10s": 10000, "30s": 30000, "1min": 60000, "5min": 300000, manual: null,
      };
      safePost(ch, {
        type: "message",
        overlay: {
          text,
          dismissAfterMs: DISMISS_MS[s.dismiss] ?? null,
          position: s.position,
          allowWeb: s.allowWeb,
        },
      });
      messagePostedRef.current = true;
    };
    post();
    const id = setInterval(post, 1000);
    return () => clearInterval(id);
  }, [messages.state.showing, messages.state.text, messages.state.dismiss, messages.state.position, messages.state.allowWeb]);

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
    const refText = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}${scripture.ref.verseStart !== scripture.ref.verseEnd ? `-${scripture.ref.verseEnd}` : ""}`;
    // Populate cards for auto-fire + AI-chip display only.
    // DO NOT call setSelectedIdx here — that would hijack the center Bible
    // panel to show the detected verse even in MANUAL mode, which the operator
    // sees as a glitch ("verses appearing in preview when not mentioned").
    // selectedIdx is only set AFTER the operator or auto-fire explicitly sends
    // a verse to live (see the auto-approve effect below at line 2174/2197).
    const label = `${refText} (${bibleSession.state.translation})`;
    bibleSession.setRef(refText);
    bibleSession.setCards([{
      id: `ai-placeholder-${key}`,
      label,
      verses: [{ verse: scripture.ref.verseStart, text: "Loading…" }],
      placeholder: true, // R8: never auto-fire the loading card
    }]);
    // NOTE: intentionally NOT calling setSelectedIdx(0) here.
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
        // NOTE: intentionally NOT calling setSelectedIdx(0) here — see above.
      } catch (e) {
        bibleSession.setCards([{
          id: `ai-error-${key}`,
          label,
          verses: [{ verse: scripture.ref.verseStart, text: e instanceof Error ? e.message : "(lookup failed)" }],
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
      // AI auto-fire uses an instant one-shot transition while preserving the
      // operator's configured transition for subsequent manual sends.
      const res = sendLiveRef.current(slide, null, { preserveConfiguredTransition: true }) as unknown;
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

  // Keep-current effects for Bible Part 2c ticker refs (stale-closure prevention).
  // These run after every render, keeping the setInterval callback fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { safeSendLiveRef.current = safeSendLive; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { bibleSetSelectedIdxRef.current = bibleSession.setSelectedIdx; });
  useEffect(() => { bibleCardsRef.current = bibleSession.state.cards; }, [bibleSession.state.cards]);
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

    const cards = bibleSession.state.cards;
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
    // fromInterim suggestions are pre-load-only: the Bible panel shows the card
    // but auto-fire must not project until the confirmed "final" transcript
    // arrives, which corrects partial verse numbers ("John 3:1" interim→"John
    // 3:16" final). forceLive/voiceCommand also always come from finals.
    const scripture = suggestions.find((s) => s.type === "scripture" && !s.isPhraseMatch && !s.fromInterim && (s.confidence >= 85 || s.forceLive) && !lowConfBlockedSpans.has(s.id));
    if (!scripture || scripture.type !== "scripture") return;
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
    const currentLiveText = liveKind === "text" ? ctx.liveSlide.text : "";
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
    const decision = decideBibleAutoFire({
      key,
      firedMap: bibleFiredMapRef.current,
      now: nowTs,
      liveText: currentLiveText,
      target: scripture.ref,
      forceLive: !!scripture.forceLive,
      voiceCommand: !!scripture.voiceCommand,
      cooldownMs: BIBLE_MICRO_COOLDOWN_MS,
    });
    if (decision.suppress) {
      if (pfTraceOn()) console.log(`[auto-approve] suppressed same-ref within ${BIBLE_MICRO_COOLDOWN_MS}ms:`, key);
      return;
    }
    // Write to the ref SYNCHRONOUSLY, BEFORE any downstream call. Even if
    // doAutoFire queues (min-gap not yet met) or the sessionStorage.setItem
    // in doAutoFire is delayed by a tick, subsequent effect invocations
    // reading the merged map above will see this entry and correctly suppress.
    bibleFiredMapRef.current[key] = nowTs;

    const body = first.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
    const slide: import("@/lib/broadcast").SlidePayload = { kind: "text", text: `${body}\n\n${first.label}` };
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
    doAutoFire(slide, key, ref, scripture.confidence, !!(scripture.forceLive || scripture.voiceCommand));
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
          // 2026-07-25 security fix (review 🔴): sessionStorage ONLY.
          if (window.sessionStorage.getItem(AUTO_APPROVE_KEY_INSTANT) !== "1") {
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
    const currentText = `${currentBody}\n\n${current.label}`;
    if (!(ctx.liveSlide?.kind === "text" && ctx.liveSlide.text === currentText)) return;

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
      safeSendLive({ kind: "text", text: `${nextBody}\n\n${nextCard.label}` });
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
      bibleCooldownUntilRef.current = Date.now() + 4000;
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
    const currentText = `${currentBody}\n\n${current.label}`;
    if (!(ctx.liveSlide?.kind === "text" && ctx.liveSlide.text === currentText)) return;
    const combined = [...bibleRecentWordsRef.current, ...words].slice(-24);
    const nextBody = nextCard.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
    const result = matchNextSlide(combined, nextBody, 4); // stricter than final=3
    if (result.consecutiveMatches >= 4) {
      bibleInterimMatchStreakRef.current += 1;
    } else {
      bibleInterimMatchStreakRef.current = 0;
    }
    if (bibleInterimMatchStreakRef.current >= 2) {
      safeSendLive({ kind: "text", text: `${nextBody}\n\n${nextCard.label}` });
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
      const currentText = `${currentBody}\n\n${current.label}`;
      if (!(bibleLiveSlideRef.current?.kind === "text" && bibleLiveSlideRef.current.text === currentText)) return;
      const silenceMs = Date.now() - bibleLastWordTsRef.current;
      if (silenceMs < BIBLE_SILENCE_ADVANCE_MS) return; // not silent enough
      const cov = scoreCoverage(bibleRecentWordsRef.current, currentBody);
      if (cov < BIBLE_COVERAGE_THRESHOLD) return; // verse not sufficiently covered
      // Verse covered + silence = preacher finished reading → advance
      const nextBody = nextCard.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
      safeSendLiveRef.current({ kind: "text", text: `${nextBody}\n\n${nextCard.label}` });
      bibleSetSelectedIdxRef.current(nextIdx);
      bibleLastAdvanceTsRef.current = Date.now();
      bibleMatchStreakRef.current = 0;
      bibleInterimMatchStreakRef.current = 0;
      bibleRecentWordsRef.current = []; // reset so we don't chain-advance immediately
      console.log(`[bible-autoprogression] silence+coverage advance to ${nextCard.label} (cov=${Math.round(cov * 100)}%, silence=${Math.round(silenceMs)}ms)`, { ts: Date.now() });
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
  // patterns. Dispatches through the SAME `presentflow:bible-next/prev`
  // internal events the manual Verse ▸/◂ buttons use (`send(dir)` above),
  // so a voice command behaves identically to a button click — including
  // always going live, which has been this app's existing behavior for
  // manual Bible verse-nav all along (not a new zero-click exception).
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
    const hasVerseContext = cards.length > 0 && idx != null && !!cards[idx] && !cards[idx].placeholder;
    if (!hasVerseContext) return;
    const cmd = parseContextCommand(last.text, { hasVerseContext, hasSlideContext: false, hasSongContext: false });
    if (!cmd) return;
    // parseContextCommand's own `confidence` field isn't gated anywhere
    // upstream — it returns the first pattern match regardless of score.
    // Enforce a floor here so a low-confidence pattern can't silently act
    // as if it were a confirmed command.
    if (cmd.confidence < 70) return;
    // Share the word-timing effect's cooldown/floor so a voice command and
    // a sustained lyric/verse word-match can't both advance the same verse
    // in the same transcript update.
    if (Date.now() < bibleCooldownUntilRef.current) return;
    if (Date.now() - bibleLastAdvanceTsRef.current < BIBLE_SLIDE_FLOOR_MS) return;
    if (cmd.verb === "next_verse" || cmd.verb === "continue") {
      dispatchInternal("presentflow:bible-next");
      bibleLastAdvanceTsRef.current = Date.now();
      bibleMatchStreakRef.current = 0;
      toast.info(`Voice: "${cmd.matchedText}" → next verse`);
    } else if (cmd.verb === "prev_verse" || cmd.verb === "back") {
      dispatchInternal("presentflow:bible-prev");
      bibleLastAdvanceTsRef.current = Date.now();
      bibleMatchStreakRef.current = 0;
      toast.info(`Voice: "${cmd.matchedText}" → previous verse`);
    } else if (cmd.verb === "repeat_verse") {
      const c = cards[idx!];
      const body = c.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
      ctx.onSendSlideToLive({ kind: "text", text: `${body}\n\n${c.label}` });
      bibleLastAdvanceTsRef.current = Date.now();
      toast.info(`Voice: "${cmd.matchedText}" → repeated`);
    } else if (cmd.verb === "goto_bible_verse") {
      // Absolute jump to a verse NUMBER within the current chapter — "from
      // verse 11", "from 13" — distinct from next/prev's relative +/-1 step.
      const verseNumber = (cmd.payload as { verseNumber?: number } | undefined)?.verseNumber;
      const current = cards[idx!];
      const m = /^(.+?)\s+(\d+):\d+/.exec(current.label);
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
            ctx.onSendSlideToLive({ kind: "text", text: `${hit.text}\n\n${label}` });
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
            ctx.onSendSlideToLive({ kind: "text", text: `${body}\n\n${first.label}` });
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

  // ── Mode-switch live follow ──────────────────────────────────────────────
  // When operator switches centerMode AND auto-approve is ON, auto-send the
  // first available slide of the target mode's content. Empty target → no-op.
  const prevCenterModeRef = useRef(centerMode);
  useEffect(() => {
    if (prevCenterModeRef.current === centerMode) return;
    prevCenterModeRef.current = centerMode;
    let autoOn = false;
    // 2026-07-25 security fix (review 🔴): sessionStorage ONLY (was localStorage).
    try { autoOn = window.sessionStorage.getItem(AUTO_APPROVE_KEY_INSTANT) === "1"; } catch { /* noop */ }
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
    ) => {
      const newRef = `${book} ${chapter}:${verse}`;
      bibleSession.setRef(newRef);
      const card = {
        id: `${newRef}-${Date.now()}`,
        label: `${newRef} (${translationCode})`,
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
      sendLiveRef.current({ kind: "text", text: `${text}\n\n${card.label}` });
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
    const crossChapterBoundary = async (dir: 1 | -1, book: string, chapter: number, translationCode: string) => {
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
        applyAdvancedVerse(dir, book, targetChapter, targetVerse, found.text, chapterRes.translation);
        maybePrefetchAdjacentChapter(book, targetChapter, targetVerse, chapterRes.verses.map((v) => v.verse), translationCode);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Verse lookup failed — press Next again.");
        console.error("[verse-nav] chapter fetch failed:", err);
      }
    };

    const advanceRef = async (dir: 1 | -1) => {
      const parser = await import("@/lib/bible-parser");
      // Base the advance on the CURRENTLY SELECTED card's label so pressing
      // Verse > walks: John 3:16 → 3:17 → 3:18 (not stuck on the input ref).
      // Fall back to the ref field if no cards are loaded yet.
      const cards = bibleSession.state.cards;
      const curIdx = bibleSession.state.selectedIdx ?? (cards.length - 1);
      const anchorRef = cards[curIdx]?.label
        ? cards[curIdx].label.replace(/\s*\([^)]+\)\s*$/, "") // strip "(KJV)"
        : bibleSession.state.ref;
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
          applyAdvancedVerse(dir, book, chapter, nextVerse, hit.text, cached.translation);
          maybePrefetchAdjacentChapter(book, chapter, nextVerse, cached.verses.map((v) => v.verse), translationCode);
          return;
        }
        // nextVerse isn't in this chapter (either < 1 going backward, or
        // > this chapter's max going forward) — advancing crosses a
        // chapter boundary.
        await crossChapterBoundary(dir, book, chapter, translationCode);
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
        await crossChapterBoundary(dir, book, chapter, translationCode);
        return;
      }
      const hit = chapterRes.verses.find((v) => v.verse === nextVerse);
      if (!hit) {
        // Same boundary case as the cached-hit-miss path above, just
        // reached via the cold-cache-fetch branch instead.
        await crossChapterBoundary(dir, book, chapter, translationCode);
        return;
      }
      applyAdvancedVerse(dir, book, chapter, nextVerse, hit.text, chapterRes.translation);
      maybePrefetchAdjacentChapter(book, chapter, nextVerse, chapterRes.verses.map((v) => v.verse), translationCode);
    };
    const send = (dir: 1 | -1) => {
      // Always advance the reference and append a new card — this is the
      // ProPresenter model. Every press of Verse > appends the next verse
      // as its own card in the grid. dedupe handles double-clicks by
      // selecting the existing card instead of duplicating.
      // Ignore repeat presses while a prior advance is still in flight —
      // otherwise two overlapping calls can both read the pre-update
      // bibleSession state and race on which one's setCards/setSelectedIdx
      // wins, skipping or duplicating a verse.
      if (advanceInFlightRef.current) return;
      advanceInFlightRef.current = true;
      void advanceRef(dir).finally(() => { advanceInFlightRef.current = false; });
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
    bibleSession.setTranslation(upper);
    try {
      window.dispatchEvent(new CustomEvent("presentflow:switch-translation", { detail: { code: upper } }));
    } catch { /* noop */ }
    // Re-fetch the Bible panel cards in the new translation so the center
    // preview updates immediately (not just the live projector). Parse each
    // card's label to get the reference, fetch in new code, rebuild cards.
    const existingCards = bibleSession.state.cards;
    if (existingCards.length > 0 && !existingCards[0]?.placeholder) {
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
    }
    // Live scripture re-render. Bible slides go live as
    // `${text}\n\n${Book C:V[-V] (CODE)}` — parse the label off the live
    // slide; anything that doesn't match that shape (songs, plain slides)
    // is left alone. The toast is HONEST: we only claim the live slide
    // changed when sendLive actually fired (or it was already in the target
    // translation); otherwise we say the next verse will use the new code.
    let liveUpdated = false;
    const live = ctx.liveSlide;
    if (live?.kind === "text" && typeof live.text === "string") {
      const parts = live.text.split("\n\n");
      const label = parts[parts.length - 1]?.trim() ?? "";
      const m = /^(.+?)\s+(\d+):(\d+)(?:-(\d+))?\s+\(([A-Za-z0-9]+)\)$/.exec(label);
      if (m) {
        const [, book, chapterStr, startStr, endStr, liveCode] = m;
        if (liveCode.toUpperCase() === upper) {
          liveUpdated = true; // already in target translation — live output is correct
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
              // 2026-07-30 fade-on-swap (Change 1 to-100): force a one-shot
              // ~200ms cross-fade transition for the re-render so the swap
              // is visibly a smooth text change, not a hard cut — regardless
              // of the operator's default transition. Uses the existing
              // TransitionSpec pathway (LiveMessage.transition), same
              // mechanism the operator's fade dropdown uses. TransitionWrapper
              // remounts on identityKey change and plays the specified fade.
              // Also dispatches a CustomEvent for same-window diagnostics /
              // future extension (transcript UI or badge fade hooks).
              try {
                window.dispatchEvent(new CustomEvent("presentflow:live-translation-swap", {
                  detail: { code: upper, book, chapter, verseStart, verseEnd },
                }));
              } catch { /* noop */ }
              const fadeSpec: import("@/lib/broadcast").TransitionSpec = {
                effectId: "cross_fade",
                durationMs: 200,
                easing: "ease-in-out",
              };
              sendLiveRef.current({ kind: "text", text: `${newText}\n\n${newLabel}` }, fadeSpec);
              liveUpdated = true;
            }
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not re-render live verse in new translation");
          }
        }
      }
    }
    toast.success(
      liveUpdated
        ? `Switched to ${upper} — "${spokenPhrase}"`
        : `Switched to ${upper} — next verse will use it`,
      { id: "translation-switch" },
    );
  }, [bibleSession, ctx.liveSlide]);
  const applyTranslationSwitchRef = useRef(applyTranslationSwitch);
  useEffect(() => { applyTranslationSwitchRef.current = applyTranslationSwitch; }, [applyTranslationSwitch]);

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
      <div data-tour="top" className="relative">
        <TopBar
          centerMode={centerMode}
          onCenterMode={setCenterMode}
          onToggleMediaStrip={() => setMediaStripOpen((v) => !v)}
          mediaStripOpen={mediaStripOpen}
          ctx={ctx}
        />
        {/* Audio Guardian "needs human" chip — overlaid on the TopBar's
            right cluster (near the audio/routing indicators) so it can't
            be missed mid-service. Removed the moment the guardian reports
            healthy again. Click → Settings › Audio in the right sidebar. */}
        {guardianAlert && (
          <button
            type="button"
            onClick={() => {
              try {
                window.dispatchEvent(new CustomEvent("presentflow:open-audio-settings"));
              } catch { /* ignore */ }
            }}
            title={guardianAlert.detail}
            aria-label={`Audio needs attention: ${guardianAlert.detail}`}
            className="absolute top-1/2 -translate-y-1/2 right-2 z-40 flex items-center gap-1 h-7 px-2.5 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold tracking-wide shadow-lg animate-pulse"
          >
            ⚠ AUDIO
          </button>
        )}
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
        {/* 2026-07-25 field bug fix — sidebar was 300px which forced the
            LivePreviewPanel below to a cramped 300×220 box that clipped
            long verses mid-word. Bumped to 360px so the preview reads
            comfortably at the sanctuary-readability floor without shrinking
            text or paginating away words. Center panel gives up 60px of
            width but the operator's primary attention is the live preview. */}
        <aside data-tour="right" className="w-[360px] shrink-0 border-l border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col overflow-hidden">
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
            <RightIconBar ctx={ctx} timer={timer} messages={messages} />
          </OperatorErrorBoundary>
          {/* Placeholder keeps the sidebar flex column filling the
              available height so the icon bar sits at the bottom of the
              sidebar rather than floating mid-column. */}
          <div className="flex-1 min-h-0" />
        </aside>
      </div>

      <SongAutopilotStaging ctx={ctx} />
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
      <WhatsNewModal />
    </div>
  );
}
