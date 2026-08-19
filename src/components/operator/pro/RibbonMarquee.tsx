import { cn } from "@/lib/utils";

/**
 * RibbonMarquee — scrolling "pro / pro-max" flourish for gated areas normal
 * accounts can't touch. Decorative + non-interactive.
 *
 * - variant="crossed" (default): two crossed diagonal ribbons; fills a `relative`
 *   container as a background flourish. Drop into a `relative` container.
 * - variant="single": one flat horizontal ribbon bar — a self-contained strip
 *   you can place inline (e.g. under a section header). Renders its own height.
 */
export function RibbonMarquee({ text = "PRO", className, opacity = 0.9, variant = "crossed" }: {
  text?: string;
  className?: string;
  opacity?: number;
  variant?: "crossed" | "single";
}) {
  // Repeat enough to fill the ribbon; duplicated inline so the -50% translate
  // loops seamlessly.
  const run = Array(8).fill(text).join("  •  ");

  if (variant === "single") {
    return (
      <div aria-hidden className={cn("pf-ribbon-strip", className)} style={{ opacity }}>
        <span className="pf-ribbon-track">{run}&nbsp;&nbsp;•&nbsp;&nbsp;{run}&nbsp;&nbsp;•&nbsp;&nbsp;</span>
      </div>
    );
  }

  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} style={{ opacity }}>
      <div className="pf-ribbon" style={{ top: "50%", marginTop: -13, transform: "rotate(-7deg)" }}>
        <span className="pf-ribbon-track">{run}&nbsp;&nbsp;•&nbsp;&nbsp;{run}&nbsp;&nbsp;•&nbsp;&nbsp;</span>
      </div>
      <div className="pf-ribbon" style={{ top: "50%", marginTop: -13, transform: "rotate(7deg)" }}>
        <span className="pf-ribbon-track pf-ribbon-track--rev">{run}&nbsp;&nbsp;•&nbsp;&nbsp;{run}&nbsp;&nbsp;•&nbsp;&nbsp;</span>
      </div>
    </div>
  );
}
