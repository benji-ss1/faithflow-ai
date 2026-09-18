import { deriveServiceMode } from "../src/lib/connection/connectionHealth";

let failed = 0;
function expect(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) {
    console.log(`[PASS] ${label}`);
  } else {
    failed += 1;
    console.error(`[FAIL] ${label}: expected ${expected}, got ${actual}`);
  }
}

// Normal audio states: only a terminal failure changes the operator mode.
expect(deriveServiceMode("online", "live", "ok"), "FULLY_ONLINE", "AI live is fully online");
expect(deriveServiceMode("online", "reconnecting", "ok"), "FULLY_ONLINE", "short reconnect stays calm");
expect(deriveServiceMode("online", "down", "ok"), "AI_DEGRADED", "AI failure selects manual presentation mode");

// The safest available mode always wins.
expect(deriveServiceMode("online", "down", "degraded"), "DATA_DEGRADED", "data outage outranks AI outage");
expect(deriveServiceMode("offline", "down", "degraded"), "OFFLINE", "offline local mode outranks every remote outage");

if (failed > 0) process.exit(1);
