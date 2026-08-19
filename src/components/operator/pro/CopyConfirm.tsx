"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * CopyConfirm — a copy button that morphs to a check for ~1.4s after copying
 * (adapted from the requested reference). Copies `text` to the clipboard.
 */
export function CopyConfirm({ text, label, className, disabled }: {
  text: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    if (disabled || !text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={copied ? "Copied" : (label ?? "Copy")}
      aria-label={label ?? "Copy"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors disabled:opacity-40",
        className,
      )}
    >
      <span className="relative grid place-items-center w-4 h-4">
        <Copy className={cn("w-4 h-4 absolute transition-all duration-200", copied ? "opacity-0 scale-50" : "opacity-100 scale-100")} />
        <Check className={cn("w-4 h-4 absolute transition-all duration-200", copied ? "opacity-100 scale-100" : "opacity-0 scale-50")} style={copied ? { color: "#4fd18b" } : undefined} />
      </span>
      {label && <span className="text-[11px] font-medium">{copied ? "Copied" : label}</span>}
    </button>
  );
}
