"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { detectAll, SuggestionDedupe, type DetectAllResult } from "@/lib/ai-detection";
import { parseBareVerse, parseBookVerseOnly, isValidChapter } from "@/lib/bible-parser";
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
  // Set by the audio bridge the moment the SAME reference is spoken a
  // second time (even minutes apart) — a preacher restating a reference is
  // itself a "put this on screen" signal. Only ever advisory: the client
  // still requires AUTO mode (autoApproveEnabled && autoSendToLive) to be
  // on before acting on it — this flag never bypasses that human toggle.
  forceLive?: boolean;
};

export type SongSuggestion = {
  suggestionId: string;
  segmentId: string;
  songId: string | null;
  title: string;
  confidence: number;
  matchedText: string;
};

export type PhraseMatch = {
  segmentId: string;
  matchedText: string;
  candidates: { book: string; chapter: number; verse: number; text: string; similarity: number }[];
  ts: number;
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

export type TranscriptChunk = { id: string; text: string; final: boolean; ts: number; words?: { w: string; c: number; s?: number; e?: number; sp?: number }[]; wordsDropped?: boolean };

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
  | { id: string; type: "scripture"; segmentId: string; ts: number; confidence: number; matchedText: string; matchedSpan?: MatchedSpan; ref: { book: string; chapter: number; verseStart: number; verseEnd: number }; forceLive?: boolean; voiceCommand?: boolean }
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
  phraseMatches: PhraseMatch[];
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
  // Rolling-window audio quality signal (roadmap item #1). `null` until
  // enough final segments arrive to make a call. `"low"` when the last N
  // finalized segments' Deepgram confidence averages below the floor —
  // surfaces as an amber "LOW AUDIO" chip so operators know a stretch of
  // silent misfires is a mic / room / signal problem, not an AI bug.
  audioQuality: "ok" | "low" | null;
  audioQualityAvg: number; // 0..1 rolling avg of last N final-segment confidences
  // Roadmap #2 — canonical (Whisper) two-pass corrections. Server sends
  // one of these when Groq Whisper disagrees with Deepgram's parse of a
  // low-confidence scripture detection. Client renders a small chip so
  // the operator can one-click swap the currently-loaded reference to
  // the Whisper-preferred one (never auto-swap during a live service).
  canonicalCorrections: CanonicalCorrection[];
};

