"use client";
import { useRef } from "react";
import type { SlideObjectWire, ThemeAppearance } from "@/lib/broadcast";
import type { ThemeDecorPlan } from "@/lib/theme-decor-plan";
import { themeBackgroundStyle, themeTextStyle } from "./SlideRenderer";
import { AnimatedThemeBg } from "./ThemeLayers";
import { SlideObjectsLayer } from "./SlideObjectsLayer";

/** Decor objects minus their per-slide entrance animation (a persistent layer
 *  must not replay an entrance on every slide). */
export function stripDecorAnim(decor: SlideObjectWire[]): SlideObjectWire[] {
  return decor.map((o) => {
    if (o.anim === undefined && o.animDelayMs === undefined) return o;
    const { anim: _a, animDelayMs: _d, ...rest } = o as SlideObjectWire & { anim?: unknown; animDelayMs?: unknown };
    void _a; void _d;
    return rest as SlideObjectWire;
  });
}

/**
 * Theme gaps (PR A): the PERSISTENT theme background + decor layer. Rendered by
 * the output compositor OUTSIDE the slide TransitionWrapper with a constant key,
 * so a decor video / animated background never restarts when the slide changes.
 *
 * `plan` is themeDecorPlan() for the CURRENT slide (the same helper SlideRenderer
 * uses). When null (blank / media / own-bg slide) the layer stays mounted but
 * hidden — the slide paints exactly what it did before, and the decor video keeps
 * its place for the next lyric/verse.
 */
export function ThemeDecorLayer({ appearance, plan, overVideo, frozen }: {
  appearance: ThemeAppearance | null | undefined;
  plan: ThemeDecorPlan | null;
  /** A background template / video sits behind: no theme background paint. */
  overVideo?: boolean;
  frozen?: boolean;
}) {
  const lastDecor = useRef<SlideObjectWire[] | null>(null);
  if (plan) lastDecor.current = plan.decor;
  const decor = plan?.decor ?? lastDecor.current;
  const visible = !!plan;
  const themedTextColor = overVideo ? undefined : ((themeTextStyle(appearance)?.color as string | undefined) ?? undefined);
  const bg: React.CSSProperties = overVideo ? {} : themeBackgroundStyle(appearance, "#0b0b0b");
  return (
    <div
      data-theme-decor-layer=""
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={{ ...bg, ...(visible ? {} : { visibility: "hidden" }) }}
      aria-hidden
    >
      {!overVideo && <AnimatedThemeBg appearance={appearance} />}
      {decor && <SlideObjectsLayer objects={stripDecorAnim(decor)} themedTextColor={themedTextColor} decor frozen={frozen} />}
    </div>
  );
}
