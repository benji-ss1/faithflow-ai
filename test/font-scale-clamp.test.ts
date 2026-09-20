/**
 * FONT-SCALE CLAMP — the "projector silently snaps back to 100%" bug (2026-09-20).
 *
 * ROOT CAUSE. The operator publishes ONE number to every output:
 *     effectiveFontScale = fontScale (text slider) * activeZone.fontScale
 * where activeZone.fontScale is the zone's FONT slider (ProjectionZoneControls,
 * reachable from the desktop slide editor) — NOT the zone Size/zoom slider.
 * The text slider maxes at FONT_SCALE_MAX = 2.5 and the zone multiplier at
 * ZONE_FONT_SCALE_MAX = 2, so the product reaches 5.0. The wire bound was a bare
 * `4`, and `sanitizeOutputState` RESET anything above it to 1 — and the operator
 * sanitises before posting, so the projector received 1 (= 100%, AUTO) with no
 * warning, mid-service. Worse, the operator's OWN preview reads the unsanitised
 * value, so preview stayed large while the projector was at 100%: the two
 * disagreed silently.
 *
 * This was a REGRESSION introduced on 2026-09-16 when the slider range was
 * widened 0.6-1.6 -> 0.3-2.5 (see operatorConstants.ts). Before that the worst
 * case was 1.6 * 2 = 3.2, safely under the bound.
 *
 * THE FIX, in three parts, all pinned here:
 *   1. DRIFT GUARD — slider max * zone max must never exceed the wire bound, so
 *      widening either slider again cannot silently reintroduce the reset.
 *   2. CLAMP AT SOURCE — the operator clamps the product, so preview and
 *      projector always agree and nothing out-of-range ever reaches the wire.
 *   3. FAIL TOWARDS INTENT — the sanitiser CLAMPS an over-large finite value
 *      instead of resetting it to 1. Too big degrades to "as big as allowed",
 *      never to "back to default". Only an uninterpretable value (non-finite,
 *      <= 0) still falls back to 1.
 *
 * Run: npx tsx test/font-scale-clamp.test.ts
 */
import assert from "node:assert/strict";
import {
  sanitizeOutputState,
  isValidOutputState,
  isValidOutputStateExternal,
  coerceLiveMessage,
  publishedFontScale,
  OUTPUT_FONT_SCALE_MAX,
  EMPTY_OUTPUT,
  type OutputState,
} from "../src/lib/broadcast";
import { FONT_SCALE_MAX, FONT_SCALE_MIN, REFERENCE_SCALE_MAX, REFERENCE_SCALE_MIN } from "../src/components/operator/pro/operatorConstants";
import { ZONE_FONT_SCALE_MAX, ZONE_FONT_SCALE_MIN, normalizeZone } from "../src/lib/projection-zone";
import { OBS_MAX_FONT_SCALE } from "../src/lib/obs-look";
import { resolveShownSize, searchCeilingPx } from "../src/components/live/AutoFitText";
import { projectorCeilingPx, PROJECTOR_MAX_BODY_FRACTION } from "../src/lib/projectorFontSize";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.error(`FAIL  ${name}\n      ${(e as Error).message}`); }
}

const base: OutputState = { ...EMPTY_OUTPUT, live: { kind: "text", text: "For God so loved the world" } };
const withScale = (fontScale: number) => sanitizeOutputState({ ...base, fontScale } as OutputState);

/** The REAL published-scale function (the same one OperatorConsole uses for both
 *  the wire payloads and its own preview), fed through the REAL zone normaliser.
 *  Nothing here is a hand copy, so deleting the clamp at source fails these tests. */
const effective = (slider: number, zone: number) =>
  publishedFontScale(slider, normalizeZone({ x: 0, y: 0, w: 1, h: 1, fontScale: zone } as never).fontScale);

// ---------------------------------------------------------------------------
// 1. DRIFT GUARD — the invariant that makes the bug structurally impossible
// ---------------------------------------------------------------------------

check("DRIFT GUARD: the PUBLISHED scale never exceeds the wire bound", () => {
  // The load-bearing invariant. Anything above the bound is REJECTED outright by
  // isValidOutputStateExternal on a stale remote surface (realtime.ts drops the
  // frame), and was RESET to 1 by the sanitiser — the original bug. The source
  // clamp must hold for every combination the two sliders can produce.
  for (let slider = FONT_SCALE_MIN; slider <= FONT_SCALE_MAX + 1e-9; slider += 0.05) {
    for (let zone = ZONE_FONT_SCALE_MIN; zone <= ZONE_FONT_SCALE_MAX + 1e-9; zone += 0.05) {
      const published = effective(slider, zone);
      assert.ok(published > 0 && published <= OUTPUT_FONT_SCALE_MAX,
        `published ${published} out of (0, ${OUTPUT_FONT_SCALE_MAX}] at slider=${slider.toFixed(2)} zone=${zone.toFixed(2)}`);
    }
  }
});

