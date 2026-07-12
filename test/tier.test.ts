// P10: Tier feature-gate invariants.
// Run: npx tsx --env-file=.env.local test/tier.test.ts
import { isMaxOnly, canAccess, dbTierToTier, MAX_FEATURES } from "../src/lib/tier";

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

// canAccess
assert(canAccess("free", "bible-lookup") === true, "free can access non-gated feature");
assert(canAccess("free", "premium-bibles") === false, "free CANNOT access premium-bibles");
assert(canAccess("pilot", "premium-bibles") === false, "pilot CANNOT access premium-bibles");
assert(canAccess("max", "premium-bibles") === true, "max can access premium-bibles");
assert(canAccess("max", "pro-content") === true, "max can access pro-content");
assert(canAccess("free", "pro-content") === false, "free CANNOT access pro-content");

// dbTierToTier mapping
assert(dbTierToTier("pilot") === "pilot", "db pilot → pilot");
assert(dbTierToTier("starter") === "free", "db starter → free");
assert(dbTierToTier("pro") === "max", "db pro → max");
assert(dbTierToTier("enterprise") === "max", "db enterprise → max");
assert(dbTierToTier(null) === "free", "db null → free");
assert(dbTierToTier(undefined) === "free", "db undefined → free");

// MAX_FEATURES set integrity
assert(MAX_FEATURES.size === 4, "exactly 4 Max features declared");
assert(MAX_FEATURES.has("premium-bibles"), "set contains premium-bibles");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
