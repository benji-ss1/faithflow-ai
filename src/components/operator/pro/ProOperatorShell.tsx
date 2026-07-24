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
import { fetchChapterCached, getCachedChapter, chapterKey, prefetchChapter } from "@/lib/bible-chapter-cache";
import { cn } from "@/lib/utils";
import { useOperatorHotkeys } from "@/hooks/useOperatorHotkeys";
import { ShortcutsHelpOverlay } from "./ShortcutsHelpOverlay";
import { AICaptionsBanner } from "./AICaptionsBanner";
import { UpdateBanner } from "./UpdateBanner";
import { AudioDebugOverlay } from "../dev/AudioDebugOverlay";
import { useDebouncedInterim } from "./useDebouncedInterim";
import { CONFIDENCE_THRESHOLD } from "@/lib/audio-thresholds";
import { OperatorTour, hasSeenTour } from "@/components/tutorial/OperatorTour";
import { WhatsNewModal } from "../WhatsNewModal";
import { dispatchInternal, isInternalEvent, internalPayload } from "@/lib/internal-events";
import { matchNextSlide, isLikelyEndOfSong } from "@/lib/ai-detection/lyric-position";
import { parseContextCommand } from "@/lib/context-parser";

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
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                title={`${ref} (${s.confidence}%) — click to load, Shift+click to send live`}
                aria-label={`${ref}, ${s.confidence}% confidence — click to load, Shift+click to send live`}
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
  // 2026-07-24 — dropped from (3 chars OR 300ms) to (1 char OR 80ms) after
  // field feedback that the transcript panel felt laggy. Detection itself
  // was never gated by this (it uses interim_final_candidate upstream), so
  // this only affects the *visible* transcript feel. 80ms keeps a light
  // render-throttle to prevent an overactive interim stream from re-rendering
  // 30 times/sec on lower-end operator machines.
  const interim = useDebouncedInterim(audio.interim, 1, 80);
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
                {/* Roadmap #5 — word-level confidence heatmap. Deepgram
                    already returns per-word confidence; render low-conf
                    words (< 0.75) in amber and very-low (< 0.5) with a
                    subtle underline so the operator can see WHERE the
                    mic/audio is struggling instead of "the whole thing
                    looks fine but a detection was wrong". Falls back to
                    plain text if the words array isn't there. */}
                {/* 2026-07-24 UX rewrite: yellow is now an AUTO-CORRECTION
                    indicator, not a low-confidence one. When the parser
                    fixed a mistranscription in context (e.g. "James
                    Forrest four" → "James four four"), the corrected
                    word renders yellow with a fade animation; hover
                    shows the original. Same idea as ChatGPT/Claude voice
                    self-correcting mid-sentence.
                    No corrections on this segment → plain text, zero
                    visual noise. (Corrections is empty/undefined for
                    99% of segments — the highlight is genuinely rare
                    and always means "the AI just fixed itself here".) */}
                {t.corrections && t.corrections.length > 0 ? (
                  (() => {
                    let display = t.text;
                    const parts: { key: number; text: string; original: string | null }[] = [];
                    let keySeq = 0;
                    // Naive word-boundary substitution of each original→corrected
                    // pair. Works because the corrections list is deduped by
                    // (original,corrected) and each pair is a single ASCII token.
                    // Iterate through the string, matching any correction's
                    // original with a case-insensitive \b regex, emitting
                    // literal chunks + a highlighted "corrected" span at each hit.
                    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    const alternation = t.corrections
                      .map((c) => escapeRe(c.original))
                      .join("|");
                    if (alternation.length === 0) {
                      parts.push({ key: keySeq++, text: display, original: null });
                    } else {
                      const re = new RegExp(`\\b(${alternation})\\b`, "gi");
                      let last = 0;
                      let m: RegExpExecArray | null;
                      while ((m = re.exec(display)) !== null) {
                        if (m.index > last) {
                          parts.push({ key: keySeq++, text: display.slice(last, m.index), original: null });
                        }
                        const hit = m[0];
                        const rule = t.corrections!.find((c) => c.original.toLowerCase() === hit.toLowerCase());
                        parts.push({ key: keySeq++, text: rule?.corrected ?? hit, original: hit });
                        last = m.index + hit.length;
                      }
                      if (last < display.length) {
                        parts.push({ key: keySeq++, text: display.slice(last), original: null });
                      }
                    }
                    return parts.map((p) => p.original === null
                      ? <span key={p.key}>{p.text}</span>
                      : <span
                          key={p.key}
                          className="rounded-sm bg-yellow-400/30 text-yellow-100 px-0.5 pf-corrected-flash"
                          title={`Heard "${p.original}" — corrected to "${p.text}"`}
                        >{p.text}</span>
                    );
                  })()
                ) : (
                  t.text
                )}
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

