import * as React from "react";
import { cn } from "@/lib/utils";
// Design Language v2: cards sit on a lit top edge + soft ambient shadow so they
// read as raised surfaces on the charcoal ground instead of flat outlines.
export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "border border-border bg-card rounded-lg shadow-[var(--edge-top),var(--shadow-sm)]",
      className,
    )}
    {...props}
  />
);
