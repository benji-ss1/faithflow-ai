"use client";
/**
 * Session-scoped state hooks for ProOperatorShell zones.
 *
 * These hooks live at the shell level so state survives tab/mode switches
 * (Radix Tabs unmounts inactive Tabs.Content — R4/R5). Consumers read/write
 * via the returned tuple; the shell mounts each hook once so ticks/timers
 * run independently of tab visibility.
 */
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------- Timer (R4)
const TIMER_KEY = "presentflow.pro.timer.v1";
export type TimerType = "countdown" | "countdown_to" | "elapsed";

export type TimerState = {
  name: string;
  type: TimerType;
  duration: string; // mm:ss
  remaining: number; // seconds
  running: boolean;
};

export type TimerApi = {
  state: TimerState;
  setName: (n: string) => void;
  setType: (t: TimerType) => void;
  setDuration: (d: string) => void;
  toggleRun: () => void;
  reset: () => void;
};

export function useTimerSession(): TimerApi {
  const [name, setName] = useState("Timer");
  const [type, setType] = useState<TimerType>("countdown");
  const [duration, setDuration] = useState("05:00");
  const [remaining, setRemaining] = useState(300);
  const [running, setRunning] = useState(false);
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
      }
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(TIMER_KEY, JSON.stringify({ name, type, duration })); } catch { /* noop */ }
    const [mm, ss] = duration.split(":").map((x) => parseInt(x, 10) || 0);
    baseline.current = mm * 60 + ss;
    if (!running) setRemaining(baseline.current);
  }, [name, type, duration, running]);

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

  return {
    state: { name, type, duration, remaining, running },
    setName, setType, setDuration, toggleRun, reset,
  };
}

// ------------------------------------------------------------- Messages (R4)
const MSG_KEY = "presentflow.pro.messages.v1";
export type MessagesState = { text: string; dismiss: string; allowWeb: boolean; showing: boolean };
export type MessagesApi = {
  state: MessagesState;
  setText: (v: string) => void;
  setDismiss: (v: string) => void;
  setAllowWeb: (v: boolean) => void;
  toggleShow: () => void;
};

export function useMessagesSession(): MessagesApi {
  const [state, setState] = useState<MessagesState>({ text: "", dismiss: "manual", allowWeb: false, showing: false });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MSG_KEY);
      if (raw) setState((s) => ({ ...s, ...JSON.parse(raw) }));
    } catch { /* noop */ }
  }, []);
  useEffect(() => {
    try {
      const { text, dismiss, allowWeb } = state;
      window.localStorage.setItem(MSG_KEY, JSON.stringify({ text, dismiss, allowWeb }));
    } catch { /* noop */ }
  }, [state]);

  return {
    state,
    setText: (v) => setState((s) => ({ ...s, text: v })),
    setDismiss: (v) => setState((s) => ({ ...s, dismiss: v })),
    setAllowWeb: (v) => setState((s) => ({ ...s, allowWeb: v })),
    toggleShow: () => setState((s) => ({ ...s, showing: !s.showing })),
  };
}

// ---------------------------------------------------------------- Bible (R5)
export type VerseCard = {
  id: string;
  label: string;
  // Y7: per-verse structure lets us respect showVerseNumbers/refFormat
  verses: Array<{ verse: number; text: string }>;
};

export type BibleSessionState = {
  ref: string;
  translation: string;
  cards: VerseCard[];
  selectedIdx: number | null;
  loading: boolean;
};

export type BibleSessionApi = {
  state: BibleSessionState;
  setRef: (v: string) => void;
  setTranslation: (v: string) => void;
  setCards: (c: VerseCard[]) => void;
  setSelectedIdx: (i: number | null) => void;
  setLoading: (v: boolean) => void;
};

export function useBibleSession(defaultTranslationCode: string): BibleSessionApi {
  const [state, setState] = useState<BibleSessionState>({
    ref: "John 3:16",
    translation: defaultTranslationCode || "KJV",
    cards: [],
    selectedIdx: null,
    loading: false,
  });

  return {
    state,
    setRef: (v) => setState((s) => ({ ...s, ref: v })),
    setTranslation: (v) => setState((s) => ({ ...s, translation: v })),
    setCards: (c) => setState((s) => ({ ...s, cards: c })),
    setSelectedIdx: (i) => setState((s) => ({ ...s, selectedIdx: i })),
    setLoading: (v) => setState((s) => ({ ...s, loading: v })),
  };
}
