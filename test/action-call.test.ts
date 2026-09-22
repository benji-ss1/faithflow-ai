/**
 * A server action must never reach the global error net.
 * Run: npx tsx --test test/action-call.test.ts
 *
 * 2026-09-22, seen live in a church mid-service: a thrown server action in the
 * timers / stage-layout hooks rejected UNHANDLED, fell through to
 * ProOperatorShell's `unhandledrejection` listener, and showed the operator
 *
 *   "Background task failed: An error occurred in the Server Components
 *    render. The specific message is omitted in production builds…"
 *
 * while their edit failed silently and the dialog closed as if it had worked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callAction, actionDigest } from "../src/lib/action-call";

test("a throwing action becomes {ok:false}, never a rejection", async () => {
  const res = await callAction("add the timer", async () => { throw new Error("boom"); });
  assert.equal(res.ok, false);
  assert.match((res as { error: string }).error, /Couldn't add the timer/);
});

test("the operator is told nothing was changed", async () => {
  let shown = "";
  await callAction("delete the layout", async () => { throw new Error("x"); }, (m) => { shown = m; });
  // Not the redacted Next message, and it states the consequence — an
  // operator mid-service needs to know whether to try again.
  assert.match(shown, /Couldn't delete the layout\. Nothing was changed\./);
  assert.doesNotMatch(shown, /Server Components|digest|omitted in production/);
});

test("the happy path is untouched", async () => {
  const res = await callAction("x", async () => ({ ok: true as const, data: 42 }));
  assert.deepEqual(res, { ok: true, data: 42 });
});

test("an action RETURNING {ok:false} passes through unchanged", async () => {
  // A handled failure is not an exception — it must not be relabelled, or a
  // real message like "Stage layout limit reached" would be replaced by the
  // generic one.
  const res = await callAction("add", async () => ({ ok: false as const, error: "Limit reached" }));
  assert.deepEqual(res, { ok: false, error: "Limit reached" });
});

test("the digest is extracted when Next attaches one", () => {
  const err = Object.assign(new Error("redacted"), { digest: "3141592653" });
  assert.equal(actionDigest(err), "3141592653");
  assert.equal(actionDigest(new Error("no digest")), null);
  assert.equal(actionDigest(null), null);
});

// ── the call sites, derived ────────────────────────────────────────────────
const HOOKS = [
  "src/components/operator/pro/hooks.ts",
  "src/components/operator/pro/right/useStageLayouts.ts",
];

test("no mutating server action in these hooks is called bare", () => {
  // Derived: any NEW mutating action added to these hooks without callAction
  // fails here, rather than being found by a church on a Sunday.
  const MUTATORS = /\b(create|update|delete|set|rename)(Timer|Stage)[A-Za-z]*\(/g;
  for (const f of HOOKS) {
    const src = readFileSync(f, "utf8");
    for (const line of src.split("\n")) {
      if (!MUTATORS.test(line)) continue;
      MUTATORS.lastIndex = 0;
      if (line.trimStart().startsWith("//") || line.includes("import")) continue;
      assert.ok(line.includes("callAction"),
        `${f}: mutating action called without callAction — a throw here becomes an unhandled rejection:\n    ${line.trim()}`);
    }
  }
});

test("a failed load is distinguishable from an empty list", () => {
  const hooks = readFileSync("src/components/operator/pro/hooks.ts", "utf8");
  assert.match(hooks, /loadError/, "the timers hook must report a failed load");
  assert.doesNotMatch(hooks, /catch \{ \/\* offline \/ no session — leave list empty \*\/ \}/,
    "the silent swallow is back — a failed load will read as 'you have no timers'");
  const panel = readFileSync("src/components/operator/pro/right/TimersPanel.tsx", "utf8");
  assert.match(panel, /timers\.loadError/, "the panel must show the failed-load state");
  assert.match(panel, /have not been deleted/, "the operator must be told their timers still exist");
});
