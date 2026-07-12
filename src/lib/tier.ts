// P10: Present Flow Max tier scaffolding — feature-gate model.
//
// The DB stores tier as one of "pilot" | "starter" | "pro" | "enterprise"
// (see subscriptionTierEnum in src/lib/db/schema.ts). The UI-facing tier
// model collapses those to three buckets for gating decisions:
//   - "free"  → no active plan / starter
//   - "pilot" → early access church on free trial
//   - "max"   → paid Present Flow Max (pro | enterprise)
//
// This module is a *scaffolding* — no real feature unlocks happen here.
// Actual entitlement checks live in server actions once billing is live.

export type Tier = "free" | "pilot" | "max";

export type DbTier = "pilot" | "starter" | "pro" | "enterprise";

/** Feature keys that Max unlocks. Kept flat so it's grep-friendly. */
export const MAX_FEATURES = new Set<string>([
  "premium-bibles",
  "premium-themes",
  "pro-content",
  "advanced-macros",
]);

/** True when the feature key is Max-only. Unknown keys → false. */
export function isMaxOnly(feature: string): boolean {
  return MAX_FEATURES.has(feature);
}

/** Collapse the DB tier enum into the UI-facing tier bucket. */
export function dbTierToTier(db: DbTier | null | undefined): Tier {
  if (!db) return "free";
  if (db === "pro" || db === "enterprise") return "max";
  if (db === "pilot") return "pilot";
  return "free"; // starter → free until a paid plan is active
}

/** True when the given tier can access a Max-only feature. */
export function canAccess(tier: Tier, feature: string): boolean {
  if (!isMaxOnly(feature)) return true;
  return tier === "max";
}

/** UI copy — one short benefit line per gated feature. */
export const FEATURE_BLURB: Record<string, string> = {
  "premium-bibles": "Includes ESV, NIV, NKJV, NASB, NLT and more.",
  "premium-themes": "Cinematic, Modern, Elegant, and Youth theme packs.",
  "pro-content": "Moving backgrounds, premium graphics, and licensed content.",
  "advanced-macros": "Chainable macros and conditional triggers.",
};
