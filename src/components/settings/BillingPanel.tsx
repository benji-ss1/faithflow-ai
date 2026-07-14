"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Info, Sparkles } from "lucide-react";
import { createCheckoutSession, openBillingPortal } from "@/lib/billing-actions";

const TIER_LABELS: Record<string, string> = {
  pilot: "Pilot / Early access",
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
};
const STATUS_LABELS: Record<string, string> = {
  pilot: "No card on file · free during pilot",
  trialing: "Trial in progress",
  active: "Active",
  past_due: "Past due — update payment",
  canceled: "Canceled",
};

export function BillingPanel({ tier, status, currentPeriodEnd, trialEnd, hasStripeCustomer }: {
  tier: string; status: string; currentPeriodEnd: string | null; trialEnd: string | null; hasStripeCustomer: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function upgrade(t: "starter" | "pro") {
    startTransition(async () => {
      const res = await createCheckoutSession({ tier: t });
      if (!res.ok) { toast.error(res.error); return; }
      window.location.href = res.data!.url;
    });
  }

  function portal() {
    startTransition(async () => {
      const res = await openBillingPortal();
      if (!res.ok) { toast.error(res.error); return; }
      window.location.href = res.data!.url;
    });
  }

  return (
    <div className="space-y-4">
      <section className="border border-border rounded-md bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="eyebrow text-muted-foreground">Current plan</div>
            <div className="text-lg font-semibold mt-0.5">{TIER_LABELS[tier] || tier}</div>
            <div className="text-xs text-muted-foreground">{STATUS_LABELS[status] || status}</div>
          </div>
          {tier === "pilot" && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm border border-success/40 text-success bg-success/5">
              Free
            </span>
          )}
        </div>

        {tier === "pilot" && (
          <div className="border border-warning/40 bg-warning/5 rounded-md p-3 text-xs text-muted-foreground space-y-1">
            <div className="flex items-start gap-2 font-semibold text-warning"><Info className="w-3 h-3 mt-0.5" /> No billing is active</div>
            <p>
              We're in the pilot phase — no card is on file and no charges will occur without your explicit action, even if you click a paid tier below (Stripe is in test mode).
            </p>
          </div>
        )}

        {(currentPeriodEnd || trialEnd) && (
          <ul className="mt-3 text-xs text-muted-foreground space-y-1">
            {trialEnd && <li>Trial ends: {new Date(trialEnd).toLocaleDateString()}</li>}
            {currentPeriodEnd && <li>Renews: {new Date(currentPeriodEnd).toLocaleDateString()}</li>}
          </ul>
        )}
      </section>

      {tier === "pilot" && (
        <section className="border border-border rounded-md bg-card p-4">
          <div className="eyebrow text-muted-foreground mb-3">Upgrade plans</div>
          <div className="grid grid-cols-2 gap-3">
            <TierCard name="Starter" price="TBD" description="Full AI stack for a single-service church."
              onUpgrade={() => upgrade("starter")} disabled={pending} />
            <TierCard name="Pro" price="TBD" description="Multi-campus, historical archives, priority support."
              onUpgrade={() => upgrade("pro")} disabled={pending} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-3">
            Prices intentionally hidden until we validate them with pilot churches. Any Upgrade click here uses Stripe test mode.
          </p>
        </section>
      )}

      {hasStripeCustomer && (
        <section className="border border-border rounded-md bg-card p-4 flex items-center justify-between">
          <div className="text-sm">Manage payment method + invoices in the Stripe portal.</div>
          <button onClick={portal} disabled={pending}
            className="h-9 px-4 border border-border rounded-md text-sm font-semibold hover:bg-accent">
            Open portal
          </button>
        </section>
      )}
    </div>
  );
}

function TierCard({ name, price, description, onUpgrade, disabled }: { name: string; price: string; description: string; onUpgrade: () => void; disabled: boolean }) {
  return (
    <div className="border border-border rounded-md p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold">{name}</span>
        <span className="text-xs text-muted-foreground">{price}</span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{description}</p>
      <button onClick={onUpgrade} disabled={disabled}
        className="w-full h-8 border border-border rounded-md text-xs font-semibold hover:bg-accent disabled:opacity-50 flex items-center justify-center gap-1">
        <Sparkles className="w-3 h-3" /> Explore (test mode)
      </button>
    </div>
  );
}
