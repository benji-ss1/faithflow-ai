"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "./db/client";
import { subscriptions, churches } from "./db/schema";
import { requireRole } from "./session";
import { stripe, isStripeConfigured } from "./stripe";

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

// Pilot never charges. This exists only so the checkout redirect never
// accidentally fires when we're not ready.
const TIER_TO_STRIPE_PRICE: Record<"starter" | "pro" | "enterprise", string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
};

export async function createCheckoutSession(input: { tier: "starter" | "pro" | "enterprise" }): Promise<Result<{ url: string }>> {
  const admin = await requireRole("admin");
  if (!isStripeConfigured()) return { ok: false, error: "Billing is not configured yet. Contact support." };

  const priceId = TIER_TO_STRIPE_PRICE[input.tier];
  if (!priceId) return { ok: false, error: `No price configured for ${input.tier} yet. This tier is not active.` };

  const db = getDb();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.churchId, admin.churchId)).limit(1);
  const [church] = await db.select().from(churches).where(eq(churches.id, admin.churchId)).limit(1);

  const s = stripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const session = await s.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: admin.email,
    client_reference_id: admin.churchId,
    metadata: { churchId: admin.churchId, tier: input.tier },
    success_url: `${appUrl}/settings/billing?ok=1`,
    cancel_url: `${appUrl}/settings/billing?canceled=1`,
    ...(sub?.stripeCustomerId ? { customer: sub.stripeCustomerId } : {}),
    subscription_data: {
      metadata: { churchId: admin.churchId, churchName: church?.name || "" },
    },
  });

  revalidatePath("/settings/billing");
  return { ok: true, data: { url: session.url! } };
}

export async function openBillingPortal(): Promise<Result<{ url: string }>> {
  const admin = await requireRole("admin");
  if (!isStripeConfigured()) return { ok: false, error: "Billing is not configured yet" };

  const db = getDb();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.churchId, admin.churchId)).limit(1);
  if (!sub?.stripeCustomerId) return { ok: false, error: "You're on the Pilot plan — nothing to manage yet" };

  const s = stripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const portal = await s.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${appUrl}/settings/billing`,
  });
  return { ok: true, data: { url: portal.url } };
}
