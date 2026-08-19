import { cn } from "@/lib/utils";

/**
 * DotGridBackground — a subtle, animated brand-tinted dot lattice for empty /
 * background areas (from the requested reference). Decorative and
 * non-interactive; drop it into any `relative` container as the first child.
 */
export function DotGridBackground({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className="pf-dotgrid" />
    </div>
  );
}
