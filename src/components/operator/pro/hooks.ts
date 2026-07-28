"use client";
/**
 * Session-scoped state hooks for ProOperatorShell zones.
 *
 * These hooks live at the shell level so state survives tab/mode switches
 * (Radix Tabs unmounts inactive Tabs.Content — R4/R5). Consumers read/write
 * via the returned tuple; the shell mounts each hook once so ticks/timers
 * run independently of tab visibility.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OVERLAY_POSITIONS, type OverlayPosition } from "@/lib/broadcast";

function sanitizePosition(p: unknown, fallback: OverlayPosition): OverlayPosition {
  return typeof p === "string" && (OVERLAY_POSITIONS as string[]).includes(p) ? (p as OverlayPosition) : fallback;
}

// ---------------------------------------------------------------- Timer (R4)
const TIMER_KEY = "presentflow.pro.timer.v1";
export type TimerType = "countdown" | "countdown_to" | "elapsed";

export type TimerState = {
  name: string;
  type: TimerType;
  duration: string; // mm:ss
  remaining: number; // seconds
  running: boolean;
  /** Whether the timer overlay is projected on live/stage outputs. */
  shown: boolean;
  position: OverlayPosition;
};

export type TimerApi = {
  state: TimerState;
  setName: (n: string) => void;
  setType: (t: TimerType) => void;
  setDuration: (d: string) => void;
  toggleRun: () => void;
  reset: () => void;
  toggleShown: () => void;
  setPosition: (p: OverlayPosition) => void;
};

export function useTimerSession(): TimerApi {
  const [name, setName] = useState("Timer");
  const [type, setType] = useState<TimerType>("countdown");
  const [duration, setDuration] = useState("05:00");
  const [remaining, setRemaining] = useState(300);
  const [running, setRunning] = useState(false);
  // "shown" is deliberately NOT persisted — a fresh operator session should
  // never resurrect a projected timer overlay from last week's service.
  const [shown, setShown] = useState(false);
  const [position, setPosition] = useState<OverlayPosition>("top-right");
  const startedAt = useRef<number | null>(null);
  const baseline = useRef(300);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TIMER_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        setName(p.name ?? "Timer");
        setType(p.type ?? "countdown");
        setDuration(p.duration ?? "05:00");
        setPosition(sanitizePosition(p.position, "top-right"));
      }
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(TIMER_KEY, JSON.stringify({ name, type, duration, position })); } catch { /* noop */ }
    const [mm, ss] = duration.split(":").map((x) => parseInt(x, 10) || 0);
    baseline.current = mm * 60 + ss;
    if (!running) setRemaining(baseline.current);
  }, [name, type, duration, running, position]);

  useEffect(() => {
    if (!running) return;
    startedAt.current = Date.now();
    const start = baseline.current;
    const id = setInterval(() => {
      const elapsed = (Date.now() - (startedAt.current ?? Date.now())) / 1000;
      setRemaining(type === "elapsed" ? elapsed : start - elapsed);
    }, 250);
    return () => clearInterval(id);
  }, [running, type]);

  const toggleRun = useCallback(() => setRunning((r) => !r), []);
  const reset = useCallback(() => { setRunning(false); setRemaining(baseline.current); }, []);
  const toggleShown = useCallback(() => setShown((s) => !s), []);

  return {
    state: { name, type, duration, remaining, running, shown, position },
    setName, setType, setDuration, toggleRun, reset, toggleShown, setPosition,
  };
}

// ------------------------------------------------------------- Messages (R4)
const MSG_KEY = "presentflow.pro.messages.v1";
export type MessagesState = { text: string; dismiss: string; allowWeb: boolean; showing: boolean; position: OverlayPosition };
export type MessagesApi = {
  state: MessagesState;
  setText: (v: string) => void;
  setDismiss: (v: string) => void;
  setAllowWeb: (v: boolean) => void;
  setPosition: (v: OverlayPosition) => void;
  toggleShow: () => void;
};

// Auto-dismiss durations. Owned here (not in MessagesTab) so the countdown
// survives the popover closing — the tab unmounts, the session hook doesn't.
const MSG_DISMISS_MS: Record<string, number> = {
  "5s": 5000, "10s": 10000, "30s": 30000, "1min": 60000, "5min": 300000,
};

