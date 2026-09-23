/**
 * The wire contract must not drift from the editor model (2026-09-22 audit).
 *
 * Two type pairs are maintained BY HAND, and a mismatch has a nasty failure
 * mode: `isValidOutputStateExternal` / `isValidSlideObject` reject the whole
 * OutputState, so THE PROJECTOR SIMPLY STOPS UPDATING MID-SERVICE rather than
 * showing anything wrong.
 *
 *   1. `SlideObject` (slide-objects.ts, what the editor writes) vs
 *      `SlideObjectWire` (broadcast.ts, what the projector accepts)
 *   2. `ThemeAppearance` (theme-appearance.ts) vs its validator
 *
 * There is no codegen and no pixel-level harness, so this is the guard: any new
 * field added to one side without the other fails here with a NAMED field.
 *
 * Run: npx tsx test/wire-contract-drift.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isValidSlideObject, isValidThemeAppearance, MAX_SLIDE_OBJECTS, SLIDE_CANVAS_W, SLIDE_CANVAS_H } from "../src/lib/broadcast";
import { themeConfigToAppearance } from "../src/lib/theme-appearance";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const wireSrc = read("../src/lib/broadcast.ts");
const modelSrc = read("../src/lib/slide-objects.ts");

console.log("SlideObject <-> SlideObjectWire (runtime round-trip, not regex):");
check("a FULLY-populated editor text object is accepted by the wire validator", () => {
  // Every optional field the editor can write. If someone adds a field to
  // SlideObject and forgets the validator, this fails — which is exactly the
  // drift that FREEZES the projector (the whole OutputState is rejected).
  const full = {
    kind: "text", x: 480.5, y: 270.25, w: 960, h: 300,
    anim: "fade", animDelayMs: 250, rotation: 15, flipH: true, flipV: true,
    locked: false, hidden: false, opacity: 0.8,
    text: "Amazing grace", fontFamily: "Inter", fontSize: 96, fontWeight: 700,
    color: "#ffffff", align: "center", italic: true, underline: true,
    lineHeight: 1.2, letterSpacing: 2, uppercase: true,
    shadow: true, stroke: "#000000", strokeWidth: 3,
    textScale: "down",
    runs: [{ start: 0, end: 7, bold: true, italic: true, underline: true, color: "#ff0000" }],
    role: "main",
  };
  assert.equal(isValidSlideObject(full as never), true,
    "a field the editor writes is rejected by the wire validator — the projector would stop updating");
});
check("a fully-populated shape / image / video object is accepted", () => {
  assert.equal(isValidSlideObject({ kind: "shape", x: 0, y: 0, w: 10, h: 10, shape: "ellipse",
    fill: "#112233", fill2: "#445566", fillAngle: 90, stroke: "#000", strokeWidth: 2, radius: 8,
    opacity: 0.5, rotation: 30, anim: "zoom", animDelayMs: 100, locked: true, hidden: false } as never), true, "shape");
  assert.equal(isValidSlideObject({ kind: "image", x: 0, y: 0, w: 10, h: 10, url: "https://example.com/a.png",
    fit: "cover", posX: 50, posY: 50, zoom: 2, opacity: 1, blurFill: true, blur: false } as never), true, "image");
  assert.equal(isValidSlideObject({ kind: "video", x: 0, y: 0, w: 10, h: 10, url: "https://example.com/a.mp4",
    fit: "contain", loop: true, muted: true, opacity: 1,
    inSec: 1, outSec: 9, endAction: "freeze", rate: 1.5, volume: 0.4 } as never), true, "video");
});
check("the four object kinds match on both sides", () => {
  for (const k of ["text", "shape", "image", "video"]) {
    assert.ok(wireSrc.includes(`kind: "${k}"`), `wire lost kind ${k}`);
    assert.ok(modelSrc.includes(`kind: "${k}"`), `model lost kind ${k}`);
  }
});
check("geometry is REQUIRED (not optional) on the editor model", () => {
  // Declared together on one line: `x: number; y: number; w: number; h: number;`
  // A `?` on any of them would let undefined geometry reach a renderer.
  for (const f of ["x", "y", "w", "h"]) {
    assert.match(modelSrc, new RegExp(`\\b${f}: number;`), `SlideObject.${f} is no longer a required number`);
    assert.ok(!new RegExp(`\\b${f}\\?: number;`).test(modelSrc), `SlideObject.${f} became OPTIONAL — undefined geometry can now reach a renderer`);
  }
});

console.log("\nthe validator actually enforces the canvas contract:");
check("finite, in-range geometry is accepted", () => {
  assert.equal(isValidSlideObject({ kind: "text", x: 0, y: 0, w: 100, h: 50, text: "hi" }), true);
  assert.equal(isValidSlideObject({ kind: "text", x: 480.5, y: 270.25, w: 960, h: 300, text: "hi" }), true);
});
check("NaN / Infinity / missing geometry is REJECTED, never projected", () => {
  for (const bad of [
    { kind: "text", x: NaN, y: 0, w: 10, h: 10, text: "x" },
    { kind: "text", x: 0, y: Infinity, w: 10, h: 10, text: "x" },
    { kind: "text", x: 0, y: 0, w: undefined, h: 10, text: "x" },
    { kind: "text", x: 0, y: 0, w: null, h: 10, text: "x" },
    { kind: "text", x: "0", y: 0, w: 10, h: 10, text: "x" },
    { kind: "text", y: 0, w: 10, h: 10, text: "x" },
  ]) {
    assert.equal(isValidSlideObject(bad as never), false, `accepted ${JSON.stringify(bad)}`);
  }
});
check("negative width/height is REJECTED", () => {
  assert.equal(isValidSlideObject({ kind: "text", x: 0, y: 0, w: -1, h: 10, text: "x" } as never), false);
  assert.equal(isValidSlideObject({ kind: "text", x: 0, y: 0, w: 10, h: -1, text: "x" } as never), false);
});
check("the canvas the validator bounds against is THE canvas", () => {
  assert.equal(SLIDE_CANVAS_W, 1920);
  assert.equal(SLIDE_CANVAS_H, 1080);
  assert.equal(MAX_SLIDE_OBJECTS, 60);
});

console.log("\nThemeAppearance <-> its validator (runtime round-trip):");
check("a rich theme config maps to an appearance the validator ACCEPTS", async () => {
  // A mapper/validator mismatch rejects the whole OutputState, so the projector
  // simply stops updating mid-service rather than showing anything wrong.
  assert.ok(isValidThemeAppearance, "isValidThemeAppearance is gone — the projector-freeze guard with it");
  const appearance = themeConfigToAppearance({
    bgType: "gradient", bgColor: "#101010", bgColor2: "#202020", bgAngle: 90,
    bgAnimation: "drift", dim: 0.3,
    textColor: "#ffffff", fontFamily: "Inter", fontWeight: 700, textShadow: true, align: "center",
    logoUrl: "https://example.com/logo.png", logoPosition: "bottom-right", logoSizePx: 200, logoOpacity: 0.9,
  } as never);
  assert.equal(isValidThemeAppearance(appearance as never), true,
    "themeConfigToAppearance produced an appearance its own validator rejects");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
