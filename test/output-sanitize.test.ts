/**
 * FAIL-OPEN projector sanitizer tests (2026-09-06 field incident, RCCG-JPD).
 *
 * Root cause reproduced here: a single malformed AUXILIARY field on the
 * OutputState (most often the RAW `next` plan slide — a media object still on a
 * blob:/http: URL, a named colour, an off-canvas coord) made isValidOutputState
 * reject the ENTIRE snapshot. A freshly-joined/reconnected projector gets its
 * current slide ONLY from the "output" join-snapshot replay, so that rejection
 * left the projector fully BLACK while the operator preview looked perfect.
 *
 * These tests lock in the guarantee: sanitizeOutputState / sanitizeSlide DROP the
 * bad subfield and keep projecting — and the result ALWAYS passes the strict
 * validator, so nothing downstream can reject it.
 *
 * Run: npx tsx test/output-sanitize.test.ts
 */
import assert from "node:assert/strict";
import {
  sanitizeSlide,
  sanitizeOutputState,
  coerceLiveMessage,
  isValidOutputStateExternal,
  slideOutputIdentity,
  EMPTY_OUTPUT,
  type OutputState,
  type SlidePayload,
} from "../src/lib/broadcast";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const okVerse: SlidePayload = { kind: "text", text: "For God so loved the world", reference: "John 3:16 (NKJV)" };

console.log("Projector fail-open sanitizers");

// --- sanitizeSlide ----------------------------------------------------------
check("valid text slide passes through with reference intact", () => {
  const s = sanitizeSlide(okVerse) as Extract<SlidePayload, { kind: "text" }>;
  assert.equal(s.kind, "text");
  assert.equal(s.text, okVerse.text);
  assert.equal(s.reference, "John 3:16 (NKJV)");
});

check("bad bgColor is DROPPED, text survives", () => {
  const s = sanitizeSlide({ kind: "text", text: "hi", bgColor: "red; --x:url(x)" }) as Extract<SlidePayload, { kind: "text" }>;
  assert.equal(s.text, "hi");
  assert.equal(s.bgColor, undefined);
});

check("invalid objects are dropped individually, valid ones kept", () => {
  const s = sanitizeSlide({
    kind: "text", text: "verse",
    objects: [
      { kind: "text", x: 10, y: 10, w: 100, h: 40, text: "good" },
      { kind: "text", x: 10, y: 10, w: 100, h: 40, text: "bad", color: "notacolor" }, // dropped
    ],
  }) as Extract<SlidePayload, { kind: "text" }>;
  assert.equal(s.objects?.length, 1);
  assert.equal(s.objects?.[0] && (s.objects[0] as { text: string }).text, "good");
});

check("lower-third layout kept, malformed band dropped", () => {
  const s = sanitizeSlide({
    kind: "text", text: "verse", scriptureLayout: "lowerThird",
    scriptureBand: { heightPct: 999, color: "red" }, // out of range → dropped
  }) as Extract<SlidePayload, { kind: "text" }>;
  assert.equal(s.scriptureLayout, "lowerThird");
  assert.equal(s.scriptureBand, undefined);
});

check("valid lower-third band is preserved", () => {
  const band = { topPct: 68, heightPct: 30, fontScale: 1, color: "#000000", opacity: 0.5 };
  const s = sanitizeSlide({ kind: "text", text: "v", scriptureLayout: "lowerThird", scriptureBand: band }) as Extract<SlidePayload, { kind: "text" }>;
  assert.deepEqual(s.scriptureBand, band);
});

check("media slide with no usable URL → null (keep prior)", () => {
  assert.equal(sanitizeSlide({ kind: "image", url: "javascript:alert(1)" }), null);
  assert.equal(sanitizeSlide({ kind: "video", url: "" }), null);
});

check("media slide with a valid URL passes", () => {
  const s = sanitizeSlide({ kind: "image", url: "https://cdn.example.com/x.jpg" });
  assert.equal(s?.kind, "image");
});

check("prototype-pollution slide rejected", () => {
  assert.equal(sanitizeSlide({ kind: "text", text: "x", ["__proto__"]: {} }), null);
});

check("unknown kind → null", () => {
  assert.equal(sanitizeSlide({ kind: "wat" }), null);
});

// --- sanitizeOutputState — the field incident -------------------------------
const base: OutputState = { ...EMPTY_OUTPUT, live: okVerse };

check("THE INCIDENT: a bad `next` slide no longer nukes the snapshot", () => {
  // next carries a media object still on a blob: URL (fresh upload) → old code
  // rejected the WHOLE OutputState → projector went black on reconnect.
  const poisoned = {
    ...base,
    next: { kind: "text", text: "next verse", objects: [{ kind: "image", x: 0, y: 0, w: 100, h: 100, url: "blob:abc-123" }] },
  } as unknown as OutputState;
  assert.equal(isValidOutputStateExternal(poisoned), false, "precondition: strict validator rejects poisoned state");
  const clean = sanitizeOutputState(poisoned);
  assert.ok(clean, "sanitized state is produced");
  assert.equal(isValidOutputStateExternal(clean), true, "sanitized state now PASSES strict validation");
  assert.equal((clean!.live as Extract<SlidePayload, { kind: "text" }>).text, okVerse.text, "live verse preserved");
  // next's bad object was dropped → next is a valid text slide (or null), never poison.
  assert.notEqual(clean!.next, undefined);
});