export function useMessagesSession(): MessagesApi {
  const [state, setState] = useState<MessagesState>({ text: "", dismiss: "manual", allowWeb: false, showing: false, position: "lower-third" });

  // Auto-dismiss: when showing and dismiss !== manual, flip showing:false
  // after N ms. Lives at the session (shell) level so closing the Messages
  // popover can't strand operator state at "showing" while the projector
  // has already hidden the overlay.
  useEffect(() => {
    if (!state.showing) return;
    const ms = MSG_DISMISS_MS[state.dismiss];
    if (!ms) return;
    const id = setTimeout(() => setState((s) => ({ ...s, showing: false })), ms);
    return () => clearTimeout(id);
  }, [state.showing, state.dismiss]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MSG_KEY);
      // `showing` is intentionally never persisted/restored — a message must
      // not resurrect onto the projector from a previous session.
      if (raw) {
        const p = JSON.parse(raw) as Partial<MessagesState>;
        setState((s) => ({ ...s, ...p, position: sanitizePosition(p.position, "lower-third"), showing: false }));
      }
    } catch { /* noop */ }
  }, []);
  useEffect(() => {
    try {
      const { text, dismiss, allowWeb, position } = state;
      window.localStorage.setItem(MSG_KEY, JSON.stringify({ text, dismiss, allowWeb, position }));
    } catch { /* noop */ }
  }, [state]);

  return {
    state,
    setText: (v) => setState((s) => ({ ...s, text: v })),
    setDismiss: (v) => setState((s) => ({ ...s, dismiss: v })),
    setAllowWeb: (v) => setState((s) => ({ ...s, allowWeb: v })),
    setPosition: (v) => setState((s) => ({ ...s, position: v })),
    toggleShow: () => setState((s) => ({ ...s, showing: !s.showing })),
  };
}

// ---------------------------------------------------------------- Bible (R5)
export type VerseCard = {
  id: string;
  label: string;
  // Y7: per-verse structure lets us respect showVerseNumbers/refFormat
  verses: Array<{ verse: number; text: string }>;
  /** R8: placeholder cards (loading / lookup-failed / out-of-range) must NEVER auto-fire. */
  placeholder?: boolean;
};

export type BibleSessionState = {
  ref: string;
  translation: string;
  cards: VerseCard[];
  selectedIdx: number | null;
  loading: boolean;
  // Phrase-search results survive tab switches. Local state in BibleMode
  // would be wiped when the operator flips to Songs/Media (Radix Tabs
  // unmounts inactive content).
  phraseHits: Array<{ book: string; chapter: number; verse: number; text: string; matched?: string }>;
  phraseQuery: string;
  resultsLimit: number;
};

export type BibleSessionApi = {
  state: BibleSessionState;
  setRef: (v: string) => void;
  setTranslation: (v: string) => void;
  setCards: (c: VerseCard[]) => void;
  setSelectedIdx: (i: number | null) => void;
  setLoading: (v: boolean) => void;
  setPhraseHits: (h: BibleSessionState["phraseHits"]) => void;
  setPhraseQuery: (q: string) => void;
  setResultsLimit: (n: number) => void;
};

export function useBibleSession(defaultTranslationCode: string): BibleSessionApi {
  const [state, setState] = useState<BibleSessionState>({
    ref: "John 3:16",
    translation: defaultTranslationCode || "KJV",
    cards: [],
    selectedIdx: null,
    loading: false,
    phraseHits: [],
    phraseQuery: "",
    resultsLimit: 20,
  });

  // Y5: memoize the returned api so effects with `bibleSession` in the deps
  // list don't re-fire on every render. Only `state` changes should trigger.
  const setRef = useCallback((v: string) => setState((s) => ({ ...s, ref: v })), []);
  const setTranslation = useCallback((v: string) => setState((s) => ({ ...s, translation: v })), []);
  const setCards = useCallback((c: VerseCard[]) => setState((s) => ({ ...s, cards: c })), []);
  const setSelectedIdx = useCallback((i: number | null) => setState((s) => ({ ...s, selectedIdx: i })), []);
  const setLoading = useCallback((v: boolean) => setState((s) => ({ ...s, loading: v })), []);
  const setPhraseHits = useCallback((h: BibleSessionState["phraseHits"]) => setState((s) => ({ ...s, phraseHits: h })), []);
  const setPhraseQuery = useCallback((q: string) => setState((s) => ({ ...s, phraseQuery: q })), []);
  const setResultsLimit = useCallback((n: number) => setState((s) => ({ ...s, resultsLimit: n })), []);

  return useMemo(() => ({
    state, setRef, setTranslation, setCards, setSelectedIdx, setLoading,
    setPhraseHits, setPhraseQuery, setResultsLimit,
  }), [state, setRef, setTranslation, setCards, setSelectedIdx, setLoading,
       setPhraseHits, setPhraseQuery, setResultsLimit]);
}
