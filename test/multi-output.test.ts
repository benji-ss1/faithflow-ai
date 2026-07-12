/**
 * Multi-output (Stage + Livestream) plumbing tests.
 *
 * Run: npx tsx --env-file=.env.local test/multi-output.test.ts
 *
 * Headless: no Electron, no BrowserWindow. We verify only:
 *   1. OutputState payload validation for `nextItem` and `countdownEndsAt`.
 *   2. Role → URL page presence for stage + livestream.
 *   3. livestreamUrl() builder handles OBS mode.
 */
import assert from "node:assert";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMPTY_OUTPUT,
  isValidOutputState,
  livestreamUrl,
  type OutputState,
} from "../src/lib/broadcast";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => { console.log(`  PASS  ${name}`); pass++; })
    .catch((e) => { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; });
}

async function main() {
  console.log("Multi-output plumbing");

  const validBase: OutputState = { ...EMPTY_OUTPUT };

  // --- 1. nextItem validation --------------------------------------------
  await check("accepts nextItem with title + type", () => {
    const s = { ...validBase, nextItem: { title: "Song 2", type: "song" } };
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("rejects nextItem.title of wrong type", () => {
    const s = { ...validBase, nextItem: { title: 123 as unknown as string, type: "song" } };
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects nextItem.title over 500 chars", () => {
    const s = { ...validBase, nextItem: { title: "x".repeat(10000), type: "song" } };
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("accepts nextItem === null", () => {
    const s = { ...validBase, nextItem: null };
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("rejects nextItem missing type", () => {
    const s = { ...validBase, nextItem: { title: "ok" } as unknown as { title: string; type: string } };
    assert.strictEqual(isValidOutputState(s), false);
  });

  // --- 2. countdownEndsAt validation --------------------------------------
  await check("accepts countdownEndsAt in near future", () => {
    const s = { ...validBase, countdownEndsAt: Date.now() + 60_000 };
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("accepts countdownEndsAt === null", () => {
    const s = { ...validBase, countdownEndsAt: null };
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("rejects countdownEndsAt = -1", () => {
    const s = { ...validBase, countdownEndsAt: -1 };
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects countdownEndsAt = NaN", () => {
    const s = { ...validBase, countdownEndsAt: NaN };
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects countdownEndsAt more than 24h in future", () => {
    const s = { ...validBase, countdownEndsAt: Date.now() + 48 * 3600 * 1000 };
    assert.strictEqual(isValidOutputState(s), false);
  });

  // --- 3. Role → URL mapping matches real Next routes --------------------
  const ROLE_TO_PATH: Record<string, string> = {
    Projector: "/live",
    Stage: "/stage",
    Livestream: "/livestream",
  };
  for (const [role, path] of Object.entries(ROLE_TO_PATH)) {
    await check(`${role} → ${path} has a page.tsx`, () => {
      const p = resolve(process.cwd(), `src/app${path}/page.tsx`);
      assert.strictEqual(existsSync(p), true, `expected ${p} to exist`);
    });
  }

  // --- 4. livestreamUrl builder ------------------------------------------
  await check("livestreamUrl without opts returns base URL", () => {
    assert.strictEqual(livestreamUrl("Livestream", "http://localhost:3000"), "http://localhost:3000/livestream");
  });

  await check("livestreamUrl with obs=lowerthird appends query", () => {
    assert.strictEqual(
      livestreamUrl("Livestream", "http://localhost:3000", { obs: "lowerthird" }),
      "http://localhost:3000/livestream?obs=lowerthird",
    );
  });

  await check("livestreamUrl with obs=full omits query", () => {
    assert.strictEqual(
      livestreamUrl("Livestream", "http://localhost:3000", { obs: "full" }),
      "http://localhost:3000/livestream",
    );
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
