"use client";
/**
 * AIDetectionsPanel — dedicated split view of AI Bible + Song detections.
 *
 * Replaces the previous mixed-list RecentDetectionsPanel. Both sections are
 * ALWAYS visible so the operator can see live Bible references and Song
 * matches at the same time.
 *
 * Behavior notes:
 * - Dedupe: canonical key (Bible: book+chapter+start-end; Song: songId).
 *   Higher-confidence new match REPLACES the old row and bumps to top.
 * - Freshness: rows show relative time and auto-expire after 10 minutes.
 * - Invalid Bible refs (lookup returns 0 verses, e.g. "John 99:99") are
 *   filtered out and remembered in an in-memory Set so they don't re-score.
 * - Partial refs (chapter=0) never surface as detections.
 * - Songs never auto-project (CLAUDE.md rule 7). Double-click = load only.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BookOpen, Music, Quote, Link2 } from "lucide-react";
import type { OperatorShellCtx } from "../../shell/types";
import type { RightRailDetections } from "./useRightRailDetections";
import type { BibleRow, SongRow } from "@/lib/right-rail-visible";
import { cachedLookup } from "@/lib/bible-client-cache";
import { cn } from "@/lib/utils";
import { dispatchInternal } from "@/lib/internal-events";

// ---------- relative time helper ----------
function relTime(ts: number, nowMs: number): string {
  const dt = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (dt < 5) return "just now";
  if (dt < 60) return `${dt}s ago`;
  const m = Math.floor(dt / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

// ---------- confidence color ----------
function confClass(conf: number): string {
  if (conf >= 90) return "text-emerald-400 border-emerald-400/30 bg-emerald-500/10";
  if (conf >= 70) return "text-amber-400 border-amber-400/30 bg-amber-500/10";
  return "text-[var(--color-muted-foreground)] border-[var(--color-border)] bg-[var(--color-elevated)]";
}

// Cross-Reference candidates are pre-filtered server-side to similarity>=60,
// so the full 0-100 confClass scale above would render almost everything in
// the same low-confidence color with no visible amber band. Tighter
// thresholds tuned for this section's actual 60-100 range.
function crossRefConfClass(similarity: number): string {
  if (similarity >= 85) return "text-emerald-400 border-emerald-400/30 bg-emerald-500/10";
  if (similarity >= 70) return "text-amber-400 border-amber-400/30 bg-amber-500/10";
  return "text-[var(--color-muted-foreground)] border-[var(--color-border)] bg-[var(--color-elevated)]";
}

// Row shapes + merge/adapter helpers moved to src/lib/right-rail-visible.ts
// (shared with the RightIconBar badges); re-exported for existing importers.
export {
  mergeBibleRows, mergeSongRows, bibleKey, bibleRowFromSuggestion,
  songRowFromSuggestion, songRowFromServerSuggestion,
} from "@/lib/right-rail-visible";
export type { BibleRow, SongRow } from "@/lib/right-rail-visible";

// ---------- Main panel ----------
export type DetectionSection = "bible" | "songs" | "xrefs";

export function AIDetectionsPanel({ ctx, sections, detections }: { ctx: OperatorShellCtx; sections?: DetectionSection[]; detections: RightRailDetections }) {
  // 2026-07-25 Phase 3 hook: RightIconBar embeds this component inside
  // per-icon popovers and passes a `sections` filter so each popover
  // only renders its slice. If unset, all three sections render (legacy
  // full-panel behavior, kept for backward compat during migration).
  const showBible = !sections || sections.includes("bible");
  const showSongs = !sections || sections.includes("songs");
  const showXrefs = !sections || sections.includes("xrefs");
  const audio = ctx.audio;

  const { bibleRows, songRows, phraseGroups: phraseMatchGroups, nowTick, dismiss, markInvalid } = detections;
  // Verse validation lookup + preview text live in useRightRailDetections
  // (always mounted) so a closed popover never counts an invalid ref.
  const previews = detections.previews;

  const autoApprove = !!ctx.autoApproveOn;
  const autoApproveThreshold = 85;

  // ---------- Bible actions ----------
  // Dispatches to a listener inside ProOperatorShell (where bibleSession —
  // the state actually driving the visible Bible panel/cards — lives).
  // Previously this called ctx.onBankAddReference, which only writes to
  // OperatorConsole's legacy "bank" concept — a completely different, not
  // visibly connected piece of state. Clicking a detection row would show a
  // "Loaded" toast while the actual Bible panel never changed at all.
  const loadBible = async (row: BibleRow) => {
    try {
      const res = await cachedLookup({
        book: row.book, chapter: row.chapter,
        verseStart: row.verseStart, verseEnd: row.verseEnd,
        translationCode: ctx.defaultTranslationCode,
      });
      if (!res.verses || res.verses.length === 0) {
        markInvalid(row.key);
        toast.error("Reference not found in DB");
        return;
      }
      dispatchInternal("presentflow:bible-goto", {
        book: row.book, chapter: row.chapter, verseStart: row.verseStart, verseEnd: row.verseEnd, live: true,
      });
      toast.success(`Loaded ${row.key}`);
    } catch {
      toast.error("Lookup failed");
    }
  };

  const sendBibleLive = async (row: BibleRow) => {
    try {
      dispatchInternal("presentflow:bible-goto", {
        book: row.book, chapter: row.chapter, verseStart: row.verseStart, verseEnd: row.verseEnd, live: true,
      });
    } catch {
      toast.error("Send failed");
    }
  };

  // ---------- Song actions ----------
  const loadSong = (row: SongRow) => {
    if (!ctx.onAddLibraryItem) {
      toast.info("Playlist add not available until a service plan is open");
      return;
    }
    void ctx.onAddLibraryItem("song", { id: row.songId, title: row.title });
  };

  // Manual, operator-initiated click → push the song's first slide live
  // immediately, matching the Bible detection row's click behavior above.
  // This is still a deliberate human click (not the AI acting on its own),
  // so it doesn't violate CLAUDE.md rule 7 ("songs never auto-project" is
  // about the AI pushing without a human click at all).
  const sendSongLivePendingRef = useRef<Set<string>>(new Set());
  const sendSongLive = async (row: SongRow) => {
    // Guard against a double-click firing two overlapping live-pushes for
    // the same song, consistent with the pending guards on every other
    // add-to-playlist trigger in this codebase.
    if (sendSongLivePendingRef.current.has(row.songId)) return;
    sendSongLivePendingRef.current.add(row.songId);
    try {
      loadSong(row);
      const res = await fetch(`/api/songs/${row.songId}/slides`).then((r) => r.json());
      const slides = Array.isArray(res.slides) ? res.slides as { lyrics: string }[] : [];
      const first = slides[0];
      if (!first || !first.lyrics) {
        toast.error("No slides found for this song");
        return;
      }
      ctx.onSendSlideToLive({ kind: "text", text: first.lyrics }, undefined, { origin: { kind: "song", songId: row.songId } });
      // Mirror the Bible chip UX: switch the center panel so the operator can
      // see the content that just went live, not stare at a stale panel.
      // ProOperatorShell listens for this event and calls setCenterMode("slides").
      dispatchInternal("presentflow:show-slides");
      toast.success(`"${row.title}" → LIVE`);
    } catch {
      toast.error("Send failed");
    } finally {
      sendSongLivePendingRef.current.delete(row.songId);
    }
  };

  const dismissBible = (key: string) => dismiss("bible", key);
  const dismissSong = (key: string) => dismiss("song", key);

  const paused = audio.stage === "paused";

  return (
    <div className="border-t border-[var(--color-border)]" data-testid="ai-detections-panel">
      {paused && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--color-border)] text-[10px]">
          <span className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300 truncate">
            Transcription paused — no voice activity for 10 minutes
          </span>
          <button
            type="button"
            onClick={() => ctx.onResumeAudio?.()}
            className="ml-auto px-2 py-0.5 rounded text-[10px] font-semibold text-white shrink-0"
            style={{ background: "#f97316" }}
          >
            Resume
          </button>
        </div>
      )}
      {/* Section A — Bible */}
      {showBible && (
      <section className="px-2 py-2" data-testid="ai-detections-bible">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="grid place-items-center w-[18px] h-[18px] rounded-md bg-[var(--color-brand)]/14 text-[var(--color-brand)] shrink-0">
            <BookOpen className="w-3 h-3" strokeWidth={2.4} />
          </span>
          <span className="eyebrow">Bible Detections</span>
          <span className="h-px flex-1" style={{ background: "linear-gradient(90deg, var(--color-border), transparent)" }} aria-hidden />
          {bibleRows.length > 0 && (
            <span className="text-[9px] font-mono text-[var(--color-muted-foreground)]">
              {bibleRows.length}
            </span>
          )}
        </div>
        <div className="h-[200px] overflow-y-auto space-y-1 pr-0.5">
          {bibleRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 text-center py-6 px-3">
              <span className="grid place-items-center w-9 h-9 rounded-xl bg-[var(--color-brand)]/10 text-[var(--color-brand)]/70 shadow-[var(--edge-top)]">
                <BookOpen className="w-4 h-4" strokeWidth={2} />
              </span>
              <p className="text-[11px] font-medium text-[var(--color-muted-foreground)] leading-relaxed">
                No Bible references detected yet.<br />Speak a reference like &quot;John 3:16&quot; to see it here.
              </p>
            </div>
          ) : (
            bibleRows.map((row) => {
              const conf = Math.round(row.confidence);
              const passesAA = autoApprove && conf >= autoApproveThreshold;
              return (
                <div
                  key={row.key}
                  role="button"
                  tabIndex={0}
                  aria-label={row.isPhraseMatch
                    ? `Bible phrase match ${row.book} ${row.chapter}:${row.verseStart}${row.verseEnd !== row.verseStart ? "-" + row.verseEnd : ""} — quoted text, not a spoken reference. Enter to load, Shift+Enter to send live`
                    : `Bible detection ${row.book} ${row.chapter}:${row.verseStart}${row.verseEnd !== row.verseStart ? "-" + row.verseEnd : ""} at ${conf}% confidence — Enter to load, Shift+Enter to send live`}
                  title={row.isPhraseMatch ? "Phrase match — quoted text, not a spoken reference. Tap to load." : undefined}
                  onClick={() => loadBible(row)}
                  onDoubleClick={(e) => { e.preventDefault(); void sendBibleLive(row); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      if (e.shiftKey) void sendBibleLive(row);
                      else loadBible(row);
                    }
                  }}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--color-elevated)] shadow-[var(--edge-top),var(--shadow-sm)] hover:shadow-[var(--edge-top),var(--shadow-md)] hover:-translate-y-px transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-spring)] cursor-pointer border border-[var(--color-border)] hover:border-[color-mix(in_oklab,var(--color-brand)_40%,var(--color-border))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                  data-testid={`bible-row-${row.key}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12.5px] font-bold tracking-[-0.01em] truncate">
                        {row.book} {row.chapter}:{row.verseStart}
                        {row.verseEnd !== row.verseStart ? `-${row.verseEnd}` : ""}
                      </span>
                      {row.isPhraseMatch && (
                        <span
                          aria-label="Phrase match — quoted text"
                          data-testid="phrase-match-badge"
                          title="Phrase match — quoted text, not a spoken reference"
                          className="grid place-items-center shrink-0 w-[16px] h-[16px] rounded-md bg-[var(--color-scripture-gold,#EF9F27)]/18 text-[var(--color-scripture-gold,#EF9F27)]"
                        >
                          <Quote className="w-2.5 h-2.5" strokeWidth={2.6} />
                        </span>
                      )}
                      {passesAA && (
                        <span
                          aria-label="auto-approve"
                          className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0"
                        />
                      )}
                    </div>
                    {previews.get(row.key) && (
                      <div className="text-[10px] text-[var(--color-muted-foreground)] truncate leading-tight">
                        {previews.get(row.key)}…
                      </div>
                    )}
                    <div className="text-[9px] text-[var(--color-muted-foreground)]/70 leading-tight">
                      {relTime(row.ts, nowTick)}
                    </div>
                  </div>
                  <span className={cn("shrink-0 font-mono text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md border shadow-[var(--edge-top)]", confClass(conf))}>
                    {conf}%
                  </span>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={(e) => { e.stopPropagation(); dismissBible(row.key); }}
                    className="shrink-0 text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-1 opacity-0 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>
      )}

      {/* Divider */}
      {showBible && showXrefs && phraseMatchGroups.length > 0 && (
        <div className="border-t border-[var(--color-border)]" />
      )}

      {/* Section — Cross-References: the preacher spoke a verse's actual
          content ("for God so loved the world...") with no reference
          structure at all, so the rule-based parser above found nothing.
          Multiple candidate verses are shown — NEVER auto-picked, since a
          phrase can genuinely match more than one verse — the operator
          clicks the right one. */}
      {showXrefs && phraseMatchGroups.length === 0 && (
        <section className="px-2 py-2" data-testid="ai-cross-references-empty">
          <div className="flex flex-col items-center gap-2 text-center py-6 px-3">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-[var(--color-brand)]/10 text-[var(--color-brand)]/70 shadow-[var(--edge-top)]">
              <Link2 className="w-4 h-4" strokeWidth={2} />
            </span>
            <p className="text-[11px] font-medium text-[var(--color-muted-foreground)] leading-relaxed">
              No cross-references detected yet.
            </p>
          </div>
        </section>
      )}
      {showXrefs && phraseMatchGroups.length > 0 && (
        <>
          <section className="px-2 py-2" data-testid="ai-cross-references">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px]">🔗</span>
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Cross-References
              </span>
            </div>
            {phraseMatchGroups.map((group) => (
              <div key={group.segmentId} className="mb-2">
                <div className="text-[10px] italic text-[var(--color-muted-foreground)] px-1 mb-1 truncate" title={group.matchedText}>
                  &quot;{group.matchedText.length > 60 ? group.matchedText.slice(0, 57) + "…" : group.matchedText}&quot;
                </div>
                <div className="space-y-1">
                  {group.candidates.map((c, i) => {
                    const label = `${c.book} ${c.chapter}:${c.verse}`;
                    return (
                      <div
                        key={`${group.segmentId}-${i}`}
                        role="button"
                        tabIndex={0}
                        title={`${label} (${c.similarity}% match) — click to load, Shift+click to send live`}
                        onClick={(e) => dispatchInternal("presentflow:bible-goto", {
                          book: c.book, chapter: c.chapter, verseStart: c.verse, verseEnd: c.verse, live: e.shiftKey,
                        })}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          dispatchInternal("presentflow:bible-goto", {
                            book: c.book, chapter: c.chapter, verseStart: c.verse, verseEnd: c.verse, live: e.shiftKey,
                          });
                        }}
                        className="group flex items-center gap-1.5 px-1.5 py-1 rounded bg-[var(--color-elevated)] hover:bg-[var(--color-elevated-hover,var(--color-elevated))] cursor-pointer border border-transparent hover:border-[var(--color-border)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] font-semibold">{label}</span>
                          <div className="text-[10px] text-[var(--color-muted-foreground)] truncate leading-tight">{c.text}</div>
                        </div>
                        <span className={cn("shrink-0 font-mono text-[9px] px-1 py-0.5 rounded border", crossRefConfClass(c.similarity))}>
                          {c.similarity}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
          {showSongs && (<div className="border-t border-[var(--color-border)]" />)}
        </>
      )}

      {/* Section B — Songs */}
      {showSongs && (
      <section className="px-2 py-2" data-testid="ai-detections-songs">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="grid place-items-center w-[18px] h-[18px] rounded-md bg-[color-mix(in_oklab,var(--color-worship)_18%,transparent)] text-[var(--color-worship-soft)] shrink-0">
            <Music className="w-3 h-3" strokeWidth={2.4} />
          </span>
          <span className="eyebrow">Song Detections</span>
          <span className="h-px flex-1" style={{ background: "linear-gradient(90deg, var(--color-border), transparent)" }} aria-hidden />
          {songRows.length > 0 && (
            <span className="text-[9px] font-mono text-[var(--color-muted-foreground)]">
              {songRows.length}
            </span>
          )}
        </div>
        <div className="h-[200px] overflow-y-auto space-y-1 pr-0.5">
          {songRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 text-center py-6 px-3">
              <span className="grid place-items-center w-9 h-9 rounded-xl bg-[color-mix(in_oklab,var(--color-worship)_12%,transparent)] text-[var(--color-worship-soft)] shadow-[var(--edge-top)]">
                <Music className="w-4 h-4" strokeWidth={2} />
              </span>
              <p className="text-[11px] font-medium text-[var(--color-muted-foreground)] leading-relaxed">
                No song matches yet.<br />Say &quot;let&apos;s sing…&quot; or a lyric line to see matches here.
              </p>
            </div>
          ) : (
            songRows.map((row) => {
              const conf = Math.round(row.confidence);
              return (
                <div
                  key={row.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => void sendSongLive(row)}
                  title="Click to send song to live"
                  className="group flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--color-elevated)] shadow-[var(--edge-top),var(--shadow-sm)] hover:shadow-[var(--edge-top),var(--shadow-md)] hover:-translate-y-px transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-spring)] cursor-pointer border border-[var(--color-border)] hover:border-[color-mix(in_oklab,var(--color-brand)_40%,var(--color-border))]"
                  data-testid={`song-row-${row.key}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12.5px] font-bold tracking-[-0.01em] truncate">
                        {row.title}
                      </span>
                      {row.artist && (
                        <span className="text-[9px] text-[var(--color-muted-foreground)] truncate">
                          · {row.artist}
                        </span>
                      )}
                    </div>
                    {row.preview && (
                      <div className="text-[10px] text-[var(--color-muted-foreground)] truncate leading-tight italic">
                        {row.preview}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-[9px] leading-tight">
                      <span className="px-1 rounded bg-[var(--color-border)]/40 text-[var(--color-muted-foreground)]">
                        {row.matchType}
                      </span>
                      <span className="text-[var(--color-muted-foreground)]/70">
                        {relTime(row.ts, nowTick)}
                      </span>
                    </div>
                  </div>
                  <span className={cn("shrink-0 font-mono text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md border shadow-[var(--edge-top)]", confClass(conf))}>
                    {conf}%
                  </span>
                  <button
                    type="button"
                    aria-label="Add to playlist"
                    title="Add to playlist"
                    onClick={(e) => { e.stopPropagation(); loadSong(row); }}
                    className="shrink-0 text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-1 opacity-0 group-hover:opacity-100"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={(e) => { e.stopPropagation(); dismissSong(row.key); }}
                    className="shrink-0 text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-1 opacity-0 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>
      )}
    </div>
  );
}
