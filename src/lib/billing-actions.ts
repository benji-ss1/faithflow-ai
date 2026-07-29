"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "./db/client";
import { subscriptions, churches } from "./db/schema";
import { requireRole } from "./session";
import { stripe, isStripeConfigured } from "./stripe";
import { getSongBundle } from "./song-limits";

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

// Cycle-aware pricing lookup. Prefer per-cycle env vars
// (STRIPE_PRICE_{TIER}_{MONTHLY|YEARLY}) when set; fall back to the
// legacy single-price env var (STRIPE_PRICE_{TIER}) which is treated as
// monthly. Both paths are pilot-safe — if no env var exists for the
// requested tier+cycle, the caller gets a clean {ok:false} instead of a
// Stripe error.
type TierKey = "starter" | "pro" | "enterprise";
type Cycle = "monthly" | "yearly";

function resolveStripePrice(tier: TierKey, cycle: Cycle): string | undefined {
  const upperTier = tier.toUpperCase();
  const upperCycle = cycle.toUpperCase();
  const cycled = process.env[`STRIPE_PRICE_${upperTier}_${upperCycle}`];
  if (cycled) return cycled;
  // Legacy fallback — monthly only. Anyone still using the flat
  // STRIPE_PRICE_* env vars gets monthly regardless of the requested
  // cycle. That's the safe direction — you can never accidentally
  // upsell a customer to a yearly plan that doesn't exist.
  if (cycle === "monthly") return process.env[`STRIPE_PRICE_${upperTier}`];
  return undefined;
}

export async function createCheckoutSession(input: { tier: TierKey; cycle?: Cycle }): Promise<Result<{ url: string }>> {
  const admin = await requireRole("admin");
  if (!isStripeConfigured()) return { ok: false, error: "Billing is not configured yet. Contact support." };

  const cycle: Cycle = input.cycle === "yearly" ? "yearly" : "monthly";
  const priceId = resolveStripePrice(input.tier, cycle);
  if (!priceId) return { ok: false, error: `No ${cycle} price configured for ${input.tier} yet. This tier/cycle is not active.` };

  const db = getDb();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.churchId, admin.churchId)).limit(1);
  const [church] = await db.select().from(churches).where(eq(churches.id, admin.churchId)).limit(1);

  const s = stripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Wrap Stripe call so a transient upstream error returns {ok:false} instead
  // of 500-ing the billing page. Also guard against Stripe returning no url
  // (previously non-null-assertion `session.url!` would crash on null).
  try {
    const session = await s.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: admin.email,
      client_reference_id: admin.churchId,
      metadata: { churchId: admin.churchId, tier: input.tier, cycle },
      success_url: `${appUrl}/settings/billing?ok=1`,
      cancel_url: `${appUrl}/settings/billing?canceled=1`,
      ...(sub?.stripeCustomerId ? { customer: sub.stripeCustomerId } : {}),
      subscription_data: {
        metadata: { churchId: admin.churchId, churchName: church?.name || "", cycle },
      },
    });
    if (!session.url) return { ok: false, error: "Stripe returned no checkout URL — try again in a minute" };
    revalidatePath("/settings/billing");
    return { ok: true, data: { url: session.url } };
  } catch (err) {
    console.error("[billing] createCheckoutSession failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: err instanceof Error ? `Stripe error: ${err.message}` : "Stripe error" };
  }
}

// One-time song-bundle purchase — separate from the subscription flow
// above. Uses inline `price_data` instead of a pre-created Stripe Price ID
// so adding/changing bundle tiers never needs a Stripe Dashboard change.
// `metadata.bundleId` is set here server-side and read back in the webhook
// (src/app/api/stripe/webhook/route.ts) — safe to trust there because a
// webhook payload is Stripe-signed, unlike metadata a client could post
// directly to an endpoint.
export async function createSongBundleCheckoutSession(bundleId: string): Promise<Result<{ url: string }>> {
  const admin = await requireRole("admin");
  if (!isStripeConfigured()) return { ok: false, error: "Billing is not configured yet. Contact support." };

  const bundle = getSongBundle(bundleId);
  if (!bundle) return { ok: false, error: "Unknown bundle" };

  const db = getDb();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.churchId, admin.churchId)).limit(1);

  const s = stripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  try {
    const session = await s.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "eur",
          unit_amount: bundle.priceCents,
          product_data: { name: bundle.label, description: `${bundle.songs} additional songs, lifetime access` },
        },
        quantity: 1,
      }],
      customer_email: admin.email,
      client_reference_id: admin.churchId,
      metadata: { churchId: admin.churchId, bundleId: bundle.id },
      success_url: `${appUrl}/library/songs?bundle=success`,
      cancel_url: `${appUrl}/library/songs?bundle=cancelled`,
      ...(sub?.stripeCustomerId ? { customer: sub.stripeCustomerId } : {}),
    });
    if (!session.url) return { ok: false, error: "Stripe returned no checkout URL — try again in a minute" };
    return { ok: true, data: { url: session.url } };
  } catch (err) {
    console.error("[billing] createSongBundleCheckoutSession failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: err instanceof Error ? `Stripe error: ${err.message}` : "Stripe error" };
  }
}

export async function openBillingPortal(): Promise<Result<{ url: string }>> {
  const admin = await requireRole("admin");
  if (!isStripeConfigured()) return { ok: false, error: "Billing is not configured yet" };

  const db = getDb();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.churchId, admin.churchId)).limit(1);
  if (!sub?.stripeCustomerId) return { ok: false, error: "You're on the Pilot plan — nothing to manage yet" };

  const s = stripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  try {
    const portal = await s.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${appUrl}/settings/billing`,
    });
    if (!portal.url) return { ok: false, error: "Stripe returned no portal URL — try again in a minute" };
    return { ok: true, data: { url: portal.url } };
  } catch (err) {
    console.error("[billing] openBillingPortal failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: err instanceof Error ? `Stripe error: ${err.message}` : "Stripe error" };
  }
}
