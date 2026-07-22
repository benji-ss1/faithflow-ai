import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { getDb } from "@/lib/db/client";
import { subscriptions, songBundlePurchases } from "@/lib/db/schema";
import { getSongBundle } from "@/lib/song-limits";

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
    if (type === "checkout.session.completed" && data.mode === "payment") {
      // One-time song-bundle purchase — separate branch from the
      // subscription checkout below (that one is always mode:"subscription").
      // `bundleId` comes from metadata, which IS trustworthy here: this is a
      // Stripe-signed webhook payload (signature verified above), not a
      // client posting metadata directly to an unauthenticated endpoint —
      // different trust boundary than the "never trust metadata" subscription
      // comment below, which is about a DIFFERENT attack (a forged session
      // token claiming a different tier).
      const churchId = data.client_reference_id as string | undefined;
      const sessionId = data.id as string | undefined;
      const metadata = (data.metadata as Record<string, string> | null) ?? null;
      const bundleId = metadata?.bundleId;
      if (!churchId || !sessionId || !bundleId) return NextResponse.json({ ok: true, skipped: "missing fields" });
      const bundle = getSongBundle(bundleId);
      if (!bundle) return NextResponse.json({ ok: true, skipped: "unknown bundle" });
      // Never trust the amount from the session — resolve it server-side from
      // the same SONG_BUNDLES table used to create the checkout session.
      try {
        await db.insert(songBundlePurchases).values({
          churchId,
          stripeCheckoutSessionId: sessionId,
          bundleId: bundle.id,
          songsGranted: bundle.songs,
          amountPaidCents: bundle.priceCents,
        });
      } catch (e) {
        // Unique constraint on stripeCheckoutSessionId — a webhook redelivery
        // for a purchase we already recorded. Not an error, just a no-op.
        // Postgres error CODE (23505 = unique_violation) rather than matching
        // the message string — the code is stable across locales/PG versions,
        // message text isn't.
        if ((e as { code?: string })?.code !== "23505") throw e;
      }
    } else if (type === "checkout.session.completed") {
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
