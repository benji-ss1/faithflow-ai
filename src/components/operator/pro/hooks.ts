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
import {
  type TimerDefinition,
  type TimerRuntime,
  initialRuntime,
  computeRemainingSec,
  isOverrun,
  applyCommand,
  resolveTargetMs,
  type TimerCommand,
} from "@/engine/timers";
import {
  listTimerDefinitions,
  createTimerDefinition,
  updateTimerDefinition,
  deleteTimerDefinition,
  type TimerDefInput,
} from "@/lib/actions";

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
  hide: () => void;
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
  const hide = useCallback(() => setShown(false), []);

  return {
    state: { name, type, duration, remaining, running, shown, position },
    setName, setType, setDuration, toggleRun, reset, toggleShown, hide, setPosition,
  };
}

// ---------------------------------------------------- Multi-timer (Wave 7 P4)
// A church-persisted, multi-named-timer session built on the pure engine
// (@/engine/timers). ADDITIVE alongside the legacy useTimerSession above (which
// remains the single "quick timer", wire slot "default"). Each named timer here
// publishes a KEYED TimerOverlay (id = its slot id) so renderers paint them
// independently. Runtime (running/shown/position) is session-only — never
// persisted — so a fresh Sunday never resurrects last week's countdown.
const TIMERS_RUNTIME_KEY = "presentflow.pro.timers.runtime.v1";

// resolveTargetMs is now the pure engine helper (@/engine/timers) so it is
// directly unit-testable; re-exported here for existing importers.
export { resolveTargetMs };

export type TimerSlot = {
  def: TimerDefinition;
  /** Raw "HH:MM" for countdown_to (persisted); def.targetMs is the resolved value. */
  targetClock: string | null;
  runtime: TimerRuntime;
  remaining: number; // recomputed each tick for display
  overrun: boolean;
  shown: boolean;
  position: OverlayPosition;
  scale: number; // operator size multiplier (1 = default)
};

export type TimersApi = {
  slots: TimerSlot[];
  loading: boolean;
  refresh: () => Promise<void>;
  addTimer: (input: TimerDefInput) => Promise<void>;
  editTimer: (id: string, input: TimerDefInput) => Promise<void>;
  removeTimer: (id: string) => Promise<void>;
  command: (id: string, cmd: TimerCommand) => void;
  toggleShown: (id: string) => void;
  /** Hide one timer's audience overlay (idempotent). */
  hide: (id: string) => void;
  setPosition: (id: string, p: OverlayPosition) => void;
  setScale: (id: string, scale: number) => void;
};

type RuntimeMeta = { shown: boolean; position: OverlayPosition; scale: number };