check("DRIFT RECORD: the raw slider product exceeds the bound and is deliberately capped", () => {
  // Currently 2.5 * 2.0 = 5.0 > 4. That is INTENTIONAL: the wire bound stays at 4
  // so a cross-device surface loaded before a deploy (still running the old
  // validator) cannot reject the frame and freeze on its last slide. The cost is
  // that the very top of the two sliders is capped.
  // If you raise OUTPUT_FONT_SCALE_MAX to cover the full range, this test SHOULD
  // fail — update it deliberately, and only at least one release AFTER every
  // output surface accepts the higher bound.
  assert.ok(FONT_SCALE_MAX * ZONE_FONT_SCALE_MAX > OUTPUT_FONT_SCALE_MAX,
    "raw product no longer exceeds the bound — re-read the rollout note in broadcast.ts before changing this");
  assert.equal(effective(FONT_SCALE_MAX, ZONE_FONT_SCALE_MAX), OUTPUT_FONT_SCALE_MAX,
    "the top of both sliders must clamp to the bound, not reset");
});

check("NO VISIBLE COST: clamping to 4 renders identically to an uncapped 5", () => {
  // The clamp caps the operator's raw 5.0 at 4.0. This proves that costs them
  // NOTHING on screen, so the safe bound is free.
  //
  // The operator scale is NOT a px multiplier: `resolveShownSize` returns the
  // FITTED size unchanged for any scale >= 1, and the scale only raises the fit
  // search ceiling (`searchCeilingPx` = projectorCeilingPx(H) * scale, where
  // projectorCeilingPx = PROJECTOR_MAX_BODY_FRACTION * H). Text can never render
  // larger than the box it must fit inside, so once the ceiling reaches the
  // container height it stops binding altogether and the box governs.
  //
  // Ceiling stops binding at scale >= 1 / PROJECTOR_MAX_BODY_FRACTION = 3.34.
  // Both 4 and 5 are above that, so they produce the SAME fitted size.
  const bindingThreshold = 1 / PROJECTOR_MAX_BODY_FRACTION;
  assert.ok(OUTPUT_FONT_SCALE_MAX > bindingThreshold,
    `the bound (${OUTPUT_FONT_SCALE_MAX}) must exceed the ceiling-binding threshold ` +
    `(${bindingThreshold.toFixed(2)}), otherwise clamping WOULD shrink text on screen`);

  // Concretely: at the bound, the ceiling already exceeds the container for every
  // realistic surface (4K projector down to a short lower-third band).
  for (const containerH of [2160, 1080, 720, 400, 259, 120]) {
    const ceilingAtBound = searchCeilingPx(Math.round(projectorCeilingPx(containerH)), OUTPUT_FONT_SCALE_MAX);
    assert.ok(ceilingAtBound >= containerH,
      `container ${containerH}px: ceiling ${ceilingAtBound}px still binds at the bound — ` +
      `clamping could visibly shrink text here`);
    // ...and raising the bound would not change that, i.e. nothing is gained.
    const ceilingUncapped = searchCeilingPx(Math.round(projectorCeilingPx(containerH)), FONT_SCALE_MAX * ZONE_FONT_SCALE_MAX);
    assert.ok(ceilingUncapped >= containerH, `container ${containerH}px: uncapped also non-binding`);
  }
});

check("NO VISIBLE COST: scale >= 1 never shrinks the fitted size", () => {
  // resolveShownSize is the function that turns the operator scale into pixels.
  // For any scale >= 1 it returns the fitted size UNCHANGED — so the clamp (which
  // only ever lowers a value from 5 to 4, both >= 1) cannot shrink anything.
  for (const best of [24, 80, 200, 640]) {
    assert.equal(resolveShownSize(best, OUTPUT_FONT_SCALE_MAX), best, "clamped scale keeps the fitted size");
    assert.equal(resolveShownSize(best, FONT_SCALE_MAX * ZONE_FONT_SCALE_MAX), best, "uncapped scale gives the same");
    assert.equal(
      resolveShownSize(best, OUTPUT_FONT_SCALE_MAX),
      resolveShownSize(best, FONT_SCALE_MAX * ZONE_FONT_SCALE_MAX),
      "clamped and uncapped are indistinguishable",
    );
  }
});

