/**
 * LAYER ORDER V3 — plan level (src/lib/output-plan.ts planOutputV3 +
 * src/lib/pp7-layer-model.ts V3 clears + src/lib/theme-layer-v3.ts).
 *
 * Fixed independent layers: media z0 → theme bg z10 → slide z20 →
 * announcement z30 → logo/Props z40.
 * "Not visible" is never "does not exist": a covered/hidden layer stays in the plan.
 * The theme background belongs to the PRESENTATION: shown only while a slide is
 * live (or an explicit keep-theme-bg retention); a cleared slide / blank start
 * hides it so the media shows. Clearing never mutates the theme.
 *
 * Run: npx tsx test/layer-order-v3.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planOutput, type OutputPlan, type PlanInput, type SlideLayerPlan, type BackgroundLayerPlan, type ThemeBgLayerPlan } from "../src/lib/output-plan";
import { pp7ClearLayer, pp7ClearAll, pp7ClearTheme, pp7ClearMediaV3, type Pp7ClearEffects, type Pp7LayerInputs } from "../src/lib/pp7-layer-model";
import { stripThemeBackground, themeLayerPaints, themeLayerCovers, themeLayerShownFor, themeHideKey, themeLayerOpacity, clearSlideThemeEffect, clearSlideAlsoClearsTheme } from "../src/lib/theme-layer-v3";
import { themeConfigToAppearance } from "../src/lib/theme-appearance";
import { isValidThemeAppearance } from "../src/lib/broadcast";
import { matrix, keyOf } from "./pp7-draw-order-matrix";
import type { BackgroundSpec, SlidePayload, ThemeAppearance } from "../src/lib/broadcast";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const IMG_A: BackgroundSpec = { type: "image", imageUrl: "https://cdn.example.com/a.jpg", imageFit: "fill" };
const IMG_B: BackgroundSpec = { type: "image", imageUrl: "https://cdn.example.com/b.jpg", imageFit: "fill" };
const VID: BackgroundSpec = { type: "video", videoUrl: "https://cdn.example.com/loop.mp4" };
const TRANSPARENT_THEME: ThemeAppearance = { textColor: "#ffffff", fontFamily: "Inter" };
const RED_THEME: ThemeAppearance = { bgType: "solid", bgColor: "#aa0000", textColor: "#ffffff" };
const BLUE_THEME: ThemeAppearance = { bgType: "solid", bgColor: "#0000aa", textColor: "#ffffff" };
const BLACK_THEME: ThemeAppearance = { bgType: "solid", bgColor: "#000000" };
const lyric = (t: string): SlidePayload => ({ kind: "text", text: t, bgColor: "#000000" });
const PLAN_ID = "plan-1";

/** Operator-side model, mirroring OperatorConsole: the "Theme" hide is keyed to
 *  (plan, per-send counter, live slide, theme bg) exactly like the console's
 *  themeHiddenKey, and is emitted as the wire `themeLayerHidden` (the appearance
 *  itself is never stripped, so a theme video pauses instead of unmounting). */
type Model = { slide: SlidePayload; appearance: ThemeAppearance | null; hiddenKey: string | null; background: BackgroundSpec | null; planId?: string; rev?: number };
const keyOf3 = (m: Model) => themeHideKey(m.slide, m.appearance, m.planId ?? PLAN_ID, m.rev ?? 0);
const hiddenOf = (m: Model) => m.hiddenKey !== null && m.hiddenKey === keyOf3(m);
const outAppearance = (m: Model) => m.appearance;
/** A send to live (sendSlideToLive bumps liveBroadcastRevision). */
const send = (m: Model, sl: SlidePayload) => { m.slide = sl; m.rev = (m.rev ?? 0) + 1; if (m.hiddenKey !== null && m.hiddenKey !== keyOf3(m)) m.hiddenKey = null; };
const inputOf = (m: Model, extra: Partial<PlanInput> = {}): PlanInput => ({
  mode: "live", slide: m.slide, appearance: outAppearance(m), background: m.background, layerOrderV3: true, ...(hiddenOf(m) ? { themeLayerHidden: true } : {}), ...extra,
});
const plan = (m: Model, extra: Partial<PlanInput> = {}) => planOutput(inputOf(m, extra));
const layer = <T,>(p: OutputPlan, id: string) => p.layers.find((l) => l.id === id) as T;
const bg = (p: OutputPlan) => layer<BackgroundLayerPlan>(p, "background");
const themeBg = (p: OutputPlan) => layer<ThemeBgLayerPlan>(p, "theme-bg");
const slideL = (p: OutputPlan) => layer<SlideLayerPlan>(p, "slide");
/** What the audience sees of the theme: the layer is shown AND paints. */
const themeVisible = (m: Model) => themeBg(plan(m)).enabled && themeLayerPaints(outAppearance(m)) && themeBg(plan(m)).props.opacity > 0;

