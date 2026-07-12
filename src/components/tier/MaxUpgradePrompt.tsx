"use client";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Sparkles, Lock, ExternalLink } from "lucide-react";
import { FEATURE_BLURB } from "@/lib/tier";
import { cn } from "@/lib/utils";

type Variant = "card" | "modal";

const FALLBACK_BASE = "https://presentflow.app";

function billingUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || FALLBACK_BASE;
  let base = FALLBACK_BASE;
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") base = raw;
  } catch {
    /* fall back */
  }
  return `${base.replace(/\/$/, "")}/settings/billing`;
}

function openBilling() {
  const url = billingUrl();
  if (typeof window !== "undefined" && window.electronAPI?.shell?.openExternal) {
    void window.electronAPI.shell.openExternal(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function PromptBody({ feature }: { feature: string }) {
  const blurb = FEATURE_BLURB[feature] ?? "Unlock premium tools for your church.";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-md bg-[var(--color-brand)]/15 text-[var(--color-brand)] flex items-center justify-center">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <div className="text-[13px] font-semibold text-[var(--color-foreground)]">
            Upgrade to Present Flow Max
          </div>
          <div className="text-[11px] text-[var(--color-muted-foreground)]">Max plan</div>
        </div>
      </div>
      <p className="text-[12px] text-[var(--color-muted-foreground)] leading-snug">
        {blurb}
      </p>
      <button
        type="button"
        onClick={openBilling}
        className="mt-1 h-8 rounded-md bg-[var(--color-brand)] text-white text-[12px] font-medium flex items-center justify-center gap-1.5 hover:opacity-90"
      >
        Learn more <ExternalLink className="w-3 h-3" />
      </button>
    </div>
  );
}

/**
 * MaxUpgradePrompt — pure UI scaffolding for gated features.
 * NO payment processing here; the "Learn more" button opens the web billing
 * portal (shell.openExternal in the desktop app, new tab on web).
 */
export function MaxUpgradePrompt({
  feature,
  variant = "card",
  className,
}: {
  feature: string;
  variant?: Variant;
  className?: string;
}) {
  if (variant === "modal") {
    return (
      <Dialog.Root defaultOpen>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content
            className={cn(
              "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
              "w-[360px] rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4 shadow-2xl",
              className,
            )}
          >
            <Dialog.Title className="sr-only">Upgrade to Present Flow Max</Dialog.Title>
            <Dialog.Description className="sr-only">
              This feature requires the Present Flow Max plan.
            </Dialog.Description>
            <PromptBody feature={feature} />
            <Dialog.Close asChild>
              <button
                type="button"
                className="mt-2 w-full h-8 rounded-md border border-[var(--color-border)] text-[12px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              >
                Not now
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
  return (
    <div
      data-tier-prompt={feature}
      className={cn(
        "rounded-md border border-dashed border-[var(--color-border)]",
        "bg-[var(--color-elevated)] p-3",
        className,
      )}
    >
      <PromptBody feature={feature} />
    </div>
  );
}

/**
 * A small locked-overlay wrapper used by the Themes premium grid — click
 * anywhere on the tile to pop the upgrade modal.
 */
export function LockedTile({
  label,
  gradient,
  feature,
}: {
  label: string;
  gradient: string;
  feature: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative aspect-video rounded border border-[var(--color-border)] overflow-hidden group focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
        style={{ background: gradient }}
        aria-label={`${label} — Max only`}
      >
        <div className="absolute inset-0 bg-black/35 flex flex-col items-center justify-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity">
          <Lock className="w-3.5 h-3.5 text-white" />
          <span className="text-[10px] font-medium text-white uppercase tracking-wider">{label}</span>
        </div>
      </button>
      {open && (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
            <Dialog.Content
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[360px] rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4 shadow-2xl"
            >
              <Dialog.Title className="sr-only">Upgrade to Present Flow Max</Dialog.Title>
              <Dialog.Description className="sr-only">
                This theme is part of the Present Flow Max plan.
              </Dialog.Description>
              <PromptBody feature={feature} />
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="mt-2 w-full h-8 rounded-md border border-[var(--color-border)] text-[12px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                >
                  Not now
                </button>
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}
