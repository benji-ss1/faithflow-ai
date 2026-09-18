import { deriveServiceMode, resolveAutopilotModeForResilience } from "../src/lib/connection/connectionHealth";

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

// No-regression guard: outages only disarm AUTO. They never stop manual
// presentation, and reconnect/recovery can never silently re-arm AUTO.
expect(resolveAutopilotModeForResilience("active", "online", "live"), "active", "AI live preserves AUTO");
expect(resolveAutopilotModeForResilience("active", "online", "reconnecting"), "active", "short reconnect preserves AUTO");
expect(resolveAutopilotModeForResilience("active", "online", "down"), "manual", "terminal AI outage disarms AUTO");
expect(resolveAutopilotModeForResilience("active", "offline", "live"), "manual", "offline state disarms AUTO");
expect(resolveAutopilotModeForResilience("manual", "online", "live"), "manual", "recovery never re-arms AUTO");
expect(resolveAutopilotModeForResilience("suggestion", "online", "live"), "suggestion", "operator-selected suggestion mode is preserved");

if (failed > 0) process.exit(1);