function fx(m: Model): Pp7ClearEffects {
  return {
    killSlide: () => { m.slide = { kind: "empty" }; },
    setBackgroundNone: () => { m.background = null; },
    clearLayer: () => {},
    clearVideoInput: () => {},
    clearAnnouncement: () => {},
    clearMessages: () => {},
    clearTheme: () => { m.hiddenKey = keyOf3(m); },
  };
}
const inputs = (m: Model): Pp7LayerInputs => ({
  kind: m.slide.kind, rowActive: () => false, announcementActive: false,
  backgroundSpecActive: !!m.background, videoInputActive: false, messagesActive: false,
  layerOrderV3: true, themeLayerActive: themeLayerShownFor(m.slide) && themeLayerPaints(outAppearance(m)),
});
const applyTheme = (m: Model, a: ThemeAppearance | null) => { m.appearance = a; m.hiddenKey = null; };
const fresh = (over: Partial<Model> = {}): Model => ({ slide: { kind: "empty" }, appearance: null, hiddenKey: null, background: null, ...over });

/** The media layer is present, enabled and carries exactly `spec`. */
function mediaIs(p: OutputPlan, spec: BackgroundSpec) {
  assert.ok(bg(p), "media layer exists");
  assert.equal(bg(p).enabled, true, "media layer enabled");
  assert.deepEqual(bg(p).props.background, spec);
}
/** Fixed order: media < theme bg < slide < logo. */
function fixedOrder(p: OutputPlan) {
  const z = (id: string) => p.layers.find((l) => l.id === id)!.z;
  assert.ok(z("background") < z("theme-bg") && z("theme-bg") < z("slide") && z("slide") < z("theme-logo"));
  assert.deepEqual(p.layers.map((l) => l.z), [...p.layers.map((l) => l.z)].sort((a, b) => a - b), "plan ascending by z");
}

console.log("layer-order-v3 — plan");

check("the user's 8-step sequence (step 8 = IMAGE after clear slide with a coloured theme)", () => {
  const m = fresh();
  // 1. image
  m.background = IMG_A;
  let p = plan(m); mediaIs(p, IMG_A); fixedOrder(p); assert.equal(themeVisible(m), false);
  // 2. transparent theme → media still visible (theme paints nothing)
  applyTheme(m, TRANSPARENT_THEME);
  p = plan(m); mediaIs(p, IMG_A); assert.equal(themeVisible(m), false);
  // 3. lyric → slide above media, no theme bg of its own
  m.slide = lyric("Amazing grace");
  p = plan(m); mediaIs(p, IMG_A); assert.equal(slideL(p).props.themeBgExternal, true); assert.equal(slideL(p).props.overVideo, false);
  assert.equal(themeVisible(m), false);
  // 4. coloured theme → covers media, media STILL in the plan
  applyTheme(m, RED_THEME);
  p = plan(m); mediaIs(p, IMG_A); assert.equal(themeBg(p).enabled, true); assert.equal(themeBg(p).props.opacity, 1);
  assert.equal(themeVisible(m), true);
  // 5. clear slide → the theme hides WITH the slide → image revealed, no reselect
  pp7ClearLayer("slide", inputs(m), fx(m));
  p = plan(m); assert.equal(m.slide.kind, "empty"); mediaIs(p, IMG_A);
  assert.equal(themeBg(p).enabled, false, "theme layer hidden"); assert.equal(themeVisible(m), false);
  assert.equal(m.appearance, RED_THEME, "clearing never mutates the theme");
  // 6. new lyric → the SAME theme shows again
  m.slide = lyric("How sweet the sound");
  p = plan(m); mediaIs(p, IMG_A); assert.equal(themeVisible(m), true);
  // 7. another colour theme
  applyTheme(m, BLUE_THEME);
  p = plan(m); mediaIs(p, IMG_A); assert.equal(themeVisible(m), true);
  // 8. clear slide (blue theme still applied) → IMAGE
  pp7ClearLayer("slide", inputs(m), fx(m));
  p = plan(m); mediaIs(p, IMG_A); assert.equal(m.slide.kind, "empty"); assert.equal(themeVisible(m), false);
  assert.equal(m.appearance, BLUE_THEME, "theme untouched; next slide shows it");
});

