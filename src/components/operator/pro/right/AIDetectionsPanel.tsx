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
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { OperatorShellCtx } from "../../shell/types";
import type { UnifiedSuggestion, SongSuggestion } from "../../useAudioStream";
import { cachedLookup } from "@/lib/bible-client-cache";
import { cn } from "@/lib/utils";
import { dispatchInternal } from "@/lib/internal-events";

const MAX_ROWS = 8;
const EXPIRY_MS = 10 * 60 * 1000; // 10 min

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

// ---------- Bible row shape ----------
export type BibleRow = {
  key: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  confidence: number;
  ts: number;
  preview?: string;       // first 40 chars of verse text
  invalid?: boolean;      // db lookup returned 0 verses
};

// ---------- Song row shape ----------
export type SongRow = {
  key: string;             // songId
  songId: string;
  title: string;
  artist: string | null;
  confidence: number;
  ts: number;
  preview?: string;        // first line of first slide
  matchType: "Title" | "Lyric" | "PD";
  source: "playlist" | "local_library" | "public_domain";
};

/**
 * Bible dedupe/merge — exported for tests.
 */
export function mergeBibleRows(prev: BibleRow[], incoming: BibleRow): BibleRow[] {
  const idx = prev.findIndex((r) => r.key === incoming.key);
  if (idx >= 0) {
    // Only replace / bump if new confidence >= existing (higher wins).
    if (incoming.confidence >= prev[idx].confidence) {
      const merged = [incoming, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      return merged.slice(0, MAX_ROWS);
    }
    // Refresh timestamp on same-or-lower conf so it stays visible.
    const bumped = { ...prev[idx], ts: incoming.ts };
    return [bumped, ...prev.slice(0, idx), ...prev.slice(idx + 1)].slice(0, MAX_ROWS);
  }
  return [incoming, ...prev].slice(0, MAX_ROWS);
}

/**
 * Song dedupe/merge — exported for tests.
 */
export function mergeSongRows(prev: SongRow[], incoming: SongRow): SongRow[] {
  const idx = prev.findIndex((r) => r.key === incoming.key);
  if (idx >= 0) {
    if (incoming.confidence >= prev[idx].confidence) {
      const merged = [incoming, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      return merged.slice(0, MAX_ROWS);
    }
    const bumped = { ...prev[idx], ts: incoming.ts };
    return [bumped, ...prev.slice(0, idx), ...prev.slice(idx + 1)].slice(0, MAX_ROWS);
  }
  return [incoming, ...prev].slice(0, MAX_ROWS);
}

/**
 * Canonical Bible key: "Book chapter:vs-ve".
 */
export function bibleKey(book: string, chapter: number, vs: number, ve: number): string {
  return `${book} ${chapter}:${vs}-${ve}`;
}

/**
 * Filter a raw suggestion to a Bible row candidate. Returns null when the
 * ref is partial (chapter=0) or malformed.
 */
export function bibleRowFromSuggestion(s: UnifiedSuggestion): BibleRow | null {
  if (s.type !== "scripture") return null;
  const { book, chapter, verseStart, verseEnd } = s.ref;
  if (!book || !chapter || chapter <= 0) return null;
  if (!verseStart || verseStart <= 0) return null;
  return {
    key: bibleKey(book, chapter, verseStart, verseEnd),
    book, chapter, verseStart, verseEnd,
    confidence: s.confidence,
    ts: s.ts,
  };
}

/**
 * Server-side song detections arrive via a different shape (Fly audio
 * bridge `{type:"song", song:{...}}` messages, stored in
 * useAudioStream's `songSuggestions`) than the client-side detectAll()
 * suggestions. This adapts them into the same SongRow shape so both
 * sources render in one deduped list — server detections were previously
 * silently discarded because the panel only read `suggestions`.
 */
export function songRowFromServerSuggestion(s: SongSuggestion): SongRow | null {
  if (!s.songId) return null;
  return {
    key: s.songId,
    songId: s.songId,
    title: s.title,
    artist: null,
    confidence: s.confidence,
    ts: Date.now(),
    preview: s.matchedText ? s.matchedText.slice(0, 60) : undefined,
    matchType: "Title",
    source: "local_library",
  };
}

export function songRowFromSuggestion(s: UnifiedSuggestion): SongRow | null {
  if (s.type !== "song" && s.type !== "lyric") return null;
  const m = s.match;
  if (!m || !m.songId) return null;
  const matchType: SongRow["matchType"] =
    s.type === "lyric" ? "Lyric"
      : m.source === "public_domain" ? "PD"
      : "Title";
  return {
    key: m.songId,
    songId: m.songId,
    title: m.title,
    artist: m.artist ?? null,
    confidence: s.confidence,
    ts: s.ts,
    preview: m.matchedLine ? m.matchedLine.split(/\r?\n/)[0].slice(0, 60) : undefined,
    matchType,
    source: m.source,
  };
}

// ---------- Main panel ----------
export function AIDetectionsPanel({ ctx }: { ctx: OperatorShellCtx }) {
  const audio = ctx.audio;
  const threshold = ctx.confidenceThreshold ?? 50;

  const [bibleRows, setBibleRows] = useState<BibleRow[]>([]);
  const [songRows, setSongRows] = useState<SongRow[]>([]);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const invalidRefsRef = useRef<Set<string>>(new Set());
  const previewLookupRef = useRef<Set<string>>(new Set());
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Tick every 15s to refresh relative timestamps + expire rows.
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(iv);
  }, []);

  // Ingest new suggestions -> split into sections.
  useEffect(() => {
    const now = Date.now();
    for (const s of audio.suggestions) {
      if (s.confidence < threshold) continue;
      if (now - s.ts > EXPIRY_MS) continue;

      if (s.type === "scripture") {
        const row = bibleRowFromSuggestion(s);
        if (!row) continue;
        if (invalidRefsRef.current.has(row.key)) continue;
        if (dismissedKeys.has(`bible:${row.key}`)) continue;

        // Kick off a lookup to verify the ref exists + get preview text.
        if (!previewLookupRef.current.has(row.key)) {
          previewLookupRef.current.add(row.key);
          (async () => {
            try {
              const res = await cachedLookup({
                book: row.book,
                chapter: row.chapter,
                verseStart: row.verseStart,
                verseEnd: row.verseEnd,
                translationCode: ctx.defaultTranslationCode,
              });
              if (!res.verses || res.verses.length === 0) {
                // Invalid — drop and remember.
                invalidRefsRef.current.add(row.key);
                setBibleRows((prev) => prev.filter((r) => r.key !== row.key));
                return;
              }
              const preview = res.verses[0]?.text?.slice(0, 40) ?? "";
              if (!preview) return; // shape drift — skip rather than render empty
              setBibleRows((prev) => prev.map((r) => r.key === row.key ? { ...r, preview } : r));
            } catch { /* leave without preview */ }
          })();
        }
        setBibleRows((prev) => mergeBibleRows(prev, row));
      } else if (s.type === "song" || s.type === "lyric") {
        const row = songRowFromSuggestion(s);
        if (!row) continue;
        if (dismissedKeys.has(`song:${row.key}`)) continue;
        setSongRows((prev) => mergeSongRows(prev, row));
      }
    }
    // Drop expired rows.
    setBibleRows((prev) => prev.filter((r) => now - r.ts < EXPIRY_MS && !invalidRefsRef.current.has(r.key)));
    setSongRows((prev) => prev.filter((r) => now - r.ts < EXPIRY_MS));
  }, [audio.suggestions, threshold, dismissedKeys, ctx.defaultTranslationCode]);

  // Ingest server-side song detections (Fly audio bridge) — a separate
  // source from the client-computed `audio.suggestions` above. Without this,
  // server detections were silently dropped since the panel only read
  // `suggestions`. Merged/deduped by songId via mergeSongRows.
  useEffect(() => {
    const now = Date.now();
    for (const s of audio.songSuggestions) {
      const row = songRowFromServerSuggestion(s);
      if (!row) continue;
      if (row.confidence < threshold) continue;
      if (dismissedKeys.has(`song:${row.key}`)) continue;
      setSongRows((prev) => mergeSongRows(prev, row));
    }
    setSongRows((prev) => prev.filter((r) => now - r.ts < EXPIRY_MS));
  }, [audio.songSuggestions, threshold, dismissedKeys]);

  // Also prune on tick.
  useEffect(() => {
    setBibleRows((prev) => prev.filter((r) => nowTick - r.ts < EXPIRY_MS));
    setSongRows((prev) => prev.filter((r) => nowTick - r.ts < EXPIRY_MS));
  }, [nowTick]);

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
        invalidRefsRef.current.add(row.key);
        setBibleRows((prev) => prev.filter((r) => r.key !== row.key));
        toast.error("Reference not found in DB");
        return;
      }
      dispatchInternal("presentflow:bible-goto", {
        book: row.book, chapter: row.chapter, verseStart: row.verseStart, verseEnd: row.verseEnd, live: false,
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
      ctx.onSendSlideToLive({ kind: "text", text: first.lyrics });
    } catch {
      toast.error("Send failed");
    } finally {
      sendSongLivePendingRef.current.delete(row.songId);
    }
  };

  const dismissBible = (key: string) => {
    setDismissedKeys((prev) => new Set(prev).add(`bible:${key}`));
    setBibleRows((prev) => prev.filter((r) => r.key !== key));
  };
  const dismissSong = (key: string) => {
    setDismissedKeys((prev) => new Set(prev).add(`song:${key}`));
    setSongRows((prev) => prev.filter((r) => r.key !== key));
  };

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
      <section className="px-2 py-2" data-testid="ai-detections-bible">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px]">📖</span>
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Bible Detections
          </span>
          {bibleRows.length > 0 && (
            <span className="ml-auto text-[9px] font-mono text-[var(--color-muted-foreground)]">
              {bibleRows.length}
            </span>
          )}
        </div>
        <div className="h-[200px] overflow-y-auto space-y-1 pr-0.5">
          {bibleRows.length === 0 ? (
            <div className="text-[10px] italic text-[var(--color-muted-foreground)] py-2 px-1">
              No Bible references detected yet. Speak a reference like &quot;John 3:16&quot; to see it here.
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
                  aria-label={`Bible detection ${row.book} ${row.chapter}:${row.verseStart}${row.verseEnd !== row.verseStart ? "-" + row.verseEnd : ""} at ${conf}% confidence — Enter to load, Shift+Enter to send live`}
                  onClick={() => loadBible(row)}
                  onDoubleClick={(e) => { e.preventDefault(); void sendBibleLive(row); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      if (e.shiftKey) void sendBibleLive(row);
                      else loadBible(row);
                    }
                  }}
                  className="group flex items-center gap-1.5 px-1.5 py-1 rounded bg-[var(--color-elevated)] hover:bg-[var(--color-elevated-hover,var(--color-elevated))] cursor-pointer border border-transparent hover:border-[var(--color-border)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                  data-testid={`bible-row-${row.key}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-semibold truncate">
                        {row.book} {row.chapter}:{row.verseStart}
                        {row.verseEnd !== row.verseStart ? `-${row.verseEnd}` : ""}
                      </span>
                      {passesAA && (
                        <span
                          aria-label="auto-approve"
                          className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0"
                        />
                      )}
                    </div>
                    {row.preview && (
                      <div className="text-[10px] text-[var(--color-muted-foreground)] truncate leading-tight">
                        {row.preview}…
                      </div>
                    )}
                    <div className="text-[9px] text-[var(--color-muted-foreground)]/70 leading-tight">
                      {relTime(row.ts, nowTick)}
                    </div>
                  </div>
                  <span className={cn("shrink-0 font-mono text-[9px] px-1 py-0.5 rounded border", confClass(conf))}>
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

      {/* Divider */}
      <div className="border-t border-[var(--color-border)]" />

      {/* Section B — Songs */}
      <section className="px-2 py-2" data-testid="ai-detections-songs">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px]">🎵</span>
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Song Detections
          </span>
          {songRows.length > 0 && (
            <span className="ml-auto text-[9px] font-mono text-[var(--color-muted-foreground)]">
              {songRows.length}
            </span>
          )}
        </div>
        <div className="h-[200px] overflow-y-auto space-y-1 pr-0.5">
          {songRows.length === 0 ? (
            <div className="text-[10px] italic text-[var(--color-muted-foreground)] py-2 px-1">
              No song matches yet. Say &quot;let&apos;s sing…&quot; or a lyric line to see matches here.
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
                  className="group flex items-center gap-1.5 px-1.5 py-1 rounded bg-[var(--color-elevated)] hover:bg-[var(--color-elevated-hover,var(--color-elevated))] cursor-pointer border border-transparent hover:border-[var(--color-border)]"
                  data-testid={`song-row-${row.key}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-semibold truncate">
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
                  <span className={cn("shrink-0 font-mono text-[9px] px-1 py-0.5 rounded border", confClass(conf))}>
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
    </div>
  );
}