check("bad appearance is dropped, live + background still flow", () => {
  const s = sanitizeOutputState({ ...base, appearance: { bgColor: "chartreuse" }, background: null } as unknown as OutputState);
  assert.ok(s);
  assert.equal(s!.appearance, null);
  assert.equal(isValidOutputStateExternal(s), true);
});

check("bad nextItem (empty title) dropped, not fatal", () => {
  const s = sanitizeOutputState({ ...base, nextItem: { title: "", type: "song" } } as unknown as OutputState);
  assert.ok(s);
  assert.equal(s!.nextItem, null);
  assert.equal(isValidOutputStateExternal(s), true);
});

check("out-of-range fontScale clamped to 1", () => {
  const s = sanitizeOutputState({ ...base, fontScale: 999 } as OutputState);
  assert.equal(s!.fontScale, 1);
  assert.equal(isValidOutputStateExternal(s), true);
});

check("bad aspectRatio coerced to 16:9", () => {
  const s = sanitizeOutputState({ ...base, aspectRatio: "banana" } as unknown as OutputState);
  assert.equal(s!.aspectRatio, "16:9");
});

check("passthrough fields (itemTitle/slideNumber/fitMode/safeArea) preserved", () => {
  const s = sanitizeOutputState({ ...base, itemTitle: "Hymn 4", slideNumber: "2 / 5", fitMode: "cover", safeArea: true } as unknown as OutputState) as OutputState & Record<string, unknown>;
  assert.equal(s.itemTitle, "Hymn 4");
  assert.equal(s.slideNumber, "2 / 5");
  assert.equal(s.fitMode, "cover");
  assert.equal(s.safeArea, true);
});

check("a fully-valid state is returned unchanged in meaning (idempotent)", () => {
  const s = sanitizeOutputState(base);
  assert.equal(isValidOutputStateExternal(s), true);
  const s2 = sanitizeOutputState(s);
  assert.deepEqual(s2, s);
});

check("unsalvageable live slide → null (caller keeps prior)", () => {
  assert.equal(sanitizeOutputState({ ...base, live: { kind: "image", url: "" } } as unknown as OutputState), null);
});

check("prototype-pollution top-level rejected", () => {
  assert.equal(sanitizeOutputState({ ...base, ["__proto__"]: {} } as unknown as OutputState), null);
});

// --- INVARIANT: sanitize must not change a VALID slide's output identity ------
// (CLAUDE.md rule 7 fade-pulse: slideOutputIdentity must stay deterministic, or
// the already-live skip breaks and verses re-pulse on the projector.)
check("designed song slide round-trips with IDENTICAL slideOutputIdentity", () => {
  const song: SlidePayload = {
    kind: "text", text: "Amazing grace, how sweet the sound",
    objects: [
      { kind: "text", x: 100, y: 200, w: 800, h: 300, text: "Amazing grace", color: "#ffffff", fontFamily: "Georgia", fontSize: 72, align: "center" },
      { kind: "image", x: 0, y: 0, w: 1920, h: 1080, url: "https://cdn.example.com/bg.jpg", fit: "cover", posX: 50, posY: 50, zoom: 1 },
    ],
  };
  const s = sanitizeSlide(song)!;
  assert.equal(slideOutputIdentity(s), slideOutputIdentity(song));
});

check("scripture slide round-trips with IDENTICAL slideOutputIdentity", () => {
  const s = sanitizeSlide(okVerse)!;
  assert.equal(slideOutputIdentity(s), slideOutputIdentity(okVerse));
});

// --- coerceLiveMessage (the shared receiver gate for /live, /stage, /livestream)
check("coerceLiveMessage passes a valid message through unchanged", () => {
  const m = { type: "set", slide: okVerse };
  assert.equal(coerceLiveMessage(m), m); // same reference (fast path)
});

check("coerceLiveMessage salvages an output message with a poisoned next", () => {
  const poisoned = { type: "output", state: { ...base, next: { kind: "text", text: "n", objects: [{ kind: "image", x: 0, y: 0, w: 10, h: 10, url: "blob:x" }] } } };
  const m = coerceLiveMessage(poisoned) as { type: string; state: OutputState };
  assert.ok(m);
  assert.equal(m.type, "output");
  assert.equal(isValidOutputStateExternal(m.state), true);
});

check("coerceLiveMessage salvages a set message, dropping unvalidated transition", () => {
  const m = coerceLiveMessage({ type: "set", slide: okVerse, transition: { bogus: true } }) as { type: string; slide: SlidePayload; transition?: unknown };
  assert.ok(m);
  assert.equal(m.type, "set");
  assert.equal(m.transition, undefined); // dropped on salvage → safe hard cut
});

check("coerceLiveMessage returns null for a malformed non-critical kind", () => {
  assert.equal(coerceLiveMessage({ type: "banana" }), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