check("blank start (nothing sent) shows NO theme bg, even with a coloured theme", () => {
  const m = fresh({ appearance: RED_THEME });
  assert.equal(themeBg(plan(m)).enabled, false);
  assert.equal(themeVisible(m), false);
  const withMedia = fresh({ appearance: RED_THEME, background: IMG_A });
  mediaIs(plan(withMedia), IMG_A); assert.equal(themeVisible(withMedia), false);
});

check("theme shown for every non-empty slide kind and an explicit keep-theme-bg retention", () => {
  for (const s of [lyric("x"), { kind: "logo", url: "https://cdn.example.com/l.png" } as SlidePayload, { kind: "image", url: "https://cdn.example.com/s.jpg" } as SlidePayload]) {
    assert.equal(themeBg(plan(fresh({ slide: s, appearance: RED_THEME }))).enabled, true, s.kind);
  }
  assert.equal(themeBg(plan(fresh({ slide: { kind: "empty", keepThemeBg: true } as SlidePayload, appearance: RED_THEME }))).enabled, true, "keepThemeBg retention");
  assert.equal(themeLayerShownFor({ kind: "empty" }), false);
  assert.equal(themeLayerShownFor(null), false);
});

check("Esc / Clear All blacks out: slide + media gone, theme hidden, nothing persistent", () => {
  const m = fresh({ slide: lyric("x"), appearance: RED_THEME, background: VID });
  pp7ClearAll(inputs(m), fx(m));
  const p = plan(m);
  assert.equal(m.slide.kind, "empty"); assert.equal(m.background, null);
  assert.equal(bg(p).enabled, false, "no media"); assert.equal(themeBg(p).enabled, false, "no theme");
  assert.equal(m.hiddenKey, null, "Clear All sets NO theme-stripped state");
  // The next slide shows the theme again, with no re-apply.
  m.slide = lyric("next");
  assert.equal(themeVisible(m), true);
});

check("Theme (hide) resets on the next slide AND on a theme identity change", () => {
  const m = fresh({ slide: lyric("one"), appearance: RED_THEME, background: IMG_A });
  pp7ClearTheme(inputs(m), fx(m));
  assert.equal(themeVisible(m), false, "hidden for this slide"); mediaIs(plan(m), IMG_A);
  assert.equal(outAppearance(m)?.textColor, "#ffffff", "text styling kept");
  assert.equal(m.slide.kind, "text", "slide kept");
  send(m, lyric("two"));
  assert.equal(themeVisible(m), true, "next slide → theme back");
  pp7ClearTheme(inputs(m), fx(m)); assert.equal(themeVisible(m), false);
  m.appearance = BLUE_THEME; // per-item / content-type theme (no applyTheme reset)
  assert.equal(themeVisible(m), true, "theme identity change → theme back");
  pp7ClearTheme(inputs(m), fx(m)); assert.equal(themeVisible(m), false);
  m.planId = "plan-2";
  assert.equal(themeVisible(m), true, "new plan → theme back");
});

check("image A → B with a black theme: theme stays, media swaps", () => {
  const m = fresh({ slide: lyric("x"), appearance: BLACK_THEME, background: IMG_A });
  mediaIs(plan(m), IMG_A);
  m.background = IMG_B;
  const p = plan(m); mediaIs(p, IMG_B);
  assert.equal(themeBg(p).enabled, true); assert.equal(m.appearance, BLACK_THEME);
});

