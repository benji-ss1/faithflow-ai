"use client";

import * as Tooltip from "@radix-ui/react-tooltip";

/**
 * Shared hover tooltip — same @radix-ui/react-tooltip pattern already used
 * in src/components/operator/pro/TopBar.tsx, lifted into a reusable wrapper
 * so any icon-only UI (e.g. the collapsed sidebar rail) gets a real styled
 * tooltip instead of the browser's native `title=` attribute.
 */
export function IconTooltip({
  label,
  side = "right",
  children,
}: {
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactNode;
}) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={8}
            className="z-50 rounded-md border border-white/10 bg-[var(--color-elevated)] px-2.5 py-1.5 text-[12px] font-medium text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
          >
            {label}
            <Tooltip.Arrow className="fill-[var(--color-elevated)]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
