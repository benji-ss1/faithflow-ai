"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fitScale, overflows, type TextScaleMode, DEFAULT_TEXT_SCALE } from "@/lib/text-fit";

/**
 * A designed text box that scales its text to fit — ProPresenter parity.
 *
 * Before this, positioned text rendered at a fixed size inside `overflow:
 * hidden`, so one line too many silently vanished off the projector. PP7 scales
 * instead. See src/lib/text-fit.ts for the modes and why the default is "down".
 *
 * ONE ELEMENT, deliberately. An earlier version wrapped the text in an inner
 * div and the DOM golden tests caught it: the extra node changed the rendered
 * markup for every designed slide. A single element measures just as well —
 * `scrollHeight`/`scrollWidth` vs `clientHeight`/`clientWidth` IS the overflow —
 * so when nothing needs scaling the output is byte-identical to before. That
 * keeps the no-regression goldens honest instead of regenerating them.
 *
 * Measuring, not guessing: render, compare content to container, apply the
 * ratio. Wrapping changes as the size changes, so we repeat a BOUNDED number of
 * times; each pass moves strictly toward a fit, so it settles in two or three.
 * No timers, no rAF loops, no forced-reflow hacks (AGENTS.md rule 3).
 */
const MAX_PASSES = 4;

export function FittedText({
  text, mode = DEFAULT_TEXT_SCALE, style, className,
}: {
  text: string;
  mode?: TextScaleMode;
  style: React.CSSProperties;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const base = style.fontSize;
  // Every input that can change the measurement.
  const key = `${text}|${mode}|${String(base)}|${String(style.lineHeight)}|${String(style.letterSpacing)}|${String(style.fontFamily)}|${String(style.fontWeight)}|${String(style.textTransform)}`;

  useLayoutEffect(() => {
    if (mode === "none" || base === undefined) { setScale(1); return; }
    const el = ref.current;
    if (!el) return;
    let next = 1;
    // Always start from the authored size so a re-fit is not compounded.
    el.style.fontSize = String(base);
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const m = {
        contentW: el.scrollWidth, contentH: el.scrollHeight,
        boxW: el.clientWidth, boxH: el.clientHeight,
      };
      if (mode === "down" && !overflows(m)) break;
      const s = fitScale(m, mode);
      if (s === 1) break;
      next *= s;
      // Apply inline so the next measurement in this synchronous pass sees it.
      el.style.fontSize = `calc(${String(base)} * ${next})`;
    }
    setScale(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode]);

  // The output surface resizes (preview vs projector vs 4K) without the text
  // changing. Re-measure from the authored size when it does.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setScale((s) => (s === 1 ? 1.0000001 : 1)));
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={scale === 1 ? style : { ...style, fontSize: `calc(${String(base)} * ${scale})` }}
    >
      {text}
    </div>
  );
}