check("theme → transparent reveals media", () => {
  const m = fresh({ slide: lyric("x"), appearance: RED_THEME, background: IMG_A });
  applyTheme(m, TRANSPARENT_THEME);
  mediaIs(plan(m), IMG_A); assert.equal(themeVisible(m), false);
});

check("3 slide changes keep media identity", () => {
  const m = fresh({ slide: lyric("1"), appearance: RED_THEME, background: VID });
  const first = bg(plan(m)).props.background;
  for (const t of ["2", "3", "4"]) { m.slide = lyric(t); assert.equal(bg(plan(m)).props.background, first, "same media object"); }
});

check("layerOpacity 0.5 is SEE-THROUGH on the theme layer (media visible), clamped, not covering", () => {
  const m = fresh({ slide: lyric("x"), appearance: { ...RED_THEME, layerOpacity: 0.5 }, background: IMG_A });
  const p = plan(m); assert.equal(themeBg(p).props.opacity, 0.5); mediaIs(p, IMG_A);
  assert.equal(themeLayerCovers(m.appearance), false, "half see-through never covers media");
  assert.equal(themeBg(planOutput(inputOf({ ...m, appearance: { ...RED_THEME, layerOpacity: 7 } }))).props.opacity, 1, "clamped");
  assert.equal(themeLayerOpacity({ ...RED_THEME, layerOpacity: Number.NaN }), 1);
  assert.equal(themeLayerPaints({ ...RED_THEME, layerOpacity: 0 }), false, "0 ⇒ paints nothing");
  assert.equal(themeLayerCovers(RED_THEME), true, "opaque solid covers");
  assert.equal(themeLayerCovers({ ...RED_THEME, bgColor: "rgba(170,0,0,0.5)" }), false, "alpha colour never covers");
  assert.equal(themeLayerCovers({ bgType: "image", bgImageUrl: "https://cdn.example.com/t.png" }), false, "image may have alpha");
});

check("dim semantics UNCHANGED: theme editor Opacity (config bgOpacity) is a DIM, never see-through", () => {
  const a = themeConfigToAppearance({ bgType: "solid", bgColor: "#aa0000", bgOpacity: 0.6 })!;
  assert.ok(Math.abs((a.dim ?? 0) - 0.4) < 1e-9, "dim = 1 − bgOpacity (legacy mapping)");
  assert.equal(a.layerOpacity, undefined, "never reinterpreted as see-through");
  assert.equal((a as Record<string, unknown>).bgOpacity, undefined, "config key never leaks onto the wire");
  const p = planOutput({ mode: "live", slide: lyric("x"), appearance: a, background: IMG_A, layerOrderV3: true });
  assert.equal(themeBg(p).props.opacity, 1, "dimmed theme is still an opaque layer");
  assert.equal(themeLayerCovers(a), true);
});

check("wire validation: layerOpacity / bgOpacity must be finite 0..1", () => {
  assert.equal(isValidThemeAppearance({ ...RED_THEME, layerOpacity: 0.5 }), true);
  assert.equal(isValidThemeAppearance({ ...RED_THEME, layerOpacity: 0 }), true);
  assert.equal(isValidThemeAppearance({ ...RED_THEME, layerOpacity: 1 }), true);
  for (const bad of [-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "0.5", null]) {
    assert.equal(isValidThemeAppearance({ ...RED_THEME, layerOpacity: bad } as unknown), false, `layerOpacity ${String(bad)}`);
    assert.equal(isValidThemeAppearance({ ...RED_THEME, bgOpacity: bad } as unknown), false, `bgOpacity ${String(bad)}`);
  }
  assert.equal(isValidThemeAppearance(RED_THEME), true, "absent ⇒ unchanged");
});

check("video media layer is untouched by theme apply / hide / clear slide", () => {
  const m = fresh({ slide: lyric("x"), background: VID });
  const snap = () => JSON.stringify(bg(plan(m)));
  const before = snap();
  applyTheme(m, RED_THEME); assert.equal(snap(), before);
  pp7ClearTheme(inputs(m), fx(m)); assert.equal(snap(), before);
  applyTheme(m, BLUE_THEME); assert.equal(snap(), before);
  pp7ClearLayer("slide", inputs(m), fx(m)); assert.equal(snap(), before);
});

