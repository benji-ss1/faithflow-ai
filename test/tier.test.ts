// P10: Tier feature-gate invariants.
// Run: npx tsx --env-file=.env.local test/tier.test.ts
import {
  isMaxOnly,
  canAccess,
  dbTierToTier,
  dbTierToPlanLabel,
  MAX_FEATURES,
  FEATURE_BLURB,
  type Tier,
} from "../src/lib/tier";

let passed = 0;
let failed = 0;

function assert(cond: unknown, label: string) {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}

console.log("tier.test — feature gate invariants");

// isMaxOnly
assert(isMaxOnly("premium-bibles") === true, "premium-bibles is Max-only");
assert(isMaxOnly("premium-themes") === true, "premium-themes is Max-only");
assert(isMaxOnly("pro-content") === true, "pro-content is Max-only");
assert(isMaxOnly("advanced-macros") === true, "advanced-macros is Max-only");
assert(isMaxOnly("bible-lookup") === false, "bible-lookup is NOT Max-only");
assert(isMaxOnly("") === false, "empty feature is not Max-only");
assert(isMaxOnly("unknown-feature") === false, "unknown feature falls open");
// Case sensitivity: canonical is lowercase-kebab
assert(isMaxOnly("Premium-Bibles") === false, "isMaxOnly is case-sensitive; PascalCase is not gated");
assert(isMaxOnly("PREMIUM-BIBLES") === false, "isMaxOnly is case-sensitive; UPPERCASE is not gated");

// canAccess — free
assert(canAccess("free", "bible-lookup") === true, "free can access non-gated feature");
assert(canAccess("free", "premium-bibles") === false, "free CANNOT access premium-bibles");
assert(canAccess("free", "pro-content") === false, "free CANNOT access pro-content");

// canAccess — pilot (early access → Max preview)
assert(canAccess("pilot", "premium-bibles") === true, "pilot CAN access premium-bibles (early access)");
assert(canAccess("pilot", "premium-themes") === true, "pilot CAN access premium-themes (early access)");
assert(canAccess("pilot", "pro-content") === true, "pilot CAN access pro-content (early access)");
assert(canAccess("pilot", "advanced-macros") === true, "pilot CAN access advanced-macros (early access)");
assert(canAccess("pilot", "bible-lookup") === true, "pilot CAN access non-gated feature");

// canAccess — max
assert(canAccess("max", "premium-bibles") === true, "max can access premium-bibles");
assert(canAccess("max", "pro-content") === true, "max can access pro-content");

// canAccess — unknown feature is not gated for any tier
(["free", "pilot", "max"] as Tier[]).forEach((t) => {
  assert(canAccess(t, "unknown-feature") === true, `${t}: unknown feature isn't gated`);
});

// dbTierToTier mapping
assert(dbTierToTier("pilot") === "pilot", "db pilot → pilot");
assert(dbTierToTier("starter") === "free", "db starter → free");
assert(dbTierToTier("pro") === "max", "db pro → max");
assert(dbTierToTier("enterprise") === "max", "db enterprise → max");
assert(dbTierToTier(null) === "free", "db null → free");
assert(dbTierToTier(undefined) === "free", "db undefined → free");

// dbTierToPlanLabel — raw label (analytics)
assert(dbTierToPlanLabel("starter") === "starter", "plan label preserves starter");
assert(dbTierToPlanLabel("pro") === "pro", "plan label preserves pro");
assert(dbTierToPlanLabel(null) === "none", "plan label null → none");
assert(dbTierToPlanLabel(undefined) === "none", "plan label undefined → none");

// MAX_FEATURES set integrity
assert(MAX_FEATURES.size === 4, "exactly 4 Max features declared");
assert(MAX_FEATURES.has("premium-bibles"), "set contains premium-bibles");

// Drift guard: every FEATURE_BLURB key must be in MAX_FEATURES
for (const key of Object.keys(FEATURE_BLURB)) {
  assert(MAX_FEATURES.has(key), `FEATURE_BLURB key "${key}" is in MAX_FEATURES`);
}
// And every MAX_FEATURES key should have a blurb (nice-to-have)
for (const key of MAX_FEATURES) {
  assert(typeof FEATURE_BLURB[key] === "string", `MAX_FEATURES key "${key}" has a FEATURE_BLURB`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