export function useTimersSession(): TimersApi {
  const [defs, setDefs] = useState<Array<{ id: string; name: string; type: string; durationSec: number; targetClock: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [runtimes, setRuntimes] = useState<Record<string, TimerRuntime>>({});
  const [meta, setMeta] = useState<Record<string, RuntimeMeta>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  // countdown_to targets are resolved ONCE (at load / reset / re-show) and held
  // here, NOT recomputed each tick. If we re-resolved every 500ms, the instant
  // `now` crossed the target `resolveTargetMs` would roll +24h and the timer
  // would jump back to ~23:59 instead of counting NEGATIVE into overrun. Keyed
  // by def id; null = unparseable clock.
  const [targets, setTargets] = useState<Record<string, number | null>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await listTimerDefinitions();
      if (res.ok && res.data) {
        setDefs(res.data.map((d) => ({ id: d.id, name: d.name, type: d.type, durationSec: d.durationSec, targetClock: d.targetClock })));
      }
    } catch { /* offline / no session — leave list empty */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Resolve each countdown_to's target ONCE when it first appears; keep the
  // already-resolved value on subsequent def refreshes (a running countdown_to
  // must not silently re-roll to tomorrow just because the list reloaded), and
  // drop targets for removed defs. Re-resolution happens ONLY on reset/re-show
  // (see reresolveTarget below).
  useEffect(() => {
    setTargets((prev) => {
      const now = Date.now();
      const next: Record<string, number | null> = {};
      let changed = false;
      for (const d of defs) {
        if (d.type !== "countdown_to") continue;
        if (d.id in prev) next[d.id] = prev[d.id];
        else { next[d.id] = resolveTargetMs(d.targetClock, now); changed = true; }
      }
      if (!changed && Object.keys(prev).length === Object.keys(next).length) return prev;
      return next;
    });
  }, [defs]);

  // Re-resolve a single countdown_to's target to its NEXT occurrence — called on
  // an explicit reset or when the operator (re-)shows it, never on a tick.
  const reresolveTarget = useCallback((id: string) => {
    setTargets((prev) => {
      const d = defs.find((x) => x.id === id);
      if (!d || d.type !== "countdown_to") return prev;
      return { ...prev, [id]: resolveTargetMs(d.targetClock, Date.now()) };
    });
  }, [defs]);

  // Restore session-only runtime meta (shown NEVER restored — always starts hidden).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TIMERS_RUNTIME_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Record<string, { position?: unknown }>;
        const restored: Record<string, RuntimeMeta> = {};
        for (const k of Object.keys(p)) {
          const sc = Number((p[k] as { scale?: unknown })?.scale);
          restored[k] = { shown: false, position: sanitizePosition(p[k]?.position, "top-right"), scale: Number.isFinite(sc) && sc >= 0.25 && sc <= 8 ? sc : 1 };
        }
        setMeta(restored);
      }
    } catch { /* noop */ }
  }, []);

  // Tick the display clock at 2Hz ONLY when something actually needs it: a
  // running countdown/elapsed, ANY countdown_to (always clock-derived), or any
  // shown timer (its overlay heartbeats off `remaining`). A list of idle,
  // stopped, hidden countdowns must not spin a 2Hz interval all service.
  const anyRunning = Object.values(runtimes).some((r) => r.running);
  const anyCountdownTo = defs.some((d) => d.type === "countdown_to");
  const anyShown = Object.values(meta).some((m) => m.shown);
  const tickNeeded = anyRunning || anyCountdownTo || anyShown;
  useEffect(() => {
    if (!tickNeeded) return;
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, [tickNeeded]);

  const setMetaFor = useCallback((id: string, patch: Partial<RuntimeMeta>) => {
    setMeta((m) => {
      const prev = m[id] ?? { shown: false, position: "top-right" as OverlayPosition, scale: 1 };
      const next = { ...m, [id]: { ...prev, ...patch } };
      try {
        const persist: Record<string, { position: OverlayPosition; scale: number }> = {};
        for (const k of Object.keys(next)) persist[k] = { position: next[k].position, scale: next[k].scale };
        window.localStorage.setItem(TIMERS_RUNTIME_KEY, JSON.stringify(persist));
      } catch { /* noop */ }
      return next;
    });
  }, []);

  const command = useCallback((id: string, cmd: TimerCommand) => {
    // A reset re-rolls a countdown_to to its next occurrence (resolve-once rule).
    if (cmd === "reset") reresolveTarget(id);
    setRuntimes((rs) => {
      const def = defToEngine(defs.find((d) => d.id === id), targets[id] ?? null);
      if (!def) return rs;
      const cur = rs[id] ?? initialRuntime(def);
      return { ...rs, [id]: applyCommand(def, cur, cmd, Date.now()) };
    });
  }, [defs, targets, reresolveTarget]);

  const toggleShown = useCallback((id: string) => {
    const willShow = !(meta[id]?.shown ?? false);
    // Re-showing a countdown_to rolls it to the next occurrence.
    if (willShow) reresolveTarget(id);
    setMetaFor(id, { shown: willShow });
  }, [meta, setMetaFor, reresolveTarget]);
  const hide = useCallback((id: string) => setMetaFor(id, { shown: false }), [setMetaFor]);
  const setPosition = useCallback((id: string, p: OverlayPosition) => setMetaFor(id, { position: p }), [setMetaFor]);
  const setScale = useCallback((id: string, scale: number) => setMetaFor(id, { scale: Math.max(0.25, Math.min(8, scale)) }), [setMetaFor]);

  const addTimer = useCallback(async (input: TimerDefInput) => {
    const res = await createTimerDefinition(input);
    if (res.ok) await refresh();
  }, [refresh]);
  const editTimer = useCallback(async (id: string, input: TimerDefInput) => {
    const res = await updateTimerDefinition(id, input);
    if (res.ok) { await refresh(); command(id, "reset"); }
  }, [refresh, command]);
  const removeTimer = useCallback(async (id: string) => {
    const res = await deleteTimerDefinition(id);
    if (res.ok) {
      setRuntimes((rs) => { const n = { ...rs }; delete n[id]; return n; });
      await refresh();
    }
  }, [refresh]);

  const slots = useMemo<TimerSlot[]>(() => defs.map((d) => {
    const def = defToEngine(d, targets[d.id] ?? null)!;
    const runtime = runtimes[d.id] ?? initialRuntime(def);
    return {
      def,
      targetClock: d.targetClock,
      runtime,
      remaining: computeRemainingSec(def, runtime, nowMs),
      overrun: isOverrun(def, runtime, nowMs),
      shown: meta[d.id]?.shown ?? false,
      position: meta[d.id]?.position ?? "top-right",
      scale: meta[d.id]?.scale ?? 1,
    };
  }), [defs, runtimes, meta, nowMs, targets]);

  return { slots, loading, refresh, addTimer, editTimer, removeTimer, command, toggleShown, hide, setPosition, setScale };
}