check("clears are independent", () => {
  const mk = (): Model => fresh({ slide: lyric("x"), appearance: RED_THEME, background: IMG_A });
  let m = mk(); pp7ClearLayer("media", inputs(m), fx(m));
  assert.equal(m.background, null); assert.equal(m.slide.kind, "text"); assert.equal(themeVisible(m), true);
  m = mk(); pp7ClearLayer("slide", inputs(m), fx(m));
  assert.equal(m.background, IMG_A); assert.equal(m.slide.kind, "empty"); assert.equal(m.appearance, RED_THEME);
  m = mk(); pp7ClearTheme(inputs(m), fx(m));
  assert.equal(m.background, IMG_A); assert.equal(m.slide.kind, "text"); assert.equal(themeVisible(m), false);
  m = mk(); m.slide = { kind: "image", url: "https://cdn.example.com/s.jpg" };
  pp7ClearLayer("media", inputs(m), fx(m)); assert.equal(m.slide.kind, "image", "V3 Clear Media never kills a media-as-slide");
});

check("Clear Media is ONE function: store + Layers-panel background override", () => {
  const calls: string[] = [];
  const f = { setBackgroundNone: () => calls.push("store"), clearLayer: (id: string) => calls.push(`layer:${id}`) };
  pp7ClearMediaV3({ rowActive: (id) => id === "background" }, f);
  assert.deepEqual(calls, ["store", "layer:background"]);
  calls.length = 0;
  pp7ClearMediaV3({ rowActive: () => false }, f);
  assert.deepEqual(calls, ["store"]);
  // The rail / Layers panel route (pp7ClearLayer "media") does exactly the same.
  const calls2: string[] = [];
  pp7ClearLayer("media", { ...inputs(fresh()), rowActive: (id) => id === "background" }, { ...fx(fresh()), setBackgroundNone: () => calls2.push("store"), clearLayer: (id) => calls2.push(`layer:${id}`) });
  assert.deepEqual(calls2, ["store", "layer:background"]);
});

check("flag off: clear model unchanged (Clear Media still kills a media slide, no theme clear)", () => {
  const m = fresh({ slide: { kind: "image", url: "https://cdn.example.com/s.jpg" }, appearance: RED_THEME, background: IMG_A });
  pp7ClearLayer("media", { ...inputs(m), layerOrderV3: undefined }, fx(m)); assert.equal(m.slide.kind, "empty");
  const m2 = fresh({ slide: lyric("x"), appearance: RED_THEME, background: IMG_A });
  pp7ClearAll({ ...inputs(m2), layerOrderV3: undefined }, fx(m2)); assert.equal(m2.hiddenKey, null);
  pp7ClearTheme({ ...inputs(m2), layerOrderV3: undefined }, fx(m2)); assert.equal(m2.hiddenKey, null);
});

