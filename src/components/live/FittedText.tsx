"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fitScale, overflows, type TextScaleMode, DEFAULT_TEXT_SCALE } from "@/lib/text-fit";
import { splitIntoSegments, type TextRun } from "@/lib/text-runs";

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

/**
 * The fit itself, as a hook, so the EDITOR and the PROJECTOR share one
 * implementation. The editor's text box is `contentEditable` while typing, so
 * it cannot use the component below (which owns its children) — but it can use
 * this. Without it the editor would clip where the projector scales, and the
 * two surfaces would disagree about what the slide looks like.
 *
 * Pass the element ref, the text, the mode and the authored font size; get back
 * a multiplier to apply to that size.
 */
export function useFitFontSize(
  ref: React.RefObject<HTMLElement | null>,
  text: string,
  mode: TextScaleMode,
  base: string | number | undefined,
  /** Anything else that changes layout (weight, spacing, family, transform). */
  deps: string = "",
): number {
  const [scale, setScale] = useState(1);
  // Bumped by the ResizeObserver below to RE-RUN the fit after a resize. It is a
  // dep of the layout effect, so the fit actually recomputes.
  const [resizeTick, setResizeTick] = useState(0);
  const key = `${text}|${mode}|${String(base)}|${deps}`;

  useLayoutEffect(() => {
    if (mode === "none" || base === undefined) { setScale(1); return; }
    const el = ref.current;
    if (!el) return;
    let next = 1;
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
      el.style.fontSize = `calc(${String(base)} * ${next})`;
    }
    setScale(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode, resizeTick]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      // Was `setScale(s => s === 1 ? 1.0000001 : 1)`, which THREW AWAY the
      // fitted multiplier (e.g. 0.6 -> 1) and never re-fitted, because the
      // layout effect's deps were only [key, mode]. Designed/PP7 text objects
      // therefore jumped to their authored size on any resize and then toggled
      // 1 <-> 1.0000001 forever. Bump a tick the fit actually depends on.
      raf = requestAnimationFrame(() => setResizeTick((n) => n + 1));
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [ref]);

  return scale;
}

/** Apply a fit multiplier to an authored font size. */
export function scaledFontSize(base: string | number | undefined, scale: number): string | number | undefined {
  if (base === undefined || scale === 1) return base;
  return `calc(${String(base)} * ${scale})`;
}

export function FittedText({
  text, mode = DEFAULT_TEXT_SCALE, style, className, runs,
}: {
  text: string;
  mode?: TextScaleMode;
  style: React.CSSProperties;
  className?: string;
  /** "Special" formatting that survives a theme (src/lib/text-runs.ts). */
  runs?: readonly TextRun[];
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const deps = `${String(style.lineHeight)}|${String(style.letterSpacing)}|${String(style.fontFamily)}|${String(style.fontWeight)}|${String(style.textTransform)}`;
  const scale = useFitFontSize(ref, text, mode, style.fontSize, deps + `|${runs?.length ?? 0}`);
  const segments = useMemo(() => splitIntoSegments(text, runs), [text, runs]);
  return (
    <div
      ref={ref}
      className={className}
      style={scale === 1 ? style : { ...style, fontSize: scaledFontSize(style.fontSize, scale) }}
    >
      {/* No runs ⇒ the plain string, so the DOM is byte-identical to before for
          every existing slide (the goldens check this). */}
      {segments.length === 1 && segments[0].text === text
        ? text
        : segments.map((seg, i) => (
            <span
              key={i}
              style={{
                fontWeight: seg.bold ? 700 : undefined,
                fontStyle: seg.italic ? "italic" : undefined,
                textDecoration: seg.underline ? "underline" : undefined,
                color: seg.color,
              }}
            >
              {seg.text}
            </span>
          ))}
    </div>
  );
}
