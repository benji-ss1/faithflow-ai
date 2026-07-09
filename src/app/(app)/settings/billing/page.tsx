import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { BillingPanel } from "@/components/settings/BillingPanel";

export default async function BillingPage() {
  const admin = await requireRole("admin");
  const db = getDb();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.churchId, admin.churchId)).limit(1);

  return (
    <div className="max-w-2xl">
      <PageHeader
        eyebrow="Billing"
        title="Billing"
        description="Account billing controls and plan state. Billing status should notify admins without blocking Sunday live operation."
      />
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
