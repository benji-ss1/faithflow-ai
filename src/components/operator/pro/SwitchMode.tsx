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
  width = 90, title, ariaLabel, className, onClick: injectedOnClick, ...rest
}, ref) {
  const KNOB = 22;
  const PAD = 3;
  // When used as a Radix `asChild` trigger (tooltip/popover), Radix injects its
  // own onClick (e.g. tooltip-close) via props. Compose it with our onChange so
  // BOTH run — never let the spread override the toggle. Pulling `onClick` out of
  // `rest` above is what makes this safe: `{...rest}` below can no longer clobber
  // the handler. (This was the AI-listening toggle's dead-click bug — the AUTO
  // switch worked only because it wasn't tooltip-wrapped.)
  const handleClick: React.MouseEventHandler<HTMLButtonElement> = (e) => {
    injectedOnClick?.(e);
    onChange();
  };
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      aria-label={ariaLabel ?? (checked ? onLabel : offLabel)}
      className={cn(
        "group/sw relative h-[30px] rounded-full border transition-[background,border-color,box-shadow,transform] duration-200 [transition-timing-function:var(--ease-spring)] shrink-0 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-app-bg)]",
        className,
      )}
      style={{
        width,
        background: checked
          ? `color-mix(in oklab, ${onColor} 22%, var(--color-app-bg))`
          : `color-mix(in oklab, ${offColor} 15%, var(--color-app-bg))`,
        borderColor: checked ? onColor : `color-mix(in oklab, ${offColor} 55%, transparent)`,
        boxShadow: checked
          ? `var(--edge-top), inset 0 1px 2px rgba(0,0,0,0.28), 0 4px 14px -4px color-mix(in oklab, ${onColor} 60%, transparent)`
          : "var(--edge-top), inset 0 1px 2px rgba(0,0,0,0.28)",
      }}
      {...rest}
      onClick={handleClick}
    >
      {/* label — opposite the knob */}
      <span
        className={cn(
          "absolute inset-0 flex items-center text-[10.5px] font-extrabold uppercase tracking-[0.08em] transition-colors",
          checked ? "justify-start pl-3" : "justify-end pr-3",
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
          background: `radial-gradient(circle at 35% 30%, color-mix(in oklab, ${checked ? onColor : offColor} 55%, #fff) 0%, ${checked ? onColor : offColor} 62%)`,
          transition: "left .26s var(--ease-spring), background .2s ease",
          boxShadow: "var(--edge-top), 0 2px 5px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.10)",
        }}
      />
    </button>
  );
});
