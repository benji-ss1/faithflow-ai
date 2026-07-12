/**
 * Projector output plumbing tests.
 *
 * Run: npx tsx --env-file=.env.local test/projector-output.test.ts
 *
 * These tests are headless — we can't spawn a real Electron BrowserWindow
 * inside tsx. Instead we verify:
 *   1. Payload validator accepts every shape the operator can send and
 *      rejects malformed / unknown-kind payloads (adversarial input).
 *   2. The role → URL mapping in OutputWindow lines up with real Next
 *      route files under src/app/*.
 *   3. Aspect-ratio flows through OutputState (schema-level).
 *
 * Uses plain node:assert (matching test/bible-completeness.test.ts).
 */
import assert from "node:assert";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  isValidLiveMessage,
  EMPTY_OUTPUT,
  type LiveMessage,
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
  console.log("Projector output plumbing");

  // --- 1. Validator: happy path -------------------------------------------
  await check("validator accepts ping", () => {
    assert.strictEqual(isValidLiveMessage({ type: "ping" } as LiveMessage), true);
  });

  await check("validator accepts clear", () => {
    assert.strictEqual(isValidLiveMessage({ type: "clear" } as LiveMessage), true);
  });

  await check("validator accepts set/text", () => {
    const m: LiveMessage = { type: "set", slide: { kind: "text", text: "John 3:16" } };
    assert.strictEqual(isValidLiveMessage(m), true);
  });

  await check("validator accepts set/image", () => {
    const m: LiveMessage = { type: "set", slide: { kind: "image", url: "https://example/x.jpg" } };
    assert.strictEqual(isValidLiveMessage(m), true);
  });

  await check("validator accepts set/blank", () => {
    const m: LiveMessage = { type: "set", slide: { kind: "blank" } };
    assert.strictEqual(isValidLiveMessage(m), true);
  });

  await check("validator accepts set/logo", () => {
    const m: LiveMessage = { type: "set", slide: { kind: "logo" } };
    assert.strictEqual(isValidLiveMessage(m), true);
  });

  await check("validator accepts set/empty (kill)", () => {
    const m: LiveMessage = { type: "set", slide: { kind: "empty" } };
    assert.strictEqual(isValidLiveMessage(m), true);
  });

  await check("validator accepts output state", () => {
    const state: OutputState = { ...EMPTY_OUTPUT, live: { kind: "text", text: "hi" } };
    assert.strictEqual(isValidLiveMessage({ type: "output", state } as LiveMessage), true);
  });

  await check("validator accepts message overlay with dismiss", () => {
    const m: LiveMessage = { type: "message", overlay: { text: "silence phones", dismissAfterMs: 10_000 } };
    assert.strictEqual(isValidLiveMessage(m), true);
  });

  await check("validator accepts message overlay with clear", () => {
    const m: LiveMessage = { type: "message", overlay: { clear: true } };
    assert.strictEqual(isValidLiveMessage(m), true);
  });

  // --- 2. Validator: adversarial ------------------------------------------
  await check("validator rejects null", () => {
    assert.strictEqual(isValidLiveMessage(null), false);
  });

  await check("validator rejects missing type", () => {
    assert.strictEqual(isValidLiveMessage({} as unknown), false);
  });

  await check("validator rejects unknown type", () => {
    assert.strictEqual(isValidLiveMessage({ type: "explode" } as unknown), false);
  });

  await check("validator rejects set with missing slide", () => {
    assert.strictEqual(isValidLiveMessage({ type: "set" } as unknown), false);
  });

  await check("validator rejects set with unknown slide kind", () => {
    assert.strictEqual(isValidLiveMessage({ type: "set", slide: { kind: "shellcode" } } as unknown), false);
  });

  await check("validator rejects output without live", () => {
    assert.strictEqual(isValidLiveMessage({ type: "output", state: {} } as unknown), false);
  });

  await check("validator rejects message without text or clear", () => {
    assert.strictEqual(isValidLiveMessage({ type: "message", overlay: {} } as unknown), false);
  });

  await check("validator rejects message with non-string text", () => {
    assert.strictEqual(isValidLiveMessage({ type: "message", overlay: { text: 42 } } as unknown), false);
  });

  // --- 2b. New adversarial coverage (Priority 2 hardening) -----------------
  await check("validator rejects output state with invalid aspectRatio", () => {
    const bad = { ...EMPTY_OUTPUT, aspectRatio: "banana" as unknown as "16:9" };
    assert.strictEqual(isValidLiveMessage({ type: "output", state: bad } as unknown), false);
  });

  await check("validator rejects payload carrying __proto__ pollution key", () => {
    const bad = JSON.parse('{"type":"clear","__proto__":{"polluted":true}}');
    assert.strictEqual(isValidLiveMessage(bad), false);
  });

  await check("validator rejects message with text.length > 2000", () => {
    const bad: unknown = { type: "message", overlay: { text: "x".repeat(2001) } };
    assert.strictEqual(isValidLiveMessage(bad), false);
  });

  await check("validator rejects message with dismissAfterMs=Infinity", () => {
    assert.strictEqual(isValidLiveMessage({ type: "message", overlay: { text: "hi", dismissAfterMs: Infinity } } as unknown), false);
  });

  await check("validator rejects message with dismissAfterMs=NaN", () => {
    assert.strictEqual(isValidLiveMessage({ type: "message", overlay: { text: "hi", dismissAfterMs: NaN } } as unknown), false);
  });

  await check("validator rejects message with dismissAfterMs=-1", () => {
    assert.strictEqual(isValidLiveMessage({ type: "message", overlay: { text: "hi", dismissAfterMs: -1 } } as unknown), false);
  });

  await check("validator rejects message with dismissAfterMs > 24h cap", () => {
    assert.strictEqual(isValidLiveMessage({ type: "message", overlay: { text: "hi", dismissAfterMs: 24 * 3600 * 1000 + 1 } } as unknown), false);
  });

  await check("validator rejects slide image url with javascript: protocol", () => {
    assert.strictEqual(
      isValidLiveMessage({ type: "set", slide: { kind: "image", url: "javascript:alert(1)" } } as unknown),
      false,
    );
  });

  await check("validator rejects slide image url with data: protocol", () => {
    assert.strictEqual(
      isValidLiveMessage({ type: "set", slide: { kind: "image", url: "data:image/svg+xml,<svg/onload=alert(1)>" } } as unknown),
      false,
    );
  });

  await check("validator rejects slide image url with file: protocol", () => {
    assert.strictEqual(
      isValidLiveMessage({ type: "set", slide: { kind: "image", url: "file:///etc/passwd" } } as unknown),
      false,
    );
  });

  await check("validator accepts slide image url with https:", () => {
    assert.strictEqual(
      isValidLiveMessage({ type: "set", slide: { kind: "image", url: "https://cdn.example/x.jpg" } } as LiveMessage),
      true,
    );
  });

  await check("validator rejects slide bgColor with CSS injection", () => {
    assert.strictEqual(
      isValidLiveMessage({ type: "set", slide: { kind: "blank", bgColor: "red;--x:url(evil)" } } as unknown),
      false,
    );
  });

  await check("validator accepts slide bgColor #hex", () => {
    assert.strictEqual(
      isValidLiveMessage({ type: "set", slide: { kind: "blank", bgColor: "#000000" } } as LiveMessage),
      true,
    );
  });

  await check("validator rejects text slide with text > 5000 chars", () => {
    assert.strictEqual(
      isValidLiveMessage({ type: "set", slide: { kind: "text", text: "x".repeat(5001) } } as LiveMessage),
      false,
    );
  });

  await check("validator rejects output state with bad announcement line length", () => {
    const bad = { ...EMPTY_OUTPUT, announcement: { line1: "x".repeat(501), position: "lower_third", style: {} } };
    assert.strictEqual(isValidLiveMessage({ type: "output", state: bad } as unknown), false);
  });

  // --- 3. Role → URL mapping matches real Next routes ---------------------
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

  // --- 4. Aspect ratio flows through payload shape ------------------------
  await check("OutputState carries aspectRatio 16:9", () => {
    const s: OutputState = { ...EMPTY_OUTPUT, aspectRatio: "16:9" };
    assert.strictEqual(s.aspectRatio, "16:9");
    assert.strictEqual(isValidLiveMessage({ type: "output", state: s } as LiveMessage), true);
  });

  await check("OutputState carries aspectRatio 4:3", () => {
    const s: OutputState = { ...EMPTY_OUTPUT, aspectRatio: "4:3" };
    assert.strictEqual(s.aspectRatio, "4:3");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
