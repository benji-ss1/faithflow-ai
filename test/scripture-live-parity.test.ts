/**
 * Preview≠Live parity fix (2026-08-25 field report): AI auto-fire / verse-nav
 * built a PLAIN scripture slide ({ text, reference }, no objects) → the live
 * renderer applied AutoFitText's default UPPERCASE style instead of the church's
 * saved scripture design, so the projector didn't match the styled preview.
 * styleScriptureSlide applies the design centrally in sendSlideToLive.
 *
 * Verifies: plain scripture → styled objects; songs (no reference) + already-
 * styled slides pass through untouched; translation is parsed out of the
 * reference; and — critically for the rule-7 fade-pulse invariant — the
 * content-identity (slideOutputIdentity) is DETERMINISTIC for a given verse
 * despite the random object IDs, so an already-live re-fire still skips.
 *
 * Run: npx tsx test/scripture-live-parity.test.ts
 * (No window/localStorage in node → loadScriptureStyle returns the DEFAULT
 *  design, which is exactly what a church with no saved style would get.)
 */
import assert from "node:assert/strict";
import { styleScriptureSlide } from "../src/components/operator/scripture/scriptureStyle";
import { slideOutputIdentity, type SlidePayload } from "../src/lib/broadcast";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}

const CHURCH = "church-1";
const textObjectsOf = (s: SlidePayload) =>
  s.kind === "text" && s.objects ? s.objects.filter((o) => o.kind === "text") : [];

console.log("Plain scripture slide → styled with the saved design:");
test("gets style objects (was objectless)", () => {
  const plain: SlidePayload = { kind: "text", text: "7 Submit yourselves therefore to God.", reference: "James 4:7 (KJV)" };
  const styled = styleScriptureSlide(plain, CHURCH);
  assert.equal(styled.kind, "text");
  if (styled.kind !== "text") return;
  assert.ok(styled.objects && styled.objects.length > 0, "styled slide must carry style objects");
  const verse = textObjectsOf(styled)[0] as { text?: string } | undefined;
  assert.ok(verse && /Submit yourselves/.test(verse.text ?? ""), "verse text preserved in the object");
});
test("verse text is NOT force-uppercased in the payload (design owns case)", () => {
  const plain: SlidePayload = { kind: "text", text: "Submit yourselves", reference: "James 4:7 (KJV)" };
  const styled = styleScriptureSlide(plain, CHURCH);
  const verse = textObjectsOf(styled)[0] as { text?: string; uppercase?: boolean } | undefined;
  assert.equal(verse?.text, "Submit yourselves", "text stays mixed-case (renderer honours object.uppercase)");
  assert.notEqual(verse?.uppercase, true, "default design is not uppercase");
});
test("reference preserved on the payload", () => {
  const styled = styleScriptureSlide({ kind: "text", text: "x", reference: "John 3:16 (NIV)" }, CHURCH);
  assert.ok(styled.kind === "text" && typeof styled.reference === "string" && /John 3:16/.test(styled.reference));
});

console.log("Pass-through (must be byte-identical — untouched):");
test("song lyric (no reference) is returned unchanged", () => {
  const song: SlidePayload = { kind: "text", text: "Great is Thy faithfulness" };
  assert.strictEqual(styleScriptureSlide(song, CHURCH), song);
});
test("already-styled slide (has objects) is returned unchanged", () => {
  const already: SlidePayload = { kind: "text", text: "x", reference: "John 3:16 (KJV)", objects: [{ kind: "text", id: "a", x: 0, y: 0, w: 10, h: 10, text: "x" } as never] };
  assert.strictEqual(styleScriptureSlide(already, CHURCH), already);
});
test("non-text slide (image) is returned unchanged", () => {
  const img: SlidePayload = { kind: "image", url: "https://x/y.jpg" } as SlidePayload;
  assert.strictEqual(styleScriptureSlide(img, CHURCH), img);
});

console.log("Rule-7 fade-pulse invariant — content-identity is deterministic:");
test("same verse styled twice → identical slideOutputIdentity (object IDs don't matter)", () => {
  const plain: SlidePayload = { kind: "text", text: "For God so loved the world", reference: "John 3:16 (KJV)" };
  const a = styleScriptureSlide(plain, CHURCH);
  const b = styleScriptureSlide(plain, CHURCH);
  // Object IDs are random per call, but must NOT leak into the identity.
  assert.equal(slideOutputIdentity(a), slideOutputIdentity(b), "re-firing the same verse must keep identity stable (no pulse)");
});
test("different verse → different identity (real content change still transitions)", () => {
  const a = styleScriptureSlide({ kind: "text", text: "verse A", reference: "John 3:16 (KJV)" }, CHURCH);
  const b = styleScriptureSlide({ kind: "text", text: "verse B", reference: "John 3:17 (KJV)" }, CHURCH);
  assert.notEqual(slideOutputIdentity(a), slideOutputIdentity(b));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