check("DRIFT GUARD: the wire bound stays in step with the OBS ceiling", () => {
  // obs-look.ts does min(OBS_MAX_FONT_SCALE, fontScale * lookScale). If the wire
  // bound rose above the OBS ceiling, nudging the OBS text slider UP could make
  // livestream text SMALLER (non-monotonic). Keep them equal.
  assert.equal(OUTPUT_FONT_SCALE_MAX, OBS_MAX_FONT_SCALE,
    "OUTPUT_FONT_SCALE_MAX and OBS_MAX_FONT_SCALE must move together or livestream sizing inverts");
});

check("DRIFT GUARD: referenceScale max never exceeds the wire bound", () => {
  assert.ok(REFERENCE_SCALE_MAX <= OUTPUT_FONT_SCALE_MAX,
    `REFERENCE_SCALE_MAX (${REFERENCE_SCALE_MAX}) exceeds OUTPUT_FONT_SCALE_MAX (${OUTPUT_FONT_SCALE_MAX})`);
});

check("DRIFT GUARD: minimums stay above zero (0 would be reset to 1, not clamped)", () => {
  assert.ok(FONT_SCALE_MIN > 0 && ZONE_FONT_SCALE_MIN > 0 && REFERENCE_SCALE_MIN > 0);
  assert.ok(FONT_SCALE_MIN * ZONE_FONT_SCALE_MIN > 0);
  // The smallest publishable product must survive the sanitiser unchanged.
  const tiny = FONT_SCALE_MIN * ZONE_FONT_SCALE_MIN;
  assert.equal(withScale(tiny)!.fontScale, tiny, "smallest real product must not be reset");
});

// ---------------------------------------------------------------------------
// 2. THE EXACT FIELD SCENARIO — the bug, reproduced and proven fixed
// ---------------------------------------------------------------------------

check("FIELD BUG: max text size + high zone FONT multiplier no longer snaps to 100%", () => {
  // 2.5 * 1.8 = 4.5 raw. THE BUG: that was RESET to 1, so the projector showed
  // 100% while the preview stayed large. Now it clamps to the bound — still big.
  const published = effective(FONT_SCALE_MAX, 1.8);
  assert.notEqual(published, 1, "must NOT fall back to 100% (the bug)");
  assert.equal(published, OUTPUT_FONT_SCALE_MAX, "clamped to the bound, still large");
  const s = withScale(published);
  assert.equal(s!.fontScale, published, "survives the sanitiser untouched");
  assert.equal(isValidOutputState(s), true);
  assert.equal(isValidOutputStateExternal(s), true);
});

check("FIELD BUG: every formerly-resetting combination now stays large", () => {
  // Exhaustive over the combinations that used to exceed the old bound and reset.
  let covered = 0;
  for (let slider = 1.6; slider <= FONT_SCALE_MAX + 1e-9; slider += 0.05) {
    for (let zone = 1.6; zone <= ZONE_FONT_SCALE_MAX + 1e-9; zone += 0.05) {
      if (slider * zone <= OUTPUT_FONT_SCALE_MAX) continue; // wasn't affected
      covered++;
      const published = effective(slider, zone);
      assert.equal(published, OUTPUT_FONT_SCALE_MAX, `slider=${slider.toFixed(2)} zone=${zone.toFixed(2)}`);
      assert.notEqual(published, 1, "never the 100% reset");
      assert.equal(withScale(published)!.fontScale, published, "sanitiser leaves it alone");
    }
  }
  assert.ok(covered > 0, "no affected combinations found — this test has stopped covering the bug");
});

check("FIELD BUG: a stale remote surface can still accept every frame we publish", () => {
  // The rollout guarantee. An output tab loaded BEFORE this deploy runs the old
  // validator; if we ever published above the bound it would DROP the frame and
  // freeze on its last slide. Nothing we emit may exceed it.
  for (const [slider, zone] of [[FONT_SCALE_MAX, ZONE_FONT_SCALE_MAX], [2.5, 1.8], [2.1, 1.95], [1, 1]] as const) {
    const st = withScale(effective(slider, zone));
    assert.equal(isValidOutputStateExternal(st), true,
      `a pre-deploy surface would reject slider=${slider} zone=${zone}`);
  }
});

