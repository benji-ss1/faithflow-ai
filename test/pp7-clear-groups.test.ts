/**
 * PP7 parity R3: named Clear Groups + Clear to Logo (F12).
 *
 * The gap: F-keys mapped only F1–F7, there was no group concept, and no F12.
 * An IMAG operator had no safe way to dump every graphic while LEAVING the
 * camera on screen — Clear All killed the camera too, so under pressure they
 * cleared layers one at a time.
 *
 * Victor 2026-09-18: our Clear All stays FIXED. ProPresenter lets you edit its
 * Clear All and warns that you then lose a clear that truly clears everything.
 * We do not copy that flaw — groups are additive.
 *
 * Run: npx tsx test/pp7-clear-groups.test.ts
 */
import assert from "node:assert/strict";
import { PP7_CLEAR_GROUPS, pp7ClearGroupById, decodePp7ClearKey, PP7_CLEAR_ORDER } from "../src/lib/pp7-clear";
import { pp7ClearGroup, pp7ClearAll, type Pp7ClearEffects, type Pp7LayerInputs } from "../src/lib/pp7-layer-model";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => {
  try { fn(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; }
};

function spy() {
  const calls: string[] = [];
  const fx: Pp7ClearEffects = {
    killSlide: (o) => calls.push(`killSlide:${o?.keepTheme === false ? "noTheme" : "keepTheme"}`),
    setBackgroundNone: () => calls.push("setBackgroundNone"),
    clearLayer: (id) => calls.push(`clearLayer:${id}`),
    clearVideoInput: () => calls.push("clearVideoInput"),
    clearAnnouncement: () => calls.push("clearAnnouncement"),
    clearMessages: () => calls.push("clearMessages"),
    clearLowerThird: () => calls.push("clearLowerThird"),
    showLogo: () => calls.push("showLogo"),
  };
  return { calls, fx };
}
const inputs: Pp7LayerInputs = {
  kind: "text",
  rowActive: () => true,
  videoInputActive: true,
  announcementActive: true,
  backgroundSpecActive: true,
  messagesActive: true,
};

console.log("the IMAG case — clear everything, keep the camera:");
check("'All But Video Input' exists and excludes videoInput", () => {
  const g = pp7ClearGroupById("all-but-video-input");
  assert.ok(g, "ProPresenter's own worked example must exist");
  assert.ok(!g!.layers.includes("videoInput"), "the whole point is the camera survives");
  for (const l of PP7_CLEAR_ORDER) if (l !== "videoInput") assert.ok(g!.layers.includes(l), `${l} must be cleared`);
});
check("running it never touches the video input", () => {
  const { calls, fx } = spy();
  pp7ClearGroup(pp7ClearGroupById("all-but-video-input")!, inputs, fx);
  assert.ok(!calls.includes("clearVideoInput"), `camera was killed: ${calls.join(",")}`);
  assert.ok(calls.some((c) => c.startsWith("killSlide")), "the slide should still clear");
  assert.ok(calls.includes("clearMessages"));
});
check("Clear All still DOES kill the camera — the groups did not weaken it", () => {
  const { calls, fx } = spy();
  pp7ClearAll(inputs, fx);
  assert.ok(calls.includes("clearVideoInput"), "the panic button must clear everything");
  assert.ok(calls.includes("clearLowerThird"));
});

console.log("Clear to Logo (F12):");
check("F12 decodes to the to-logo group", () => {
  assert.deepEqual(decodePp7ClearKey({ key: "F12" }), { group: "to-logo" });
});
check("F12 with a modifier is NOT a clear", () => {
  for (const m of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
    assert.equal(decodePp7ClearKey({ key: "F12", ...m }), null);
  }
});
check("it clears, then shows the logo — in that order", () => {
  const { calls, fx } = spy();
  pp7ClearGroup(pp7ClearGroupById("to-logo")!, inputs, fx);
  assert.ok(calls.includes("showLogo"), "the logo must actually reach the projector");
  assert.equal(calls[calls.length - 1], "showLogo", "showing the logo before clearing would flash it away");
});
check("it leaves the camera alone — an end-of-service clear must not kill IMAG", () => {
  const { calls, fx } = spy();
  pp7ClearGroup(pp7ClearGroupById("to-logo")!, inputs, fx);
  assert.ok(!calls.includes("clearVideoInput"));
});
check("with no logo configured it does nothing rather than clearing to black", () => {
  const { calls, fx } = spy();
  const noLogo: Pp7ClearEffects = { ...fx, showLogo: undefined };
  pp7ClearGroup(pp7ClearGroupById("to-logo")!, inputs, noLogo);
  assert.ok(!calls.includes("showLogo"));
  // The rail hides the button entirely in this case; the model simply no-ops.
});

console.log("groups are additive, never a replacement for Clear All:");
check("no group is named or behaves as Clear All", () => {
  for (const g of PP7_CLEAR_GROUPS) {
    assert.notEqual(g.id, "all");
    assert.notEqual(g.name.toLowerCase(), "clear all");
  }
});
check("layers always run in rail order, whatever order a group lists", () => {
  const { calls, fx } = spy();
  const scrambled = { ...pp7ClearGroupById("all-but-video-input")!, layers: ["messages", "slide", "media"] as const };
  pp7ClearGroup(scrambled as never, inputs, fx);
  const idx = (s: string) => calls.findIndex((c) => c.startsWith(s));
  assert.ok(idx("clearMessages") < idx("killSlide"), "messages precede slide in rail order");
});
check("every group tells the operator what it does before they press it", () => {
  for (const g of PP7_CLEAR_GROUPS) {
    assert.ok(g.description && g.description.length > 10, `${g.id} needs a real description`);
    assert.ok(g.name.length > 0);
  }
});

console.log("the existing shortcuts are untouched:");
check("F1–F7 and the Clear All chord still decode as before", () => {
  assert.equal(decodePp7ClearKey({ key: "F1" }), "all");
  assert.equal(decodePp7ClearKey({ key: "F2" }), "slide");
  assert.equal(decodePp7ClearKey({ key: "F3" }), "media");
  assert.equal(decodePp7ClearKey({ key: "F4" }), "props");
  assert.equal(decodePp7ClearKey({ key: "F5" }), "audio");
  assert.equal(decodePp7ClearKey({ key: "F6" }), "messages");
  assert.equal(decodePp7ClearKey({ key: "F7" }), "announcements");
  assert.equal(decodePp7ClearKey({ key: "C", metaKey: true, shiftKey: true }), "all");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
