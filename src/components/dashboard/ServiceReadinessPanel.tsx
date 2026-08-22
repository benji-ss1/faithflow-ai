"use client";
/**
 * One consolidated "Service readiness" surface that auto-cycles through the
 * things a church needs before Sunday — Operational Prep, AI Health, Audio
 * (Readiness) and Output — instead of four separate always-visible cards.
 *
 * Design intent (from the owner):
 *  - It "flickers" (auto-rotates) between the sections.
 *  - Each item ticks off (with a little pop animation) once it's satisfied,
 *    then DROPS OUT of the rotation — so a fully-set-up church watches the
 *    whole thing melt down to a calm "you're all set" state.
 *  - Auto-detected signals tick themselves; anything the web can't see yet
 *    (audio/projector connected on the desktop — live heartbeat lands after
 *    Sunday) can be ticked MANUALLY, persisted per-church in localStorage.
 *  - AI Health runs a REAL check against /api/health/* — green → drops out;
 *    if something breaks later it comes back (re-checked every visit).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Mic,
  MonitorPlay,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

export type PrepItem = { key: string; label: string; hint: string; done: boolean; href: string };

type Props = {
  churchId: string;
  nextService: { title: string; date: string } | null;
  prep: PrepItem[];
  ai: { pending: number; reviewed: number };
  audio: { done: boolean; label: string | null };
  output: { done: boolean };
};

type Manual = { audio?: boolean; output?: boolean; prep?: Record<string, boolean> };

const ROTATE_MS = 6500;

function storageKey(churchId: string) {
  return `pf.readiness.${churchId}.v1`;
}

function loadManual(churchId: string): Manual {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(storageKey(churchId)) || "{}") as Manual;
  } catch {
    return {};
  }
}

type HealthState = "checking" | "ok" | "fail";
type Check = { key: string; label: string; state: HealthState; hint?: string; blocking: boolean };

// `blocking` = whether this check must be green for the panel to count as
// healthy and drop out of the rotation. Deepgram is NON-blocking: its key
// lives on the Fly.io audio bridge, not on this Vercel process, so its health
// route reports red on the web by design — it's shown for info, never blocks.
const HEALTH_ENDPOINTS: { key: string; label: string; url: string; blocking: boolean }[] = [
  { key: "ai", label: "AI (Groq)", url: "/api/health/ai", blocking: true },
  { key: "db", label: "Database", url: "/api/health/db", blocking: true },
  { key: "storage", label: "Media storage", url: "/api/health/storage", blocking: true },
  { key: "deepgram", label: "Transcription", url: "/api/health/deepgram", blocking: false },
];

export function ServiceReadinessPanel(props: Props) {
  const { churchId, nextService, prep, ai, audio, output } = props;
  const [manual, setManual] = useState<Manual>({});
  const [checks, setChecks] = useState<Check[]>(
    HEALTH_ENDPOINTS.map((e) => ({ key: e.key, label: e.label, state: "checking" as HealthState, blocking: e.blocking })),
  );
  const [showDone, setShowDone] = useState(false);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // localStorage is only available client-side — hydrate after mount.
  useEffect(() => setManual(loadManual(churchId)), [churchId]);

  const persist = useCallback(
    (next: Manual) => {
      setManual(next);
      try {
        window.localStorage.setItem(storageKey(churchId), JSON.stringify(next));
      } catch {
        /* private mode / quota — non-fatal, ticks just won't persist */
      }
    },
    [churchId],
  );

  const runHealth = useCallback(async () => {
    setChecks(
      HEALTH_ENDPOINTS.map((e) => ({ key: e.key, label: e.label, state: "checking", blocking: e.blocking })),
    );
    const results = await Promise.all(
      HEALTH_ENDPOINTS.map(async (e) => {
        try {
          // Timeout each probe — a half-open connection would otherwise never
          // settle, leaving Promise.all (and the panel) stuck in "checking".
          const res = await fetch(e.url, { cache: "no-store", signal: AbortSignal.timeout(7000) });
          const data = await res.json().catch(() => ({}));
          const ok = res.ok && data?.ok !== false;
          return { key: e.key, label: e.label, state: (ok ? "ok" : "fail") as HealthState, hint: data?.hint, blocking: e.blocking };
        } catch {
          return { key: e.key, label: e.label, state: "fail" as HealthState, hint: "Could not reach the check", blocking: e.blocking };
        }
      }),
    );
    setChecks(results);
  }, []);

  useEffect(() => {
    runHealth();
  }, [runHealth]);

  // Healthy = every BLOCKING check is green (deepgram is informational — its
  // key lives on Fly, so it's red on the web by design and must not block).
  const blocking = checks.filter((c) => c.blocking);
  const aiHealthy = blocking.length > 0 && blocking.every((c) => c.state === "ok");
  const aiChecking = checks.some((c) => c.state === "checking");

  // Effective completion (auto signal OR manual tick).
  const prepEffective = useMemo(
    () => prep.map((p) => ({ ...p, done: p.done || !!manual.prep?.[p.key] })),
    [prep, manual.prep],
  );
  const prepDone = prepEffective.every((p) => p.done);
  const audioDone = audio.done || !!manual.audio;
  const outputDone = output.done || !!manual.output;

  const panels = useMemo(() => {
    const all = [
      { id: "prep", complete: prepDone },
      { id: "ai", complete: aiHealthy },
      { id: "audio", complete: audioDone },
      { id: "output", complete: outputDone },
    ] as const;
    return all;
  }, [prepDone, aiHealthy, audioDone, outputDone]);

  const incomplete = panels.filter((p) => !p.complete);
  const completeCount = panels.length - incomplete.length;
  const allReady = incomplete.length === 0;

  // Keep the rotation index valid as panels drop out.
  useEffect(() => {
    if (index >= incomplete.length) setIndex(0);
  }, [incomplete.length, index]);

  // Auto-rotate ("flicker") through the incomplete panels.
  const reduceMotion = useRef(false);
  useEffect(() => {
    reduceMotion.current =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  useEffect(() => {
    if (paused || allReady || incomplete.length < 2 || reduceMotion.current) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % incomplete.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused, allReady, incomplete.length]);

  const activeId = incomplete[Math.min(index, incomplete.length - 1)]?.id;

  const tickAudio = () => persist({ ...manual, audio: true });
  const tickOutput = () => persist({ ...manual, output: true });
  const tickPrep = (key: string) => persist({ ...manual, prep: { ...manual.prep, [key]: true } });
  const resetAll = () => persist({});

  return (
    <section
      className="rounded-[10px] border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-card)] p-6"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pf-admin-text-muted)]">
            Service readiness
          </div>
          <div className="mt-1 text-base font-semibold tracking-[-0.01em] text-[var(--pf-admin-text)]">
            {allReady ? "You're all set for Sunday" : `${completeCount} of ${panels.length} ready`}
          </div>
          {nextService ? (
            <div className="mt-0.5 text-xs text-[var(--pf-admin-text-secondary)]">
              Next service · {nextService.title} · {nextService.date}
            </div>
          ) : null}
        </div>

        {!allReady && incomplete.length > 1 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous"
              onClick={() => setIndex((i) => (i - 1 + incomplete.length) % incomplete.length)}
              className="grid h-7 w-7 place-items-center rounded-md border border-[var(--pf-admin-border)] text-[var(--pf-admin-text-secondary)] hover:bg-[var(--pf-admin-bg-hover)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1.5">
              {incomplete.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  aria-label={`Go to ${p.id}`}
                  onClick={() => setIndex(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === index
                      ? "w-5 bg-[var(--pf-admin-accent)]"
                      : "w-1.5 bg-[var(--pf-admin-border)] hover:bg-[var(--pf-admin-text-muted)]"
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              aria-label="Next"
              onClick={() => setIndex((i) => (i + 1) % incomplete.length)}
              className="grid h-7 w-7 place-items-center rounded-md border border-[var(--pf-admin-border)] text-[var(--pf-admin-text-secondary)] hover:bg-[var(--pf-admin-bg-hover)]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>

      {/* Body */}
      <div className="min-h-[168px]">
        {allReady ? (
          <AllSetPanel
            prep={prepEffective}
            audioLabel={audio.label}
            showDone={showDone}
            onToggleDone={() => setShowDone((v) => !v)}
            onReset={resetAll}
          />
        ) : (
          <div key={activeId} className="pf-fade">
            {activeId === "prep" && <PrepPanel items={prepEffective} onTick={tickPrep} />}
            {activeId === "ai" && (
              <AiPanel ai={ai} checks={checks} checking={aiChecking} onRecheck={runHealth} />
            )}
            {activeId === "audio" && <AudioPanel label={audio.label} onTick={tickAudio} />}
            {activeId === "output" && <OutputPanel onTick={tickOutput} />}
          </div>
        )}
      </div>

      <style jsx>{`
        .pf-fade {
          animation: pfFade 420ms ease;
        }
        @keyframes pfFade {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pf-fade {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}

/* ---------- individual panels ---------- */

function PanelHead({ icon, eyebrow, title }: { icon: React.ReactNode; eyebrow: string; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[var(--pf-admin-accent-soft)]">{icon}</div>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pf-admin-text-muted)]">
          {eyebrow}
        </div>
        <div className="text-sm font-semibold text-[var(--pf-admin-text)]">{title}</div>
      </div>
    </div>
  );
}

function TickButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--pf-admin-border)] px-2.5 text-xs font-medium text-[var(--pf-admin-text)] transition hover:border-[var(--pf-admin-accent)] hover:bg-[var(--pf-admin-accent-soft)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--pf-admin-accent-ring)]"
    >
      <Check className="h-3 w-3" /> {children}
    </button>
  );
}

function PrepPanel({ items, onTick }: { items: PrepItem[]; onTick: (key: string) => void }) {
  return (
    <div>
      <PanelHead
        icon={<Sparkles className="h-5 w-5 text-[var(--pf-admin-accent)]" />}
        eyebrow="Operational prep"
        title="First-time setup"
      />
      <div className="space-y-1.5">
        {items.map((item) => (
          <div
            key={item.key}
            className="flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 hover:border-[var(--pf-admin-border-subtle)]"
          >
            {item.done ? (
              <CheckCircle2 className="pf-pop h-[18px] w-[18px] shrink-0 text-[var(--pf-admin-green)]" />
            ) : (
              <TriangleAlert className="h-[18px] w-[18px] shrink-0 text-[var(--pf-admin-gold)]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--pf-admin-text)]">{item.label}</div>
              <div className="truncate text-xs text-[var(--pf-admin-text-secondary)]">{item.hint}</div>
            </div>
            {item.done ? null : (
              <div className="flex items-center gap-1.5">
                <TickButton onClick={() => onTick(item.key)}>Done</TickButton>
                <Link
                  href={item.href}
                  className="grid h-7 w-7 place-items-center rounded-md text-[var(--pf-admin-text-muted)] hover:bg-[var(--pf-admin-bg-hover)]"
                  aria-label={`Open ${item.label}`}
                >
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </div>
        ))}
      </div>
      <PopStyle />
    </div>
  );
}

function AiPanel({
  ai,
  checks,
  checking,
  onRecheck,
}: {
  ai: { pending: number; reviewed: number };
  checks: Check[];
  checking: boolean;
  onRecheck: () => void;
}) {
  // Only BLOCKING failures mean "needs attention". A non-blocking fail
  // (deepgram, whose key lives on Fly) is shown muted, not as an alarm.
  const blockingFailing = checks.filter((c) => c.blocking && c.state === "fail");
  const infoHint = blockingFailing[0]?.hint;
  return (
    <div>
      <PanelHead
        icon={<Bot className="h-5 w-5 text-[var(--pf-admin-accent)]" />}
        eyebrow="AI health"
        title={checking ? "Running check…" : blockingFailing.length ? "Needs attention" : "AI systems healthy"}
      />
      <div className="grid grid-cols-2 gap-1.5">
        {checks.map((c) => {
          const softFail = !c.blocking && c.state === "fail";
          return (
            <div key={c.key} className="flex items-center gap-2 rounded-md bg-[var(--pf-admin-bg-subtle)] px-2.5 py-1.5">
              {c.state === "checking" ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-[var(--pf-admin-text-muted)]" />
              ) : c.state === "ok" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-[var(--pf-admin-green)]" />
              ) : softFail ? (
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--pf-admin-text-muted)]" aria-hidden />
              ) : (
                <TriangleAlert className="h-3.5 w-3.5 text-[var(--pf-admin-gold)]" />
              )}
              <span className={`text-xs font-medium ${softFail ? "text-[var(--pf-admin-text-muted)]" : "text-[var(--pf-admin-text)]"}`}>
                {c.label}
                {softFail ? " · on bridge" : ""}
              </span>
            </div>
          );
        })}
      </div>
      {infoHint ? (
        <div className="mt-2 text-xs text-[var(--pf-admin-text-secondary)]">{infoHint}</div>
      ) : null}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-[var(--pf-admin-text-secondary)]">
          {ai.pending} pending · {ai.reviewed} reviewed
        </span>
        <button
          type="button"
          onClick={onRecheck}
          disabled={checking}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--pf-admin-border)] px-2.5 text-xs font-medium hover:bg-[var(--pf-admin-bg-hover)] disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} /> Run check
        </button>
      </div>
    </div>
  );
}

function AudioPanel({ label, onTick }: { label: string | null; onTick: () => void }) {
  return (
    <div>
      <PanelHead
        icon={<Mic className="h-5 w-5 text-[var(--pf-admin-accent)]" />}
        eyebrow="Readiness"
        title="Audio input"
      />
      <p className="text-sm leading-6 text-[var(--pf-admin-text-secondary)]">
        {label
          ? `Last known input: ${label}.`
          : "Audio is captured on the desktop app. Once you've connected your mixer or mic there, tick this so the dashboard stops flagging it."}
      </p>
      <div className="mt-3">
        <TickButton onClick={onTick}>Audio is connected</TickButton>
      </div>
      <p className="mt-2 text-[11px] text-[var(--pf-admin-text-muted)]">
        Live auto-detection of the desktop connection is coming — for now this is a manual confirmation.
      </p>
    </div>
  );
}

function OutputPanel({ onTick }: { onTick: () => void }) {
  return (
    <div>
      <PanelHead
        icon={<MonitorPlay className="h-5 w-5 text-[var(--pf-admin-accent)]" />}
        eyebrow="Output"
        title="Projector / screens"
      />
      <p className="text-sm leading-6 text-[var(--pf-admin-text-secondary)]">
        Projector output is driven from the desktop app. Once your screen or stream is wired up and showing slides,
        tick this to clear it.
      </p>
      <div className="mt-3">
        <TickButton onClick={onTick}>Output is connected</TickButton>
      </div>
      <p className="mt-2 text-[11px] text-[var(--pf-admin-text-muted)]">
        Live auto-detection of the desktop connection is coming — for now this is a manual confirmation.
      </p>
    </div>
  );
}

function AllSetPanel({
  prep,
  audioLabel,
  showDone,
  onToggleDone,
  onReset,
}: {
  prep: PrepItem[];
  audioLabel: string | null;
  showDone: boolean;
  onToggleDone: () => void;
  onReset: () => void;
}) {
  const rows = [
    ...prep.map((p) => ({ label: p.label })),
    { label: "AI systems healthy" },
    { label: audioLabel ? `Audio — ${audioLabel}` : "Audio connected" },
    { label: "Output connected" },
  ];
  return (
    <div className="pf-fade">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-[rgba(61,154,80,0.12)]">
          <CheckCircle2 className="pf-pop h-6 w-6 text-[var(--pf-admin-green)]" />
        </div>
        <div>
          <div className="text-sm font-semibold text-[var(--pf-admin-text)]">Everything&apos;s ready.</div>
          <div className="text-xs text-[var(--pf-admin-text-secondary)]">
            Your setup checks are all green. Have a great service.
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleDone}
          className="text-xs font-medium text-[var(--pf-admin-accent)] hover:text-[var(--pf-admin-accent-hover)]"
        >
          {showDone ? "Hide details" : "View details"}
        </button>
        <span className="text-[var(--pf-admin-border)]">·</span>
        <button
          type="button"
          onClick={onReset}
          className="text-xs font-medium text-[var(--pf-admin-text-muted)] hover:text-[var(--pf-admin-text-secondary)]"
        >
          Reset checklist
        </button>
      </div>

      {showDone ? (
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-[var(--pf-admin-text-secondary)]">
              <CheckCircle2 className="h-4 w-4 text-[var(--pf-admin-green)]" /> {r.label}
            </div>
          ))}
        </div>
      ) : null}
      <PopStyle />
    </div>
  );
}

function PopStyle() {
  // Global so the keyframes and the .pf-pop selector share the same (unscoped)
  // namespace — styled-jsx can orphan a keyframes reference when the selector
  // is :global but the @keyframes isn't, silently killing the animation.
  return (
    <style jsx global>{`
      .pf-pop {
        animation: pfPop 360ms cubic-bezier(0.22, 1.2, 0.36, 1);
      }
      @keyframes pfPop {
        0% {
          transform: scale(0.4);
          opacity: 0;
        }
        60% {
          transform: scale(1.15);
        }
        100% {
          transform: scale(1);
          opacity: 1;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pf-pop {
          animation: none;
        }
      }
    `}</style>
  );
}