check("Esc / live X route to the V3 blackout (camera included); voice/AI clear is slide-only (source lock)", () => {
  const src = readFileSync(new URL("../src/components/operator/OperatorConsole.tsx", import.meta.url), "utf8");
  assert.match(src, /e\.key === "Escape"\) \{ e\.preventDefault\(\); killOutput\(\); \}/);
  assert.match(src, /cmd\.verb === "clear_screen"\) \{ voiceClear\(\);/);
  assert.match(src, /case "clear_live": voiceClear\(\); break;/);
  assert.match(src, /const voiceClear = useCallback\(\(\) => \{ if \(layerOrderV3On\) clearLive\(\); else killOutput\(\); \}/, "V3 voice = clearLive only; flag off = killOutput (unchanged)");
  assert.match(src, /onKill: killOutput,/);
  const body = src.slice(src.indexOf("const killOutput = useCallback("), src.indexOf("}, [layerOrderV3On, clearLive, clearMediaLayerV3, videoInput]);"));
  assert.match(body, /if \(!layerOrderV3On\) \{ clearLive\(\); return; \}/, "flag off = exactly clearLive");
  for (const step of ["clearLive();", "clearMediaLayerV3();", "if (videoInput) clearVideoInputLive()", "setAnnouncement(null);"]) assert.ok(body.includes(step), step);
  assert.ok(!/setThemeHiddenKey/.test(body), "blackout sets no persistent theme state");
  const cm = src.slice(src.indexOf("const clearMediaLayerV3 = useCallback("), src.indexOf("const clearHeldLowerThirdRef"));
  assert.match(cm, /pp7ClearMediaV3\(/, "console Clear Media uses the shared function");
});

check("single flag source: console, compositor and click handlers read one store", () => {
  const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  assert.match(read("components/operator/OperatorConsole.tsx"), /const layerOrderV3On = useLayerOrderV3\(\);/);
  assert.match(read("components/live/OutputCompositor.tsx"), /useLayerOrderV3\(\)/);
  for (const f of ["components/operator/pro/center/MediaBrowser.tsx", "components/operator/pro/left/MediaBinSection.tsx"]) {
    assert.match(read(f), /from "@\/lib\/layer-order-v3"/, f);
  }
  const store = read("lib/layer-order-v3.ts");
  assert.match(store, /useSyncExternalStore\(subscribe, readLayerOrderV3Flag, serverSnapshot\)/, "hook snapshot IS the reader");
  assert.match(store, /LAYER_ORDER_V3_EVENT/); assert.match(store, /"storage"/);
});

check("flag off == golden (all 22,400 fixtures)", () => {
  const golden = JSON.parse(readFileSync(new URL("./fixtures/output-plan-main.golden.json", import.meta.url), "utf8")) as {
    fixtures: number; order: number[]; plans: unknown[];
  };
  const all = matrix();
  assert.equal(all.length, golden.fixtures);
  for (let n = 0; n < all.length; n++) {
    const got = JSON.stringify(planOutput({ ...all[n], layerOrderV3: false }));
    if (got !== JSON.stringify(golden.plans[golden.order[n]])) assert.fail(`fixture ${keyOf(all[n])}`);
  }
});

check("preview and live produce the identical plan for the same state", () => {
  // Preview (LivePreviewPanel / LiveOutputThumb) renders mode "live" through the
  // same OutputCompositor with previewFrozen, which only freezes playback.
  const m = fresh({ slide: lyric("x"), appearance: { ...RED_THEME, layerOpacity: 0.5 }, background: VID });
  assert.deepEqual(plan(m), plan(m));
  assert.deepEqual(planOutput(inputOf(m)), planOutput({ ...inputOf(m) }));
});

check("OBS alpha keying still suppresses media, theme bg, camera and logo", () => {
  for (const mode of ["livestream", "ndi"] as const) {
    const p = planOutput({ mode, slide: lyric("x"), appearance: RED_THEME, background: IMG_A, videoInput: { deviceId: "cam" } as never, transparent: true, layerOrderV3: true });
    assert.equal(bg(p).enabled, false); assert.equal(themeBg(p).enabled, false);
    assert.equal(p.layers.find((l) => l.id === "theme-logo")!.enabled, false);
    assert.equal(p.layers.some((l) => l.id === "camera"), false);
    assert.equal(slideL(p).props.transparentBg, true);
  }
});

check("camera is media: below media, never suppresses it; stage never has a camera", () => {
  const p = planOutput({ mode: "live", slide: lyric("x"), appearance: RED_THEME, background: IMG_A, videoInput: { deviceId: "cam" } as never, layerOrderV3: true });
  const cam = p.layers.find((l) => l.id === "camera")!;
  assert.ok(cam.z < bg(p).z); assert.equal(bg(p).enabled, true);
  assert.equal(slideL(p).props.renderMode, "over-video"); assert.equal(slideL(p).props.cameraExternal, true);
  const s = planOutput({ mode: "stage", slide: lyric("x"), background: IMG_A, videoInput: { deviceId: "cam" } as never, layerOrderV3: true });
  assert.equal(s.layers.some((l) => l.id === "camera"), false);
});

check("announcement (z30) is an overlay above the slide and BELOW the logo / Props (z40)", () => {
  const p = planOutput({ mode: "live", slide: lyric("x"), appearance: RED_THEME, layerOrderV3: true, announcementLive: true });
  const ann = p.layers.find((l) => l.id === "announcement")!;
  const logo = p.layers.find((l) => l.id === "theme-logo")!;
  assert.equal(ann.z, 30); assert.equal(logo.z, 40);
  assert.ok(ann.z > slideL(p).z && ann.z < logo.z);
  const ids = p.layers.map((l) => l.id);
  assert.ok(ids.indexOf("announcement") < ids.indexOf("theme-logo"), "plan order");
});

check("Hide theme lapses on ANY new send: A→B→A and an identical re-send", () => {
  const A = lyric("chorus"), B = lyric("verse");
  const m = fresh({ appearance: RED_THEME, background: IMG_A });
  send(m, A); pp7ClearTheme(inputs(m), fx(m));
  assert.equal(themeVisible(m), false, "hidden on A");
  send(m, B); assert.equal(themeVisible(m), true, "B shows theme");
  send(m, A); assert.equal(themeVisible(m), true, "back to A does NOT re-hide");
  assert.equal(m.hiddenKey, null, "stale key cleared");
  pp7ClearTheme(inputs(m), fx(m)); assert.equal(themeVisible(m), false);
  send(m, { ...A }); assert.equal(themeVisible(m), true, "identical chorus re-send does not carry the hide");
  send(m, A); assert.equal(themeVisible(m), true, "same object re-send too");
  assert.notEqual(themeHideKey(A, RED_THEME, PLAN_ID, 1), themeHideKey(A, RED_THEME, PLAN_ID, 2), "send counter is in the key");
});

check("Hide theme disables the theme layer WITHOUT stripping the appearance (video pauses, not unmounts)", () => {
  const vidTheme: ThemeAppearance = { bgType: "video", bgVideoUrl: "https://cdn.example.com/t.mp4" };
  const p = planOutput({ mode: "live", slide: lyric("x"), appearance: vidTheme, layerOrderV3: true, themeLayerHidden: true });
  assert.equal(themeBg(p).enabled, false);
  assert.equal(stripThemeBackground(vidTheme)?.bgVideoUrl, undefined, "(strip helper still exists, no longer used for hide)");
  const src = readFileSync(new URL("../src/components/operator/OperatorConsole.tsx", import.meta.url), "utf8");
  assert.ok(!/stripThemeBackground/.test(src), "console never strips the appearance for a hide");
  assert.match(src, /themeLayerHiddenV3 \? \{ themeLayerHidden: true \} : \{\}/);
});

check("V3 blank is opaque: theme layer disabled under it; flag off unchanged", () => {
  const p = planOutput({ mode: "live", slide: { kind: "blank" } as SlidePayload, appearance: RED_THEME, background: IMG_A, layerOrderV3: true });
  assert.equal(themeBg(p).enabled, false, "theme under an opaque blank is disabled (paused)");
  mediaIs(p, IMG_A);
  const k = planOutput({ mode: "livestream", slide: { kind: "blank" } as SlidePayload, appearance: RED_THEME, layerOrderV3: true, transparent: true });
  assert.equal(slideL(k).props.transparentBg, true, "OBS keying keeps blank see-through");
});

check("clearSlideAlsoClearsTheme: default false; both values map to the documented effect", () => {
  assert.equal(clearSlideAlsoClearsTheme, false, "Victor 2026-09-24: option (a)");
  assert.equal(clearSlideThemeEffect(), "hide-with-slide");
  assert.equal(clearSlideThemeEffect(false), "hide-with-slide");
  assert.equal(clearSlideThemeEffect(true), "theme-off");
  const src = readFileSync(new URL("../src/components/operator/OperatorConsole.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(clearSlideThemeEffect\(\) === "theme-off"\) setThemeOffV3\(true\);/);
});

check("receivers trust the wire only; local flag only in operator previews", () => {
  const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  assert.match(read("components/live/OutputCompositor.tsx"), /const v3 = !!props\.layerOrderV3 \|\| \(!!props\.trustLocalFlag && v3Local\);/);
  for (const r of ["app/live/page.tsx", "app/stage/page.tsx", "app/livestream/page.tsx", "app/ndi/page.tsx", "lib/multiview.ts"]) {
    assert.ok(!/trustLocalFlag/.test(read(r)), `${r} must not trust the local flag`);
  }
  assert.match(read("components/operator/pro/right/LivePreviewPanel.tsx"), /trustLocalFlag: true/);
  assert.match(read("components/operator/LiveOutputThumb.tsx"), /layerOrderV3 trustLocalFlag previewFrozen/);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