export type CanonicalCorrection = {
  id: string;
  segmentId: string;
  dgText: string;
  whisperText: string;
  original: { book: string; chapter: number; verseStart: number; verseEnd: number };
  corrected: { book: string; chapter: number; verseStart: number; verseEnd: number };
  ts: number;
  dismissed?: boolean;
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
    detections: [], phraseMatches: [], songSuggestions: [], commandSuggestions: [], suggestions: [],
    stage: "idle", stageHistory: [], chunksSent: 0, dgMessagesReceived: 0,
    reconnectFailed: false, reconnectAttempts: 0, warmStarted: false,
    silenceGateClosed: false, msgsPerSec: 0, lastLatencyMs: null, avgConfidence: 0,
    audioQuality: null, audioQualityAvg: 0,
    canonicalCorrections: [],
  });

  // Dedupe primitive: 30s cooldown per (type, key), refresh on +10 confidence.
  const dedupeRef = useRef(new SuggestionDedupe(30_000));
  // Track the last-seen churchId so we can nuke dedupe on church change.
  const lastDetectChurchIdRef = useRef<string | null>(null);
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
  // Last book/chapter actually detected — resolves bare "verse 11" / "what
  // does verse 7 say" mentions (no book/chapter spoken) against whatever
  // passage is currently active in the service.
  const lastActiveRefRef = useRef<{ book: string; chapter: number } | null>(null);
  // A preacher restating the SAME reference (even minutes apart, well
  // outside the 30s dedupe cooldown above) is itself a strong "put this on
  // screen" signal — tracked separately so it can flag forceLive on the
  // suggestion regardless of the normal confidence floor. The consuming
  // auto-fire effect (ProOperatorShell) still requires AUTO mode's explicit
  // human toggle to be on before acting on this flag.
  const REPEAT_WINDOW_MS = 10 * 60 * 1000;
  const refOccurrencesRef = useRef<Map<string, { count: number; firstAt: number }>>(new Map());
  const noteRefOccurrence = useCallback((key: string): number => {
    const now = Date.now();
    const map = refOccurrencesRef.current;
    for (const [k, v] of map) if (now - v.firstAt > REPEAT_WINDOW_MS) map.delete(k);
    const cur = map.get(key);
    if (cur) { cur.count++; return cur.count; }
    map.set(key, { count: 1, firstAt: now });
    return 1;
  }, []);
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
    // Cross-church leak defense: if the churchId has changed since the last
    // detection (SPA sign-out → sign-in as different church without a full
    // reload), the SuggestionDedupe map still holds keys from the previous
    // church and would suppress fresh detections. Reset it on transition.
    if (lastDetectChurchIdRef.current !== null && lastDetectChurchIdRef.current !== base.churchId) {
      dedupeRef.current = new SuggestionDedupe(30_000);
    }
    lastDetectChurchIdRef.current = base.churchId;
    // R6/R10: capture generation to abort stale detections after restart.
    const capturedGeneration = pipelineGenerationRef.current;
    let result: DetectAllResult;
    try {
      result = await detectAll(text, { ...base, library: libraryRef.current, prebuiltIndex: songIndexRef.current ?? undefined });
    } catch (e) {
      console.warn("[presentflow-detect] detectAll failed", e);
      return;
    }

    // Bare "verse 11" / "what does verse 7 say" — no book or chapter spoken
    // at all. Only meaningful once a passage is already active (see
    // lastActiveRefRef above), and only as a fallback when the parser found
    // nothing, so it can never override an actual spoken reference.
    if (result.scripture.length === 0 && lastActiveRefRef.current) {
      // "Book verse N" — a DIFFERENT book named but no chapter ("Acts of the
      // Apostles verse 4"). Checked first since it names an explicit book;
      // same book as active → carry the chapter over, different book →
      // default to chapter 1 (mirrors the parser's existing book-chapter-only
      // default of verse 1).
      const bookVerse = parseBookVerseOnly(text);
      if (bookVerse) {
        const chapter = bookVerse.book === lastActiveRefRef.current.book ? lastActiveRefRef.current.chapter : 1;
        if (isValidChapter(bookVerse.book, chapter)) {
          result.scripture = [{
            book: bookVerse.book, chapter,
            verseStart: bookVerse.verse, verseEnd: bookVerse.verse,
            confidence: 90, matchedText: bookVerse.matchedText, needsSemanticFallback: false, isNavigationCommand: true,
          }];
        }
      } else {
        const bare = parseBareVerse(text);
        if (bare && isValidChapter(lastActiveRefRef.current.book, lastActiveRefRef.current.chapter)) {
          result.scripture = [{
            book: lastActiveRefRef.current.book, chapter: lastActiveRefRef.current.chapter,
            verseStart: bare.verse, verseEnd: bare.verse,
            confidence: 90, matchedText: bare.matchedText, needsSemanticFallback: false, isNavigationCommand: true,
          }];
        }
      }
    }
    const ts = Date.now();
    const newSuggestions: UnifiedSuggestion[] = [];
    // R1: compute char offset for matchedText within source text. Deepgram
    // punctuates ("John 3, verse 16") but the parser normalises to
    // "John 3:16", so a naive indexOf misses and the word-conf gate falls
    // back to a permissive fail-open path. Try exact first; if that misses,
    // fuzzy-match by stripping punctuation and matching token positions.
    const spanFor = (matchedText: string): MatchedSpan | undefined => {
      if (!matchedText) return undefined;
      const lower = text.toLowerCase();
      const idx = lower.indexOf(matchedText.toLowerCase());
      if (idx >= 0) return { start: idx, end: idx + matchedText.length };
      // Fuzzy: strip punctuation from both sides, align on the first token
      // of the match. Good enough for word-conf overlap detection — the gate
      // only needs an approximate span.
      const strip = (s: string) => s.replace(/[.,;:!?()"'\-]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      const strippedText = strip(text);
      const strippedMatch = strip(matchedText);
      if (!strippedMatch) return undefined;
      const sIdx = strippedText.indexOf(strippedMatch);
      if (sIdx < 0) return undefined;
      // Walk the original text and count non-punctuation chars until we hit
      // sIdx worth, then compute the original-text offset. Approximate but
      // strictly within the utterance bounds.
      let origIdx = 0;
      let seen = 0;
      while (origIdx < text.length && seen < sIdx) {
        const ch = text[origIdx];
        if (/[\p{L}\p{N}\s]/u.test(ch)) seen++;
        origIdx++;
      }
      return { start: origIdx, end: Math.min(text.length, origIdx + matchedText.length) };
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
      // Review found: the fuzzy/phonetic book-match pattern (confidence 55
      // raw, ~65 max after blending) can coincidentally hit a real book name
      // from ordinary speech ("room 1:2" -> Romans 1:2). That's an
      // acceptable low-confidence passive suggestion, but it must never (a)
      // become the "current chapter" context bare "verse N" resolves
      // against, or (b) qualify for forceLive's confidence-floor bypass —
      // both would let one coincidental fuzzy hit compound into a wrong
      // live-fire. Gate both on a confidence floor comfortably above that
      // pattern's ceiling; genuine low-confidence-but-real hits (the
      // pre-existing semantic-fallback tier) sit at 72+ and are unaffected.
      const trustworthyForContext = conf >= 70;
      if (trustworthyForContext) lastActiveRefRef.current = { book: r.book, chapter: r.chapter };
      // Restating the exact same reference (even minutes apart) is itself a
      // "make sure this is on screen" signal — flags forceLive so the
      // auto-fire effect can bypass its normal confidence floor. Still
      // requires AUTO mode's explicit human toggle; this hook never sends
      // anything live itself.
      const occurrenceCount = noteRefOccurrence(`${r.book}|${r.chapter}|${r.verseStart}|${r.verseEnd}`);
      // Every re-mention within REPEAT_WINDOW_MS gets forceLive, not just the
      // 2nd. A preacher going Matt 5:5 → Gen 4:4 → Matt 5:5 → Gen 4:4 → …
      // needs the 3rd and later mentions to carry the flag too, otherwise
      // the back-and-forth stops auto-projecting after the first swap.
      // Auto-fire's other guards (AUTO toggle, min-gap, different-live-ref
      // check) keep this from spamming.
      const forceLive = occurrenceCount >= 2 && trustworthyForContext;
      const suggestion: UnifiedSuggestion = { id, type: "scripture", segmentId, ts, confidence: conf, matchedText: r.matchedText, matchedSpan: spanFor(r.matchedText), ref: { book: r.book, chapter: r.chapter, verseStart: r.verseStart, verseEnd: r.verseEnd }, ...(forceLive ? { forceLive: true } : {}), ...(r.isNavigationCommand ? { voiceCommand: true } : {}) };
      if (forceLive || r.isNavigationCommand) {
        // Bypass the normal 30s dedupe cooldown for this one signal — the
        // repeat is very often said within that same window (that's the
        // whole point), and this only fires once per key per REPEAT_WINDOW_MS
        // (occurrenceCount === 2 exactly), so it can't spam.
        newSuggestions.push(suggestion);
      } else {
        push(suggestion, key);
      }
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
    setState((s) => {
      // Render-storm fix: during continuous speech this is called with
      // "receiving_interim"/"receiving_final" on essentially every Deepgram
      // message. If the stage hasn't actually changed, return the SAME state
      // reference so React bails out — no re-render, no stageHistory growth
      // churn. Over a multi-hour service this removes thousands of redundant
      // commits of the whole operator-state object.
      if (s.stage === stage) return s;
      return { ...s, stage, stageHistory: [...s.stageHistory, { stage, ts: Date.now() }].slice(-30) };
    });
  }, []);
  const wsRef = useRef<WebSocket | null>(null);
  // Throttle counter for chunksSent state updates — keeps the ~50Hz worklet
  // hot-path from committing React state on every audio frame.
  const lastChunkStateAtRef = useRef<number>(0);
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

  // ALWAYS-ON mode (default): the AI never goes dormant on its own — no
  // silence gate closing, no idle auto-pause. Operators explicitly asked for
  // "on full time; if we want it off we turn it off ourselves." The silence
  // gate and auto-pause still EXIST (this is a per-machine opt-out, default
  // on), but are disabled by default.
  const isAiAlwaysOn = useCallback((): boolean => {
    try {
      if (typeof localStorage === "undefined") return true;
      return localStorage.getItem("presentflow.pro.aiAlwaysOn") !== "0"; // default on
    } catch { return true; }
  }, []);
  // Snapshotted into a ref at start() so the ~50Hz worklet hot path reads a
  // plain boolean, never localStorage per audio frame.
  const aiAlwaysOnRef = useRef<boolean>(true);
  // NOTE: an earlier draft added a proactive hourly connection-refresh as a
  // "guardrail" against long-session drift. The stress review showed it was
  // net-negative: cycling the socket via the reconnect path tears down and
  // RE-ACQUIRES the mic/AudioContext every hour, so a single transient
  // getUserMedia failure (device busy, Bluetooth renegotiation) would kill
  // the very session it was meant to protect, and a slow mic re-acquire could
  // drop words past the 5s ring. Dropped. The real long-session degradation
  // was an unthrottled per-message render storm (fixed below); the existing
  // stall watchdog + reconnect still recover a genuinely wedged socket.

  // Perf helper — chunked Uint8Array → base64. A naive
  //   String.fromCharCode(...bytes) + btoa()
  // over ~160 KB blocks the main thread ~200 ms on reconnect flush (the
  // exact moment the AI Live pill flips green). We chunk the char-code
  // apply to 8 KB slices so no single call ever holds a huge string.
  const bytesToBase64 = (bytes: Uint8Array): string => {
    const CHUNK = 8192;
    let bin = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
      bin += String.fromCharCode.apply(null, slice as unknown as number[]);
    }
    return btoa(bin);
  };
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
  // Roadmap #1 — rolling audio-quality window. Kept as a ring buffer (last
  // N final-segment confidences) so a drop in current audio quality is
  // detectable even mid-session. `audioQualityStateRef` is the sticky
  // ok/low value, mutated only on hysteresis crossings so we don't dispatch
  // the same edge repeatedly.
  const rollingConfRef = useRef<number[]>([]);
  const audioQualityStateRef = useRef<"ok" | "low" | null>(null);
  // Roadmap #4 — per-preacher/per-church learned keyterms miner. During a
  // service, accumulate tokens with consistently LOW Deepgram confidence
  // (a proxy for "the model doesn't know this word for this preacher").
  // On session end, POST the aggregated candidates to
  // /api/audio/session-metrics — server upserts into
  // church_learned_keyterms, promotes at MIN_OCCURRENCES_TO_PROMOTE, and
  // loadKeyterms() picks them up on the next Deepgram connection. Key is
  // lowercase normalized; value keeps a cased "display" form (first seen
  // wins) so "Habakkuk" stays "Habakkuk" not "habakkuk" when biasing.
  const lowConfTokensRef = useRef<Map<string, { display: string; count: number; sumConf: number }>>(new Map());
  const LEARNED_MINER_CONF_CEILING = 0.65; // only words BELOW this feed the miner
  const LEARNED_MINER_MIN_LEN = 4;         // skip stop-word noise ("the", "to")
  const LEARNED_MINER_MAX_LEN = 24;        // skip run-on garble
  const msgTimestampsRef = useRef<number[]>([]);
  const firstChunkAtRef = useRef<number | null>(null);
  // Render-storm fix: true message count + last-commit clock so the diagnostic
  // counters (dgMessagesReceived/msgsPerSec/lastLatencyMs) commit to React
  // state at ~1Hz instead of on every Deepgram message. During continuous
  // speech Deepgram streams interims constantly; committing the whole
  // operator-state object per message drove sustained 5-15 renders/sec for
  // hours — the most likely cause of long-service quality degradation.
  const dgMsgCountRef = useRef<number>(0);
  const lastDgStateCommitAtRef = useRef<number>(0);
  const lastLatencyMsRef = useRef<number | null>(null);
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
        const b64 = bytesToBase64(silence);
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
    // Only dedupe on exact-normalized equality. Substring matching swallowed
    // distinct references when the pastor said "John 3" then "John 3:16"
    // within the window — "john 3" is contained in "john 3:16", so the
    // fuller reference was suppressed and only the truncated interim card
    // ever rendered. The core SuggestionDedupe (by reference key) handles
    // true duplicates; this Map only exists to avoid re-running detectAll on
    // the same raw text milliseconds apart.
    if (recentDetectionTextsRef.current.has(norm)) return true;
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
  // Flicker fix: pending "downgrade the pill to connecting" timer, armed on an
  // abnormal WS close and cancelled if the reconnect re-readies within grace.
  const readyDowngradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<(opts?: { warm?: boolean }) => Promise<void>>(async () => {});
  // Auto-pause: track when the last transcript arrived and check periodically.
  // If no transcript for AUTO_PAUSE_MS while listening, transition to paused
  // and close the WS to save Deepgram cost. Raised from 10 to 30 minutes —
  // a real service has long silent stretches (worship sets, offering,
  // videos, testimonies without a mic) well past 10 minutes where the
  // operator still wants AI Live armed and ready the moment speech resumes,
  // not auto-paused and needing a manual restart mid-service.
  const AUTO_PAUSE_MS = 30 * 60 * 1000; // 30 minutes
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
      // Roadmap #4 — top-K low-confidence tokens for the learned-keyterm
      // miner. Bounded (top 40 by count) so payloads stay tiny even after
      // hour-long services. Server upserts + promotion logic lives in
      // /api/audio/session-metrics.
      const lowConfTokens = Array.from(lowConfTokensRef.current.entries())
        .filter(([, v]) => v.count >= 2) // one-off hits are noise, not preacher vocabulary
        .map(([, v]) => ({ display: v.display, count: v.count, avgConf: Math.round((v.sumConf / v.count) * 100) / 100 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 40);
      const payload = { sessionId, planId, durationSec, reconnects, avgConfidence, wordsHigh, wordsLow, startedAt, endedAt, lowConfTokens };
      const body = JSON.stringify(payload);
      // Prefer sendBeacon when the tab is unloading — fetch(keepalive) is
      // best-effort on unload and drops on some browsers if teardown is
      // already mid-flight. sendBeacon is guaranteed to be queued by the UA.
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      if (hidden && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        try {
          navigator.sendBeacon("/api/audio/session-metrics", new Blob([body], { type: "application/json" }));
        } catch { /* fall through to fetch */ }
      }
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
    // Cleared HERE (a real stop) rather than in teardown(): teardown runs on
    // every reconnect cycle, and clearing there kept re-disarming the 3s
    // downgrade so the pill stayed green ~7-30s into a genuine outage
    // (review 🟡). Leaving it to ride across reconnect teardowns means it
    // fires ~3s after the FIRST disconnect if we haven't re-readied by then.
    if (readyDowngradeTimerRef.current) { clearTimeout(readyDowngradeTimerRef.current); readyDowngradeTimerRef.current = null; }
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
      // Half-dead state fix: flip listening=false so the UI reflects reality
      // and the operator's mic chunks stop piling into a doomed ring buffer.
      // The reconnectFailed flag drives a "Retry" affordance in the AI Live pill.
      ringBufferRef.current = [];
      ringBufferBytesRef.current = 0;
      intentionalStopRef.current = true;
      // Reset the attempt counter on give-up so a subsequent operator click on
      // the AI pill is treated as a FRESH start (the optimistic listening:true
      // + reconnectFailed:false path), not a reconnect. Without this the ref
      // stayed at 9, so re-clicking the pill skipped the instant-ON path and
      // reintroduced the "connecting gap" + lingering Retry/Diagnose buttons.
      reconnectAttemptsRef.current = 0;
      setState((s) => ({ ...s, reconnectFailed: true, listening: false, ready: false, error: null }));
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

  const start = useCallback(async (opts?: { warm?: boolean }) => {
    // R6: reentry guard — if we're mid-init, don't spawn a duplicate pipeline.
    // Check the LATEST committed state via a ref check on wsRef, which is set
    // synchronously below.
    // (Fine-grained state check happens against pipelineGenerationRef.)
    intentionalStopRef.current = false;
    // Deterministic mic-mute state per invocation. Prior bug: warmStart set
    // micMutedRef=true then never got cleared on subsequent operator clicks,
    // so the WS opened but PCM chunks were suppressed at line ~1030 — Fly
    // saw a handshake but no audio, looked dead.
    micMutedRef.current = !!opts?.warm;

    // Two-tab defense was here (BroadcastChannel lease per planId) but was
    // false-positiving for testers who reload / have stale channels in the
    // same origin process — silently refusing to start with no way to
    // recover except closing the app. The double-billing risk it protected
    // against is minor; per-user cap on the Fly bridge already limits to 3
    // concurrent sessions per user. Re-add only with more robust ownership
    // tracking (unique-per-session UUID, TTL, explicit release on stop).
    // R6: bump generation. Every async callback captures this synchronously.
    const generation = ++pipelineGenerationRef.current;
    lastTranscriptAtRef.current = Date.now();
    // Snapshot always-on mode for the worklet hot path. Also proactively
    // clear any leftover gate-closed state so a mode flip (or a reconnect
    // that inherited a closed gate) can't leave audio suppressed.
    aiAlwaysOnRef.current = isAiAlwaysOn();
    if (aiAlwaysOnRef.current) {
      silenceClosedRef.current = false;
      setState((s) => ({ ...s, silenceGateClosed: false }));
    }
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
    // R10: this same start() function runs both for a fresh operator-initiated
    // start AND for every automatic reconnect (scheduleReconnect calls it
    // directly). Previously it unconditionally zeroed dgMessagesReceived and
    // reset stage to "idle" every time — so a brief, successful Fly/network
    // blip reconnect made the AI Live pill visibly flicker off and back on
    // (aiFlowing in TopBar derives from dgMessagesReceived > 0), even though
    // nothing was actually wrong. Only reset those on a genuinely fresh
    // start — a reconnect (reconnectAttemptsRef > 0, set by scheduleReconnect
    // before calling this) keeps the running counters so the pill stays
    // steady through the blip.
    const isReconnectAttempt = reconnectAttemptsRef.current > 0;
    if (isReconnectAttempt) {
      setState((s) => ({ ...s, error: null, stage: "idle" }));
    } else {
      // Fresh start: flip `listening` (the operator's ON/OFF intent) true
      // IMMEDIATELY so the pill reads "AI ON" the instant they click — the
      // mic/WS/Deepgram handshake then happens silently in the background.
      // The pill is now binary (ON = this flag), so there is no "connecting"
      // limbo for the operator to see; a genuine unrecoverable failure flips
      // it back to false (stop / give-up / fatal). Reconnects keep it true.
      setState((s) => ({ ...s, listening: true, error: null, reconnectFailed: false, stage: "idle", stageHistory: [], chunksSent: 0, dgMessagesReceived: 0 }));
      // Fresh start only — mirror the diagnostic-counter reset in the refs so
      // the throttled commit path starts from zero. On a reconnect these are
      // deliberately preserved (the pill must not flicker back to "no messages").
      dgMsgCountRef.current = 0;
      lastDgStateCommitAtRef.current = 0;
      lastLatencyMsRef.current = null;
    }
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
        // Include the last-observed stage so a tester can self-diagnose:
        // stuck at 'opening_ws' → network/firewall; 'requesting_ticket' →
        // auth or CSRF; 'mic_granted' but no deepgram_ready → Fly bridge down.
        return { ...s, error: `AI failed to initialise (stuck at ${s.stage})` };
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
      // Surface any non-2xx explicitly so the pill doesn't stay stuck
      // "connecting…" with no reason. 403 → CSRF/middleware; 429 → rate
      // limit; 500 → server outage; 402 → tier gate; etc.
      if (!ticketRes.ok) {
        let bodyText = "";
        try { bodyText = (await ticketRes.json())?.error || ""; } catch { /* not JSON */ }
        throw new Error(`Ticket ${ticketRes.status}${bodyText ? `: ${bodyText}` : ""}`);
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
          if (isDevOrTraceOn()) console.log(`[audio-buffer] retained ${ms} ms during reconnect`);
          for (const chunk of buffered) {
            try {
              const b64 = bytesToBase64(chunk);
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
        if (lat !== null) lastLatencyMsRef.current = lat;
        // Render-storm fix: track the true count in a ref every message, but
        // commit to React state only on the FIRST message (so aiFlowing → the
        // green pill lights immediately) and then at most ~1Hz. These are
        // diagnostic counters; the UI only needs "received > 0" promptly, not
        // an exact per-message tick.
        dgMsgCountRef.current += 1;
        if (dgMsgCountRef.current === 1 || now - lastDgStateCommitAtRef.current >= 1000) {
          lastDgStateCommitAtRef.current = now;
          const committedCount = dgMsgCountRef.current;
          setState((s) => ({ ...s, dgMessagesReceived: committedCount, msgsPerSec: rate, lastLatencyMs: lastLatencyMsRef.current ?? s.lastLatencyMs }));
        }
        // Task 10/11: track word-level confidence buckets for autopilot gating.
        // Roadmap #4: same walk feeds the learned-keyterm miner.
        if ((msg.type === "final" || msg.type === "interim_final_candidate") && Array.isArray(msg.words)) {
          for (const w of msg.words as { w?: string; c?: number }[]) {
            if (typeof w?.c !== "number") continue;
            if (w.c >= CONFIDENCE_THRESHOLD) wordsHighRef.current += 1;
            else wordsLowRef.current += 1;
            // Miner — only on `final` (skip interim-candidate which will
            // resurface as final and would double-count). Cased display
            // form comes straight from Deepgram which returns
            // smart-formatted, capitalized proper nouns; the normalized
            // key is lowercased.
            if (msg.type === "final" && typeof w.w === "string" && w.c < LEARNED_MINER_CONF_CEILING) {
              const rawDisplay = w.w.replace(/[^\p{L}\p{N}'\- ]/gu, "").trim();
              if (rawDisplay.length >= LEARNED_MINER_MIN_LEN && rawDisplay.length <= LEARNED_MINER_MAX_LEN) {
                const key = rawDisplay.toLowerCase();
                const prev = lowConfTokensRef.current.get(key);
                if (prev) {
                  prev.count += 1;
                  prev.sumConf += w.c;
                } else {
                  lowConfTokensRef.current.set(key, { display: rawDisplay, count: 1, sumConf: w.c });
                }
              }
            }
          }
        }
        if (msg.type === "final" && typeof msg.confidence === "number") {
          confSumRef.current += msg.confidence;
          confCountRef.current += 1;
          const avg = confSumRef.current / confCountRef.current;
          // Rolling-window quality signal (roadmap item #1). Session-lifetime
          // avgConfidence above is a long-term summary and can't detect a
          // stretch of BAD audio in a currently-good session — a rolling
          // window of the last N segments can. Hysteresis (drop-in at 0.65,
          // recover-out at 0.75) stops the chip flapping right at the
          // boundary.
          const AUDIO_QUALITY_WINDOW = 10;
          const AUDIO_QUALITY_LOW_ENTER = 0.65;
          const AUDIO_QUALITY_LOW_EXIT = 0.75;
          const AUDIO_QUALITY_MIN_SAMPLES = 5;
          rollingConfRef.current.push(msg.confidence);
          if (rollingConfRef.current.length > AUDIO_QUALITY_WINDOW) rollingConfRef.current.shift();
          const w = rollingConfRef.current;
          let nextQuality: "ok" | "low" | null = null;
          let rollAvg = 0;
          if (w.length >= AUDIO_QUALITY_MIN_SAMPLES) {
            rollAvg = w.reduce((a, b) => a + b, 0) / w.length;
            const prev = audioQualityStateRef.current;
            if (prev === "low") nextQuality = rollAvg >= AUDIO_QUALITY_LOW_EXIT ? "ok" : "low";
            else nextQuality = rollAvg < AUDIO_QUALITY_LOW_ENTER ? "low" : "ok";
            if (nextQuality !== prev) {
              audioQualityStateRef.current = nextQuality;
              try {
                if (typeof window !== "undefined") {
                  window.dispatchEvent(new CustomEvent(
                    nextQuality === "low" ? "presentflow:audio-quality-low" : "presentflow:audio-quality-ok",
                    { detail: { avg: rollAvg, samples: w.length } },
                  ));
                }
              } catch { /* noop */ }
            }
          }
          setState((s) => ({
            ...s,
            avgConfidence: Math.round(avg * 100) / 100,
            audioQuality: nextQuality,
            audioQualityAvg: Math.round(rollAvg * 100) / 100,
          }));
        }
        if (msg.type === "ready") {
          if (stallWatchdogRef.current) { clearTimeout(stallWatchdogRef.current); stallWatchdogRef.current = null; }
          // Reconnected (or fresh) socket is live again — cancel any pending
          // pill-downgrade so a fast blip never flashed "connecting".
          if (readyDowngradeTimerRef.current) { clearTimeout(readyDowngradeTimerRef.current); readyDowngradeTimerRef.current = null; }
          setStage("deepgram_ready"); log("5 deepgram ready"); setState((s) => ({ ...s, ready: true })); return;
        }
        if (msg.type === "interim") { setStage("receiving_interim"); log("7 interim", msg.text); }
        if (msg.type === "final") { setStage("receiving_final"); log("8 final", msg.text); }
        if (msg.type === "detection" || msg.type === "song" || msg.type === "command") log(`9 ${msg.type}`);
        if (msg.type === "interim") { lastTranscriptAtRef.current = Date.now(); setState((s) => ({ ...s, interim: msg.text })); }
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
          // Server sets wordsDropped when > 500 words were trimmed off a long
          // utterance. Persist that so the auto-approve gate can conservatively
          // block auto-live (no words to check → can't rule out low-conf).
          const wordsDropped = (msg as { wordsDropped?: boolean }).wordsDropped === true;
          setState((s) => ({
            ...s,
            interim: "",
            transcript: [...s.transcript, { id: msg.segmentId, text: msg.text, final: true, ts: Date.now(), words, wordsDropped }].slice(-100),
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
        else if (msg.type === "phrase_matches") setState((s) => ({
          ...s,
          phraseMatches: [{ segmentId: msg.segmentId, matchedText: msg.matchedText, candidates: msg.candidates, ts: Date.now() }, ...s.phraseMatches].slice(0, 10),
        }));
        else if (msg.type === "song") setState((s) => ({ ...s, songSuggestions: [msg.song, ...s.songSuggestions].slice(0, 30) }));
        else if (msg.type === "command") setState((s) => ({ ...s, commandSuggestions: [msg.command, ...s.commandSuggestions].slice(0, 30) }));
        else if (msg.type === "error") setState((s) => ({ ...s, error: msg.message }));
        else if (msg.type === "canonical_correction") {
          // Roadmap #2 — background canonical (Whisper) two-pass says
          // Deepgram's parse of this segment was wrong. Push a
          // correction chip so the operator can one-click swap; never
          // auto-swap during a live service (too jarring, and Whisper
          // isn't infallible either). Deduplicate: if we already have a
          // pending correction for this segment, replace it.
          const correction: CanonicalCorrection = {
            id: `cc-${msg.segmentId}-${Date.now()}`,
            segmentId: msg.segmentId,
            dgText: msg.dgText, whisperText: msg.whisperText,
            original: msg.original, corrected: msg.corrected,
            ts: Date.now(),
          };
          setState((s) => ({
            ...s,
            canonicalCorrections: [correction, ...s.canonicalCorrections.filter((c) => c.segmentId !== msg.segmentId)].slice(0, 10),
          }));
        }
      };

      ws.onerror = (e) => {
        log("WS error", e);
        // Suppress the "WebSocket error" red banner during transient Fly blips —
        // the reconnect loop already handles the recovery. Only surface if the
        // operator intentionally stopped or we've never successfully connected.
        if (intentionalStopRef.current || reconnectSuccessesRef.current === 0) {
          setState((s) => ({ ...s, error: "WebSocket error" }));
        }
      };
      ws.onclose = (e) => {
        log("WS close", { code: e.code, reason: e.reason });
        // Null wsRef if this is still the current ws — prior code only reset
        // wsRef in stop()/teardown(), so a warmStart() after an abnormal
        // close could see wsRef.current pointing at a CLOSED socket and
        // early-return `if (wsRef.current)`, wedging the pipeline until app
        // restart. Guarded so we don't clobber a newer ws already assigned.
        if (wsRef.current === ws) wsRef.current = null;
        const abnormal = e.code !== 1000 && e.code !== 1005;
        // Server sends 1008 for auth / ticket problems and 1011 for missing
        // config (e.g. DEEPGRAM_API_KEY). Both are non-recoverable by
        // reconnecting — surface the reason directly and stop the loop.
        const fatal = e.code === 1008 || e.code === 1011;
        if (fatal) {
          if (readyDowngradeTimerRef.current) { clearTimeout(readyDowngradeTimerRef.current); readyDowngradeTimerRef.current = null; }
          setState((s) => ({ ...s, ready: false, error: e.reason ? `Audio bridge: ${e.reason}` : s.error }));
          intentionalStopRef.current = true;
          if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
          setState((s) => ({ ...s, listening: false }));
          return;
        }
        if (abnormal && !intentionalStopRef.current) {
          // Keep `listening` true so the top-bar pill still shows "on" while
          // we reconnect behind the scenes — the operator shouldn't have to
          // touch anything for a transient Fly/network blip.
          //
          // Flicker fix: DON'T flip `ready` false immediately. A brief blip
          // (or the hourly proactive refresh) reopens in well under a second,
          // and an instantaneous ready:false→true round-trip made the AI
          // Live pill (and the LIVE TRANSCRIPT dot) visibly flash to
          // "connecting" and back every time. Hold `ready` for a short grace
          // window; only downgrade the pill if the reconnect is genuinely
          // taking a while. Cleared when the reconnected socket re-readies.
          if (!readyDowngradeTimerRef.current) {
            readyDowngradeTimerRef.current = setTimeout(() => {
              readyDowngradeTimerRef.current = null;
              setState((s) => ({ ...s, ready: false }));
            }, 3000);
          }
          scheduleReconnect();
        } else {
          if (readyDowngradeTimerRef.current) { clearTimeout(readyDowngradeTimerRef.current); readyDowngradeTimerRef.current = null; }
          setState((s) => ({ ...s, ready: false, listening: false }));
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
        // Give a specific actionable message per browser-level error name
        // rather than a raw string an operator can't act on.
        const name = (micErr as { name?: string })?.name || "";
        const msg = (micErr as { message?: string })?.message || "";
        if (name === "NotAllowedError" || /denied|permission/i.test(msg)) {
          // Electron only: distinguish "macOS never even offered the
          // permission dialog" (usually means this build isn't code-signed
          // — see electron/main.ts's launch-time check) from a plain user
          // denial, since the fix is completely different (reinstall a
          // signed build vs. just flipping a toggle in System Settings).
          const electronApi = (typeof window !== "undefined" ? (window as { electronAPI?: { audio?: { getMicPermissionStatus?: () => Promise<string> } } }).electronAPI : undefined);
          if (electronApi?.audio?.getMicPermissionStatus) {
            try {
              const status = await electronApi.audio.getMicPermissionStatus();
              if (status === "not-determined") {
                throw new Error("macOS never showed a microphone permission prompt for Present Flow — this usually means the app isn't code-signed yet. Try quitting and reopening the app once; if it still doesn't prompt, this needs a signed build to fix.");
              }
            } catch { /* fall through to the generic message below */ }
          }
          throw new Error("Microphone permission denied — enable it in System Settings → Privacy & Security → Microphone, then restart Present Flow.");
        }
        if (name === "NotFoundError" || /not found|no device/i.test(msg)) {
          throw new Error("No microphone found — connect a mic (or select one in Audio Setup) and try again.");
        }
        if (name === "NotReadableError" || /in use|busy/i.test(msg)) {
          throw new Error("Microphone is in use by another app (Zoom, OBS, Chrome tab). Close it and retry.");
        }
        throw new Error(`Microphone unavailable: ${msg || name || "unknown"}. Check Audio Setup and retry.`);
      }
      // R6: mic acquired but a newer start() superseded us — release + abort.
      if (generation !== pipelineGenerationRef.current) {
        try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
        try { ws.close(1000, "superseded"); } catch { /* ignore */ }
        return;
      }
      setStage("mic_granted"); log("4b mic granted", stream.getAudioTracks().map((t) => t.label));
      streamRef.current = stream;
      // Bluetooth / AirPods often refuse a 16kHz AudioContext (macOS HFP path
      // forces 8/16kHz mono; some drivers force 44.1kHz stereo). Try 16k
      // first; on failure fall back to the device's native rate and let the
      // worklet resample down to 16k PCM16 for the WS bridge.
      let audioCtx: AudioContext;
      try {
        audioCtx = new AudioContext({ sampleRate: 16000 });
      } catch (rateErr) {
        log("audioctx 16k unavailable, falling back to device rate", rateErr instanceof Error ? rateErr.message : String(rateErr));
        try {
          audioCtx = new AudioContext();
        } catch (fallbackErr) {
          throw new Error(`AudioContext creation failed on this device: ${fallbackErr instanceof Error ? fallbackErr.message : "unknown"}. Try switching from Bluetooth to a wired mic in Audio Input settings.`);
        }
      }
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === "suspended") await audioCtx.resume();
      setStage("audioctx_ready"); log("4c audioctx", { state: audioCtx.state, sampleRate: audioCtx.sampleRate });
      const source = audioCtx.createMediaStreamSource(stream);

      // Load inline worklet: downsamples to Int16 at 16 kHz and posts to main
      // thread. If the AudioContext is not natively 16 kHz (Bluetooth path),
      // the worklet linear-interpolates the incoming frame to the 16 kHz grid
      // — cheap, good-enough quality for speech, avoids shipping a WASM lib.
      const ctxRate = audioCtx.sampleRate;
      const workletCode = `
        const TARGET_RATE = 16000;
        const INPUT_RATE = ${ctxRate};
        const RATIO = INPUT_RATE / TARGET_RATE;
        class PCMSender extends AudioWorkletProcessor {
          process(inputs) {
            const input = inputs[0];
            if (!input || !input[0]) return true;
            const ch = input[0];
            let out;
            if (RATIO === 1) {
              out = new Int16Array(ch.length);
              for (let i = 0; i < ch.length; i++) {
                const s = Math.max(-1, Math.min(1, ch[i]));
                out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
            } else {
              const outLen = Math.floor(ch.length / RATIO);
              out = new Int16Array(outLen);
              for (let i = 0; i < outLen; i++) {
                const srcIdx = i * RATIO;
                const i0 = Math.floor(srcIdx);
                const i1 = Math.min(ch.length - 1, i0 + 1);
                const frac = srcIdx - i0;
                const sample = ch[i0] * (1 - frac) + ch[i1] * frac;
                const s = Math.max(-1, Math.min(1, sample));
                out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
            }
            this.port.postMessage(out.buffer, [out.buffer]);
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
        const alwaysOn = aiAlwaysOnRef.current;
        // R8: hysteresis. Close only after HOLD_MS below -60 dBFS; reopen
        // when audio climbs back above -55 dBFS.
        if (dbfs < SILENCE_CLOSE_DBFS) {
          if (silenceStartRef.current === null) silenceStartRef.current = nowMs;
          // In always-on mode (default) we NEVER close the gate — audio keeps
          // flowing full-time. The gate only engages when a machine has
          // explicitly opted out of always-on.
          if (!alwaysOn && !silenceClosedRef.current && nowMs - (silenceStartRef.current ?? nowMs) >= SILENCE_HOLD_MS) {
            silenceClosedRef.current = true;
            setState((s) => ({ ...s, silenceGateClosed: true }));
            if (isDevOrTraceOn()) console.log("[audio-silence] gate closed");
          }
        } else if (dbfs > SILENCE_OPEN_DBFS) {
          silenceStartRef.current = null;
          if (silenceClosedRef.current) {
            silenceClosedRef.current = false;
            setState((s) => ({ ...s, silenceGateClosed: false }));
            if (isDevOrTraceOn()) console.log("[audio-silence] gate opened");
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
        // Use the chunked base64 helper for consistency with reconnect flush
        // (was reintroducing the O(n²) String.fromCharCode loop here).
        const b64 = bytesToBase64(bytes);
        ws.send(JSON.stringify({ type: "audio", b64 }));
        sentChunks++;
        // Throttle chunksSent state to ~1Hz. Was firing on every worklet
        // message (~50Hz) → ~180K React commits/hour × 3h = ~540K commits
        // over a service just to update a diagnostic counter. UI reads it
        // via state so we still surface progress, but no more per-chunk churn.
        if (sentChunks - (lastChunkStateAtRef.current ?? 0) >= 40) {
          lastChunkStateAtRef.current = sentChunks;
          setState((s) => ({ ...s, chunksSent: sentChunks }));
        }
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

  // Privacy scope: capture only while the service-operating screen is mounted.
  // This hook lives in OperatorConsole (the screen you open to run a service),
  // so when the operator navigates away or closes the console, capture stops
  // and the OS mic is released. This is the single unmount-stop for the hook
  // (it replaced an older `() => stop()` effect with `[stop]` deps that could
  // also fire on a mid-mount stop-identity change). Combined with the
  // explicit-click-to-start gate, the open mic is bounded to "operator is on
  // the service console AND turned AI on" — always-on only changes behavior
  // *within* that window (no silence-sleep, no idle auto-pause), never the
  // window itself. A ref keeps this unmount-only (empty deps) while always
  // calling the latest stop(); stop() on an idle hook is a safe no-op, so a
  // dev StrictMode double-invoke is harmless.
  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; }, [stop]);
  useEffect(() => () => { try { stopRef.current(); } catch { /* ignore */ } }, []);

  // Auto-pause after prolonged silence. Cheap 30s interval poll (no per-render
  // side effect). Stops the pipeline and closes the WS to save Deepgram cost.
  //
  // Browsers throttle setInterval on hidden tabs to ~1min, so we also listen
  // for visibilitychange and re-check on tab-return so the operator doesn't
  // see a "still on" pill 12 min after silence started.
  useEffect(() => {
    if (autoPauseTimerRef.current) { clearInterval(autoPauseTimerRef.current); autoPauseTimerRef.current = null; }
    if (!state.listening) return;
    const check = () => {
      // Always-on mode never auto-pauses — operators asked for the AI to
      // stay live full-time and turn it off only by hand. The idle
      // auto-pause remains available as an explicit per-machine opt-in
      // (aiAlwaysOn = "0"), just off by default.
      if (isAiAlwaysOn()) return;
      if (!isAutoPauseEnabled()) return;
      const elapsed = Date.now() - lastTranscriptAtRef.current;
      if (elapsed < AUTO_PAUSE_MS) return;
      setState((s) => {
        if (s.stage !== "receiving_final") return s;
        intentionalStopRef.current = true;
        try { teardown(); } catch { /* ignore */ }
        return { ...s, stage: "paused", listening: false, ready: false, interim: "" };
      });
    };
    const iv = setInterval(check, 30_000);
    autoPauseTimerRef.current = iv;
    const onVisibility = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(iv);
      if (autoPauseTimerRef.current === iv) autoPauseTimerRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [state.listening, isAutoPauseEnabled, isAiAlwaysOn, teardown]);

  // Flush metrics + attempt clean teardown when the tab is unloaded or
  // backgrounded for good. Uses sendBeacon inside flushSessionMetrics when
  // document.visibilityState === "hidden".
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHide = () => {
      if (!sessionStartRef.current) return;
      try { flushSessionMetrics(); } catch { /* ignore */ }
    };
    const onPageHide = () => onHide();
    const onVisibility = () => { if (document.visibilityState === "hidden") onHide(); };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushSessionMetrics]);

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
    // Also react to the OS-level devicechange event (headphones unplugged
    // mid-service, USB interface hot-swapped, Bluetooth reconnect). Debounced
    // by 500ms — some drivers fire 3-4 events in a burst on plug/unplug.
    let deviceChangeTimer: ReturnType<typeof setTimeout> | null = null;
    const onDeviceChange = () => {
      if (deviceChangeTimer) clearTimeout(deviceChangeTimer);
      deviceChangeTimer = setTimeout(() => {
        deviceChangeTimer = null;
        if (!state.listening) return;
        if (isDevOrTraceOn()) console.log("[presentflow-audio] devicechange — restarting pipeline");
        stop();
        setTimeout(() => { startRef.current().catch(() => { /* ignore */ }); }, 100);
      }, 500);
    };
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    md?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      window.removeEventListener("presentflow:audio-input-changed", handler);
      md?.removeEventListener?.("devicechange", onDeviceChange);
      if (deviceChangeTimer) clearTimeout(deviceChangeTimer);
    };
  }, [state.listening, stop, isDevOrTraceOn]);

  const resume = useCallback(() => {
    lastTranscriptAtRef.current = Date.now();
    intentionalStopRef.current = false;
    micMutedRef.current = false;
    // Defensive: unlike restart()/stop(), this wasn't zeroing
    // reconnectAttemptsRef. Currently unreachable in practice (nothing calls
    // resume() while a reconnect backoff is pending), but if that changes,
    // a stale ref > 0 would make start() wrongly treat this fresh call as a
    // reconnect and skip resetting dgMessagesReceived/stageHistory.
    reconnectAttemptsRef.current = 0;
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
    setState((s) => ({ ...s, warmStarted: true }));
    // Pass warm:true so start() sets micMutedRef itself — no shared-ref leak
    // between warm-start and subsequent operator toggles.
    startRef.current({ warm: true }).catch(() => { /* ignore */ });
  }, [state.warmStarted, state.listening, isDevOrTraceOn]);

  // (Unmount capture-stop is handled by the empty-deps ref-based effect near
  // startRef above — see the "Privacy scope" comment. A prior `useEffect(() =>
  // () => stop(), [stop])` lived here but its `[stop]` deps meant its cleanup
  // could also fire on a mid-mount `stop`-identity change, not only true
  // unmount; the ref-based version is unmount-only and always calls the
  // latest stop, so this duplicate was removed.)

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
