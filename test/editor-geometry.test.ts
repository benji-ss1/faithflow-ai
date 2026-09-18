// Theme/slide editor parity — PR 1 (status bar, zoom, size lock, flip).
// Pure-helper unit tests + the no-regression parity proof that the projector
// renders EXISTING content byte-identically.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boundingRect, formatRectStatus, clampZoom, stepZoom, zoomLabel, ZOOM_MIN, ZOOM_MAX,
  constrainAspect, lockedSizePatch, flipTransform, keepOnCanvas, MIN_OBJECT_SIZE,
} from "../src/lib/editor-geometry";
import { slideDesignSig, slideOutputIdentity, isValidSlideObject, type SlideObjectWire } from "../src/lib/broadcast";
import { normalizeEditableSlide, slidePayloadFromEditable, extractLyricsFromEditable, emptyTextObject } from "../src/lib/slide-objects";

// ---------- status bar ------------------------------------------------------

test("formatRectStatus rounds to whole canvas units", () => {
  const f = formatRectStatus({ x: 100.4, y: 200.6, w: 399.5, h: 50.2 });
  assert.deepEqual(f, { x: "100", y: "201", w: "400", h: "50" });
});

test("formatRectStatus shows dashes with nothing selected", () => {
  assert.deepEqual(formatRectStatus(null), { x: "—", y: "—", w: "—", h: "—" });
});

test("boundingRect of one rect is that rect; of many is the union", () => {
  assert.deepEqual(boundingRect([{ x: 10, y: 20, w: 30, h: 40 }]), { x: 10, y: 20, w: 30, h: 40 });
  assert.deepEqual(
    boundingRect([{ x: 100, y: 100, w: 100, h: 100 }, { x: 50, y: 300, w: 100, h: 50 }]),
    { x: 50, y: 100, w: 150, h: 250 },
  );
  assert.equal(boundingRect([]), null);
});

// ---------- zoom ------------------------------------------------------------

test("zoom clamps and steps through the fixed ladder", () => {
  assert.equal(clampZoom(99), ZOOM_MAX);
  assert.equal(clampZoom(0.01), ZOOM_MIN);
  assert.equal(clampZoom(Number.NaN), 1);
  // null (Fit) behaves as 100% for stepping.
  assert.equal(stepZoom(null, 1), 1.5);
  assert.equal(stepZoom(null, -1), 0.75);
  assert.equal(stepZoom(ZOOM_MAX, 1), ZOOM_MAX);
  assert.equal(stepZoom(ZOOM_MIN, -1), ZOOM_MIN);
});

test("zoomLabel says Fit for the default, never a fake percentage", () => {
  assert.equal(zoomLabel(null), "Fit");
  assert.equal(zoomLabel(1), "100%");
  assert.equal(zoomLabel(0.25), "25%");
});

// ---------- size lock -------------------------------------------------------

const START = { x: 100, y: 100, w: 400, h: 200 }; // 2:1

test("size lock keeps the ratio when dragging a side handle", () => {
  const r = constrainAspect(START, { x: 100, y: 100, w: 600, h: 200 }, "e");
  assert.equal(r.w, 600);
  assert.equal(r.h, 300); // 600 / 2
  assert.equal(r.x, 100);
  assert.equal(r.y, 100);
});

test("size lock on a corner follows whichever axis moved more", () => {
  // Width moved 200, height moved 10 → width wins.
  const r = constrainAspect(START, { x: 100, y: 100, w: 600, h: 210 }, "se");
  assert.equal(r.w, 600);
  assert.equal(r.h, 300);
  // Height moved 200, width moved 10 → height wins.
  const r2 = constrainAspect(START, { x: 100, y: 100, w: 410, h: 400 }, "se");
  assert.equal(r2.h, 400);
  assert.equal(r2.w, 800);
});

test("size lock pins the edge opposite the handle", () => {
  // Dragging the west handle: the RIGHT edge (x+w = 500) must not move.
  const r = constrainAspect(START, { x: 300, y: 100, w: 200, h: 200 }, "w");
  assert.equal(r.x + r.w, 500);
  assert.equal(r.h, r.w / 2);
  // Dragging the north handle: the BOTTOM edge (y+h = 300) must not move.
  const r2 = constrainAspect(START, { x: 100, y: 200, w: 400, h: 100 }, "n");
  assert.equal(r2.y + r2.h, 300);
});

test("size lock never produces a sub-minimum object", () => {
  const r = constrainAspect(START, { x: 100, y: 100, w: 1, h: 1 }, "se");
  assert.ok(r.w >= MIN_OBJECT_SIZE);
  assert.ok(r.h >= MIN_OBJECT_SIZE);
});

test("size lock is a no-op for an unrecognised handle (move)", () => {
  const next = { x: 5, y: 6, w: 7, h: 8 };
  assert.deepEqual(constrainAspect(START, next, "move"), next);
});

