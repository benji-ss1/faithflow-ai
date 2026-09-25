/**
 * EVERY presentflow:* event must have BOTH a dispatcher and a listener.
 * Run: npx tsx --test test/event-bus-connected.test.ts
 *
 * WHY THIS EXISTS. On 2026-09-25 the stage-layout feature was found to be
 * completely dead: the operator dispatched, the console listened, and the two
 * passed different shapes. The test that "covered" it asserted that the string
 * "presentflow:stage-layout" appeared in both files. It did — on both sides of
 * a connection that was never made.
 *
 * Sweeping for the class then found three more, all live in production:
 *   - presentflow:hotkey-next / -prev  — dispatched, NO listener. A custom
 *     voice command mapped to "Next verse" fired into the void and the handler
 *     then showed a success toast.
 *   - presentflow:draft-announcement   — the AI "Fill announce tab" button
 *     dispatched, nothing listened, and it flashed a confirmation.
 *   - presentflow:open-zone-editor     — a listener with no dispatcher; the
 *     Projection Zone editor was unreachable from the UI.
 *
 * This is the event-bus analogue of no-dead-capability.test.ts. It is
 * MECHANICAL on purpose: names are collected from source, constants resolved,
 * and each name must appear on both sides or be explicitly excused below with
 * a reason. An excuse is a decision someone wrote down; silence is a bug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    try { return statSync(p).isDirectory() ? walk(p) : [p]; } catch { return []; }
  });
}

const files = [...walk("src"), ...walk("electron")].filter((f) => /\.tsx?$/.test(f));
const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

/** `export const FOO_EVENT = "presentflow:foo"` → FOO_EVENT resolves to that. */
const constToName = new Map<string, string>();
for (const src of sources.values()) {
  for (const m of src.matchAll(/(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)[^=]*=\s*\n?\s*["'](presentflow:[^"']+)["']/g)) {
    constToName.set(m[1], m[2]);
  }
}

const dispatched = new Map<string, string[]>();
const listened = new Map<string, string[]>();
const add = (m: Map<string, string[]>, name: string, file: string) => {
  const cur = m.get(name) ?? [];
  if (!cur.includes(file)) cur.push(file);
  m.set(name, cur);
};

for (const [file, src] of sources) {
  // dispatchInternal("x") | new CustomEvent("x") | new Event("x")
  // `new CustomEvent<SomeType>(NAME)` — the generic parameter must be allowed
  // for, or four correctly-wired events look orphaned. My first version missed
  // it and reported false positives, which is how a guard loses its authority.
  for (const m of src.matchAll(/(?:dispatchInternal[<(][^"'`]*|new\s+(?:Custom)?Event\s*(?:<[^>]*>)?\s*\(\s*)["'](presentflow:[^"']+)["']/g)) {
    add(dispatched, m[1], file);
  }
  // dispatchInternal(CONST) | new CustomEvent(CONST)
  for (const m of src.matchAll(/(?:dispatchInternal[<(]\s*|new\s+(?:Custom)?Event\s*(?:<[^>]*>)?\s*\(\s*)([A-Z][A-Z0-9_]*)\b/g)) {
    const n = constToName.get(m[1]);
    if (n) add(dispatched, n, file);
  }
  for (const m of src.matchAll(/(?:add|remove)EventListener\s*\(\s*["'](presentflow:[^"']+)["']/g)) {
    add(listened, m[1], file);
  }
  for (const m of src.matchAll(/(?:add|remove)EventListener\s*\(\s*([A-Z][A-Z0-9_]*)\b/g)) {
    const n = constToName.get(m[1]);
    if (n) add(listened, n, file);
  }
}

/**
 * Deliberate one-enders. Each needs a REASON — this list is where someone
 * records a decision, not where inconvenient findings go to be silenced.
 */
const DISPATCH_ONLY_OK: Record<string, string> = {
  // ── PRE-EXISTING, FOUND BY THIS GUARD ON ITS FIRST RUN, NOT YET FIXED ──
  // Listed so the guard is green on the CURRENT state and can therefore catch
  // the NEXT one. Each is a real defect in someone else's area and needs a
  // decision, not a silent deletion by me. Remove the entry when it is fixed.
  "presentflow:draft-announcement": "PRE-EXISTING DEFECT: AIHelpersPanel's 'Fill announce tab' dispatches this and flashes a success confirmation; nothing listens, so the drafted lines never arrive. Needs wiring to the announcement tab.",
  "presentflow:raw-capture-changed": "PRE-EXISTING: rawCapture announces a change and nothing listens. Either a consumer was removed or one was never written.",
  "presentflow:theme-recents-changed": "fire-and-forget; the same value is also written to storage and read there",
  "presentflow:audio-quality-low": "informational; the same value goes into useAudioStream state, which IS consumed",
  "presentflow:audio-quality-ok": "informational; as above",
  "presentflow:music-suspected": "informational; as above",
  "presentflow:music-suspected-cleared": "informational; as above",
};
const LISTEN_ONLY_OK: Record<string, string> = {
  // ── PRE-EXISTING, as above ──
  "presentflow:open-zone-editor": "PRE-EXISTING DEFECT: OperatorConsole opens the Projection Zone editor on this event and NOTHING dispatches it, so the editor is unreachable from the UI. Its own comment says an entry point would be added later; it never was.",
  "presentflow:blank-slides-updated": "PRE-EXISTING: useCustomThemes refreshes on this and nothing fires it, so blank-slide changes may not refresh until a reload.",
  "presentflow:custom-themes-updated": "PRE-EXISTING: as above, for custom themes.",
  "presentflow:apply-theme-to-song": "deliberately retired 2026-09; theme-apply-client bakes the theme in and no longer fires it",
};

test("the event-bus scan actually found events", () => {
  // If the regexes break, every assertion below would pass vacuously.
  assert.ok(dispatched.size >= 8, `only found ${dispatched.size} dispatched events — the scan has broken`);
  assert.ok(listened.size >= 8, `only found ${listened.size} listened events — the scan has broken`);
});

test("every dispatched event has a listener", () => {
  const orphans = [...dispatched.keys()]
    .filter((n) => !listened.has(n) && !(n in DISPATCH_ONLY_OK))
    .map((n) => `${n}  (dispatched from ${dispatched.get(n)!.join(", ")})`);
  assert.deepEqual(orphans, [],
    "these events are dispatched into the void — whatever fires them is a control that lies:\n  " + orphans.join("\n  "));
});

test("every listened event has a dispatcher", () => {
  const orphans = [...listened.keys()]
    .filter((n) => !dispatched.has(n) && !(n in LISTEN_ONLY_OK))
    .map((n) => `${n}  (listened in ${listened.get(n)!.join(", ")})`);
  assert.deepEqual(orphans, [],
    "these listeners can never fire — the feature behind them is unreachable:\n  " + orphans.join("\n  "));
});

test("an excused event is excused for a stated reason", () => {
  for (const [name, why] of [...Object.entries(DISPATCH_ONLY_OK), ...Object.entries(LISTEN_ONLY_OK)]) {
    assert.ok(why.length > 20, `${name} needs a real reason, not "${why}"`);
  }
});
