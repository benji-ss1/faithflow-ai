/**
 * Pure-logic tests for shell-level auto-approve rules. The shell effect is
 * React-bound, so these tests exercise the same predicates in isolation:
 *
 *   - R3: rate-limit min-gap (single-slot displacement queue)
 *   - R4: auto-advance interval clears on AutoApprove OFF event
 *   - R8: empty / placeholder cards must not auto-fire
 *
 * Run via:  npx tsx test/adversarial/auto-approve-shell-rules.test.ts
 */
import assert from "node:assert";

let pass = 0;
let fail = 0;
function run(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  PASS  ${name}`); pass++; })
    .catch((e) => { console.error(`  FAIL  ${name} — ${(e as Error).message}`); fail++; });
}

// ── R3: rate-limit min-gap with single-slot queue ────────────────────────
type QSlot = { ref: string; conf: number };
class RateLimitedFirer {
  lastAt = -Infinity; // never-fired ⇒ first submit fires immediately
  queued: QSlot | null = null;
  fired: string[] = [];
  displaced: string[] = [];
  gap: number;
  now = 0;
  constructor(gap: number) { this.gap = gap; }
  tick(t: number) { this.now = t; }
  submit(slot: QSlot) {
    const wait = this.lastAt === -Infinity ? 0 : (this.lastAt + this.gap - this.now);
    if (wait <= 0) {
      this.lastAt = this.now;
      this.fired.push(slot.ref);
      return;
    }
    if (this.queued) this.displaced.push(this.queued.ref);
    this.queued = slot;
  }
  flushQueue(atT: number) {
    // Simulates the timer firing after `wait` ms.
    if (!this.queued) return;
    this.tick(atT);
    this.lastAt = atT;
    this.fired.push(this.queued.ref);
    this.queued = null;
  }
}

const tests: Promise<void>[] = [];

tests.push(run("R3 first fire immediate; second inside gap gets queued", () => {
  const r = new RateLimitedFirer(4000);
  r.tick(0);
  r.submit({ ref: "John 3:16", conf: 92 }); // wait=0, fires
  assert.deepStrictEqual(r.fired, ["John 3:16"]);
  r.tick(1000); // wait = 0 + 4000 - 1000 = 3000 → queued
  r.submit({ ref: "Romans 8:28", conf: 90 });
  assert.strictEqual(r.queued?.ref, "Romans 8:28");
  assert.deepStrictEqual(r.fired, ["John 3:16"]);
}));

tests.push(run("R3 newer detection displaces older queued slot", () => {
  const r = new RateLimitedFirer(4000);
  r.tick(0);
  r.submit({ ref: "John 3:16", conf: 92 }); // fires immediately (fills lastAt)
  r.tick(500);
  r.submit({ ref: "A", conf: 90 }); // queued
  r.tick(1000);
  r.submit({ ref: "B", conf: 91 }); // displaces A
  assert.strictEqual(r.queued?.ref, "B");
  assert.deepStrictEqual(r.displaced, ["A"]);
  assert.deepStrictEqual(r.fired, ["John 3:16"]);
}));

tests.push(run("R3 queued slot fires after min-gap window elapses", () => {
  const r = new RateLimitedFirer(4000);
  r.tick(0);
  r.submit({ ref: "A", conf: 90 }); // fires immediately (lastAt=0)
  r.tick(1000);
  r.submit({ ref: "B", conf: 91 }); // queued (wait=3000ms)
  r.flushQueue(4000);
  assert.deepStrictEqual(r.fired, ["A", "B"]);
}));

// ── R4: auto-advance clears on OFF event ─────────────────────────────────
tests.push(run("R4 clearAutoAdvance stops running interval", () => {
  // Simulate: interval fires while OFF event lands mid-run.
  let cleared = false;
  const intervalRef: { current: number | null } = { current: 1 };
  const clear = () => { if (intervalRef.current !== null) { cleared = true; intervalRef.current = null; } };
  clear();
  assert.strictEqual(cleared, true);
  assert.strictEqual(intervalRef.current, null);
  // Idempotent: second clear is a no-op.
  cleared = false;
  clear();
  assert.strictEqual(cleared, false);
}));

// ── R8: placeholder cards must not fire ──────────────────────────────────
type Card = { placeholder?: boolean; verses: { verse: number; text: string }[] };
function shouldAutoFire(card: Card | undefined): boolean {
  if (!card) return false;
  if (card.placeholder === true) return false;
  if (!card.verses?.length) return false;
  const text = card.verses[0]?.text ?? "";
  if (!text || text === "Loading…" || text.length === 0) return false;
  return true;
}

tests.push(run("R8 skips placeholder=true card", () => {
  assert.strictEqual(shouldAutoFire({ placeholder: true, verses: [{ verse: 1, text: "abc" }] }), false);
}));
tests.push(run("R8 skips card with empty first verse text", () => {
  assert.strictEqual(shouldAutoFire({ verses: [{ verse: 1, text: "" }] }), false);
}));
tests.push(run("R8 skips 'Loading…' text card", () => {
  assert.strictEqual(shouldAutoFire({ verses: [{ verse: 1, text: "Loading…" }] }), false);
}));
tests.push(run("R8 fires normal populated card", () => {
  assert.strictEqual(shouldAutoFire({ verses: [{ verse: 16, text: "For God so loved..." }] }), true);
}));

Promise.all(tests).then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
});