/** Map a stored def row to the engine's TimerDefinition. `resolvedTargetMs` is
 *  the ALREADY-resolved countdown_to target (resolved once by the hook), not a
 *  clock to resolve per call — passing `nowMs` here would re-roll on overrun. */
function defToEngine(
  d: { id: string; name: string; type: string; durationSec: number; targetClock: string | null } | undefined,
  resolvedTargetMs: number | null,
): TimerDefinition | null {
  if (!d) return null;
  const type = (d.type === "countdown_to" || d.type === "elapsed" ? d.type : "countdown") as TimerDefinition["type"];
  return { id: d.id, name: d.name, type, durationSec: d.durationSec, targetMs: type === "countdown_to" ? resolvedTargetMs : null };
}

// ------------------------------------------------------------- Messages (R4)
const MSG_KEY = "presentflow.pro.messages.v1";
export type MessagesState = { text: string; dismiss: string; allowWeb: boolean; showing: boolean; position: OverlayPosition; scroll: boolean; scrollDir: "ltr" | "rtl"; scrollSec: number };
export type MessagesApi = {
  state: MessagesState;
  setText: (v: string) => void;
  setDismiss: (v: string) => void;
  setAllowWeb: (v: boolean) => void;
  setPosition: (v: OverlayPosition) => void;
  setScroll: (v: boolean) => void;
  setScrollDir: (v: "ltr" | "rtl") => void;
  setScrollSec: (v: number) => void;
  toggleShow: () => void;
  hide: () => void;
};

// Auto-dismiss durations. Owned here (not in MessagesTab) so the countdown
// survives the popover closing — the tab unmounts, the session hook doesn't.
const MSG_DISMISS_MS: Record<string, number> = {
  "5s": 5000, "10s": 10000, "30s": 30000, "1min": 60000, "5min": 300000,
};

export function useMessagesSession(): MessagesApi {
  const [state, setState] = useState<MessagesState>({ text: "", dismiss: "manual", allowWeb: false, showing: false, position: "lower-third", scroll: false, scrollDir: "rtl", scrollSec: 18 });

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
      const { text, dismiss, allowWeb, position, scroll, scrollDir, scrollSec } = state;
      window.localStorage.setItem(MSG_KEY, JSON.stringify({ text, dismiss, allowWeb, position, scroll, scrollDir, scrollSec }));
    } catch { /* noop */ }
  }, [state]);

  return {
    state,
    setText: (v) => setState((s) => ({ ...s, text: v })),
    setDismiss: (v) => setState((s) => ({ ...s, dismiss: v })),
    setAllowWeb: (v) => setState((s) => ({ ...s, allowWeb: v })),
    setPosition: (v) => setState((s) => ({ ...s, position: v })),
    setScroll: (v) => setState((s) => ({ ...s, scroll: v })),
    setScrollDir: (v) => setState((s) => ({ ...s, scrollDir: v })),
    setScrollSec: (v) => setState((s) => ({ ...s, scrollSec: Math.max(4, Math.min(120, Math.round(v) || 18)) })),
    toggleShow: () => setState((s) => ({ ...s, showing: !s.showing })),
    hide: () => setState((s) => (s.showing ? { ...s, showing: false } : s)),
  };
}

// ------------------------------------------- Message templates + board (Wave 7)
// ADDITIVE alongside useMessagesSession (the legacy single composer, wire slot
// "default"). Loads church-persisted TEMPLATES and manages a SESSION list of
// ACTIVE extra messages (each keyed) published via the wire's messages[] array.
// The {{timer}} / {{timer:ID}} token is expanded at post time (see
// expandMessageTokens) using the live timers snapshot.
import {
  listMessageTemplates,
  createMessageTemplate,
  updateMessageTemplate,
  deleteMessageTemplate,
  type MessageTemplateInput,
} from "@/lib/actions";
// Pure message-token helpers now live in the engine so they are directly
// unit-testable (hooks.ts pulls in "server-only" actions); re-exported for
// existing importers (ProOperatorShell).
import { expandMessageTokens, timerTokenValue } from "@/engine/timers/messages";
export { expandMessageTokens, timerTokenValue };

export type MessageTemplate = {
  id: string; name: string; text: string; position: OverlayPosition;
  config: { scroll?: boolean; scrollDir?: "ltr" | "rtl"; scrollSec?: number; allowWeb?: boolean; dismiss?: string; timerId?: string };
};

