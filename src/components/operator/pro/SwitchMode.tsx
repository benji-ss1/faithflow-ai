"use client";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * SwitchMode — a compact sliding on/off switch with a short label (adapted from
 * the requested reference to this app's toolbar scale + tokens). The knob slides
 * between off (left) and on (right); the label sits opposite the knob.
 * `onColor` / `offColor` let each use carry its own accent (brand orange for
 * AUTO; green-on / red-off for the AI listener). forwardRef + prop-spread so it
 * works as a Radix `asChild` trigger (tooltips, popovers).
 */
export const SwitchMode = forwardRef<HTMLButtonElement, {
  checked: boolean;
  onChange: () => void;
  onLabel: string;
  offLabel: string;
  onColor?: string;
  offColor?: string;
  width?: number;
  title?: string;
  ariaLabel?: string;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>>(function SwitchMode({
  checked, onChange, onLabel, offLabel,
  onColor = "var(--color-brand)", offColor = "var(--color-muted-foreground)",
  width = 90, title, ariaLabel, className, ...rest
}, ref) {
  const KNOB = 20;
  const PAD = 3;
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      title={title}
      aria-label={ariaLabel ?? (checked ? onLabel : offLabel)}
      className={cn(
        "relative h-[26px] rounded-full border transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]",
        className,
      )}
      style={{
        width,
        background: checked
          ? `color-mix(in oklab, ${onColor} 20%, transparent)`
          : `color-mix(in oklab, ${offColor} 14%, transparent)`,
        borderColor: checked ? onColor : `color-mix(in oklab, ${offColor} 55%, transparent)`,
      }}
      {...rest}
    >
      {/* label — opposite the knob */}
      <span
        className={cn(
          "absolute inset-0 flex items-center text-[10px] font-bold uppercase tracking-wider transition-colors",
          checked ? "justify-start pl-2.5" : "justify-end pr-2.5",
        )}
        style={{ color: checked ? onColor : offColor }}
      >
        {checked ? onLabel : offLabel}
      </span>
      {/* knob */}
      <span
        aria-hidden
        className="absolute top-1/2 -translate-y-1/2 rounded-full"
        style={{
          height: KNOB,
          width: KNOB,
          left: checked ? width - KNOB - PAD : PAD,
          background: checked ? onColor : offColor,
          transition: "left .24s cubic-bezier(.4,0,.2,1), background .2s ease",
          boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
        }}
      />
    </button>
  );
});
