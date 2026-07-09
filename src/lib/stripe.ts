// Stripe client. Absolutely NEVER used with a live key. The `stripe()` helper
// throws if STRIPE_SECRET_KEY is not a test-mode key. The pilot tier never
// invokes billing at all, so this only fires if an admin explicitly clicks
// "Upgrade to Starter" (etc) — and even then it lands in test mode.

import Stripe from "stripe";

let _client: Stripe | null = null;

export function stripe(): Stripe {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  if (!key.startsWith("sk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be a test-mode key (starts with sk_test_). Live billing is not enabled yet.");
  }
  _client = new Stripe(key, { apiVersion: "2024-11-20.acacia" as never });
  return _client;
}

export const isStripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;