export type ActiveMessage = {
  id: string; text: string; position: OverlayPosition;
  scroll: boolean; scrollDir: "ltr" | "rtl"; scrollSec: number; allowWeb: boolean;
  dismiss: string; timerId?: string;
  /** Wave-7 fix pass: a hidden message STAYS in the list (with a Show action)
   *  so an operator can re-show it without re-picking the template. Hidden
   *  messages are filtered OUT of the wire post (see ProOperatorShell extras). */
  hidden?: boolean;
};

export type MessagesBoardApi = {
  templates: MessageTemplate[];
  loadingTemplates: boolean;
  refreshTemplates: () => Promise<void>;
  addTemplate: (input: MessageTemplateInput) => Promise<void>;
  editTemplate: (id: string, input: MessageTemplateInput) => Promise<void>;
  removeTemplate: (id: string) => Promise<void>;
  active: ActiveMessage[];
  activate: (m: Omit<ActiveMessage, "id">) => void;
  activateTemplate: (t: MessageTemplate) => void;
  /** Hide a message but keep it listed (re-showable via `show`). */
  hide: (id: string) => void;
  /** Re-show a previously hidden message. */
  show: (id: string) => void;
  /** Permanently drop a message from the list. */
  remove: (id: string) => void;
  clearAll: () => void;
};

const MSG_TEMPLATE_DISMISS_MS: Record<string, number> = MSG_DISMISS_MS;
let activeMsgSeq = 0;

export function useMessagesBoard(): MessagesBoardApi {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [active, setActive] = useState<ActiveMessage[]>([]);

  const refreshTemplates = useCallback(async () => {
    try {
      const res = await listMessageTemplates();
      if (res.ok && res.data) {
        setTemplates(res.data.map((r) => ({
          id: r.id, name: r.name, text: r.text,
          position: sanitizePosition(r.position, "lower-third"),
          config: (r.config as MessageTemplate["config"]) ?? {},
        })));
      }
    } catch { /* offline — leave empty */ }
    finally { setLoadingTemplates(false); }
  }, []);
  useEffect(() => { void refreshTemplates(); }, [refreshTemplates]);

  const addTemplate = useCallback(async (input: MessageTemplateInput) => { const r = await createMessageTemplate(input); if (r.ok) await refreshTemplates(); }, [refreshTemplates]);
  const editTemplate = useCallback(async (id: string, input: MessageTemplateInput) => { const r = await updateMessageTemplate(id, input); if (r.ok) await refreshTemplates(); }, [refreshTemplates]);
  const removeTemplate = useCallback(async (id: string) => { const r = await deleteMessageTemplate(id); if (r.ok) await refreshTemplates(); }, [refreshTemplates]);

  const hide = useCallback((id: string) => setActive((a) => a.map((m) => m.id === id ? { ...m, hidden: true } : m)), []);
  const show = useCallback((id: string) => setActive((a) => a.map((m) => m.id === id ? { ...m, hidden: false } : m)), []);
  const remove = useCallback((id: string) => setActive((a) => a.filter((m) => m.id !== id)), []);
  const clearAll = useCallback(() => setActive([]), []);

  const activate = useCallback((m: Omit<ActiveMessage, "id">) => {
    const id = `m${Date.now().toString(36)}${(activeMsgSeq++).toString(36)}`;
    setActive((a) => [...a.filter((x) => x.text !== m.text || x.position !== m.position), { ...m, id }]);
    // Auto-dismiss (session-side; the wire also carries dismissAfterMs so the
    // renderer independently hides it).
    const ms = MSG_TEMPLATE_DISMISS_MS[m.dismiss];
    if (ms) setTimeout(() => setActive((a) => a.filter((x) => x.id !== id)), ms);
  }, []);

  const activateTemplate = useCallback((t: MessageTemplate) => {
    activate({
      text: t.text, position: t.position,
      scroll: t.config.scroll ?? false, scrollDir: t.config.scrollDir ?? "rtl",
      scrollSec: t.config.scrollSec ?? 18, allowWeb: t.config.allowWeb ?? false,
      dismiss: t.config.dismiss ?? "manual", timerId: t.config.timerId,
    });
  }, [activate]);

  return { templates, loadingTemplates, refreshTemplates, addTemplate, editTemplate, removeTemplate, active, activate, activateTemplate, hide, show, remove, clearAll };
}

// ---------------------------------------------------------------- Bible (R5)
export type VerseCard = {
  id: string;
  label: string;
  // Y7: per-verse structure lets us respect showVerseNumbers/refFormat
  verses: Array<{ verse: number; text: string }>;
  /** R8: placeholder cards (loading / lookup-failed / out-of-range) must NEVER auto-fire. */
  placeholder?: boolean;
  /** 2026-08-15: set when the reference parsed fine but the verse doesn't exist
   *  in the Bible (e.g. "Genesis 1:102"). Carries a friendly notice to show on
   *  the operator + projector instead of a blank slide. Never auto-fires. */
  invalid?: string;
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