// ---------------------------------------------------------------------------
// Parts 6-8 — Song auto-stage/auto-live and word-timing slide auto-advance.
//
// Policy (explicit, user-approved 2026-07-22 — see CLAUDE.md rule 7): below
// SONG_AUTOLIVE_CONFIDENCE, a song detection only stages (human "G" keypress
// via `confirmStagedSongLive` required to go live). At/above
// SONG_AUTOLIVE_CONFIDENCE, `autoLiveSong` pushes it live with ZERO human
// action, using the exact same anti-replay/min-gap guardrails proven out by
// Bible's `doAutoFire` (see AUTO_APPROVE_KEY_INSTANT effect below): a
// session-persisted fired-key map (5min replay suppression) and a min-gap
// cooldown between auto-live events (falls back to staging, never silently
// drops, if a second high-confidence song lands inside the cooldown). This
// is a deliberate, documented exception to the historical "only one human
// keypress may call ctx.onSendSlideToLive" invariant — the user explicitly
// accepted the copyright-safety tradeoff for the ≥85% tier only. Do not lower
// SONG_AUTOLIVE_CONFIDENCE or extend zero-click to other content without new
// explicit sign-off.
//
// CLAUDE.md rule 7 is enforced upstream in autopilot.ts's isSong branch and
// OperatorConsole's gate — neither is touched here.
// ---------------------------------------------------------------------------

const SONG_AUTOSTAGE_CONFIRM_KEY = "KeyG"; // "G" for "Go live" — Space is
// already bound to next-slide navigation (useOperatorHotkeys), so we
// deliberately picked a different key to avoid a silent collision.

