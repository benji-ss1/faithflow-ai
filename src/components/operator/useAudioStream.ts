"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { detectAll, SuggestionDedupe, type DetectAllResult } from "@/lib/ai-detection";
import type { IndexedSong } from "@/lib/ai-detection/lyric-fragment";
import type { SongMatchResult } from "@/lib/ai-detection/song-match";

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
  | "receiving_final";        // first final transcript received

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
  const getCtxRef = useRef<DetectContextProvider | undefined>(opts?.getDetectContext);
  useEffect(() => { libraryRef.current = opts?.library || []; }, [opts?.library]);
  useEffect(() => { getCtxRef.current = opts?.getDetectContext; }, [opts?.getDetectContext]);

  const runDetectAll = useCallback(async (segmentId: string, text: string) => {
    const provider = getCtxRef.current;
    const base = provider ? provider() : { churchId: "", hasVerseContext: false, hasSlideContext: false, hasSongContext: false };
    let result: DetectAllResult;
    try {
      result = await detectAll(text, { ...base, library: libraryRef.current });
    } catch (e) {
      console.warn("[faithflow-detect] detectAll failed", e);
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

    for (const r of result.scripture) {
      const id = `sc-${segmentId}-${r.book}-${r.chapter}-${r.verseStart}-${r.verseEnd}`;
      const key = `${r.book} ${r.chapter}:${r.verseStart}-${r.verseEnd}`;
      push({ id, type: "scripture", segmentId, ts, confidence: r.confidence, matchedText: r.matchedText, ref: { book: r.book, chapter: r.chapter, verseStart: r.verseStart, verseEnd: r.verseEnd } }, key);
    }
    for (const m of result.song) {
      const id = `sg-${segmentId}-${m.songId}`;
      push({ id, type: "song", segmentId, ts, confidence: m.confidence, matchedText: m.matchedLine || m.title, match: m }, m.songId);
    }
    for (const m of result.lyric) {
      const id = `ly-${segmentId}-${m.songId}`;
      push({ id, type: "lyric", segmentId, ts, confidence: m.confidence, matchedText: m.matchedLine || m.title, match: m }, `lyric:${m.songId}`);
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
  }, []);

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
  const startRef = useRef<() => Promise<void>>(async () => {});

  const teardown = useCallback(() => {
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
    console.log("[faithflow-audio] stop() called — hard-stopping pipeline");
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
      console.warn("[faithflow-audio] auto-reconnect gave up after 8 attempts");
      setState((s) => ({ ...s, error: "AI listener disconnected. Toggle AI Listening OFF then ON." }));
      return;
    }
    // Exponential backoff w/ jitter: ~0.5s, 1s, 2s, 4s, 8s, 15s (capped), + up to 500ms jitter.
    const base = Math.min(500 * Math.pow(2, attempt - 1), 15_000);
    const delay = base + Math.floor(Math.random() * 500);
    console.log(`[faithflow-audio] scheduling reconnect attempt ${attempt} in ${delay}ms`);
    setState((s) => ({ ...s, error: `Reconnecting AI listener (attempt ${attempt})…` }));
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      // Tear the old pipeline down before starting fresh — mic tracks and
      // AudioContext can leak otherwise.
      teardown();
      startRef.current().catch((e) => console.warn("[faithflow-audio] reconnect start failed", e));
    }, delay);
  }, [teardown]);

  const start = useCallback(async () => {
    intentionalStopRef.current = false;
    setState((s) => ({ ...s, error: null, stage: "idle", stageHistory: [], chunksSent: 0, dgMessagesReceived: 0 }));
    const log = (stage: string, extra?: unknown) => console.log(`[faithflow-audio] ${stage}`, extra ?? "");
    try {
      setStage("requesting_ticket"); log("1 requesting ticket");
      const ticketRes = await fetch("/api/audio/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
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
        if (msg.type === "ready") { setStage("deepgram_ready"); log("5 deepgram ready"); setState((s) => ({ ...s, ready: true })); return; }
        if (msg.type === "interim") { setStage("receiving_interim"); log("7 interim", msg.text); }
        if (msg.type === "final") { setStage("receiving_final"); log("8 final", msg.text); }
        if (msg.type === "detection" || msg.type === "song" || msg.type === "command") log(`9 ${msg.type}`);
        if (msg.type === "ready") setState((s) => ({ ...s, ready: true }));
        else if (msg.type === "interim") setState((s) => ({ ...s, interim: msg.text }));
        else if (msg.type === "final") {
          setState((s) => ({
            ...s,
            interim: "",
            transcript: [...s.transcript, { id: msg.segmentId, text: msg.text, final: true, ts: Date.now() }].slice(-100),
          }));
          // Phase 5A: run unified detection client-side. Fire-and-forget.
          runDetectAll(msg.segmentId, msg.text);
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
        setState((s) => ({ ...s, ready: false }));
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
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } });
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
  }, [planId, stop, setStage, scheduleReconnect]);

  // Expose the latest `start` to scheduleReconnect without recreating it on
  // every render (would restart the backoff clock).
  useEffect(() => { startRef.current = start; }, [start]);

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

  return { state, start, stop, dismissDetection, dismissSong, dismissCommand, dismissSuggestion, simulateTranscript };
}
