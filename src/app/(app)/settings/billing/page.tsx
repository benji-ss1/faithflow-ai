import { eq } from "drizzle-orm";
import { Info } from "lucide-react";
import { requireRole } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { isStripeConfigured } from "@/lib/stripe";
import { PageHeader } from "@/components/layout/PageHeader";
import { BillingPanel } from "@/components/settings/BillingPanel";

export default async function BillingPage() {
  const admin = await requireRole("admin");
  const db = getDb();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.churchId, admin.churchId)).limit(1);
  const stripeReady = isStripeConfigured();

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        eyebrow="Billing"
        title="Billing"
        description="Account billing controls and plan state. Billing status should notify admins without blocking Sunday live operation."
      />
      {!stripeReady && (
        <div className="flex items-start gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <div>
            <div className="mb-1 font-semibold text-foreground">Billing not yet configured</div>
            You&rsquo;re on the free Pilot tier &mdash; no payment method is on file and no charges are possible. When Stripe test keys are added
            (<code className="rounded bg-white/5 px-1 py-[1px] text-[10px]">STRIPE_SECRET_KEY</code>,{" "}
            <code className="rounded bg-white/5 px-1 py-[1px] text-[10px]">STRIPE_PRICE_*</code>), Change Plan will light up here.
            Contact support if you need billing sooner.
          </div>
        </div>
      )}
      <BillingPanel
        tier={sub?.tier || "pilot"}
        status={sub?.status || "pilot"}
        currentPeriodEnd={sub?.currentPeriodEnd?.toISOString() || null}
        trialEnd={sub?.trialEnd?.toISOString() || null}
        hasStripeCustomer={!!sub?.stripeCustomerId}
      />
    </div>
  );
}
