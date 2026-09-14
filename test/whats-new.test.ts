// What's-New last-seen never moves backwards. Run: npx tsx test/whats-new.test.ts
import assert from "node:assert/strict";
import { forwardLastSeen, newerEntries, cmpVersion, launchDecision } from "../src/lib/whats-new";

const CL = [{ version: "0.1.402" }, { version: "0.1.401" }, { version: "0.1.380" }];

// Simulate launches: desktop app version 0.1.380 behind changelog top 0.1.402.
let stored: string | null = "0.1.380";
function launch(currentVersion: string): boolean {
  const newer = newerEntries(CL, stored);
  if (newer.length === 0) { stored = forwardLastSeen(stored, currentVersion); return false; }
  stored = forwardLastSeen(stored, newer[0].version); // dismiss
  return true;
}
assert.equal(launch("0.1.380"), true, "first launch after update shows");
assert.equal(stored, "0.1.402");
for (let i = 0; i < 5; i++) assert.equal(launch("0.1.380"), false, `launch ${i + 2} must not re-pop`);
assert.equal(stored, "0.1.402", "never reset backwards to app version");
CL.unshift({ version: "0.1.403" });
assert.equal(launch("0.1.380"), true, "a genuinely new entry still shows once");
assert.equal(launch("0.1.380"), false);
assert.equal(forwardLastSeen(null, "0.1.1"), "0.1.1");
assert.equal(forwardLastSeen("0.1.10", "0.1.9"), "0.1.10");
assert.equal(newerEntries(CL, null).length, 0);
assert.ok(cmpVersion("0.1.10", "0.1.9") > 0);

// Desktop app version AHEAD of the notes (0.1.999 vs 0.1.403) must never mask notes:
// launchDecision only ever stores CHANGELOG versions.
{
  const cl = [{ version: "0.1.403" }, { version: "0.1.402" }];
  let seen: string | null = null;
  const run = () => {
    const { newer, store } = launchDecision(cl, seen);
    if (store) seen = forwardLastSeen(seen, store);
    if (newer.length) seen = forwardLastSeen(seen, newer[0].version); // dismiss
    return newer.length;
  };
  assert.equal(run(), 0, "first run shows nothing");
  assert.equal(seen, "0.1.403", "first run stores newest CHANGELOG version, not app version");
  assert.equal(run(), 0);
  assert.equal(seen, "0.1.403", "nothing newer stores nothing");
  cl.unshift({ version: "0.1.404" });
  assert.equal(run(), 1, "new note shows despite app 0.1.999");
  assert.equal(run(), 0, "exactly once");
  assert.deepEqual(launchDecision([], null), { newer: [], store: null });
}
console.log("whats-new: all passed");
