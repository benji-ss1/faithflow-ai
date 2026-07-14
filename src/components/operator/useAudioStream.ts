"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { detectAll, SuggestionDedupe, type DetectAllResult } from "@/lib/ai-detection";
import { buildIndex, type IndexedSong, type SongIndex } from "@/lib/ai-detection/lyric-fragment";
import type { SongMatchResult } from "@/lib/ai-detection/song-match";
import { matchCustomCommand, readCustomCommands, readAudioInputPref, audioConstraintsFor } from "@/lib/voice-commands";
import { dispatchInternal } from "@/lib/internal-events";

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

export type TranscriptChunk = { id: string; text: string; final: boolean; ts: number };

/**
 * Unified suggestion — Phase 5A. Runs client-side on every transcript
 * finalization. Lives alongside detections/songSuggestions/commandSuggestions
 * so existing UI flows keep working.
 */
export type UnifiedSuggestion =
  | { id: string; type: "scripture"; segmentId: string; ts: number; confidence: number; matchedText: string; ref: { book: string; chapter: number; verseStart: number; verseEnd: number } }
  | { id: string; type: "song"; segmentId: string; ts: number; confidence: number; matchedText: string; match: SongMatchResult }
  | { id: string; type: "lyric"; segmentId: string; ts: number; confidence: number; matchedText: string; match: SongMatchResult }
  | { id: string; type: "section"; segmentId: string; ts: number; confidence: number; matchedText: string; section: "chorus" | "verse" | "bridge" | "outro" | "tag"; index?: number };

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
    let result: DetectAllResult;
    try {
      result = await detectAll(text, { ...base, library: libraryRef.current, prebuiltIndex: songIndexRef.current ?? undefined });
    } catch (e) {
      console.warn("[presentflow-detect] detectAll failed", e);
      return;
    }
    const ts = Date.now();
    const newSuggestions: UnifiedSuggestion[] = [];

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
      const rawBoost = (wellFormed ? 10 : 0) + (r.verseEnd > r.verseStart ? 5 : 0);
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
      push({ id, type: "scripture", segmentId, ts, confidence: conf, matchedText: r.matchedText, ref: { book: r.book, chapter: r.chapter, verseStart: r.verseStart, verseEnd: r.verseEnd } }, key);
    }
    for (const m of result.song) {
      const id = `sg-${segmentId}-${m.songId}`;
      push({ id, type: "song", segmentId, ts, confidence: m.confidence, matchedText: m.matchedLine || m.title, match: m }, m.songId);
      prefetchSongSlides(m.songId);
    }
    for (const m of result.lyric) {
      const id = `ly-${segmentId}-${m.songId}`;
      push({ id, type: "lyric", segmentId, ts, confidence: m.confidence, matchedText: m.matchedLine || m.title, match: m }, `lyric:${m.songId}`);
      prefetchSongSlides(m.songId);
    }
    for (const s of result.section) {
      const id = `se-${segmentId}-${s.section}-${s.index ?? "x"}`;
      const key = `${s.section}:${s.index ?? ""}`;
      push({ id, type: "section", segmentId, ts, confidence: s.confidence, matchedText: s.matchedText, section: s.section, index: s.index }, key);
    }

    if (newSuggestions.length === 0) return;
    setState((prev) => {
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

  const stop = useCallback(() => {
    if (isDevOrTraceOn()) console.log("[presentflow-audio] stop() called — hard-stopping pipeline");
    intentionalStopRef.current = true;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    reconnectAttemptsRef.current = 0;
    teardown();
    setState((s) => ({ ...s, listening: false, ready: false, interim: "", stage: "idle" }));
  }, [teardown]);

  const scheduleReconnect = useCallback(() => {
    if (intentionalStopRef.current) return;
    const attempt = ++reconnectAttemptsRef.current;
    if (attempt > 8) {
      if (isDevOrTraceOn()) console.warn("[presentflow-audio] auto-reconnect gave up after 8 attempts");
      setState((s) => ({ ...s, error: "AI listener disconnected. Toggle AI Listening OFF then ON." }));
      return;
    }
    // Exponential backoff w/ jitter: ~0.5s, 1s, 2s, 4s, 8s, 15s (capped), + up to 500ms jitter.
    const base = Math.min(500 * Math.pow(2, attempt - 1), 15_000);
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
    intentionalStopRef.current = false;
    lastTranscriptAtRef.current = Date.now();
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
      setStage("ticket_ok"); log("2 ticket ok", ticket.url);

      setStage("opening_ws");
      const ws = new WebSocket(ticket.url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setStage("ws_open"); log("3 WS open");
        // Fresh connection stable — reset backoff so a later drop starts at attempt 1.
        reconnectAttemptsRef.current = 0;
        setState((s) => ({ ...s, error: null }));
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        setState((s) => ({ ...s, dgMessagesReceived: s.dgMessagesReceived + 1 }));
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
          const text = msg.text;
          const dgConfidence = msg.confidence;
          queueMicrotask(() => { runDetectAll(segmentId, text, { dgConfidence }); });
        }
        else if (msg.type === "final") {
          lastTranscriptAtRef.current = Date.now();
          setState((s) => ({
            ...s,
            interim: "",
            transcript: [...s.transcript, { id: msg.segmentId, text: msg.text, final: true, ts: Date.now() }].slice(-100),
          }));
          // Phase 5A: run unified detection client-side. Fire-and-forget.
          runDetectAll(msg.segmentId, msg.text, { dgConfidence: msg.confidence });
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
        if (ws.readyState !== WebSocket.OPEN) return;
        const bytes = new Uint8Array(e.data as ArrayBuffer);
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
    startRef.current().catch(() => { /* ignore */ });
  }, []);

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

  return { state, start, stop, resume, dismissDetection, dismissSong, dismissCommand, dismissSuggestion, simulateTranscript };
}
