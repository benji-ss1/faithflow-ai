import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { mediaAssets, subscriptions } from "@/lib/db/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountCard } from "@/components/account/AccountCard";
import { BillingPanel } from "@/components/settings/BillingPanel";

export default async function SubscriptionsPage() {
  const admin = await requireRole("admin");
  const db = getDb();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.churchId, admin.churchId)).limit(1);
  const media = await db.select().from(mediaAssets).where(eq(mediaAssets.churchId, admin.churchId));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Subscriptions"
        title="Plan and usage"
        description="Seats, plan posture, and lightweight SaaS account management. Billing warnings should notify admins without blocking Sunday live operation."
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <AccountCard title="Current plan" description="High-level account tier.">
          <div className="text-3xl font-semibold capitalize">{sub?.tier || "pilot"}</div>
          <div className="mt-2 text-sm text-muted-foreground capitalize">{(sub?.status || "pilot").replace("_", " ")}</div>
        </AccountCard>
        <AccountCard title="AI usage" description="Placeholder until formal usage metering lands.">
          <div className="text-3xl font-semibold">Pilot</div>
          <div className="mt-2 text-sm text-muted-foreground">No hard usage billing enforced in current phase.</div>
        </AccountCard>
        <AccountCard title="Storage posture" description="Media and archive growth signal.">
          <div className="text-3xl font-semibold">{media.length}</div>
          <div className="mt-2 text-sm text-muted-foreground">registered media assets in this workspace</div>
        </AccountCard>
      </div>
      <div className="max-w-3xl">
        <BillingPanel
          tier={sub?.tier || "pilot"}
          status={sub?.status || "pilot"}
          currentPeriodEnd={sub?.currentPeriodEnd?.toISOString() || null}
          trialEnd={sub?.trialEnd?.toISOString() || null}
          hasStripeCustomer={!!sub?.stripeCustomerId}
        />
      </div>
    </div>
  );
}
