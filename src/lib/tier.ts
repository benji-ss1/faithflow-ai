// @client-only
// P10: Present Flow Max tier scaffolding — feature-gate model.
//
// WARNING: This module is CLIENT-ONLY for UI hint purposes.
// Do NOT import into server actions for entitlement decisions.
// Server actions must query the `subscriptions` table directly to enforce
// real entitlement. This module can drift, be cached, or be forged in the
// browser — it is UI scaffolding, not a security boundary.
//
// The DB stores tier as one of "pilot" | "starter" | "pro" | "enterprise"
// (see subscriptionTierEnum in src/lib/db/schema.ts). The UI-facing tier
// model collapses those to three buckets for gating decisions:
//   - "free"  → no active plan / starter
//   - "pilot" → early access church on free trial (Max feature preview)
//   - "max"   → paid Present Flow Max (pro | enterprise)

export type Tier = "free" | "pilot" | "max";

export type DbTier = "pilot" | "starter" | "pro" | "enterprise";

/** Feature keys that Max unlocks. Kept flat so it's grep-friendly. */
export const MAX_FEATURES = new Set<string>([
  "premium-bibles",
  "premium-themes",
  "pro-content",
  "advanced-macros",
]);

/** True when the feature key is Max-only. Unknown keys → false. Case-sensitive: canonical keys are lowercase-kebab. */
export function isMaxOnly(feature: string): boolean {
  return MAX_FEATURES.has(feature);
}

/** Collapse the DB tier enum into the UI-facing tier bucket. */
export function dbTierToTier(db: DbTier | null | undefined): Tier {
  if (!db) return "free";
  if (db === "pro" || db === "enterprise") return "max";
  if (db === "pilot") return "pilot";
  // TODO(billing): starter is a paid SKU; distinguish from free once analytics needs it.
  return "free"; // starter → free until a paid plan is active
}

/**
 * Raw DB tier label for analytics/telemetry. Does NOT collapse starter → free.
 * Never use this for entitlement decisions — use canAccess() for UI hints and
 * server-side subscription queries for the actual entitlement.
 */
export function dbTierToPlanLabel(db: DbTier | null | undefined): string {
  return db ?? "none";
}

/**
 * True when the given tier can access a Max-only feature.
 * DECISION (see DECISIONS.md): pilot tier gets Max feature preview
 * (early-access churches see the full Max feature set during their trial).
 */
export function canAccess(tier: Tier, feature: string): boolean {
  if (!isMaxOnly(feature)) return true;
  return tier === "max" || tier === "pilot"; // early-access includes pilot
}

/** UI copy — one short benefit line per gated feature. */
export const FEATURE_BLURB: Record<string, string> = {
  "premium-bibles": "Includes ESV, NIV, NKJV, NASB, NLT and more.",
  "premium-themes": "Cinematic, Modern, Elegant, and Youth theme packs.",
  "pro-content": "Moving backgrounds, premium graphics, and licensed content.",
  "advanced-macros": "Chainable macros and conditional triggers.",
};
