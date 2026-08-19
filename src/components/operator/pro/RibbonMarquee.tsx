import { cn } from "@/lib/utils";

/**
 * RibbonMarquee — two crossed ribbons of scrolling text (from the requested
 * reference), the "pro / pro-max" flourish for gated areas normal accounts
 * can't touch. Decorative + non-interactive. Drop into a `relative` container.
 */
export function RibbonMarquee({ text = "PRO", className, opacity = 0.9 }: {
  text?: string;
  className?: string;
  opacity?: number;
}) {
  // Repeat enough to fill the ribbon; duplicated inline so the -50% translate
  // loops seamlessly.
  const run = Array(8).fill(text).join("  •  ");
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
