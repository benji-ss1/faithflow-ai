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
      const churchId = (data.client_reference_id as string) || (data.metadata as Record<string, string>)?.churchId;
      if (!churchId) return NextResponse.json({ ok: true, skipped: "no churchId" });
      const stripeCustomerId = (data.customer as string) || null;
      const stripeSubscriptionId = (data.subscription as string) || null;
      const tier = ((data.metadata as Record<string, string>)?.tier || "starter") as "starter" | "pro" | "enterprise";
      await db.update(subscriptions)
        .set({ stripeCustomerId, stripeSubscriptionId, tier, status: "trialing", updatedAt: new Date() })
        .where(eq(subscriptions.churchId, churchId));
    } else if (type === "customer.subscription.updated" || type === "customer.subscription.created") {
      const churchId = (data.metadata as Record<string, string>)?.churchId;
      if (!churchId) return NextResponse.json({ ok: true, skipped: "no churchId" });
      const status = (data.status as string) || "active";
      const currentPeriodEnd = data.current_period_end ? new Date((data.current_period_end as number) * 1000) : null;
      const trialEnd = data.trial_end ? new Date((data.trial_end as number) * 1000) : null;
      await db.update(subscriptions)
        .set({ status: mapStripeStatus(status), currentPeriodEnd, trialEnd, updatedAt: new Date() })
        .where(eq(subscriptions.churchId, churchId));
    } else if (type === "customer.subscription.deleted") {
      const churchId = (data.metadata as Record<string, string>)?.churchId;
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

function mapStripeStatus(s: string): "pilot" | "trialing" | "active" | "past_due" | "canceled" {
  if (s === "trialing") return "trialing";
  if (s === "active") return "active";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
  return "pilot";
}