const SONG_STAGE_CONFIDENCE = 60; // stage for human "G" confirm
const SONG_AUTOLIVE_CONFIDENCE = 85; // zero-click auto-live, see policy note above
const SONG_AUTO_FIRED_SESSION_KEY = "presentflow.pro.songAutoFired.v1"; // 5min replay suppression, mirrors AUTO_FIRED_SESSION_KEY
const SONG_AUTO_LIVE_MIN_GAP_MS = 4000; // mirrors Bible's DEFAULT_MIN_GAP_MS

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
  const confirmPendingRef = useRef(false);
  const lastSongAutoLiveAtRef = useRef(0); // min-gap cooldown for Part 6b auto-live
  const promotionInFlightRef = useRef<Set<string>>(new Set()); // dedupe for staged->auto-live promotion

  // Word-tracking buffers for Part 7/8.
  const recentWordsRef = useRef<string[]>([]);
  const lastWordTsRef = useRef<number>(Date.now());
  const matchStreakRef = useRef(0);
  const interimMatchStreakRef = useRef(0); // predictive interim-based advance streak
  const cooldownUntilRef = useRef(0);
  const lastAdvanceTsRef = useRef(0);
  const progressionHandledForRef = useRef<Set<string>>(new Set());

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
    // Replay suppression — same 5min-window pattern as AUTO_FIRED_SESSION_KEY.
    // Different-song-live bypass mirrors the scripture path: the guard exists
    // to stop chatter from re-firing the SAME song. If a DIFFERENT song (or
    // nothing) is currently live, this is a legitimate swap back — the
    // worship team returning to song A after song B is exactly the case the
    // guard shouldn't block. Same-song echo is already handled by the
    // `liveSongRef.current?.songId === songId` short-circuit above.
    const differentSongLive = liveSongRef.current !== null && liveSongRef.current.songId !== songId;
    if (!differentSongLive) {
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
      if (slides.length === 0) return;
      const text = slides[0];
      lastSongAutoLiveAtRef.current = now;
      ctx.onSendSlideToLive({ kind: "text", text });
      liveSongRef.current = { songId, title, slides, currentIdx: 0, confirmedAt: now };
      lastAdvanceTsRef.current = now;
      matchStreakRef.current = 0;
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
    if (!autoApprove) return;
    const candidates: { songId: string; title: string; confidence: number }[] = [];
    for (const s of ctx.audio.suggestions) {
      if (s.type !== "song" && s.type !== "lyric") continue;
      if (s.confidence < SONG_STAGE_CONFIDENCE) continue;
      const songId = s.match?.songId;
      if (!songId) continue;
      candidates.push({ songId, title: s.match.title, confidence: s.confidence });
    }
    for (const s of ctx.audio.songSuggestions) {
      if (s.confidence < SONG_STAGE_CONFIDENCE || !s.songId) continue;
      candidates.push({ songId: s.songId, title: s.title, confidence: s.confidence });
    }
    if (candidates.length === 0) return;
    // Highest confidence first.
    candidates.sort((a, b) => b.confidence - a.confidence);

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
      const handledAt = stagedOrHandledRef.current.get(c.songId);
      // Different-song-live bypass: the 5-min redetect cooldown is anti-
      // chatter for the currently-live song. If a DIFFERENT song is live
      // (worship team swapping back to an earlier one) or nothing is live,
      // let the candidate through — that's a legitimate back-and-forth swap.
      // 2026-07-23 review fix: keep a shorter (15s) cooldown even in the
      // bypass path so a worship transition where two songs both score
      // ≥85% can't machine-gun autoLiveSong every second.
      const SONG_REDETECT_BYPASS_FLOOR_MS = 15 * 1000;
      const differentSongLive = liveSongRef.current !== null && liveSongRef.current.songId !== c.songId;
      if (handledAt) {
        const gap = now - handledAt;
        if (!differentSongLive && gap < SONG_REDETECT_COOLDOWN_MS) continue;
        if (differentSongLive && gap < SONG_REDETECT_BYPASS_FLOOR_MS) continue;
      }
      if (c.confidence >= SONG_AUTOLIVE_CONFIDENCE) {
        stagedOrHandledRef.current.set(c.songId, now);
        void autoLiveSong(c.songId, c.title, c.confidence);
        break;
      }
      if (stagedSong) break; // one staged banner at a time
      stagedOrHandledRef.current.set(c.songId, now);
      void stageSong(c.songId, c.title, c.confidence, "detection");
      break;
    }
  }, [ctx.audio.suggestions, ctx.audio.songSuggestions, autoApprove, stagedSong, stageSong, autoLiveSong]);

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
    recentWordsRef.current = [...recentWordsRef.current, ...words].slice(-16);
    lastWordTsRef.current = Date.now();

    const live = liveSongRef.current;
    if (!live) return;
    if (Date.now() < cooldownUntilRef.current) return;
    if (Date.now() - lastAdvanceTsRef.current < 3000) return; // min time-on-slide floor
    const nextIdx = live.currentIdx + 1;
    if (nextIdx >= live.slides.length) return; // last slide — see Part 8 below

    const result = matchNextSlide(recentWordsRef.current, live.slides[nextIdx]);
    if (result.consecutiveMatches >= 3) {
      matchStreakRef.current += 1;
    } else {
      matchStreakRef.current = 0;
    }
    // Require the match to hold for two consecutive transcript segments —
    // not a single one-off — before advancing, per the "sustained match"
    // guardrail.
    if (matchStreakRef.current >= 2) {
      const text = live.slides[nextIdx];
      ctx.onSendSlideToLive({ kind: "text", text });
      liveSongRef.current = { ...live, currentIdx: nextIdx };
      lastAdvanceTsRef.current = Date.now();
      matchStreakRef.current = 0;
      forceRender((n) => n + 1);
      setAutoAdvanceFlash(true);
      console.log(`[song-autoprogression] auto-advanced "${live.title}" to slide ${nextIdx + 1}/${live.slides.length} (word-match confidence ${result.confidence}%)`, { ts: Date.now() });
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
    if (Date.now() - lastAdvanceTsRef.current < 3000) return; // same min time-on-slide floor
    const nextIdx = live.currentIdx + 1;
    if (nextIdx >= live.slides.length) return;

    // Combine committed recent words with the live interim tail so a match
    // spanning a segment boundary (e.g. "...loved the" final + "world" interim)
    // still registers, without permanently committing unconfirmed interim
    // words into recentWordsRef (that stays final-only).
    const combined = [...recentWordsRef.current, ...words].slice(-16);
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
      forceRender((n) => n + 1);
      setAutoAdvanceFlash(true);
      console.log(`[song-autoprogression] predictive interim advance "${live.title}" to slide ${nextIdx + 1}/${live.slides.length} (confidence ${result.confidence}%)`, { ts: Date.now() });
      window.setTimeout(() => setAutoAdvanceFlash(false), 2500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.audio.interim]);

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

  const dismissStaged = useCallback(() => setStagedSong(null), []);

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
          <div className="text-[11px] font-bold text-orange-200">
            Press <kbd className="px-1.5 py-0.5 rounded bg-orange-500 text-white font-mono">G</kbd> to go LIVE with slide {stagedSong.currentIdx + 1} of {stagedSong.slides.length} — human confirm required, AI will never send this on its own.
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

