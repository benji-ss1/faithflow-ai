"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Robust clipboard copy. navigator.clipboard.writeText requires a secure
 * context AND (in the Electron desktop shell) clipboard permission — it can
 * reject silently there. Fall back to the Electron bridge, then to a
 * hidden-textarea execCommand, so the copy button works everywhere.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const bridge = (window as unknown as { electronAPI?: { clipboard?: { writeText?: (t: string) => void } } }).electronAPI;
    if (bridge?.clipboard?.writeText) { bridge.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { /* give up */ }
  return false;
}

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
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
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
