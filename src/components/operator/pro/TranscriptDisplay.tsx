"use client";
/**
 * TranscriptDisplay — Change 3 (revised 2026-07-30).
 *
 * Wraps the RICH live-transcript renderer (previously LiveTranscriptPanel)
 * in the fixed-height + resizable + minimizable chrome introduced in
 * Change 3. The wrapper owns:
 *   - fixed (non-growing) height, resizable via a bottom-edge drag handle
 *   - auto-scroll-to-bottom with pause-on-user-scroll and a
 *     "Jump to latest" pill to resume
 *   - custom warm-dark scrollbar (via the existing `.pf-transcript-scroll`
 *     CSS class in globals.css)
 *   - minimize/restore (collapses to a ~32px bar with the isCapturing dot)
 *   - session persistence (height + minimized) via localStorage
 *
 * Content rendering (yellow auto-correction spans + hover, orange
 * trigger-phrase highlights, mm:ss timestamps + hover, interim/final
 * distinction, Clear button, 30s window) is restored — the earlier
 * flat-string `text` prop lost all of that. Rendered inside the same
 * fixed-height scroll region so we keep the panel bounded.
 *
 * Minimizing does NOT unmount the source; the panel keeps consuming
 * `ctx.audio.*` and re-renders on restore with the current tail already
 * visible.
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  DEFAULT_TRANSCRIPT_DISPLAY_PREFS,
  MIN_TRANSCRIPT_HEIGHT_PX,
  readTranscriptDisplayPrefs,
  writeTranscriptDisplayPrefs,
} from "@/lib/transcriptDisplayPrefs";
import type { OperatorShellCtx } from "../shell/types";
import { useDebouncedInterim } from "./useDebouncedInterim";

type Props = {
  ctx: OperatorShellCtx;
};

// Threshold (px) for "considered at bottom". Scrolls within this margin
// of the bottom keep auto-scroll ON; anything above pauses it.
const AT_BOTTOM_THRESHOLD_PX = 20;
// Bar height when minimized. Matches the ~32px spec.
const MINIMIZED_BAR_HEIGHT_PX = 32;
// Max height as a fraction of the parent panel — enforced live during
// drag so a runaway drag can't push everything else off the sidebar.
const MAX_HEIGHT_PARENT_FRACTION = 0.6;

export function TranscriptDisplay({ ctx }: Props) {
  const audio = ctx.audio;

  // ── State ────────────────────────────────────────────────────────────
  // We start from defaults synchronously (SSR-safe), then hydrate from
  // localStorage in an effect. Prevents server/client mismatches when
  // this ever renders through Next SSR.
  const [heightPx, setHeightPx] = useState<number>(
    DEFAULT_TRANSCRIPT_DISPLAY_PREFS.heightPx,
  );
  const [minimized, setMinimized] = useState<boolean>(
    DEFAULT_TRANSCRIPT_DISPLAY_PREFS.minimized,
  );
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  // Clear button — hides everything transcribed before `clearedAt`
  // WITHOUT stopping the Deepgram pipeline. New utterances continue to
  // land. Local-only state so a page reload restores the full history.
  const [clearedAt, setClearedAt] = useState<number>(0);

  // ── Refs ─────────────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    startY: number;
    startHeight: number;
    pointerId: number | null;
  }>({ active: false, startY: 0, startHeight: 0, pointerId: null });
  // Prevent our own programmatic scrolls from being interpreted as a
  // user scroll-up (which would incorrectly pause auto-scroll).
  const programmaticScrollRef = useRef<boolean>(false);

  // ── Hydrate from localStorage on mount ───────────────────────────────
  useEffect(() => {
    const prefs = readTranscriptDisplayPrefs();
    setHeightPx(prefs.heightPx);
    setMinimized(prefs.minimized);
  }, []);

  // ── Persist changes to localStorage ──────────────────────────────────
  useEffect(() => {
    writeTranscriptDisplayPrefs({ heightPx, minimized });
  }, [heightPx, minimized]);

  // ── Content derivation (restored rich renderer inputs) ───────────────
  // 30-chunk / 30s window, gated by the Clear cutoff.
  const recent = audio.transcript.slice(-30).filter((t) => t.ts > clearedAt);
  const now = Date.now();
  const windowed = recent.filter((t) => now - t.ts < 30_000);
  // Debounce interim renders to ≥1 char + 90ms cadence — same setting as
  // the retired LiveTranscriptPanel (2026-07-24 tuning).
  const interim = useDebouncedInterim(audio.interim, 1, 90);
  const hasContent = windowed.length > 0 || !!interim;

  // Index detected trigger phrases by segmentId → matchedText[] for
  // inline orange highlighting inside their originating chunk.
  const triggersBySegment = new Map<string, string[]>();
  for (const s of audio.suggestions) {
    if (!s.segmentId || !s.matchedText) continue;
    const existing = triggersBySegment.get(s.segmentId) ?? [];
    existing.push(s.matchedText);
    triggersBySegment.set(s.segmentId, existing);
  }

  // mm:ss clock-time timestamp per chunk.
  const mmss = (ts: number): string => {
    const d = new Date(ts);
    return `${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  };

  // ── Auto-scroll to bottom when new transcript lands (if enabled) ─────
  // Depends on transcript array + interim + (indirectly) clearedAt via
  // `windowed.length`; using autoScroll/minimized/audio.transcript/interim
  // as the trigger set matches the retired panel and Change-3 wrapper.
  useLayoutEffect(() => {
    if (!autoScroll) return;
    if (minimized) return;
    const el = scrollRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    queueMicrotask(() => {
      programmaticScrollRef.current = false;
    });
  }, [audio.transcript, interim, autoScroll, minimized]);

  // On restoring from minimize, snap to bottom if auto-scroll is on.
  useLayoutEffect(() => {
    if (minimized) return;
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    queueMicrotask(() => {
      programmaticScrollRef.current = false;
    });
  }, [minimized, autoScroll]);

  // ── Scroll handler: pause/resume auto-scroll based on distance from
  //    the bottom. Programmatic scrolls skip the check. ────────────────
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (programmaticScrollRef.current) return;
    const el = e.currentTarget;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= AT_BOTTOM_THRESHOLD_PX;
    setAutoScroll((prev) => (prev === atBottom ? prev : atBottom));
  }, []);

  // ── Jump-to-latest pill click ────────────────────────────────────────
  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    setAutoScroll(true);
    queueMicrotask(() => {
      programmaticScrollRef.current = false;
    });
  }, []);

  // ── Drag-resize handlers (pointer events + pointer capture) ──────────
  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only left-button / primary pointer.
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers throw on non-capturable pointer types; ignore.
      }
      dragStateRef.current = {
        active: true,
        startY: e.clientY,
        startHeight: heightPx,
        pointerId: e.pointerId,
      };
    },
    [heightPx],
  );

  const computeMaxHeightPx = useCallback((): number => {
    // Cap to 60% of the parent (the right sidebar / column that hosts
    // this panel). We walk one node up from our root; fallback to the
    // viewport if that measurement isn't available.
    const root = rootRef.current;
    const parent = root?.parentElement;
    const parentH =
      parent?.getBoundingClientRect().height ??
      (typeof window !== "undefined" ? window.innerHeight : 800);
    return Math.max(MIN_TRANSCRIPT_HEIGHT_PX, Math.floor(parentH * MAX_HEIGHT_PARENT_FRACTION));
  }, []);

  const onResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const st = dragStateRef.current;
      if (!st.active) return;
      if (st.pointerId !== null && e.pointerId !== st.pointerId) return;
      const delta = e.clientY - st.startY;
      const maxH = computeMaxHeightPx();
      const next = Math.max(
        MIN_TRANSCRIPT_HEIGHT_PX,
        Math.min(maxH, st.startHeight + delta),
      );
      setHeightPx((prev) => (prev === next ? prev : next));
    },
    [computeMaxHeightPx],
  );

  const onResizePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const st = dragStateRef.current;
      if (!st.active) return;
      const target = e.currentTarget;
      try {
        if (st.pointerId !== null) target.releasePointerCapture(st.pointerId);
      } catch {
        // Ignore — capture may already be gone.
      }
      dragStateRef.current = {
        active: false,
        startY: 0,
        startHeight: 0,
        pointerId: null,
      };
      // heightPx is already persisted by the effect above; no extra work.
    },
    [],
  );

  // ── Minimize toggle ──────────────────────────────────────────────────
  const toggleMinimized = useCallback(() => {
    setMinimized((prev) => !prev);
  }, []);

  // Product rule: AI ON = red dot on, always (reconnect blips are silent).
  const isRecording = audio.listening;
  const isCapturing = audio.listening;

  // ── Minimized view: 32px bar with label + pulsing dot ────────────────
  if (minimized) {
    return (
      <div
        ref={rootRef}
        className="border-t border-[var(--color-border)]"
        data-testid="transcript-display"
        data-minimized="true"
      >
        <button
          type="button"
          onClick={toggleMinimized}
          className="flex w-full items-center gap-2 px-2 hover:bg-white/[0.03] transition-colors"
          style={{ height: MINIMIZED_BAR_HEIGHT_PX }}
          aria-label="Restore transcript panel"
          title="Restore transcript panel"
        >
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Transcription
          </span>
          {isCapturing && (
            <span
              aria-label="capturing"
              className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"
              style={{ animationDuration: "1.5s" }}
            />
          )}
          <ChevronDown
            size={12}
            className="ml-auto text-[var(--color-muted-foreground)]"
            aria-hidden="true"
          />
        </button>
      </div>
    );
  }

  // ── Full view ────────────────────────────────────────────────────────
  return (
    <div
      ref={rootRef}
      className="border-t border-[var(--color-border)] px-2 py-2"
      data-testid="transcript-display"
      data-minimized="false"
    >
      {/* Header — label + Clear + minimize chevron. */}
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
        <span className="h-px flex-1" style={{ background: "linear-gradient(90deg, var(--color-border), transparent)" }} aria-hidden />
        <button
          type="button"
          title="Clear visible transcript (does not stop AI listener)"
          aria-label="Clear transcript"
          onClick={() => setClearedAt(Date.now())}
          className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-1.5 py-0.5 rounded hover:bg-white/5"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={toggleMinimized}
          className="p-1 rounded text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-white/5 transition-colors"
          aria-label="Minimize transcript panel"
          title="Minimize transcript panel"
        >
          <ChevronUp size={12} aria-hidden="true" />
        </button>
      </div>

      {/* Fixed-height scroll region with smooth collapse transition. */}
      <div
        className="relative"
        style={{
          height: heightPx,
          transition: "height 200ms ease",
        }}
      >
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full w-full overflow-y-auto rounded bg-[var(--color-elevated)] border border-[var(--color-border)] px-2 py-1 text-[12px] leading-snug pf-transcript-scroll"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        >
          {!hasContent ? (
            <div className="text-[11px] italic text-[var(--color-muted-foreground)] py-1">
              {audio.listening ? "Listening…" : "Say something with AI Live on…"}
            </div>
          ) : (
            <>
              {windowed.map((t) => {
                const triggers = triggersBySegment.get(t.id) ?? [];
                return (
                  <div key={t.id} className="text-[var(--color-foreground)] break-words flex items-start gap-2">
                    {/* Yellow AUTO-CORRECTION spans win over orange trigger
                        highlights when both would apply on the same segment —
                        corrections carry more information (the actual fix)
                        so they claim rendering. */}
                    <span className="flex-1 min-w-0">
                    {t.corrections && t.corrections.length > 0 ? (
                      (() => {
                        const display = t.text;
                        const parts: { key: number; text: string; original: string | null }[] = [];
                        let keySeq = 0;
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
                    ) : triggers.length > 0 ? (
                      (() => {
                        const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                        const alternation = triggers.map(escapeRe).join("|");
                        const parts: { key: number; text: string; matched: boolean }[] = [];
                        let keySeq = 0;
                        if (!alternation) return t.text;
                        const re = new RegExp(`(${alternation})`, "gi");
                        let last = 0;
                        let m: RegExpExecArray | null;
                        while ((m = re.exec(t.text)) !== null) {
                          if (m.index > last) {
                            parts.push({ key: keySeq++, text: t.text.slice(last, m.index), matched: false });
                          }
                          parts.push({ key: keySeq++, text: m[0], matched: true });
                          last = m.index + m[0].length;
                        }
                        if (last < t.text.length) {
                          parts.push({ key: keySeq++, text: t.text.slice(last), matched: false });
                        }
                        return parts.map((p) => p.matched
                          ? <span
                              key={p.key}
                              className="rounded-sm px-0.5 font-semibold"
                              style={{ backgroundColor: "rgba(240, 132, 46, 0.25)", color: "#F0842E" }}
                              title="Detected trigger phrase"
                            >{p.text}</span>
                          : <span key={p.key}>{p.text}</span>
                        );
                      })()
                    ) : (
                      t.text
                    )}
                    </span>
                    <span
                      className="shrink-0 text-[10px] font-mono text-[var(--color-muted-foreground)] opacity-60 tabular-nums pt-0.5"
                      title={new Date(t.ts).toLocaleTimeString()}
                    >
                      {mmss(t.ts)}
                    </span>
                  </div>
                );
              })}
              {interim && (
                <div className="text-[var(--color-muted-foreground)] break-words opacity-70 flex items-start gap-2">
                  <span className="flex-1 min-w-0">{interim}</span>
                  <span className="shrink-0 text-[10px] font-mono opacity-40 tabular-nums pt-0.5">·</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Jump-to-latest pill — only when auto-scroll is paused. */}
        {!autoScroll && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-2 right-3 flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-elevated)]/95 backdrop-blur px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-elevated)] shadow-sm transition-colors"
            aria-label="Jump to latest transcript"
            title="Jump to latest transcript"
          >
            <ChevronDown size={11} aria-hidden="true" />
            Jump to latest
          </button>
        )}
      </div>

      {/* Drag-resize handle — bottom edge, 6px tall, grip cursor. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize transcript panel"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        className="mt-1 h-1.5 w-full cursor-row-resize rounded-full bg-[var(--color-border)]/40 hover:bg-[var(--color-border)] transition-colors"
        style={{ touchAction: "none" }}
      />
    </div>
  );
}