export function ProOperatorShell({ ctx }: { ctx: OperatorShellCtx }) {
  const [centerMode, setCenterMode] = useState<CenterMode>("slides");
  const [mediaStripOpen, setMediaStripOpen] = useState(true);
  const [slideSize, setSlideSize] = useState(160);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
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
    // Dedup key can keep the "-verseEnd" suffix unconditionally — it's never
    // shown to the operator. The visible reference-box text must NOT: it was
    // reusing this same string via setRef(key), which put a bogus "-1" on
    // every single-verse detection ("Philippians 4:1-1" instead of "Philippians 4:1").
    const key = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}-${scripture.ref.verseEnd}`;
    if (lastRoutedScriptureRef.current === key) return;
    lastRoutedScriptureRef.current = key;
    const refText = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}${scripture.ref.verseStart !== scripture.ref.verseEnd ? `-${scripture.ref.verseEnd}` : ""}`;
    // Optimistic render: show a placeholder card immediately so operator sees
    // detection landed before the DB roundtrip completes. Cache-hit path
    // resolves synchronously below and overwrites — no visible flicker.
    const label = `${refText} (${bibleSession.state.translation})`;
    bibleSession.setRef(refText);
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
        bibleSession.setSelectedIdx(0);
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
  const lastLiveWasSongRef = useRef<boolean>(false); // Y8

  // Part 2 (verse forward-continuation): word-timing tracking buffers, same
  // shape as the song version in SongAutopilotStaging but scoped to Bible
  // verse cards. Only advances a verse that is ALREADY live (manually
  // clicked or auto-fired via doAutoFire above) — never originates a fresh
  // push, mirroring the song invariant.
  const bibleRecentWordsRef = useRef<string[]>([]);
  const bibleMatchStreakRef = useRef(0);
  const bibleCooldownUntilRef = useRef(0);
  const bibleLastAdvanceTsRef = useRef(0);

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
    // forceLive (set client-side when the SAME reference is spoken a second
    // time, even minutes apart) bypasses the normal 85% floor — restating a
    // verse is itself the "make sure this is on screen" signal. AUTO mode
    // being on (the `autoOn` check above) is still required either way.
    const scripture = suggestions.find((s) => s.type === "scripture" && (s.confidence >= 85 || s.forceLive) && !lowConfBlockedSpans.has(s.id));
    if (!scripture || scripture.type !== "scripture") return;
    const first = cards[0];
    // R8: skip placeholder cards (loading / no-text / lookup-failed) AND
    // empty-text guard as belt-and-braces.
    if (!first || first.placeholder === true || !first.verses?.length) return;
    const firstText = first.verses[0]?.text ?? "";
    if (!firstText || firstText === "Loading…" || firstText.length === 0) return;

    const key = first.id;
    // R5: check sessionStorage for recent replays (5 min TTL). This is the
    // SOLE timing authority — a preacher returning to the same verse later
    // in the service must be able to trigger it again. `lastAutoLiveKeyRef`
    // used to ALSO permanently block a repeat of whatever key fired last:
    // since `first.id` is a stable per-reference key (not unique per
    // detection event), if the same verse stayed the most recent detection
    // with nothing else firing in between, that extra check would keep
    // blocking it forever even after the 5-minute window had long expired.
    // Removed — the sessionStorage map already does the real timing.
    //
    // forceLive/voiceCommand bypass this window entirely: a preacher
    // explicitly restating the same reference, or an explicit "verse N"/
    // "from verse N" navigation phrase, IS the authorization to replay —
    // the 5-minute guard exists to stop a STALE lingering high-confidence
    // detection from re-firing on its own, not to block a deliberate repeat.
    // Different-reference-live bypass: the 5-min replay guard exists to stop
    // an echoing stale detection from re-firing the SAME slide that's already
    // on screen. It should NOT block a legitimate switch back to a previous
    // reference — that's the whole point of preacher-driven back-and-forth
    // (Matt 5:5 → Gen 4:4 → back to Matt 5:5 within 5 min).
    //
    // 2026-07-23 review fix: previously used `currentLiveText.endsWith(first.label)`
    // which was doubly wrong. (a) The trailing label varies by code path — manual
    // Lookup emits "Book C:Vs-Ve (TR)" ranges; goto emits per-verse "Book C:V (TR)".
    // Same reference could look different. (b) An empty currentLiveText (fresh
    // session, nothing live yet) also gave `endsWith === false`, which SKIPPED the
    // guard entirely — reopening the very stale-echo case R5 was added to fix.
    //
    // Correct semantics: parse a canonical (book|ch|vs|ve) tuple from live text;
    // skip the guard ONLY when a DIFFERENT parsed scripture is currently live
    // (that's a legit swap-back). Same-ref-live OR nothing-scripture-live both
    // keep the guard active.
    const currentLiveText = ctx.liveSlide?.kind === "text" ? ctx.liveSlide.text : "";
    let differentRefLive = false;
    const liveScriptureMatch = currentLiveText.match(/(\d?\s*[A-Za-z]+)\s+(\d+):(\d+)(?:-(\d+))?\s*\([A-Z]+\)\s*$/);
    if (liveScriptureMatch) {
      const liveBook = liveScriptureMatch[1].trim().toLowerCase().replace(/\s+/g, " ");
      const liveCh = parseInt(liveScriptureMatch[2], 10);
      const liveVs = parseInt(liveScriptureMatch[3], 10);
      const liveVe = liveScriptureMatch[4] ? parseInt(liveScriptureMatch[4], 10) : liveVs;
      const targetBook = scripture.ref.book.toLowerCase().replace(/\s+/g, " ");
      differentRefLive = liveBook !== targetBook
        || liveCh !== scripture.ref.chapter
        || liveVs !== scripture.ref.verseStart
        || liveVe !== scripture.ref.verseEnd;
    }
    if (!scripture.forceLive && !scripture.voiceCommand && !differentRefLive) {
      try {
        const raw = window.sessionStorage.getItem(AUTO_FIRED_SESSION_KEY);
        const map: Record<string, number> = raw ? JSON.parse(raw) : {};
        const firedAt = map[key];
        if (typeof firedAt === "number" && Date.now() - firedAt < 5 * 60 * 1000) {
          return;
        }
      } catch { /* noop */ }
    }

    const body = first.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
    const slide: import("@/lib/broadcast").SlidePayload = { kind: "text", text: `${body}\n\n${first.label}` };
    const ref = `${scripture.ref.book} ${scripture.ref.chapter}:${scripture.ref.verseStart}${scripture.ref.verseEnd !== scripture.ref.verseStart ? `-${scripture.ref.verseEnd}` : ""}`;
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
    bibleRecentWordsRef.current = [...bibleRecentWordsRef.current, ...words].slice(-16);

    if (Date.now() < bibleCooldownUntilRef.current) return;
    if (Date.now() - bibleLastAdvanceTsRef.current < 3000) return; // min time-on-slide floor

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
    if (bibleMatchStreakRef.current >= 2) {
      ctx.onSendSlideToLive({ kind: "text", text: `${nextBody}\n\n${nextCard.label}` });
      bibleSession.setSelectedIdx(nextIdx);
      bibleLastAdvanceTsRef.current = Date.now();
      bibleMatchStreakRef.current = 0;
      console.log(`[bible-autoprogression] word-match auto-advance to card ${nextIdx + 1}/${cards.length} (${nextCard.label}, confidence ${result.confidence}%)`, { ts: Date.now() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.audio.transcript]);

  // Any manual operator action cancels Bible forward-continuation tracking
  // too, same guardrail philosophy as the song version's cancelTracking.
  useEffect(() => {
    const cancel = () => {
      bibleCooldownUntilRef.current = Date.now() + 4000;
      bibleMatchStreakRef.current = 0;
    };
    window.addEventListener("click", cancel, true);
    window.addEventListener("keydown", cancel, true);
    return () => {
      window.removeEventListener("click", cancel, true);
      window.removeEventListener("keydown", cancel, true);
    };
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
    if (Date.now() - bibleLastAdvanceTsRef.current < 3000) return;
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
      const parsed = parser.parseReference(anchorRef);
      if (!parsed) return;
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
