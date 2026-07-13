"use client";
import { useState } from "react";
import { Lock } from "lucide-react";
import { useTier } from "@/hooks/useTier";
import { canAccess } from "@/lib/tier";
import { MaxUpgradePrompt } from "@/components/tier/MaxUpgradePrompt";
import type { OperatorShellCtx } from "../../shell/types";

type PillState = "on" | "off" | "unknown";

function Pill({ label, state, ghost }: { label: string; state: PillState; ghost?: boolean }) {
  const color =
    state === "on" ? "bg-emerald-500" :
    state === "off" ? "bg-red-500" :
    "bg-neutral-500";
  return (
    <div className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${ghost ? "opacity-40" : ""}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
    </div>
  );
}

export function OutputRoutingRow({ ctx }: { ctx: OperatorShellCtx }) {
  const { tier } = useTier();
  const [showPrompt, setShowPrompt] = useState(false);

  if (tier === null) {
    return <div className="h-6" aria-hidden />;
  }

  const allowed = canAccess(tier, "pro-content");
  const liveState: PillState = ctx.liveSlide && ctx.liveSlide.kind !== "empty" ? "off" : "unknown";

  const pills: Array<{ label: string; state: PillState }> = [
    { label: "Media", state: "unknown" },
    { label: "Inhouse Stream", state: "unknown" },
    { label: "Live", state: liveState },
    { label: "Audience", state: "unknown" },
    { label: "Stage", state: "unknown" },
    { label: "Status", state: "unknown" },
  ];

  if (!allowed) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowPrompt(true)}
          className="relative w-full flex items-center gap-1 justify-end px-2 py-1 border-b border-[var(--color-border)]"
          title="Output routing (Max)"
        >
          {pills.map((p) => <Pill key={p.label} label={p.label} state={p.state} ghost />)}
          <Lock className="w-3 h-3 text-[var(--color-muted-foreground)]" />
        </button>
        {showPrompt && (
          <MaxUpgradePrompt feature="pro-content" variant="modal" />
        )}
      </>
    );
  }

  return (
    <div className="w-full flex items-center gap-1 justify-end px-2 py-1 border-b border-[var(--color-border)]">
      {pills.map((p) => <Pill key={p.label} label={p.label} state={p.state} />)}
    </div>
  );
}
