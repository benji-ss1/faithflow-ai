"use client";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { createSongBundleCheckoutSession } from "@/lib/billing-actions";
import { SONG_BUNDLES } from "@/lib/song-bundles";

/**
 * "Upgrade Your Library" section — layout/flow modeled on a reference
 * design (stats bar / plan-style usage bar / 4 pricing cards / trust
 * badges), restyled to this app's own brand accent instead of copying the
 * reference's color scheme.
 */
export function SongBundlesPanel({ usage, limit }: { usage: number; limit: number }) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  const buy = async (bundleId: string) => {
    if (pendingId) return;
    setPendingId(bundleId);
    try {
      const res = await createSongBundleCheckoutSession(bundleId);
      if (!res.ok) { toast.error(res.error); return; }
      window.location.href = res.data!.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setPendingId(null);
    }
  };

  const pct = Math.min(100, Math.round((usage / Math.max(1, limit)) * 100));

  return (
    <div className="space-y-4">
      <DashboardCard title="Your Library" eyebrow={`${usage} / ${limit}`}>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-[var(--color-brand)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 text-xs text-muted-foreground">{Math.max(0, limit - usage)} songs of room left — {pct}% used</div>
      </DashboardCard>

      <div>
        <h3 className="text-base font-semibold">Upgrade Your Library</h3>
        <p className="mt-1 text-sm text-muted-foreground">Choose a bundle to expand your song library. One-time payment, lifetime access.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SONG_BUNDLES.map((b) => (
          <DashboardCard
            key={b.id}
            title={b.label}
            tone={b.bestValue ? "premium" : "default"}
            eyebrow={b.bestValue ? "BEST VALUE" : undefined}
          >
            <p className="text-xs text-muted-foreground">{b.hint}</p>
            <div className="mt-3 text-2xl font-bold">€{(b.priceCents / 100).toFixed(0)}</div>
            <div className="text-xs text-muted-foreground">One-time payment</div>
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              <li>✓ {b.songs.toLocaleString()} additional songs</li>
              <li>✓ Lifetime access</li>
              <li>✓ Instant activation</li>
            </ul>
            <button
              onClick={() => void buy(b.id)}
              disabled={pendingId === b.id}
              className={cn(
                "mt-4 h-9 w-full rounded-xl text-sm font-semibold transition disabled:opacity-60",
                b.bestValue ? "bg-[var(--color-brand)] text-black" : "bg-foreground text-background",
              )}
            >
              {pendingId === b.id ? "Redirecting…" : `Choose ${b.songs.toLocaleString()} Songs`}
            </button>
          </DashboardCard>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-6 rounded-2xl border border-border bg-card/60 p-4 text-xs text-muted-foreground">
        <span>⚡ <strong className="text-foreground">Instant Access</strong> — activated as soon as payment is confirmed.</span>
        <span>∞ <strong className="text-foreground">Lifetime Access</strong> — one-time payment, use forever.</span>
      </div>
    </div>
  );
}