test("typing W with size lock on moves H with it, and vice versa", () => {
  assert.deepEqual(lockedSizePatch(START, "w", 800), { w: 800, h: 400 });
  assert.deepEqual(lockedSizePatch(START, "h", 400), { w: 800, h: 400 });
  // Degenerate height can't crash or produce NaN.
  const r = lockedSizePatch({ x: 0, y: 0, w: 100, h: 0 }, "w", 50);
  assert.ok(Number.isFinite(r.w) && Number.isFinite(r.h));
});

// ---------- flip ------------------------------------------------------------

test("flipTransform is undefined unless a flip flag is set", () => {
  assert.equal(flipTransform({}), undefined);
  assert.equal(flipTransform({ flipH: false, flipV: false }), undefined);
  assert.equal(flipTransform({ flipH: true }), "-1 1");
  assert.equal(flipTransform({ flipV: true }), "1 -1");
  assert.equal(flipTransform({ flipH: true, flipV: true }), "-1 -1");
});

test("flip flags survive wire validation, and a non-boolean is rejected", () => {
  const base = { kind: "shape", x: 0, y: 0, w: 100, h: 100, shape: "rect" };
  assert.equal(isValidSlideObject({ ...base, flipH: true, flipV: false }), true);
  assert.equal(isValidSlideObject({ ...base, flipH: "yes" }), false);
  assert.equal(isValidSlideObject({ ...base, flipV: 1 }), false);
});

// ---------- keepOnCanvas ----------------------------------------------------

test("keepOnCanvas leaves an on-canvas object alone and rescues a lost one", () => {
  const r = { x: 100, y: 100, w: 200, h: 200 };
  assert.deepEqual(keepOnCanvas(r), r);
  const far = keepOnCanvas({ x: 99999, y: -99999, w: 200, h: 200 });
  assert.ok(far.x < 1920 && far.y + 200 > 0);
});

// ---------- PARITY: existing content must be untouched ----------------------
// Every object saved before this PR has no flipH/flipV. These lock in that the
// wire signature, the output identity, the saved JSON shape and the projector's
// style output are all byte-identical for such content.

const LEGACY_OBJECTS: SlideObjectWire[] = [
  { kind: "text", x: 80, y: 400, w: 1760, h: 280, text: "Amazing grace", fontFamily: "Inter", fontSize: 96, fontWeight: 600, color: "#ffffff", align: "center" },
  { kind: "shape", x: 0, y: 900, w: 1920, h: 180, shape: "rect", fill: "#000000", opacity: 0.6 },
  { kind: "image", x: 660, y: 340, w: 600, h: 400, url: "https://example.test/logo.png", fit: "contain" },
  { kind: "text", x: 80, y: 60, w: 800, h: 120, text: "John 3:16", rotation: 4, hidden: true },
];

test("PARITY — slideDesignSig is unchanged for objects with no flip", () => {
  const sig = slideDesignSig({ kind: "text", text: "Amazing grace", objects: LEGACY_OBJECTS });
  assert.equal(
    sig,
    "||o4:t80,400,1760,280#ffffff,Inter,96,600,center,,;s0,900,1920,180#000000|;i660,340,600,400https://example.test/logo.png|contain|50,50,1|;t80,60,800,120@4h,,,,,,",
  );
  // No "H" / "V" marker anywhere for unflipped content.
  assert.ok(!/[HV]/.test(sig.replace(/https?:\/\/[^;|]*/g, "")));
});

test("PARITY — flipping DOES change the identity (so the projector re-renders)", () => {
  const before = slideOutputIdentity({ kind: "text", text: "x", objects: LEGACY_OBJECTS });
  const flipped = LEGACY_OBJECTS.map((o, i) => (i === 2 ? { ...o, flipH: true } : o));
  const after = slideOutputIdentity({ kind: "text", text: "x", objects: flipped });
  assert.notEqual(before, after);
  // …and setting the flag to false is identical to not having it at all.
  const off = LEGACY_OBJECTS.map((o, i) => (i === 2 ? { ...o, flipH: false, flipV: false } : o));
  assert.equal(slideOutputIdentity({ kind: "text", text: "x", objects: off }), before);
});

test("PARITY — saved slide JSON round-trips unchanged", () => {
  const objectsJson = { bgColor: "#101010", objects: LEGACY_OBJECTS };
  const slide = normalizeEditableSlide({ id: "s1", lyrics: "Amazing grace", objectsJson });
  assert.deepEqual(JSON.parse(JSON.stringify(slide.objects)), LEGACY_OBJECTS);
  assert.equal(slide.bgColor, "#101010");
  const payload = slidePayloadFromEditable(slide);
  assert.equal(payload.kind, "text");
  assert.equal(payload.kind === "text" ? payload.text : null, "Amazing grace\nJohn 3:16");
  assert.equal(extractLyricsFromEditable(slide), "Amazing grace\nJohn 3:16");
});

test("PARITY — a freshly created text object carries no flip fields", () => {
  const o = emptyTextObject();
  assert.equal("flipH" in o, false);
  assert.equal("flipV" in o, false);
  assert.equal(flipTransform(o), undefined);
});
