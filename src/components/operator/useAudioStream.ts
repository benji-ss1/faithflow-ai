"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { detectAll, SuggestionDedupe, type DetectAllResult } from "@/lib/ai-detection";
import { buildIndex, type IndexedSong, type SongIndex } from "@/lib/ai-detection/lyric-fragment";
import type { SongMatchResult } from "@/lib/ai-detection/song-match";
import { matchCustomCommand, readCustomCommands, readAudioInputPref, audioConstraintsFor } from "@/lib/voice-commands";
import { dispatchInternal } from "@/lib/internal-events";
import { CONFIDENCE_THRESHOLD } from "@/lib/audio-thresholds";

export type Detection = {
  id: string;
  segmentId: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  confidence: number;
  matchedText: string;
};

export type SongSuggestion = {
  suggestionId: string;
  segmentId: string;
  songId: string | null;
  title: string;
  confidence: number;
  matchedText: string;
};

export type ContextCommand = {
  verb: "next_verse" | "prev_verse" | "continue" | "back";
  segmentId: string;
  confidence: number;
  matchedText: string;
};

export type CommandSuggestion = {
  suggestionId: string;
  segmentId: string;
  verb: "next_slide" | "prev_slide" | "blank" | "logo" | "clear_live" | "show_reference" | "show_song";
  payload: Record<string, unknown>;
  confidence: number;
  matchedText: string;
};

export type TranscriptChunk = { id: string; text: string; final: boolean; ts: number; words?: { w: string; c: number; s?: number; e?: number }[] };

/**
 * Unified suggestion — Phase 5A. Runs client-side on every transcript
 * finalization. Lives alongside detections/songSuggestions/commandSuggestions
 * so existing UI flows keep working.
 */
/** R1: char offsets of matchedText within the source transcript segment.
 *  Populated at detection time so the autopilot gate can map low-conf words
 *  by (segmentId, [start,end]) instead of naive substring includes(). */
export type MatchedSpan = { start: number; end: number };
export type UnifiedSuggestion =
  | { id: string; type: "scripture"; segmentId: string; ts: number; confidence: number; matchedText: string; matchedSpan?: MatchedSpan; ref: { book: string; chapter: number; verseStart: number; verseEnd: number } }
  | { id: string; type: "song"; segmentId: string; ts: number; confidence: number; matchedText: string; matchedSpan?: MatchedSpan; match: SongMatchResult }
  | { id: string; type: "lyric"; segmentId: string; ts: number; confidence: number; matchedText: string; matchedSpan?: MatchedSpan; match: SongMatchResult }
  | { id: string; type: "section"; segmentId: string; ts: number; confidence: number; matchedText: string; matchedSpan?: MatchedSpan; section: "chorus" | "verse" | "bridge" | "outro" | "tag"; index?: number };

export type PipelineStage =
  | "idle"                    // not started
  | "requesting_ticket"       // POST /api/audio/ticket
  | "ticket_ok"               // ticket received
  | "opening_ws"              // new WebSocket
  | "ws_open"                 // WS onopen fired
  | "requesting_mic"          // getUserMedia() called
  | "mic_granted"             // getUserMedia() resolved
  | "audioctx_ready"          // AudioContext created + resumed
  | "worklet_loaded"          // AudioWorklet module added
  | "worklet_connected"       // worklet node connected to graph
  | "deepgram_ready"          // server sent { type: "ready" }
  | "first_chunk_sent"        // first audio chunk sent over WS
  | "receiving_interim"       // first interim transcript received
  | "receiving_final"         // first final transcript received
  | "paused";                 // auto-paused after prolonged silence

export type AudioStreamState = {
  listening: boolean;
  ready: boolean;
  error: string | null;
  transcript: TranscriptChunk[];
  interim: string;
  detections: Detection[];
  songSuggestions: SongSuggestion[];
  commandSuggestions: CommandSuggestion[];
  suggestions: UnifiedSuggestion[]; // Phase 5A unified layer
  stage: PipelineStage;
  stageHistory: { stage: PipelineStage; ts: number }[];
  chunksSent: number;
  dgMessagesReceived: number;
  // Reconnect surfacing (Task 5): true after >8 backoff attempts fail. Client
  // shell renders a persistent banner + a Retry Now button that flips this
  // back to false via manual restart.
  reconnectFailed: boolean;
  reconnectAttempts: number;
  // Warm-start (Task 9): WS is open but mic is not flowing.
  warmStarted: boolean;
  // RMS silence gate (Task 13).
  silenceGateClosed: boolean;
  // Observability (Task 15).
  msgsPerSec: number;
  lastLatencyMs: number | null;
  avgConfidence: number;
};

/**
 * Client-side mic capture → WebSocket bridge to Deepgram.
 * Captures 16kHz linear16 PCM via AudioWorklet + downsampling.
 */
export type DetectContextProvider = () => {
  churchId: string;
  planId?: string;
  planSongIds?: string[];
  recentSongIds?: string[];
  hasVerseContext: boolean;
  hasSlideContext: boolean;
  hasSongContext: boolean;
};

