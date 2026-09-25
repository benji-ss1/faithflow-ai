"use client";
/**
 * StageLayoutRenderer — paints an operator-designed stage layout (2026-09-21).
 *
 * This is what makes the Stage Layout editor real. Until this existed a church
 * could design a layout, assign it to a screen, and see nothing — the editor
 * was scaffolding with no consumer, which the doctrine calls a bug, not a
 * feature (docs/ONE_TO_ONE_LOOP.md §5).
 *
 * The layout is RESOLVED OPERATOR-SIDE and arrives on OutputState, because
 * /stage is a public route with no church DB access — the same reason a scene
 * carries a resolved appearance rather than a theme id.
 *
 * Timer values are computed HERE from the same anchors the networked timer path
 * uses, so a stage layout on a paired tablet ticks correctly, and its colour
 * triggers fire, exactly as on the operator's own monitor.
 */
import { useEffect, useState } from "react";
import type { StageLayoutWire, TimerWire } from "@/lib/broadcast";
import {
  computeRemainingSec, isOverrun, resolveTimerColor, triggerValueFor, formatTimerClock,
  type TimerDefinition, type TimerRuntime,
} from "@/engine/timers";
import { senderNow, type ClockSync } from "@/lib/timer-clock";
import { stageTextCss } from "@/engine/stage";

/** A binding that no longer resolves renders as a dash rather than vanishing,
 *  so a broken layout is VISIBLE to the operator instead of silently empty. */
const UNBOUND = "—";

export function StageLayoutRenderer({
  layout,
  wireTimers = [],
  clockSync = null,
  currentText,
  nextText,
  message,
}: {
  layout: StageLayoutWire;
  wireTimers?: TimerWire[];
  clockSync?: ClockSync | null;
  currentText?: string | null;
  nextText?: string | null;
  message?: string | null;
}) {
  // One tick for the whole layout. Only mounted when something needs it — a
  // layout of static text costs nothing.
  const needsTick = layout.widgets.some((w) => w.kind === "timer" || w.kind === "clock");
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!needsTick) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [needsTick]);

  const now = senderNow(clockSync);
  const byId = new Map(wireTimers.map((t) => [t.id, t]));

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: layout.background, containerType: "size" }}>
      {[...layout.widgets].sort((a, b) => a.zIndex - b.zIndex).map((w) => {
        let text: string | null = null;
        let color = w.color ?? "#ffffff";
        // The caption shown above the value when `showLabel` is on. A timer
        // uses its own name; a clock says "Clock"; anything else is already
        // self-describing, so it gets none.
        const label = !w.showLabel ? null
          : w.kind === "timer" ? (w.timerId ? byId.get(w.timerId)?.name ?? null : null)
          : w.kind === "clock" ? "Clock"
          : null;

        if (w.kind === "timer") {
          const t = w.timerId ? byId.get(w.timerId) : undefined;
          if (!t) {
            text = UNBOUND;
          } else {
            const def: TimerDefinition = {
              id: t.id, name: t.name ?? "", type: t.type, durationSec: t.durationSec,
              targetMs: t.targetMs ?? null, allowsOverrun: t.allowsOverrun,
              elapsedStartSec: t.elapsedStartSec, elapsedEndSec: t.elapsedEndSec,
            };
            const rt: TimerRuntime = { running: t.running, anchorMs: t.anchorMs, baseSec: t.baseSec };
            const remaining = computeRemainingSec(def, rt, now);
            text = formatTimerClock(remaining, {
              // The WIDGET's format wins over the timer's own, so the same
              // timer can read differently on the stage screen than elsewhere.
              showHours: w.showHours ?? t.showHours,
              leadingZeros: w.leadingZeros ?? t.leadingZeros,
            });
            const tv = triggerValueFor(def, remaining);
            const resolved = tv === null
              ? (w.color ?? t.color)
              : resolveTimerColor(
                  { color: w.color ?? t.color, overrunColor: t.overrunColor, colorTriggers: t.colorTriggers ?? [] },
                  tv,
                );
            color = resolved ?? (isOverrun(def, rt, now) ? "#f87171" : "#ffffff");
          }
        } else if (w.kind === "clock") {
          const d = new Date(now);
          const h = w.showHours === false ? (d.getHours() % 12 || 12) : d.getHours();
          text = `${w.leadingZeros ? String(h).padStart(2, "0") : h}:${String(d.getMinutes()).padStart(2, "0")}`;
        } else if (w.kind === "current_text") {
          text = currentText ?? "";
        } else if (w.kind === "next_text") {
          text = nextText ?? "";
        } else if (w.kind === "message") {
          text = message ?? "";
        } else if (w.kind === "static_text") {
          text = w.text ?? "";
        } else if (w.kind === "slide_preview") {
          // A live preview of what an output is showing — ProPresenter's
          // screen-preview stage object. Rendered as the slide's text on a
          // framed panel: /stage has the text, not a video feed of the
          // projector, so this is an honest preview rather than a fake one.
          const previewText = w.previewScreen === "stage" ? (nextText ?? "") : (currentText ?? "");
          return (
            <div key={w.id} className="absolute overflow-hidden rounded border border-white/20 bg-black/40"
              style={{
                left: `${w.rect.x * 100}%`, top: `${w.rect.y * 100}%`,
                width: `${w.rect.w * 100}%`, height: `${w.rect.h * 100}%`,
              }}>
              <div className="absolute top-1 left-2 text-[9px] uppercase tracking-widest text-white/40">
                {w.previewScreen ?? "main"}
              </div>
              <div className="w-full h-full flex items-center justify-center p-2">
                <span className="font-semibold text-center leading-tight"
                  style={{ color: w.color ?? "#ffffff", fontSize: stageTextCss({ rect: { h: w.rect.h * 0.43 }, scale: w.scale }) }}>
                  {previewText}
                </span>
              </div>
            </div>
          );
        } else {
          // A kind we do not render must never be offered in the editor —
          // test/no-dead-capability.test.ts enforces that.
          return null;
        }

        return (
          <div key={w.id}
            className="absolute flex overflow-hidden"
            style={{
              left: `${w.rect.x * 100}%`, top: `${w.rect.y * 100}%`,
              width: `${w.rect.w * 100}%`, height: `${w.rect.h * 100}%`,
              alignItems: "center",
              justifyContent: w.align === "left" ? "flex-start" : w.align === "right" ? "flex-end" : "center",
            }}>
            {/* The widget's NAME above the value — a bare "0:00" on a
                confidence monitor with three timers is unreadable. `showLabel`
                was on the model and set by a built-in preset since 2026-09-21
                and never rendered until 2026-09-25. */}
            {label && (
              <span className="absolute left-0 right-0 top-0 uppercase tracking-[0.15em] font-semibold opacity-70 truncate"
                style={{
                  color,
                  fontSize: stageTextCss({ rect: { h: w.rect.h * 0.23 }, scale: w.scale }),
                  textAlign: w.align,
                }}>
                {label}
              </span>
            )}
            <span
              className={w.kind === "timer" || w.kind === "clock" ? "font-mono tabular-nums font-semibold" : "font-semibold"}
              style={{
                color,
                ...(w.uppercase ? { textTransform: "uppercase" as const } : {}),
                // Sized off the box height so a layout reads the same on a
                // 720p confidence monitor and a 4K LED wall.
                fontSize: stageTextCss(w),
                lineHeight: 1.1,
                textAlign: w.align,
                textShadow: "0 2px 12px rgba(0,0,0,0.5)",
                width: "100%",
              }}>
              {text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
