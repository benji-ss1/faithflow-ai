import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { getDb } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * Stripe webhook. Test-mode only — the stripe() client throws if the key
 * isn't sk_test_. We intentionally do NOT write any state that would allow
 * a real charge to proceed unnoticed; the schema's default is "pilot" and
 * only explicit subscription events transition it.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 501 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const body = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    return NextResponse.json({ error: `Invalid signature: ${e instanceof Error ? e.message : "?"}` }, { status: 400 });
  }

  const db = getDb();
  const type = event.type;
  const data = event.data.object as unknown as Record<string, unknown>;

  try {
    if (type === "checkout.session.completed") {
      // client_reference_id is set server-side when we mint the checkout
      // session — it is the ONLY trustworthy churchId source at this stage.
      // metadata.churchId is deliberately IGNORED because it's caller-mutable
      // (a compromised session token could forge it to another church).
      const churchId = data.client_reference_id as string | undefined;
      if (!churchId) return NextResponse.json({ ok: true, skipped: "no churchId" });
      const stripeCustomerId = (data.customer as string) || null;
      const stripeSubscriptionId = (data.subscription as string) || null;
      // Same reason: metadata.tier is mutable; the safe read is the sub row
      // from Stripe (fetched via subscription id above). For now default to
      // starter unless the price_id → tier mapping is wired.
      const tier = "starter" as const;
      await db.update(subscriptions)
        .set({ stripeCustomerId, stripeSubscriptionId, tier, status: "trialing", updatedAt: new Date() })
        .where(eq(subscriptions.churchId, churchId));
    } else if (type === "customer.subscription.updated" || type === "customer.subscription.created") {
      // Don't trust metadata.churchId — it can be rewritten after the initial
      // checkout. Instead resolve churchId by the immutable stripeSubscriptionId
      // (or stripeCustomerId fallback) that we recorded during checkout.
      const subId = (data.id as string) || null;
      const custId = (data.customer as string) || null;
      const churchId = await resolveChurchId(db, subId, custId);
      if (!churchId) return NextResponse.json({ ok: true, skipped: "no matching subscription row" });
      const status = (data.status as string) || "active";
      const currentPeriodEnd = data.current_period_end ? new Date((data.current_period_end as number) * 1000) : null;
      const trialEnd = data.trial_end ? new Date((data.trial_end as number) * 1000) : null;
      await db.update(subscriptions)
        .set({ status: mapStripeStatus(status), currentPeriodEnd, trialEnd, updatedAt: new Date() })
        .where(eq(subscriptions.churchId, churchId));
    } else if (type === "customer.subscription.deleted") {
      const subId = (data.id as string) || null;
      const custId = (data.customer as string) || null;
      const churchId = await resolveChurchId(db, subId, custId);
      if (!churchId) return NextResponse.json({ ok: true });
      await db.update(subscriptions)
        .set({ status: "canceled", updatedAt: new Date() })
        .where(eq(subscriptions.churchId, churchId));
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("[stripe-webhook] handler error:", e);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}

/** Resolve the churchId a Stripe subscription belongs to via our own DB.
 * Prefers stripeSubscriptionId (unique per checkout), falls back to
 * stripeCustomerId. Returns null if we've never seen this sub — that's the
 * signal to reject the event (privesc defense). */
async function resolveChurchId(
  db: ReturnType<typeof getDb>,
  subId: string | null,
  custId: string | null,
): Promise<string | null> {
  if (subId) {
    const [row] = await db
      .select({ churchId: subscriptions.churchId })
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subId))
      .limit(1);
    if (row) return row.churchId;
  }
  if (custId) {
    const [row] = await db
      .select({ churchId: subscriptions.churchId })
      .from(subscriptions)
      .where(eq(subscriptions.stripeCustomerId, custId))
      .limit(1);
    if (row) return row.churchId;
  }
  return null;
}

function mapStripeStatus(s: string): "pilot" | "trialing" | "active" | "past_due" | "canceled" {
  if (s === "trialing") return "trialing";
  if (s === "active") return "active";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
  return "pilot";
}