export function useAudioStream(planId: string, opts?: { library?: IndexedSong[]; getDetectContext?: DetectContextProvider }) {
  const [state, setState] = useState<AudioStreamState>({
    listening: false, ready: false, error: null, transcript: [], interim: "",
    detections: [], songSuggestions: [], commandSuggestions: [], suggestions: [],
    stage: "idle", stageHistory: [], chunksSent: 0, dgMessagesReceived: 0,
    reconnectFailed: false, reconnectAttempts: 0, warmStarted: false,
    silenceGateClosed: false, msgsPerSec: 0, lastLatencyMs: null, avgConfidence: 0,
  });

  // Dedupe primitive: 30s cooldown per (type, key), refresh on +10 confidence.
  const dedupeRef = useRef(new SuggestionDedupe(30_000));
  const libraryRef = useRef<IndexedSong[]>(opts?.library || []);
  // Perf #1: prebuild the trigram song index ONCE per library change and
  // reuse it across every detection call, instead of rebuilding per detection
  // inside matchSongCue. On a 200-song library this drops per-detection cost
  // from ~40-80ms to <5ms of set intersection.
  const songIndexRef = useRef<SongIndex | null>(
    opts?.library && opts.library.length ? buildIndex(opts.library) : null,
  );
  // Prefetched slides cache: songId -> slide payloads. Populated eagerly
  // when we detect a song, so the operator's click on the chip lands in a
  // hot cache.
  const slidePrefetchRef = useRef<Map<string, unknown>>(new Map());
  const inFlightSlideFetchRef = useRef<Set<string>>(new Set());
  const getCtxRef = useRef<DetectContextProvider | undefined>(opts?.getDetectContext);
  useEffect(() => {
    libraryRef.current = opts?.library || [];
    songIndexRef.current = libraryRef.current.length ? buildIndex(libraryRef.current) : null;
  }, [opts?.library]);
  useEffect(() => { getCtxRef.current = opts?.getDetectContext; }, [opts?.getDetectContext]);

  // Dev-or-trace log gate: quiet in packaged prod builds unless the operator
  // explicitly opts in via localStorage. Hoisted above runDetectAll so the
  // detection-confidence log (R1) can reference it.
  const isDevOrTraceOn = useCallback((): boolean => {
    try {
      if (process.env.NODE_ENV !== "production") return true;
      if (typeof localStorage !== "undefined") {
        const raw = localStorage.getItem("presentflow.aiTrace");
        if (!raw) return false;
        try {
          const parsed = JSON.parse(raw) as { value?: string; exp?: number };
          if (parsed && typeof parsed === "object" && "value" in parsed) {
            if (typeof parsed.exp === "number" && Date.now() > parsed.exp) {
              try { localStorage.removeItem("presentflow.aiTrace"); } catch { /* ignore */ }
              return false;
            }
            return parsed.value === "1";
          }
        } catch { /* legacy plain "1" fallthrough */ }
        return raw === "1";
      }
    } catch { /* ignore */ }
    return false;
  }, []);

  // Prefetch slides for a detected song. Fire-and-forget; caches by songId so
  // an operator click on the chip resolves from memory instead of round-tripping.
  // Y9: LRU cap at 50 entries so a long service can't grow the cache unbounded.
  const SLIDE_PREFETCH_CAP = 50;
  const prefetchSongSlides = useCallback((songId: string) => {
    if (!songId) return;
    if (slidePrefetchRef.current.has(songId)) return;
    if (inFlightSlideFetchRef.current.has(songId)) return;
    inFlightSlideFetchRef.current.add(songId);
    fetch(`/api/songs/${encodeURIComponent(songId)}/slides`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json) return;
        // Y9: evict oldest when at cap. Map iteration order = insertion order.
        while (slidePrefetchRef.current.size >= SLIDE_PREFETCH_CAP) {
          const oldest = slidePrefetchRef.current.keys().next().value;
          if (oldest === undefined) break;
          slidePrefetchRef.current.delete(oldest);
        }
        slidePrefetchRef.current.set(songId, json);
      })
      .catch(() => { /* non-fatal; a later click will fetch */ })
      .finally(() => { inFlightSlideFetchRef.current.delete(songId); });
  }, []);

  const runDetectAll = useCallback(async (segmentId: string, text: string, opts?: { dgConfidence?: number }) => {
    const provider = getCtxRef.current;
    const base = provider ? provider() : { churchId: "", hasVerseContext: false, hasSlideContext: false, hasSongContext: false };
    // R6/R10: capture generation to abort stale detections after restart.
    const capturedGeneration = pipelineGenerationRef.current;
    let result: DetectAllResult;
    try {
      result = await detectAll(text, { ...base, library: libraryRef.current, prebuiltIndex: songIndexRef.current ?? undefined });
    } catch (e) {
      console.warn("[presentflow-detect] detectAll failed", e);
      return;
    }
    const ts = Date.now();
    const newSuggestions: UnifiedSuggestion[] = [];
    // R1: compute char offset for matchedText within source text.
    const spanFor = (matchedText: string): MatchedSpan | undefined => {
      if (!matchedText) return undefined;
      const idx = text.toLowerCase().indexOf(matchedText.toLowerCase());
      if (idx < 0) return undefined;
      return { start: idx, end: idx + matchedText.length };
    };

    const push = (s: UnifiedSuggestion, key: string) => {
      const decision = dedupeRef.current.shouldEmit(s.type, key, s.confidence, ts);
      if (decision === "suppress") return;
      newSuggestions.push(s);
      // "refresh" is handled by the reducer below (replace-in-place)
      (s as UnifiedSuggestion & { _refresh?: boolean })._refresh = decision === "refresh";
    };

    // Blend parser confidence (0-100) with Deepgram utterance confidence (0-1)
    // using a floor formula so well-formed refs still surface as ≥90%.
    //   final = min(100, round(parser * dgConf) + boost)
    // boost: +10 for well-formed patterns (colon "John 3:16" style),
    //        +5 additional if a real multi-verse range is detected.
    // Missing dgConf → treat as 1.0 (parser-only). A shaky utterance can lower
    // but the boost still lifts obvious refs into auto-approve territory.
    const blendScripture = (r: { confidence: number; matchedText: string; verseStart: number; verseEnd: number }): number => {
      const dg = opts?.dgConfidence;
      const parserConf = r.confidence;
      const dgConf = typeof dg === "number" && dg > 0 && dg <= 1 ? dg : 1;
      const wellFormed = /\d+\s*:\s*\d+/.test(r.matchedText);
      // Y2: cap the boost so a garbage range ("John 3:16-99") can never leap
      // past parserConf by more than 10. Combined with Y6 chapter validation
      // in bible-parser, this keeps false positives well below auto-fire.
      // Confidence floor: if Deepgram utterance confidence is below the
      // canonical CONFIDENCE_THRESHOLD, drop the boost entirely — a shaky
      // transcript shouldn't ride the well-formed pattern into auto-approve.
      const belowFloor = typeof dg === "number" && dg < CONFIDENCE_THRESHOLD;
      const rawBoost = belowFloor ? 0 : ((wellFormed ? 10 : 0) + (r.verseEnd > r.verseStart ? 5 : 0));
      const boost = Math.min(rawBoost, 10);
      const base = Math.round(parserConf * dgConf);
      const final = Math.max(1, Math.min(100, Math.min(base + boost, parserConf + 10)));
      // R1: gate behind PF_AI_TRACE — leaks pastoral content in prod otherwise.
      if (isDevOrTraceOn()) {
        console.log("[detection-confidence]", r.matchedText, { parserConf, dgConf, boost, final });
      }
      return final;
    };

    for (const r of result.scripture) {
      const id = `sc-${segmentId}-${r.book}-${r.chapter}-${r.verseStart}-${r.verseEnd}`;
      const key = `${r.book} ${r.chapter}:${r.verseStart}-${r.verseEnd}`;
      const conf = blendScripture(r);
      push({ id, type: "scripture", segmentId, ts, confidence: conf, matchedText: r.matchedText, matchedSpan: spanFor(r.matchedText), ref: { book: r.book, chapter: r.chapter, verseStart: r.verseStart, verseEnd: r.verseEnd } }, key);
    }
    for (const m of result.song) {
      const id = `sg-${segmentId}-${m.songId}`;
      const mt = m.matchedLine || m.title;
      push({ id, type: "song", segmentId, ts, confidence: m.confidence, matchedText: mt, matchedSpan: spanFor(mt), match: m }, m.songId);
      prefetchSongSlides(m.songId);
    }
    for (const m of result.lyric) {
      const id = `ly-${segmentId}-${m.songId}`;
      const mt = m.matchedLine || m.title;
      push({ id, type: "lyric", segmentId, ts, confidence: m.confidence, matchedText: mt, matchedSpan: spanFor(mt), match: m }, `lyric:${m.songId}`);
      prefetchSongSlides(m.songId);
    }
    for (const s of result.section) {
      const id = `se-${segmentId}-${s.section}-${s.index ?? "x"}`;
      const key = `${s.section}:${s.index ?? ""}`;
      push({ id, type: "section", segmentId, ts, confidence: s.confidence, matchedText: s.matchedText, matchedSpan: spanFor(s.matchedText), section: s.section, index: s.index }, key);
    }

    if (newSuggestions.length === 0) return;
    setState((prev) => {
      // R10: stale detection guard — drop if generation flipped mid-flight.
      if (capturedGeneration !== pipelineGenerationRef.current) return prev;
      const merged = [...prev.suggestions];
      for (const n of newSuggestions) {
        const refresh = (n as UnifiedSuggestion & { _refresh?: boolean })._refresh;
        // Same-key updater
        const keyOf = (x: UnifiedSuggestion) => {
          if (x.type === "scripture") return `scripture:${x.ref.book} ${x.ref.chapter}:${x.ref.verseStart}-${x.ref.verseEnd}`;
          if (x.type === "song") return `song:${x.match.songId}`;
          if (x.type === "lyric") return `lyric:${x.match.songId}`;
          return `section:${x.section}:${x.index ?? ""}`;
        };
        const nk = keyOf(n);
        const existingIdx = merged.findIndex((m) => keyOf(m) === nk);
        if (refresh && existingIdx >= 0) merged[existingIdx] = n;
        else if (existingIdx >= 0) merged[existingIdx] = n; // update in place
        else merged.unshift(n);
      }
      return { ...prev, suggestions: merged.slice(0, 40) };
    });
  }, [isDevOrTraceOn, prefetchSongSlides]);

  const setStage = useCallback((stage: PipelineStage) => {
    setState((s) => ({
      ...s,
      stage,
      stageHistory: [...s.stageHistory, { stage, ts: Date.now() }].slice(-30),
    }));
  }, []);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  // Task 4: 5-second PCM ring buffer used while the WS is closed to backfill
  // on reconnect. 16kHz * 2 bytes/sample * 5s = 160,000 bytes cap.
  const RING_CAP_BYTES = 160_000;
  const ringBufferRef = useRef<Uint8Array[]>([]);
  const ringBufferBytesRef = useRef<number>(0);
  // Task 13 / R8: RMS silence gate state with hysteresis + lookback ring.
  const silenceStartRef = useRef<number | null>(null);
  const silenceClosedRef = useRef<boolean>(false);
  // R8: hysteresis — close at -60 dBFS, reopen at -55.
  const SILENCE_CLOSE_DBFS = -60;
  const SILENCE_OPEN_DBFS = -55;
  const SILENCE_HOLD_MS = 4000; // R8: extend from 2s to 4s for preacher pauses
  // R8: 200ms lookback ring. Even while the gate is CLOSED we keep the most
  // recent ~200ms of PCM around so that on reopen we flush the leading edge —
  // otherwise the first word of resumed speech is truncated at Deepgram.
  const LOOKBACK_CAP_BYTES = Math.round(0.2 * 16000 * 2); // 200ms
  const lookbackRingRef = useRef<Uint8Array[]>([]);
  const lookbackBytesRef = useRef<number>(0);
  // Task 14/15: session metrics.
  const sessionStartRef = useRef<number>(0);
  const reconnectsCountRef = useRef<number>(0);
  const wordsHighRef = useRef<number>(0);
  const wordsLowRef = useRef<number>(0);
  const confSumRef = useRef<number>(0);
  const confCountRef = useRef<number>(0);
  const msgTimestampsRef = useRef<number[]>([]);
  const firstChunkAtRef = useRef<number | null>(null);
  // Task 9: warm-start — mic muted flag.
  const micMutedRef = useRef<boolean>(false);
  // R9: keep-alive silence pings (256 bytes of silence PCM16) every 5s while
  // warm-muted, so Deepgram doesn't close the idle connection before the
  // operator actually starts speaking.
  const keepAliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startKeepAlive = useCallback(() => {
    if (keepAliveTimerRef.current) return;
    keepAliveTimerRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!micMutedRef.current && !silenceClosedRef.current) return; // audio flowing, no need
      try {
        // 256 bytes = 128 samples PCM16 mono = 8ms at 16kHz. Silence.
        const silence = new Uint8Array(256);
        let bin = "";
        for (let i = 0; i < silence.length; i++) bin += String.fromCharCode(silence[i]);
        const b64 = btoa(bin);
        ws.send(JSON.stringify({ type: "audio", b64 }));
      } catch { /* ignore */ }
    }, 5000);
  }, []);
  const stopKeepAlive = useCallback(() => {
    if (keepAliveTimerRef.current) { clearInterval(keepAliveTimerRef.current); keepAliveTimerRef.current = null; }
  }, []);
  // R11: recent detection-text dedupe. Map<normalizedText, tsMs>. 800ms window.
  const recentDetectionTextsRef = useRef<Map<string, number>>(new Map());
  const RECENT_DETECT_WINDOW_MS = 800;
  const shouldSkipRedetect = (text: string): boolean => {
    const now = Date.now();
    const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (!norm) return false;
    // Prune stale entries.
    for (const [k, ts] of recentDetectionTextsRef.current) {
      if (now - ts > RECENT_DETECT_WINDOW_MS) recentDetectionTextsRef.current.delete(k);
    }
    // Match: text is contained in a recent entry OR a recent entry is contained in text.
    for (const [k] of recentDetectionTextsRef.current) {
      if (k === norm || k.includes(norm) || norm.includes(k)) return true;
    }
    recentDetectionTextsRef.current.set(norm, now);
    // Cap size.
    if (recentDetectionTextsRef.current.size > 50) {
      const oldestKey = recentDetectionTextsRef.current.keys().next().value;
      if (oldestKey !== undefined) recentDetectionTextsRef.current.delete(oldestKey);
    }
    return false;
  };
  // R6/R10: monotonic pipeline generation. Every start() bumps this and
  // every async callback captures it at spawn time. When completion runs and
  // the current generation has advanced, the callback aborts (stale).
  const pipelineGenerationRef = useRef(0);
  // R3: client-generated session UUID for dedupe on the metrics endpoint.
  // Fresh on every start() (not restart(), which continues the same session).
  const sessionIdRef = useRef<string | null>(null);
  // Y8: split reconnect attempt scheduling from actual successful reconnects.
  const reconnectSuccessesRef = useRef(0);
  // Y12: last known metric-flush failure info for the localStorage retry queue.
  const METRICS_RETRY_KEY = "presentflow.metrics.retryQueue.v1";
  // Auto-reconnect bookkeeping. `intentionalStopRef` distinguishes an
  // operator-initiated stop (never reconnect) from an abnormal WS close
  // (Fly bridge blip, transient network drop). `reconnectTimerRef` lets
  // us cancel a pending retry when the operator flips OFF mid-backoff.
  const intentionalStopRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<() => Promise<void>>(async () => {});
  // Auto-pause: track when the last transcript arrived and check periodically.
  // If no transcript for AUTO_PAUSE_MS while listening, transition to paused
  // and close the WS to save Deepgram cost.
  const AUTO_PAUSE_MS = 10 * 60 * 1000; // 10 minutes
  const lastTranscriptAtRef = useRef<number>(Date.now());
  const autoPauseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAutoPauseEnabled = useCallback((): boolean => {
    try {
      if (typeof localStorage === "undefined") return true;
      const raw = localStorage.getItem("presentflow.pro.autoPause.enabled");
      return raw !== "0"; // default true
    } catch { return true; }
  }, []);

  const teardown = useCallback(() => {
    if (stallWatchdogRef.current) { clearTimeout(stallWatchdogRef.current); stallWatchdogRef.current = null; }
    if (keepAliveTimerRef.current) { clearInterval(keepAliveTimerRef.current); keepAliveTimerRef.current = null; }
    try { workletNodeRef.current?.port?.close?.(); } catch { /* ignore */ }
    try { workletNodeRef.current?.disconnect(); } catch { /* ignore */ }
    workletNodeRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => { t.stop(); t.enabled = false; }); } catch { /* ignore */ }
    streamRef.current = null;
    try { wsRef.current?.send(JSON.stringify({ type: "stop" })); } catch { /* ignore */ }
    try { wsRef.current?.close(1000, "teardown"); } catch { /* ignore */ }
    wsRef.current = null;
    try { audioCtxRef.current?.suspend(); } catch { /* ignore */ }
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
  }, []);

  // Task 14: fire-and-forget metrics POST on session finalize.
  const flushSessionMetrics = useCallback(() => {
    const startedAt = sessionStartRef.current;
    if (!startedAt) return;
    const endedAt = Date.now();
    const durationSec = Math.max(0, Math.round((endedAt - startedAt) / 1000));
    const reconnects = reconnectsCountRef.current;
    const wordsHigh = wordsHighRef.current;
    const wordsLow = wordsLowRef.current;
    const avgConfidence = confCountRef.current > 0
      ? Math.round((confSumRef.current / confCountRef.current) * 100) / 100
      : 0;
    console.log(
      `[audio-session] planId=${planId} duration=${durationSec}s reconnects=${reconnects} avgConfidence=${avgConfidence.toFixed(2)} wordsHigh=${wordsHigh} wordsLow=${wordsLow}`,
    );
    const sessionId = sessionIdRef.current;
    try {
      const payload = { sessionId, planId, durationSec, reconnects, avgConfidence, wordsHigh, wordsLow, startedAt, endedAt };
      const body = JSON.stringify(payload);
      fetch("/api/audio/session-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).then((r) => {
        if (!r.ok) {
          // Y12: enqueue for retry — bounded to 10 entries.
          try {
            const raw = localStorage.getItem(METRICS_RETRY_KEY);
            const arr: unknown[] = raw ? JSON.parse(raw) : [];
            arr.push(payload);
            while (arr.length > 10) arr.shift();
            localStorage.setItem(METRICS_RETRY_KEY, JSON.stringify(arr));
          } catch { /* ignore */ }
          console.warn(`[audio-session] metrics POST failed status=${r.status}`);
        }
      }).catch((err) => {
        try {
          const raw = localStorage.getItem(METRICS_RETRY_KEY);
          const arr: unknown[] = raw ? JSON.parse(raw) : [];
          arr.push(payload);
          while (arr.length > 10) arr.shift();
          localStorage.setItem(METRICS_RETRY_KEY, JSON.stringify(arr));
        } catch { /* ignore */ }
        console.warn("[audio-session] metrics POST failed:", err instanceof Error ? err.message : err);
      });
    } catch { /* ignore */ }
    // Reset counters.
    sessionStartRef.current = 0;
    reconnectsCountRef.current = 0;
    reconnectSuccessesRef.current = 0;
    wordsHighRef.current = 0;
    wordsLowRef.current = 0;
    confSumRef.current = 0;
    confCountRef.current = 0;
    firstChunkAtRef.current = null;
    sessionIdRef.current = null;
  }, [planId]);

  const stop = useCallback(() => {
    if (isDevOrTraceOn()) console.log("[presentflow-audio] stop() called — hard-stopping pipeline");
    intentionalStopRef.current = true;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    reconnectAttemptsRef.current = 0;
    // Task 4: drop any buffered PCM — a hard stop discards backlog.
    ringBufferRef.current = [];
    ringBufferBytesRef.current = 0;
    flushSessionMetrics();
    teardown();
    setState((s) => ({ ...s, listening: false, ready: false, interim: "", stage: "idle", reconnectFailed: false, reconnectAttempts: 0, warmStarted: false, silenceGateClosed: false }));
  }, [teardown, flushSessionMetrics]);

  const scheduleReconnect = useCallback(() => {
    if (intentionalStopRef.current) return;
    const attempt = ++reconnectAttemptsRef.current;
    reconnectsCountRef.current += 1;
    setState((s) => ({ ...s, reconnectAttempts: attempt }));
    if (attempt > 8) {
      if (isDevOrTraceOn()) console.warn("[presentflow-audio] auto-reconnect gave up after 8 attempts");
      setState((s) => ({ ...s, reconnectFailed: true, error: null }));
      return;
    }
    // Task 3: exponential backoff, base=500ms, cap=8s, +up to 500ms jitter.
    // Attempts 1..8 → 500, 1000, 2000, 4000, 8000, 8000, 8000, 8000 (+jitter).
    const base = Math.min(500 * Math.pow(2, attempt - 1), 8_000);
    const delay = base + Math.floor(Math.random() * 500);
    if (isDevOrTraceOn()) console.log(`[presentflow-audio] scheduling reconnect attempt ${attempt} in ${delay}ms`);
    // Don't set a user-facing error string during the transient reconnect
    // loop — the AI Live pill already carries the "connecting…" state and
    // the operator doesn't need a red banner for every Fly hiccup. Keep the
    // console log for debugging; only the exhaustion case (>8 attempts,
    // handled above) surfaces a real error.
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      // Tear the old pipeline down before starting fresh — mic tracks and
      // AudioContext can leak otherwise.
      teardown();
      startRef.current().catch((e) => { if (isDevOrTraceOn()) console.warn("[presentflow-audio] reconnect start failed", e); });
    }, delay);
  }, [teardown, isDevOrTraceOn]);

  const start = useCallback(async () => {
    // R6: reentry guard — if we're mid-init, don't spawn a duplicate pipeline.
    // Check the LATEST committed state via a ref check on wsRef, which is set
    // synchronously below.
    // (Fine-grained state check happens against pipelineGenerationRef.)
    intentionalStopRef.current = false;
    // R6: bump generation. Every async callback captures this synchronously.
    const generation = ++pipelineGenerationRef.current;
    lastTranscriptAtRef.current = Date.now();
    // Y7: only open a metrics session when mic is actually going to send audio.
    // Warm-start opens WS with mic muted → don't accumulate a 0-metrics
    // session that pollutes the audio_sessions rollup. sessionStart is opened
    // lazily below on first unmuted chunk instead.
    // R3: fresh session UUID per new start(). restart() and warmStart() reuse.
    if (!sessionIdRef.current) {
      try {
        sessionIdRef.current = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      } catch {
        sessionIdRef.current = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
    }
    // Y7: honor pre-set mute (warmStart flips before calling start()).
    if (!micMutedRef.current) {
      setState((s) => ({ ...s, warmStarted: false }));
    }
    setState((s) => ({ ...s, error: null, stage: "idle", stageHistory: [], chunksSent: 0, dgMessagesReceived: 0 }));
    // PF_AI_TRACE gate: dev + localStorage("presentflow.aiTrace","1") enable numbered logs.
    // Off in prod unless explicitly opted in so the demo console stays quiet.
    const aiTraceOn = isDevOrTraceOn();
    const log = (stage: string, extra?: unknown) => {
      if (!aiTraceOn) return;
      console.log(`[ai-pipeline] ${stage}`, extra ?? "");
    };
    // Y1: Stall watchdog. If we never reach deepgram_ready within 15s, treat
    // it as a failed init and tear down. Cleared on deepgram_ready message.
    if (stallWatchdogRef.current) clearTimeout(stallWatchdogRef.current);
    stallWatchdogRef.current = setTimeout(() => {
      stallWatchdogRef.current = null;
      setState((s) => {
        if (s.stage === "deepgram_ready" || s.stage === "receiving_interim" || s.stage === "receiving_final") return s;
        return { ...s, error: "AI failed to initialise" };
      });
      // Kick a reconnect attempt if this wasn't an intentional stop, else stop.
      if (!intentionalStopRef.current) scheduleReconnect();
      else stop();
    }, 15_000);
    try {
      setStage("requesting_ticket"); log("1 requesting ticket");
      const ticketRes = await fetch("/api/audio/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      // R7: session-expiry surfacing. A 401 here means the operator's session
      // silently expired mid-service — without this branch the AI Live pill
      // shows connecting forever with no explanation.
      if (ticketRes.status === 401) {
        throw new Error("AI listener needs re-auth — sign in again to resume");
      }
      const ticket = await ticketRes.json();
      if (!ticket.url) throw new Error(ticket.error || "Ticket endpoint returned no URL");
      // R6: ticket returned but a newer start() superseded us — abort quietly.
      if (generation !== pipelineGenerationRef.current) return;
      setStage("ticket_ok"); log("2 ticket ok", ticket.url);

      setStage("opening_ws");
      const ws = new WebSocket(ticket.url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        // R6: stale-generation abort — a newer start() has superseded us.
        if (generation !== pipelineGenerationRef.current) {
          try { ws.close(1000, "superseded"); } catch { /* ignore */ }
          return;
        }
        setStage("ws_open"); log("3 WS open");
        // Y8: count successful open (post-first) as a reconnect success.
        if (reconnectAttemptsRef.current > 0) reconnectSuccessesRef.current += 1;
        // Fresh connection stable — reset backoff so a later drop starts at attempt 1.
        reconnectAttemptsRef.current = 0;
        setState((s) => ({ ...s, error: null, reconnectFailed: false, reconnectAttempts: 0 }));
        // R9: fire up keep-alive so warm-muted sessions don't get idled out.
        startKeepAlive();
        // Task 4: flush the ring buffer of PCM captured while WS was closed.
        // Chunks are queued in arrival order; drained oldest-first before
        // live audio resumes so the transcript catches up.
        const buffered = ringBufferRef.current;
        if (buffered.length > 0) {
          const bytes = ringBufferBytesRef.current;
          const ms = Math.round((bytes / 2 / 16_000) * 1000);
          console.log(`[audio-buffer] retained ${ms} ms during reconnect`);
          for (const chunk of buffered) {
            try {
              let bin = "";
              for (let i = 0; i < chunk.length; i++) bin += String.fromCharCode(chunk[i]);
              const b64 = btoa(bin);
              ws.send(JSON.stringify({ type: "audio", b64 }));
            } catch { /* drop on error */ break; }
          }
          ringBufferRef.current = [];
          ringBufferBytesRef.current = 0;
        }
      };

      ws.onmessage = (e) => {
        // Y13: guard JSON.parse — a corrupt/oversized frame shouldn't kill the pipeline.
        // Match the pre-existing typing (implicit any from JSON.parse) so downstream
        // property reads keep their previous shape.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let msg: any;
        try {
          msg = JSON.parse(e.data);
        } catch (err) {
          console.warn("[presentflow-audio] malformed WS message", err instanceof Error ? err.message : err);
          return;
        }
        // Task 15: msg/sec rolling window (5s) + first-transcript latency.
        const now = Date.now();
        msgTimestampsRef.current.push(now);
        while (msgTimestampsRef.current.length && now - msgTimestampsRef.current[0] > 5000) {
          msgTimestampsRef.current.shift();
        }
        const rate = Math.round(msgTimestampsRef.current.length / 5);
        let lat: number | null = null;
        if ((msg.type === "interim" || msg.type === "final") && firstChunkAtRef.current) {
          lat = now - firstChunkAtRef.current;
          firstChunkAtRef.current = null;
        }
        setState((s) => ({ ...s, dgMessagesReceived: s.dgMessagesReceived + 1, msgsPerSec: rate, lastLatencyMs: lat ?? s.lastLatencyMs }));
        // Task 10/11: track word-level confidence buckets for autopilot gating.
        if ((msg.type === "final" || msg.type === "interim_final_candidate") && Array.isArray(msg.words)) {
          for (const w of msg.words as { w?: string; c?: number }[]) {
            if (typeof w?.c !== "number") continue;
            if (w.c >= CONFIDENCE_THRESHOLD) wordsHighRef.current += 1;
            else wordsLowRef.current += 1;
          }
        }
        if (msg.type === "final" && typeof msg.confidence === "number") {
          confSumRef.current += msg.confidence;
          confCountRef.current += 1;
          const avg = confSumRef.current / confCountRef.current;
          setState((s) => ({ ...s, avgConfidence: Math.round(avg * 100) / 100 }));
        }
        if (msg.type === "ready") {
          if (stallWatchdogRef.current) { clearTimeout(stallWatchdogRef.current); stallWatchdogRef.current = null; }
          setStage("deepgram_ready"); log("5 deepgram ready"); setState((s) => ({ ...s, ready: true })); return;
        }
        if (msg.type === "interim") { setStage("receiving_interim"); log("7 interim", msg.text); }
        if (msg.type === "final") { setStage("receiving_final"); log("8 final", msg.text); }
        if (msg.type === "detection" || msg.type === "song" || msg.type === "command") log(`9 ${msg.type}`);
        if (msg.type === "ready") setState((s) => ({ ...s, ready: true }));
        else if (msg.type === "interim") { lastTranscriptAtRef.current = Date.now(); setState((s) => ({ ...s, interim: msg.text })); }
        else if (msg.type === "interim_final_candidate") {
          // Perf fix #2E: run detection on a high-confidence, sufficiently-
          // long interim so verse cards can render 1-2s earlier than the
          // final transcript would normally allow. Client-side dedupe
          // (SuggestionDedupe by reference key) prevents a duplicate card
          // when the same reference lands again in the eventual "final".
          //
          // Perf #1: schedule via microtask (queueMicrotask) instead of
          // setTimeout(0) so detection runs immediately after the WS
          // message handler yields, keeping interim→chip latency <200ms.
          const segmentId = `interim-${Date.now()}`;
          const text: string = msg.text;
          const dgConfidence = msg.confidence;
          // R11: dedupe candidate-vs-final within 800ms.
          if (!shouldSkipRedetect(text)) {
            queueMicrotask(() => { runDetectAll(segmentId, text, { dgConfidence }); });
          }
        }
        else if (msg.type === "final") {
          lastTranscriptAtRef.current = Date.now();
          const words = Array.isArray(msg.words) ? msg.words as { w: string; c: number }[] : undefined;
          setState((s) => ({
            ...s,
            interim: "",
            transcript: [...s.transcript, { id: msg.segmentId, text: msg.text, final: true, ts: Date.now(), words }].slice(-100),
          }));
          // Phase 5A: run unified detection client-side. Fire-and-forget.
          // R11: skip if we already ran detection on this text within 800ms
          // (e.g. from a preceding interim_final_candidate).
          if (!shouldSkipRedetect(msg.text)) {
            runDetectAll(msg.segmentId, msg.text, { dgConfidence: msg.confidence });
          }
          // Runtime hook — check user-added custom voice commands and, on
          // match, dispatch a `presentflow:voice-command` event. Shell owns
          // the actual side-effect (calls ctx callback + toast).
          try {
            const customs = readCustomCommands();
            const match = matchCustomCommand(msg.text, customs);
            if (match && typeof window !== "undefined") {
              // Y1: nonce-gated dispatch. Handlers verify the nonce and drop
              // anything else on the floor.
              dispatchInternal("presentflow:voice-command", match);
            }
          } catch { /* ignore */ }
        }
        else if (msg.type === "detection") setState((s) => ({ ...s, detections: [msg.detection, ...s.detections].slice(0, 50) }));
        else if (msg.type === "song") setState((s) => ({ ...s, songSuggestions: [msg.song, ...s.songSuggestions].slice(0, 30) }));
        else if (msg.type === "command") setState((s) => ({ ...s, commandSuggestions: [msg.command, ...s.commandSuggestions].slice(0, 30) }));
        else if (msg.type === "error") setState((s) => ({ ...s, error: msg.message }));
      };

      ws.onerror = (e) => { log("WS error", e); setState((s) => ({ ...s, error: "WebSocket error" })); };
      ws.onclose = (e) => {
        log("WS close", { code: e.code, reason: e.reason });
        const abnormal = e.code !== 1000 && e.code !== 1005;
        // Server sends 1008 for auth / ticket problems and 1011 for missing
        // config (e.g. DEEPGRAM_API_KEY). Both are non-recoverable by
        // reconnecting — surface the reason directly and stop the loop.
        const fatal = e.code === 1008 || e.code === 1011;
        setState((s) => ({ ...s, ready: false, error: fatal && e.reason ? `Audio bridge: ${e.reason}` : s.error }));
        if (fatal) {
          intentionalStopRef.current = true;
          if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
          setState((s) => ({ ...s, listening: false }));
          return;
        }
        if (abnormal && !intentionalStopRef.current) {
          // Keep `listening` true so the top-bar pill still shows "on" while
          // we reconnect behind the scenes — the operator shouldn't have to
          // touch anything for a transient Fly/network blip.
          scheduleReconnect();
        } else {
          setState((s) => ({ ...s, listening: false }));
        }
      };

      setStage("requesting_mic"); log("4a requesting mic");
      // Honour user's Audio Input picker preference. NDI is not yet wired
      // to a real capture path — log and fall back to default device.
      const inputPref = readAudioInputPref();
      if (inputPref?.kind === "ndi") {
        console.log("[ai-pipeline:1] NDI source selected — falling back to default device (NDI capture not yet implemented)");
      }
      const constraints = audioConstraintsFor(inputPref);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (micErr) {
        throw new Error(`Microphone access denied or unavailable: ${micErr instanceof Error ? micErr.message : "unknown"}`);
      }
      // R6: mic acquired but a newer start() superseded us — release + abort.
      if (generation !== pipelineGenerationRef.current) {
        try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
        try { ws.close(1000, "superseded"); } catch { /* ignore */ }
        return;
      }
      setStage("mic_granted"); log("4b mic granted", stream.getAudioTracks().map((t) => t.label));
      streamRef.current = stream;
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === "suspended") await audioCtx.resume();
      setStage("audioctx_ready"); log("4c audioctx", { state: audioCtx.state, sampleRate: audioCtx.sampleRate });
      const source = audioCtx.createMediaStreamSource(stream);

      // Load inline worklet: downsamples to Int16 and posts to main thread.
      const workletCode = `
        class PCMSender extends AudioWorkletProcessor {
          process(inputs) {
            const input = inputs[0];
            if (!input || !input[0]) return true;
            const ch = input[0];
            const buf = new Int16Array(ch.length);
            for (let i = 0; i < ch.length; i++) {
              const s = Math.max(-1, Math.min(1, ch[i]));
              buf[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            this.port.postMessage(buf.buffer, [buf.buffer]);
            return true;
          }
        }
        registerProcessor('pcm-sender', PCMSender);
      `;
      const blob = new Blob([workletCode], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);
      setStage("worklet_loaded"); log("worklet_loaded");

      const node = new AudioWorkletNode(audioCtx, "pcm-sender");
      workletNodeRef.current = node;
      let sentChunks = 0;
      node.port.onmessage = (e) => {
        const raw = e.data as ArrayBuffer;
        const bytes = new Uint8Array(raw);
        // Task 9: warm-start / mic-muted → do not send.
        if (micMutedRef.current) return;
        // Y7: lazily open session window on first unmuted chunk.
        if (!sessionStartRef.current) sessionStartRef.current = Date.now();
        // Task 13: RMS silence gate. Compute RMS over PCM16 samples.
        const i16 = new Int16Array(raw);
        let sumSq = 0;
        for (let i = 0; i < i16.length; i++) { const v = i16[i] / 0x8000; sumSq += v * v; }
        const rms = Math.sqrt(sumSq / Math.max(1, i16.length));
        const dbfs = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
        const nowMs = Date.now();
        // R8: hysteresis. Close only after HOLD_MS below -60 dBFS; reopen
        // when audio climbs back above -55 dBFS.
        if (dbfs < SILENCE_CLOSE_DBFS) {
          if (silenceStartRef.current === null) silenceStartRef.current = nowMs;
          if (!silenceClosedRef.current && nowMs - (silenceStartRef.current ?? nowMs) >= SILENCE_HOLD_MS) {
            silenceClosedRef.current = true;
            setState((s) => ({ ...s, silenceGateClosed: true }));
            console.log("[audio-silence] gate closed");
          }
        } else if (dbfs > SILENCE_OPEN_DBFS) {
          silenceStartRef.current = null;
          if (silenceClosedRef.current) {
            silenceClosedRef.current = false;
            setState((s) => ({ ...s, silenceGateClosed: false }));
            console.log("[audio-silence] gate opened");
            // R8: flush lookback ring on reopen so DG hears the leading edge.
            if (ws.readyState === WebSocket.OPEN) {
              for (const chunk of lookbackRingRef.current) {
                try {
                  let bin = "";
                  for (let i = 0; i < chunk.length; i++) bin += String.fromCharCode(chunk[i]);
                  const b64 = btoa(bin);
                  ws.send(JSON.stringify({ type: "audio", b64 }));
                } catch { break; }
              }
            }
            lookbackRingRef.current = [];
            lookbackBytesRef.current = 0;
          }
        }
        // R8: always buffer into 200ms lookback ring (even while closed) so
        // the leading edge of resumed speech isn't chopped off.
        lookbackRingRef.current.push(bytes);
        lookbackBytesRef.current += bytes.length;
        while (lookbackBytesRef.current > LOOKBACK_CAP_BYTES && lookbackRingRef.current.length > 0) {
          const d = lookbackRingRef.current.shift();
          if (d) lookbackBytesRef.current -= d.length;
        }
        // If gate closed, skip send (but keep the mic open).
        if (silenceClosedRef.current) return;
        // Task 4: WS closed → buffer into 5s ring, evicting oldest.
        if (ws.readyState !== WebSocket.OPEN) {
          ringBufferRef.current.push(bytes);
          ringBufferBytesRef.current += bytes.length;
          while (ringBufferBytesRef.current > RING_CAP_BYTES && ringBufferRef.current.length > 0) {
            const dropped = ringBufferRef.current.shift();
            if (dropped) ringBufferBytesRef.current -= dropped.length;
          }
          return;
        }
        if (firstChunkAtRef.current === null) firstChunkAtRef.current = nowMs;
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const b64 = btoa(bin);
        ws.send(JSON.stringify({ type: "audio", b64 }));
        sentChunks++;
        setState((s) => ({ ...s, chunksSent: sentChunks }));
        if (sentChunks === 1) { setStage("first_chunk_sent"); log("6 first audio chunk sent"); }
        else if (sentChunks % 400 === 0) log(`6 sent ${sentChunks} audio chunks`);
      };
      source.connect(node);
      const silent = audioCtx.createGain();
      silent.gain.value = 0;
      node.connect(silent).connect(audioCtx.destination);
      setStage("worklet_connected"); log("worklet_connected");

      setState((s) => ({ ...s, listening: true }));
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : "Start failed" }));
      stop();
    }
  }, [planId, stop, setStage, scheduleReconnect, isDevOrTraceOn]);

  // Expose the latest `start` to scheduleReconnect without recreating it on
  // every render (would restart the backoff clock).
  useEffect(() => { startRef.current = start; }, [start]);

  // Auto-pause after prolonged silence. Cheap 30s interval poll (no per-render
  // side effect). Stops the pipeline and closes the WS to save Deepgram cost.
  useEffect(() => {
    if (autoPauseTimerRef.current) { clearInterval(autoPauseTimerRef.current); autoPauseTimerRef.current = null; }
    if (!state.listening) return;
    const iv = setInterval(() => {
      if (!isAutoPauseEnabled()) return;
      const elapsed = Date.now() - lastTranscriptAtRef.current;
      if (elapsed < AUTO_PAUSE_MS) return;
      // Only auto-pause when we were actually receiving final transcripts —
      // don't yank a pipeline still mid-init.
      setState((s) => {
        if (s.stage !== "receiving_final") return s;
        // Trigger teardown but keep the "paused" state visible.
        intentionalStopRef.current = true;
        try { teardown(); } catch { /* ignore */ }
        return { ...s, stage: "paused", listening: false, ready: false, interim: "" };
      });
    }, 30_000);
    autoPauseTimerRef.current = iv;
    return () => { clearInterval(iv); if (autoPauseTimerRef.current === iv) autoPauseTimerRef.current = null; };
  }, [state.listening, isAutoPauseEnabled, teardown]);

  // Restart pipeline when the operator changes the audio input mid-service.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      if (!state.listening) return;
      // Full restart so getUserMedia picks up the new deviceId.
      stop();
      setTimeout(() => { startRef.current().catch(() => { /* ignore */ }); }, 100);
    };
    window.addEventListener("presentflow:audio-input-changed", handler);
    return () => window.removeEventListener("presentflow:audio-input-changed", handler);
  }, [state.listening, stop]);

  const resume = useCallback(() => {
    lastTranscriptAtRef.current = Date.now();
    intentionalStopRef.current = false;
    micMutedRef.current = false;
    setState((s) => ({ ...s, warmStarted: false }));
    startRef.current().catch(() => { /* ignore */ });
  }, []);

  // Task 6: manual "Restart listening" — stop + fresh ticket + start.
  const restart = useCallback(() => {
    if (isDevOrTraceOn()) console.log("[presentflow-audio] restart() called");
    // Y4: flush metrics BEFORE teardown so the aborted session is recorded.
    try { flushSessionMetrics(); } catch { /* ignore */ }
    // Full stop first.
    intentionalStopRef.current = true;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    reconnectAttemptsRef.current = 0;
    ringBufferRef.current = [];
    ringBufferBytesRef.current = 0;
    // Y4: reset the missing state — session windows, word buckets, conf sums,
    // rate windows, chunk latency, silence gate, mic mute flag.
    sessionStartRef.current = 0;
    wordsHighRef.current = 0;
    wordsLowRef.current = 0;
    confSumRef.current = 0;
    confCountRef.current = 0;
    msgTimestampsRef.current = [];
    firstChunkAtRef.current = null;
    silenceStartRef.current = null;
    silenceClosedRef.current = false;
    micMutedRef.current = false;
    lookbackRingRef.current = [];
    lookbackBytesRef.current = 0;
    // R10/Y4: reset dedupe + recent-detection cache so a new session doesn't
    // inherit suppressed keys from the previous one.
    dedupeRef.current = new SuggestionDedupe(30_000);
    recentDetectionTextsRef.current.clear();
    // R6: bump generation so any inflight callback from the prior pipeline aborts.
    pipelineGenerationRef.current += 1;
    teardown();
    setState((s) => ({ ...s, reconnectFailed: false, reconnectAttempts: 0, error: null, listening: false, ready: false, interim: "", stage: "idle", silenceGateClosed: false }));
    // Small tick so React commits stop-state before starting fresh.
    setTimeout(() => { startRef.current().catch(() => { /* ignore */ }); }, 50);
  }, [teardown, isDevOrTraceOn, flushSessionMetrics]);

  // Task 9: warm-start — open WS + Deepgram, keep mic muted until listening
  // is toggled ON. Called at operator mount so the first user-toggle has zero
  // handshake latency. Billing behavior documented in DECISIONS.md.
  const warmStart = useCallback(() => {
    if (wsRef.current || state.warmStarted || state.listening) return;
    if (isDevOrTraceOn()) console.log("[presentflow-audio] warmStart() called");
    micMutedRef.current = true;
    setState((s) => ({ ...s, warmStarted: true }));
    startRef.current().catch(() => { /* ignore */ });
  }, [state.warmStarted, state.listening, isDevOrTraceOn]);

  useEffect(() => () => stop(), [stop]);

  const dismissDetection = useCallback((id: string) => {
    setState((s) => ({ ...s, detections: s.detections.filter((d) => d.id !== id) }));
  }, []);

  const dismissSong = useCallback((id: string) => {
    setState((s) => ({ ...s, songSuggestions: s.songSuggestions.filter((x) => x.suggestionId !== id) }));
  }, []);

  const dismissCommand = useCallback((id: string) => {
    setState((s) => ({ ...s, commandSuggestions: s.commandSuggestions.filter((x) => x.suggestionId !== id) }));
  }, []);

  const dismissSuggestion = useCallback((id: string) => {
    setState((s) => ({ ...s, suggestions: s.suggestions.filter((x) => x.id !== id) }));
  }, []);

  /**
   * Simulate a transcript segment locally — no audio, no network. Used by
   * the Simulate Phrase input in the AI Assistant panel for testing.
   */
  const simulateTranscript = useCallback((text: string) => {
    const segmentId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setState((s) => ({
      ...s,
      transcript: [...s.transcript, { id: segmentId, text, final: true, ts: Date.now() }].slice(-100),
    }));
    runDetectAll(segmentId, text);
  }, [runDetectAll]);

  return { state, start, stop, resume, restart, warmStart, dismissDetection, dismissSong, dismissCommand, dismissSuggestion, simulateTranscript };
}