check("FIELD BUG: preview and projector agree at every slider/zone combination", () => {
  for (let slider = FONT_SCALE_MIN; slider <= FONT_SCALE_MAX + 1e-9; slider += 0.1) {
    for (const zone of [0.5, 0.75, 1, 1.25, 1.6, 1.8, 2]) {
      const preview = effective(slider, zone);          // what shellCtx feeds preview
      const projector = withScale(preview)!.fontScale;  // what survives to the wire
      assert.equal(projector, preview,
        `preview ${preview} != projector ${projector} at slider=${slider.toFixed(2)} zone=${zone}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. SANITISER — fails towards intent
// ---------------------------------------------------------------------------

check("over-large finite fontScale is CLAMPED, never reset to 1", () => {
  for (const v of [OUTPUT_FONT_SCALE_MAX + 0.0001, OUTPUT_FONT_SCALE_MAX + 1, 12, 999, 1e6, Number.MAX_SAFE_INTEGER]) {
    const s = withScale(v);
    assert.equal(s!.fontScale, OUTPUT_FONT_SCALE_MAX, `${v} -> bound`);
    assert.notEqual(s!.fontScale, 1, `${v} must not reset to 1`);
  }
});

check("uninterpretable fontScale falls back to 1", () => {
  for (const v of [0, -0.5, -999, NaN, Infinity, -Infinity]) {
    assert.equal(withScale(v)!.fontScale, 1, `${String(v)} -> 1`);
  }
});

check("non-numeric fontScale falls back to 1", () => {
  for (const v of ["2", null, {}, [], true, undefined as never]) {
    const s = sanitizeOutputState({ ...base, fontScale: v } as never) as OutputState;
    // `undefined` means "absent" — the field is legitimately left alone.
    if (v === undefined) assert.equal(s.fontScale, undefined);
    else assert.equal(s.fontScale, 1, `${JSON.stringify(v)} -> 1`);
  }
});

check("in-range fontScale passes through untouched", () => {
  for (const v of [0.15, 0.3, 0.5, 1, 1.5, 2, 2.5, 3.5, 3.99, OUTPUT_FONT_SCALE_MAX]) {
    assert.equal(withScale(v)!.fontScale, v, `${v} unchanged`);
  }
});

check("referenceScale gets identical treatment", () => {
  const ref = (referenceScale: number) => sanitizeOutputState({ ...base, referenceScale } as OutputState);
  assert.equal(ref(999)!.referenceScale, OUTPUT_FONT_SCALE_MAX, "clamped, not reset");
  assert.notEqual(ref(999)!.referenceScale, 1);
  assert.equal(ref(0)!.referenceScale, 1, "uninterpretable -> 1");
  assert.equal(ref(NaN)!.referenceScale, 1);
  assert.equal(ref(REFERENCE_SCALE_MAX)!.referenceScale, REFERENCE_SCALE_MAX, "slider max survives");
  assert.equal(ref(2.2)!.referenceScale, 2.2, "in range untouched");
});

check("fontScale and referenceScale are clamped independently", () => {
  const s = sanitizeOutputState({ ...base, fontScale: 99, referenceScale: 1.5 } as OutputState)!;
  assert.equal(s.fontScale, OUTPUT_FONT_SCALE_MAX);
  assert.equal(s.referenceScale, 1.5, "a bad fontScale must not disturb referenceScale");
  const t = sanitizeOutputState({ ...base, fontScale: 1.5, referenceScale: 99 } as OutputState)!;
  assert.equal(t.fontScale, 1.5);
  assert.equal(t.referenceScale, OUTPUT_FONT_SCALE_MAX);
});

// ---------------------------------------------------------------------------
// 4. INVARIANTS the rest of the system relies on
// ---------------------------------------------------------------------------

check("sanitised output ALWAYS passes the strict validator", () => {
  for (const v of [0, -1, NaN, Infinity, 0.3, 1, 4, 4.0001, 999, 1e9]) {
    const s = withScale(v);
    assert.ok(s, "state salvageable");
    assert.equal(isValidOutputState(s), true, `strict validation failed for input ${String(v)}`);
    assert.equal(isValidOutputStateExternal(s), true, `external validation failed for input ${String(v)}`);
  }
});

check("strict validator boundary: accepts the bound, rejects just above it", () => {
  assert.equal(isValidOutputState({ ...base, fontScale: OUTPUT_FONT_SCALE_MAX }), true);
  assert.equal(isValidOutputState({ ...base, fontScale: OUTPUT_FONT_SCALE_MAX + 0.0001 }), false);
  assert.equal(isValidOutputState({ ...base, fontScale: 0 }), false);
  assert.equal(isValidOutputState({ ...base, fontScale: -1 }), false);
  assert.equal(isValidOutputState({ ...base, fontScale: NaN }), false);
  assert.equal(isValidOutputState({ ...base, referenceScale: OUTPUT_FONT_SCALE_MAX }), true);
  assert.equal(isValidOutputState({ ...base, referenceScale: OUTPUT_FONT_SCALE_MAX + 0.0001 }), false);
});

check("sanitising is idempotent", () => {
  for (const v of [999, 0, NaN, 2.5, 4]) {
    const once = withScale(v)!;
    const twice = sanitizeOutputState(once)!;
    assert.equal(twice.fontScale, once.fontScale, `not idempotent for ${String(v)}`);
  }
});

check("clamping survives the cross-device wire (coerceLiveMessage)", () => {
  const sent = withScale(effective(FONT_SCALE_MAX, 2))!;
  const wire = JSON.parse(JSON.stringify({ type: "output", state: sent }));
  const msg = coerceLiveMessage(wire);
  assert.ok(msg && msg.type === "output", "message survives the wire");
  const got = (msg as { state: OutputState }).state;
  assert.equal(got.fontScale, OUTPUT_FONT_SCALE_MAX, "clamped value arrives intact");
  assert.notEqual(got.fontScale, 1, "must not arrive as 100%");
});

check("an absent fontScale is never fabricated", () => {
  const s = sanitizeOutputState({ ...base } as OutputState)!;
  assert.equal(s.fontScale, EMPTY_OUTPUT.fontScale, "untouched when absent");
});

// ---------------------------------------------------------------------------
// 5. ZONE normalisation
// ---------------------------------------------------------------------------

check("zone fontScale is clamped to its own bounds", () => {
  const z = (fontScale: unknown) => normalizeZone({ x: 0, y: 0, w: 1, h: 1, fontScale } as never).fontScale;
  assert.equal(z(99), ZONE_FONT_SCALE_MAX);
  assert.equal(z(0.01), ZONE_FONT_SCALE_MIN);
  assert.equal(z(1.4), 1.4);
  assert.equal(z(NaN), 1);
  assert.equal(z(undefined), 1);
});

check("no zone + no slider combination can ever publish above the bound", () => {
  const zones = [-5, 0, 0.1, 0.5, 1, 1.7, 2, 3, 99, NaN];
  const sliders = [FONT_SCALE_MIN, 0.5, 1, 1.6, 2, 2.4, FONT_SCALE_MAX];
  for (const zn of zones) {
    for (const sl of sliders) {
      const zoneScale = normalizeZone({ x: 0, y: 0, w: 1, h: 1, fontScale: zn } as never).fontScale;
      const published = Math.min(OUTPUT_FONT_SCALE_MAX, sl * zoneScale);
      assert.ok(published > 0 && published <= OUTPUT_FONT_SCALE_MAX,
        `published ${published} out of range for zone=${String(zn)} slider=${sl}`);
      assert.equal(withScale(published)!.fontScale, published,
        `published ${published} was altered by the sanitiser (would be a silent size change)`);
    }
  }
});

// ---------------------------------------------------------------------------
// 6. FUZZ
// ---------------------------------------------------------------------------

check("fuzz: 20k random scales never produce an invalid state or a surprise reset", () => {
  for (let i = 0; i < 20000; i++) {
    const r = Math.random();
    const v = r < 0.1 ? [0, -1, NaN, Infinity, -Infinity][i % 5]
      : r < 0.55 ? Math.random() * OUTPUT_FONT_SCALE_MAX
      : Math.random() * 1000;
    const s = withScale(v);
    assert.ok(s, "salvageable");
    assert.equal(isValidOutputState(s), true, `invalid for ${String(v)}`);
    const out = s!.fontScale!;
    assert.ok(out > 0 && out <= OUTPUT_FONT_SCALE_MAX, `out of range: ${out}`);
    // A finite, positive, in-range input must come back EXACTLY as sent.
    if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= OUTPUT_FONT_SCALE_MAX) {
      assert.equal(out, v, `in-range input ${v} was altered to ${out}`);
    }
    // A finite, positive, too-large input must clamp — never reset.
    if (typeof v === "number" && Number.isFinite(v) && v > OUTPUT_FONT_SCALE_MAX) {
      assert.equal(out, OUTPUT_FONT_SCALE_MAX, `too-large input ${v} did not clamp`);
    }
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
