/**
 * OBS EDITOR end-to-end contract (2026-09-14).
 *
 * For EVERY control × look: operator store → published OutputState (obsLook +
 * obsLowerThird) → sanitizeOutputState / coerceLiveMessage (wire) →
 * applyObsLiveFields (/livestream state application) → resolveObsRender
 * (compositor inputs) → OutputCompositor server render (actual rendered props).
 *
 * Plus back-compat: URL-only links (none / ?bg=transparent / ?obs=lowerthird&band
 * / ?mode=lower_third) resolve to EXACTLY the legacy compositor inputs and render
 * byte-identically with no live settings; and a fuzz of the new wire fields.
 *
 * Run: npx tsx test/obs-editor.test.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  sanitizeOutputState, coerceLiveMessage, isValidOutputState, scrubOutputStateForRemote, sanitizeObsLook, slideOutputIdentity,
  type OutputState, type SlidePayload, type ThemeAppearance, type ObsLookWire,
} from "../src/lib/broadcast";
import { DEFAULT_OBS_BAND, parseObsBand, clampObsBand, overlayBandSlide, type ObsBandConfig } from "../src/lib/obs-lowerthird";
import {
  DEFAULT_OBS_LOOK_SETTINGS, OBS_OUTLINE_TEXT_SHADOW, readObsEditorStore, obsLookWireFromStore, parseObsUrl,
  resolveObsRender, applyObsLiveFields, obsThemeColorsOf, clampObsLookSettings, urlLook, heldLowerThirdFor,
  createTrailingPublisher, OBS_MAX_FONT_SCALE, camBandTopPct, type HeldLowerThird,
  type ObsEditorStore, type ObsLook, type ObsRenderResolved,
} from "../src/lib/obs-look";

(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const song: SlidePayload = { kind: "text", text: "He reigns forever more" };
const verse: SlidePayload = { kind: "text", text: "For God so loved the world", reference: "John 3:16 (KJV)" };
const theme: ThemeAppearance = { bgType: "solid", bgColor: "#123456", textColor: "#ffd400", fontFamily: "Inter" } as ThemeAppearance;

const q = (s: string) => { const p = new URLSearchParams(s); return (k: string) => p.get(k); };

function storeWith(look: ObsLook, patch: Partial<ObsEditorStore["settings"]> = {}, band: Partial<ObsBandConfig> = {}): ObsEditorStore {
  return { v: 2, look, lookLive: true, band: clampObsBand({ ...DEFAULT_OBS_BAND, ...band }), settings: { ...DEFAULT_OBS_LOOK_SETTINGS, ...patch } };
}
/** Camera look pinned to the full-frame layout (for the full-frame control tests). */
const camFull = (patch: Partial<ObsEditorStore["settings"]> = {}) => storeWith("camera", { camLayout: "full", ...patch });

/** The operator publish → wire → livestream apply → resolve pipeline. */
function pipeline(store: ObsEditorStore, opts: { url?: string; slide?: SlidePayload; lowerThird?: { line1: string; line2: string } | null; appearance?: ThemeAppearance | null; viaMessage?: boolean } = {}): { resolved: ObsRenderResolved; state: OutputState } {
  const raw: OutputState = {
    live: opts.slide ?? song, next: null, itemTitle: "", slideNumber: "1 / 1", aspectRatio: "16:9",
    lowerThird: opts.lowerThird ?? null, fontScale: 1, appearance: opts.appearance ?? theme,
    obsLowerThird: store.band, obsLook: obsLookWireFromStore(store),
  } as OutputState;
  const sent = sanitizeOutputState(raw)!; // operator sanitize-before-wire
  assert.ok(isValidOutputState(sent), "published state must pass strict validation");
  const remote = scrubOutputStateForRemote(sent); // Realtime / LAN
  const received = opts.viaMessage
    ? (coerceLiveMessage({ type: "output", state: JSON.parse(JSON.stringify(remote)) }) as { state: OutputState }).state
    : sanitizeOutputState(JSON.parse(JSON.stringify(remote)))!;
  const f = applyObsLiveFields(received);
  const url = parseObsUrl(q(opts.url ?? "live=1"));
  const resolved = resolveObsRender({
    url, liveLook: f.liveLook, liveBand: f.liveBand, fontScale: received.fontScale ?? 1,
    appearance: received.appearance ?? null, themeColors: obsThemeColorsOf(received.appearance), lowerThird: received.lowerThird,
  });
  return { resolved, state: received };
}

async function main() {
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
  const render = (r: ObsRenderResolved, slide: SlidePayload, appearance: ThemeAppearance | null = theme) =>
    renderToStaticMarkup(React.createElement(OutputCompositor, {
      mode: "livestream", slide, appearance: r.appearance, fontScale: r.fontScale, transparent: r.transparent,
      obsBand: r.obsBand, obsThemeColors: obsThemeColorsOf(appearance), obsBandExtras: r.obsBandExtras,
      obsOverlay: r.obsOverlay, backgroundDim: r.backgroundDim,
    }));

  // ── Look selection is LIVE ────────────────────────────────────────────────
  for (const via of [false, true]) {
    const tag = via ? "(coerceLiveMessage)" : "(sanitizeOutputState)";
    check(`look: camera picked live overrides a ?obs=lowerthird link ${tag}`, () => {
      const { resolved } = pipeline(camFull(), { url: "obs=lowerthird&live=1", viaMessage: via });
      assert.equal(resolved.look, "camera"); assert.equal(resolved.transparent, true); assert.equal(resolved.obsBand, null);
    });
    check(`look: lowerthird picked live overrides a plain link ${tag}`, () => {
      const { resolved } = pipeline(storeWith("lowerthird"), { url: "live=1", viaMessage: via });
      assert.equal(resolved.look, "lowerthird"); assert.equal(resolved.transparent, true); assert.ok(resolved.obsBand);
    });
    check(`look: full picked live overrides a ?bg=transparent link ${tag}`, () => {
      const { resolved } = pipeline(storeWith("full"), { url: "bg=transparent&live=1", viaMessage: via });
      assert.equal(resolved.look, "full"); assert.equal(resolved.transparent, false);
    });
  }
  check("look: NOT published until explicitly picked (migrated store keeps URL look)", () => {
    const s = readObsEditorStore(null, JSON.stringify({ ...DEFAULT_OBS_BAND, style: "black" }), "camera");
    assert.equal(s.lookLive, false);
    assert.equal(obsLookWireFromStore(s).look, undefined);
    const { resolved } = pipeline(s, { url: "obs=lowerthird" });
    assert.equal(resolved.look, "lowerthird");
    assert.equal(resolved.obsBand?.style, "black", "migrated band reaches OBS");
  });
  // OPT-IN per link: an old link (no live=1) × every live look keeps its URL look.
  for (const u of ["", "bg=transparent", "obs=lowerthird", "mode=lower_third", "obs=lowerthird&ltStyle=frost&ltTop=10", "bg=transparent&lookLock=1"]) {
    for (const lk of ["camera", "lowerthird", "full"] as const) {
      check(`look opt-in: old link "${u || "(none)"}" × live ${lk} → URL look unchanged`, () => {
        const url = parseObsUrl(q(u));
        const { resolved } = pipeline(storeWith(lk, { camScale: 1.5, fullDim: 0.5, ltText: "white" }), { url: u });
        assert.equal(resolved.look, urlLook(url));
        assert.equal(resolved.transparent, url.transparent); assert.equal(resolved.mode, url.mode);
      });
      check(`look opt-in: live=1 link "${u || "(none)"}" follows live ${lk}`, () => {
        const { resolved } = pipeline(storeWith(lk), { url: `${u}&live=1` });
        assert.equal(resolved.look, lk);
      });
    }
  }
  check("look opt-in: settings still restyle ONLY the look an old link shows", () => {
    const cam = pipeline(storeWith("full", { camScale: 1.5, fullScale: 2, fullDim: 0.5 }), { url: "bg=transparent" }).resolved;
    assert.equal(cam.look, "camera"); assert.equal(cam.fontScale, 1.5); assert.equal(cam.backgroundDim, undefined);
    const full = pipeline(camFull({ camScale: 1.5, fullScale: 0.8 }), { url: "" }).resolved;
    assert.equal(full.look, "full"); assert.equal(full.fontScale, 0.8); assert.equal(full.obsOverlay, undefined);
    const lt = pipeline(storeWith("camera", { ltText: "black", camScale: 2 }), { url: "obs=lowerthird" }).resolved;
    assert.equal(lt.look, "lowerthird"); assert.equal(lt.fontScale, 1); assert.equal(lt.obsBandExtras?.textColor, "#111111");
  });

  // ── Lower third controls ─────────────────────────────────────────────────
  check("lowerthird × style/height/position/size/opacity → band wire in rendered slide", () => {
    const { resolved } = pipeline(storeWith("lowerthird", {}, { style: "black", heightPct: 40, topPct: 50, fontScale: 1.5, opacity: 0.8 }));
    const s = overlayBandSlide(song, resolved.obsBand!, obsThemeColorsOf(theme), resolved.obsBandExtras) as Extract<SlidePayload, { kind: "text" }>;
    assert.deepEqual({ t: s.scriptureBand!.topPct, h: s.scriptureBand!.heightPct, f: s.scriptureBand!.fontScale, c: s.scriptureBand!.color, o: s.scriptureBand!.opacity },
      { t: 50, h: 40, f: 1.5, c: "#000000", o: 0.8 });
    const html = render(resolved, song);
    assert.ok(html.includes("top:50%") && html.includes("height:40%"), "band geometry rendered");
    assert.ok(html.includes("opacity:0.8"), "band opacity rendered");
  });
  check("lowerthird × theme style → church theme colours", () => {
    const { resolved } = pipeline(storeWith("lowerthird", {}, { style: "theme" }));
    const html = render(resolved, song);
    assert.ok(html.includes("#123456"), "theme bg"); assert.ok(html.includes("#ffd400"), "theme text");
  });
  for (const [mode, expect] of [["white", "#ffffff"], ["black", "#111111"], ["theme", "#ffd400"], ["#ff0000", "#ff0000"]] as const) {
    check(`lowerthird × text colour ${mode} → ${expect} rendered`, () => {
      const { resolved } = pipeline(storeWith("lowerthird", { ltText: mode }, { style: "grey" }));
      assert.equal(resolved.obsBandExtras?.textColor, expect);
      assert.ok(render(resolved, song).includes(`color:${expect}`), "colour in markup");
    });
  }
  check("lowerthird × text colour auto → legacy (no extras)", () => {
    const { resolved } = pipeline(storeWith("lowerthird"));
    assert.equal(resolved.obsBandExtras, undefined);
  });
  check("lowerthird × show reference OFF hides the verse reference; ON shows it", () => {
    const off = pipeline(storeWith("lowerthird", { ltRef: false }), { slide: verse }).resolved;
    assert.ok(!render(off, verse).includes("John 3:16"));
    const on = pipeline(storeWith("lowerthird", { ltRef: true }), { slide: verse }).resolved;
    assert.ok(render(on, verse).includes("John 3:16"));
  });
  check("lowerthird × operator's own lower third WINS over lyrics (a0f53c8 parity)", () => {
    const lt = { line1: "Pastor John Smith", line2: "Senior Pastor" };
    const { resolved } = pipeline(storeWith("lowerthird"), { lowerThird: lt });
    const html = render(resolved, song);
    assert.ok(html.includes("Pastor John Smith") && html.includes("Senior Pastor"));
    assert.ok(!html.includes("He reigns forever more"), "lyrics suppressed while lower third shows");
  });
  check("lowerthird × operator lower third works with a URL-only link too (no editor)", () => {
    const r = resolveObsRender({ url: parseObsUrl(q("obs=lowerthird")), fontScale: 1, appearance: null, themeColors: {}, lowerThird: { line1: "Welcome", line2: "" } });
    assert.ok(render(r, { kind: "empty" }, null).includes("Welcome"));
  });
  check("lowerthird × Reset (null band) clears back to the link band", () => {
    const f = applyObsLiveFields({ obsLowerThird: null });
    assert.equal(f.liveBand, null);
    const r = resolveObsRender({ url: parseObsUrl(q("obs=lowerthird&ltStyle=frost&ltTop=10")), liveBand: f.liveBand, fontScale: 1, appearance: null, themeColors: {}, lowerThird: null });
    assert.equal(r.obsBand?.style, "frost"); assert.equal(r.obsBand?.topPct, 10);
  });

  // ── Over your camera controls ────────────────────────────────────────────
  check("camera × text size → compositor fontScale multiplied", () => {
    assert.equal(pipeline(camFull({ camScale: 1.6 })).resolved.fontScale, 1.6);
    assert.equal(pipeline(camFull({ camScale: 0.5 })).resolved.fontScale, 0.5);
  });
  for (const pos of ["top", "bottom"] as const) {
    check(`camera × position ${pos} → rendered alignment`, () => {
      const { resolved } = pipeline(camFull({ camPos: pos }));
      assert.equal(resolved.obsOverlay?.verticalAlign, pos);
      assert.ok(render(resolved, song).includes(pos === "top" ? "items-start" : "items-end"));
    });
  }
  check("camera × position middle → centred (no hint)", () => {
    const { resolved } = pipeline(camFull({ camPos: "middle" }));
    assert.equal(resolved.obsOverlay, undefined);
  });
  for (const [mode, expect] of [["white", "#ffffff"], ["black", "#111111"], ["theme", "#ffd400"], ["#00ff00", "#00ff00"]] as const) {
    check(`camera × text colour ${mode} → ${expect} rendered`, () => {
      const { resolved } = pipeline(camFull({ camText: mode }), { appearance: { ...theme, textColor: "#ffd400" } as ThemeAppearance });
      assert.ok(render(resolved, song).includes(`color:${expect}`));
    });
  }
  check("camera × effect outline → outline shadow rendered", () => {
    const { resolved } = pipeline(camFull({ camEffect: "outline" }));
    assert.ok(render(resolved, song).includes(OBS_OUTLINE_TEXT_SHADOW.slice(0, 30)));
  });
  check("camera × effect none → text-shadow none", () => {
    const { resolved } = pipeline(camFull({ camEffect: "none" }));
    assert.ok(render(resolved, song).includes("text-shadow:none"));
  });
  check("camera × scrim 50% → rgba(0,0,0,0.5) background rendered", () => {
    const { resolved } = pipeline(camFull({ camScrim: 0.5 }));
    assert.ok(render(resolved, song).includes("rgba(0,0,0,0.5)"));
  });
  check("camera × designed slide → colour + scrim reach SlideObjectsLayer path", () => {
    const designed: SlidePayload = { kind: "text", text: "", objects: [
      { kind: "text", x: 0, y: 0, w: 900, h: 200, text: "Line A", color: "#ffffff" },
      { kind: "text", x: 0, y: 300, w: 900, h: 200, text: "Line B", color: "#ffffff" },
    ] } as SlidePayload;
    const { resolved } = pipeline(camFull({ camScrim: 0.3, camText: "#ff00ff" }), { slide: designed });
    const html = render(resolved, designed);
    assert.ok(html.includes("rgba(0,0,0,0.3)")); assert.ok(html.includes("#ff00ff"));
  });

  // ── Over your camera LAYOUT (lower third default / full / positions) ─────
  for (const via of [false, true]) {
    check(`camLayout: new live=1 link defaults to a see-through LOWER THIRD ${via ? "(coerce)" : "(sanitize)"}`, () => {
      const s = readObsEditorStore(null, null, null);
      assert.equal(s.settings.camLayout, "lowerthird", "new install UI default");
      const { resolved } = pipeline({ ...s, look: "camera", lookLive: true }, { url: "bg=transparent&live=1", viaMessage: via });
      assert.equal(resolved.look, "camera"); assert.equal(resolved.camLayout, "lowerthird");
      assert.equal(resolved.transparent, true); assert.equal(resolved.mode, "lower_third");
      assert.equal(resolved.obsBand?.style, "clear", "transparent band");
      assert.equal(resolved.obsBand!.topPct, 100 - resolved.obsBand!.heightPct - 6);
      const html = render(resolved, song);
      assert.ok(html.includes("background:transparent") && html.includes("He reigns forever more"));
    });
  }
  check("camLayout: live=1 link with NO live settings yet → lower third by default", () => {
    const r = resolveObsRender({ url: parseObsUrl(q("bg=transparent&live=1")), fontScale: 1, appearance: theme, themeColors: obsThemeColorsOf(theme), lowerThird: null });
    assert.equal(r.camLayout, "lowerthird"); assert.equal(r.mode, "lower_third"); assert.equal(r.transparent, true); assert.ok(r.obsBand);
  });
  check("camLayout: switch to full → legacy full-frame words (no band), full-frame controls apply", () => {
    const { resolved } = pipeline(camFull({ camScale: 1.5, camPos: "top" }), { url: "bg=transparent&live=1" });
    assert.equal(resolved.camLayout, "full"); assert.equal(resolved.mode, "full"); assert.equal(resolved.obsBand, null);
    assert.equal(resolved.fontScale, 1.5); assert.equal(resolved.obsOverlay?.verticalAlign, "top");
  });
  for (const [pos, h, off, top] of [["upper", 24, 0, 6], ["mid", 24, 0, 38], ["lower", 24, 0, 70], ["custom", 24, 0, 0], ["custom", 24, 50, 38], ["custom", 24, 100, 76], ["upper", 60, 0, 6], ["lower", 60, 0, 34], ["mid", 30, 0, 35]] as const) {
    check(`camLayout: position ${pos} (h=${h}, offset=${off}) → band top ${top}%`, () => {
      assert.equal(camBandTopPct(pos, h, off), top);
      const { resolved } = pipeline(storeWith("camera", { camBandPosition: pos, camBandHeightPct: h, camBandOffsetPct: off }), { url: "live=1" });
      assert.equal(resolved.obsBand?.topPct, top); assert.equal(resolved.obsBand?.heightPct, h);
      const bs = overlayBandSlide(song, resolved.obsBand!, {}, resolved.obsBandExtras) as Extract<SlidePayload, { kind: "text" }>;
      assert.equal(bs.scriptureBand!.topPct, top, "band wire top% the renderer consumes");
      assert.ok(render(resolved, song).includes("He reigns forever more"));
    });
  }
  check("camLayout: band style/opacity/size/text colour reach the rendered band", () => {
    const { resolved } = pipeline(storeWith("camera", { camBandStyle: "black", camBandOpacity: 0.8, camBandScale: 1.5, camText: "#ff0000" }), { url: "live=1" });
    assert.equal(resolved.obsBand?.style, "black"); assert.equal(resolved.obsBand?.fontScale, 1.5);
    const html = render(resolved, song);
    assert.ok(html.includes("opacity:0.8") && html.includes("color:#ff0000"));
  });
  check("camLayout: OLD link (no live=1) stays full-frame unless explicitly changed", () => {
    const old = pipeline(storeWith("camera", { camLayout: "lowerthird", camLayoutSet: false }), { url: "bg=transparent" }).resolved;
    assert.equal(old.mode, "full"); assert.equal(old.obsBand, null); assert.equal(old.camLayout, undefined);
    const picked = pipeline(storeWith("camera", { camLayout: "lowerthird", camLayoutSet: true }), { url: "bg=transparent" }).resolved;
    assert.equal(picked.mode, "lower_third"); assert.ok(picked.obsBand);
    const pickedFull = pipeline(storeWith("camera", { camLayout: "full", camLayoutSet: true }), { url: "bg=transparent" }).resolved;
    assert.equal(pickedFull.mode, "full");
    // camLayout never affects non-camera looks.
    for (const u of ["", "obs=lowerthird", "live=1"]) {
      const r = pipeline(storeWith(u === "live=1" ? "full" : "camera", { camLayout: "lowerthird", camLayoutSet: true, camBandPosition: "upper" }), { url: u }).resolved;
      assert.notEqual(r.look, "camera"); assert.equal(r.camLayout, undefined);
    }
  });
  check("camLayout migration: pre-existing v2 store (no camLayout) keeps full-frame; legacy user too; new install lower third", () => {
    const pre = JSON.stringify({ v: 2, look: "camera", lookLive: true, band: DEFAULT_OBS_BAND, settings: { camScale: 1.4 } });
    const s = readObsEditorStore(pre, null, null);
    assert.equal(s.settings.camLayout, "full"); assert.equal(s.settings.camScale, 1.4);
    assert.equal(pipeline(s, { url: "bg=transparent&live=1" }).resolved.mode, "full", "existing live=1 user keeps full-frame");
    assert.equal(readObsEditorStore(null, null, "camera").settings.camLayout, "full");
    assert.equal(readObsEditorStore(null, null, null).settings.camLayout, "lowerthird");
    const rt = readObsEditorStore(JSON.stringify({ ...s, settings: { ...s.settings, camLayout: "lowerthird", camLayoutSet: true } }), null, null);
    assert.equal(rt.settings.camLayout, "lowerthird"); assert.equal(rt.settings.camLayoutSet, true);
  });

  // ── Full projector look controls ─────────────────────────────────────────
  check("full × text size → compositor fontScale multiplied", () => {
    assert.equal(pipeline(storeWith("full", { fullScale: 1.4 })).resolved.fontScale, 1.4);
  });
  check("full × darken → ONE mechanism: theme dim (no template) OR veil (template), never both", () => {
    const { resolved } = pipeline(storeWith("full", { fullDim: 0.4 }));
    assert.equal(resolved.appearance?.dim, 0.4); assert.equal(resolved.backgroundDim, undefined);
    assert.ok(render(resolved, song).includes("rgba(0,0,0,0.4)"), "theme dim layer");
    const bg = { type: "image", imageUrl: "https://x.test/a.jpg" } as never;
    const t = resolveObsRender({ url: parseObsUrl(q("")), liveLook: { fullDim: 0.4 }, fontScale: 1, appearance: theme, themeColors: obsThemeColorsOf(theme), lowerThird: null, hasTemplateBackground: true });
    assert.equal(t.backgroundDim, 0.4); assert.equal(t.appearance, theme, "theme dim untouched when veil used");
    const html = renderToStaticMarkup(React.createElement(OutputCompositor, { mode: "livestream", slide: song, background: bg, backgroundDim: t.backgroundDim, appearance: t.appearance }));
    assert.ok(html.includes('data-obs-dim="0.4"'), "template veil");
    assert.ok(!html.includes("linear-gradient(rgba(0,0,0,0.4)"), "no stacked theme dim");
    // Monotonic: more slider → never lighter, on both paths.
    let prevA = -1, prevB = -1;
    for (let d = 0; d <= 0.9001; d += 0.05) {
      const a = resolveObsRender({ url: parseObsUrl(q("")), liveLook: { fullDim: d }, fontScale: 1, appearance: { ...theme, dim: 0.2 } as ThemeAppearance, themeColors: {}, lowerThird: null });
      const b = resolveObsRender({ url: parseObsUrl(q("")), liveLook: { fullDim: d }, fontScale: 1, appearance: theme, themeColors: {}, lowerThird: null, hasTemplateBackground: true });
      const da = a.appearance?.dim ?? 0, db = b.backgroundDim ?? 0;
      assert.ok(da >= prevA && db >= prevB, `monotonic at ${d}`); prevA = da; prevB = db;
      assert.ok(!(a.backgroundDim && (a.appearance?.dim ?? 0) > (theme.dim ?? 0)) && !(b.backgroundDim && b.appearance !== theme), "never both");
    }
  });
  check("font cap: stream fontScale × look size never exceeds 4", () => {
    for (const lk of ["camera", "full"] as const) {
      const r = resolveObsRender({ url: parseObsUrl(q(lk === "camera" ? "bg=transparent" : "")), liveLook: { camScale: 2, fullScale: 2 }, fontScale: 3, appearance: theme, themeColors: {}, lowerThird: null });
      assert.equal(r.fontScale, OBS_MAX_FONT_SCALE);
    }
  });

  // ── Operator lower-third title lifetime ──────────────────────────────────
  check("title: send → shows; heartbeat/re-send same slide → stays; different slide → gone, lyrics show; clear → gone", () => {
    const lt = { line1: "Pastor Ade", line2: "Lead Pastor" };
    let held: HeldLowerThird | null = { lt, sendSeq: 4 };
    assert.deepEqual(heldLowerThirdFor(held, 4), lt, "shows (heartbeat / same-position re-send don't bump the counter)");
    const next: SlidePayload = { kind: "text", text: "Amazing grace how sweet" };
    const shown = heldLowerThirdFor(held, 5);
    assert.equal(shown, null, "next send clears");
    const r = pipeline(storeWith("lowerthird"), { url: "obs=lowerthird", slide: next, lowerThird: shown }).resolved;
    const html = render(r, next);
    assert.ok(html.includes("Amazing grace how sweet") && !html.includes("Pastor Ade"), "lyrics show after title cleared");
    held = null; assert.equal(heldLowerThirdFor(held, 4), null, "explicit clear");
  });
  check("title: repeated IDENTICAL slide (chorus / blank) from another position clears the title", () => {
    // Model of OperatorConsole.noteLiveSend: bump on identity change OR different position.
    let seq = 0; let pos: string | null = null; let liveId = slideOutputIdentity({ kind: "empty" });
    const sendAt = (s: SlidePayload, p: string | null) => {
      const id = slideOutputIdentity(s); const idChanged = id !== liveId;
      if (idChanged || (p !== null && p !== pos)) seq++;
      if (p !== null || idChanged) pos = p;
      liveId = id;
    };
    const lt = { line1: "Pastor Ade", line2: "" };
    for (const s of [{ kind: "text", text: "Chorus: how great" }, { kind: "blank" }] as SlidePayload[]) {
      sendAt(s, "0:1");
      const held: HeldLowerThird = { lt, sendSeq: seq };
      sendAt({ ...s } as SlidePayload, "0:1");
      assert.deepEqual(heldLowerThirdFor(held, seq), lt, `${s.kind}: same position re-send keeps title`);
      sendAt({ ...s } as SlidePayload, "0:5");
      assert.equal(slideOutputIdentity(s), liveId, "identical content");
      assert.equal(heldLowerThirdFor(held, seq), null, `${s.kind}: same content, different position clears title`);
    }
  });
  check("publisher: message sent while a trailing editor send is pending survives on remote", () => {
    let now = 0; const timers: { at: number; fn: () => void; id: number }[] = []; let nid = 0;
    const clock = { now: () => now, setTimeout: (fn: () => void, ms: number) => { const id = ++nid; timers.push({ at: now + ms, fn, id }); return id; }, clearTimeout: (h: unknown) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); } };
    const advance = (to: number) => { for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > to) break; timers.shift(); now = t.at; t.fn(); } now = to; };
    const remote: Array<{ camScale: number; operatorMessage: string | null }> = [];
    const pub = createTrailingPublisher<{ camScale: number; operatorMessage: string | null }>((s) => remote.push(s), 125, clock);
    pub.sendNow({ camScale: 1, operatorMessage: null });
    advance(40); pub.schedule({ camScale: 1.2, operatorMessage: null }); // drag → pending
    advance(60); pub.sendNow({ camScale: 1.2, operatorMessage: "Car KJA-123 blocking" }); // sendMessage
    advance(2000);
    assert.equal(remote[remote.length - 1].operatorMessage, "Car KJA-123 blocking", "message not overwritten by the trailing flush");
  });
  check("publisher: dispose flushes the pending trailing value", () => {
    let now = 0; const handles: unknown[] = [];
    const clock = { now: () => now, setTimeout: (_fn: () => void, _ms: number) => { const h = {}; handles.push(h); return h; }, clearTimeout: (h: unknown) => { const i = handles.indexOf(h); if (i >= 0) handles.splice(i, 1); } };
    const sent: number[] = [];
    const p = createTrailingPublisher<number>((v) => sent.push(v), 125, clock);
    p.schedule(1); now = 10; p.schedule(2); p.schedule(3);
    p.dispose();
    assert.deepEqual(sent, [1, 3], "final value flushed on dispose");
    assert.equal(handles.length, 0, "timer cleared");
    p.dispose(); assert.deepEqual(sent, [1, 3], "second dispose is a no-op");
  });
  check("full × settings never leak into camera / lowerthird", () => {
    const { resolved } = pipeline(camFull({ fullScale: 2, fullDim: 0.9 }));
    assert.equal(resolved.fontScale, 1); assert.equal(resolved.backgroundDim, undefined);
  });

  // ── Back-compat: URL-only links render identically ───────────────────────
  const legacyCases = ["", "bg=transparent", "obs=lowerthird", "obs=lowerthird&ltTop=40&ltH=30&ltScale=1.25&ltOpacity=80&ltStyle=frost", "mode=lower_third", "mode=lower_third&bg=transparent"];
  for (const u of legacyCases) {
    check(`back-compat: "${u || "(none)"}" with no live settings == legacy inputs + markup`, () => {
      const p = new URLSearchParams(u);
      let transparent = p.get("bg") === "transparent"; let mode: "full" | "lower_third" = "full";
      if (p.get("mode") === "lower_third") mode = "lower_third";
      if (p.get("obs") === "lowerthird") { mode = "lower_third"; transparent = true; }
      const legacyBand = parseObsBand((k) => p.get(k));
      for (const live of [undefined, null, {} as ObsLookWire, obsLookWireFromStore({ ...storeWith("camera"), lookLive: false })]) {
        const r = resolveObsRender({ url: parseObsUrl(q(u)), liveLook: live, fontScale: 1.2, appearance: theme, themeColors: obsThemeColorsOf(theme), lowerThird: null });
        assert.equal(r.transparent, transparent); assert.equal(r.mode, mode);
        assert.deepEqual(r.obsBand, mode === "lower_third" ? legacyBand : null);
        assert.equal(r.fontScale, 1.2); assert.equal(r.appearance, theme);
        assert.equal(r.obsOverlay, undefined); assert.equal(r.backgroundDim, undefined); assert.equal(r.obsBandExtras, undefined);
        for (const slide of [song, verse]) {
          const legacyHtml = renderToStaticMarkup(React.createElement(OutputCompositor, { mode: "livestream", slide, appearance: theme, fontScale: 1.2, transparent, obsBand: mode === "lower_third" ? legacyBand : null, obsThemeColors: obsThemeColorsOf(theme) }));
          assert.equal(render(r, slide), legacyHtml);
        }
      }
    });
  }
  check("back-compat: an old operator (no obsLook, no band) → URL decides everything", () => {
    const f = applyObsLiveFields({});
    assert.deepEqual(f, { liveBand: null, liveLook: null });
  });

  // ── Migration + store ────────────────────────────────────────────────────
  check("migration: legacy band + look survive into v2; v2 round-trips", () => {
    const legacy = JSON.stringify({ topPct: 5, heightPct: 20, fontScale: 1.3, opacity: 0.4, style: "frost" });
    const s = readObsEditorStore(null, legacy, "lowerthird");
    assert.equal(s.band.style, "frost"); assert.equal(s.look, "lowerthird"); assert.equal(s.lookLive, false);
    const s2 = readObsEditorStore(JSON.stringify({ ...s, lookLive: true, settings: { ...s.settings, camScale: 1.7 } }), null, null);
    assert.equal(s2.lookLive, true); assert.equal(s2.settings.camScale, 1.7); assert.equal(s2.band.style, "frost");
    assert.equal(readObsEditorStore("{garbage", legacy, null).band.style, "frost");
  });

  // ── Fuzz the new wire fields ─────────────────────────────────────────────
  check("fuzz: obsLook through sanitizeOutputState / coerceLiveMessage (20k)", () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const junk = [undefined, null, NaN, Infinity, -1, 0, 0.5, 0.95, 1, 2, 3, "", "auto", "white", "theme", "#fff", "#ff00ff", "#ggg", "red", "rgba(0,0,0,1)", "camera", "lowerthird", "full", "top", "middle", "outline", true, false, [], {}, JSON.parse('{"__proto__":{"x":1}}'), "x".repeat(5000)];
    junk.push("lowerthird", "full", "upper", "mid", "lower", "custom", "grey", "clear", "frost", 10, 24, 50, 60, 61, 100, 101, -0.1);
    const keys = ["look", "ltText", "ltRef", "camScale", "camPos", "camText", "camEffect", "camScrim", "fullScale", "fullDim", "camLayout", "camLayoutSet", "camBandPosition", "camBandOffsetPct", "camBandHeightPct", "camBandScale", "camBandOpacity", "camBandStyle", "evil"];
    const pick = () => junk[Math.floor(rnd() * junk.length)];
    for (let i = 0; i < 20000; i++) {
      const look: Record<string, unknown> = {};
      for (const k of keys) if (rnd() < 0.6) look[k] = pick();
      const obsLook = rnd() < 0.15 ? pick() : look;
      const st = { live: song, aspectRatio: "16:9", lowerThird: null, obsLook };
      const out = sanitizeOutputState(st);
      assert.ok(out, "live slide must survive a bad obsLook");
      assert.ok(isValidOutputState(out), `sanitized must be strictly valid: ${JSON.stringify(obsLook)?.slice(0, 200)}`);
      const msg = coerceLiveMessage({ type: "output", state: st });
      assert.ok(msg && msg.type === "output" && isValidOutputState(msg.state), "coerced message valid");
      // Resolution never throws and always yields clamped numbers.
      const r = resolveObsRender({ url: parseObsUrl(q(rnd() < 0.5 ? "obs=lowerthird" : "bg=transparent")), liveLook: out!.obsLook ?? null, fontScale: 1, appearance: theme, themeColors: obsThemeColorsOf(theme), lowerThird: null });
      assert.ok(Number.isFinite(r.fontScale) && r.fontScale >= 0.5 && r.fontScale <= 2);
      const r2 = resolveObsRender({ url: parseObsUrl(q(rnd() < 0.5 ? "bg=transparent&live=1" : "bg=transparent")), liveLook: out!.obsLook ?? null, fontScale: 1, appearance: theme, themeColors: {}, lowerThird: null });
      if (r2.obsBand) assert.ok(r2.obsBand.topPct >= 0 && r2.obsBand.topPct + r2.obsBand.heightPct <= 100 && Number.isFinite(r2.obsBand.opacity), "camera band on-screen");
      if (msg && msg.type === "output") assert.deepEqual(msg.state.obsLook ?? null, out!.obsLook ?? null, "coerce == sanitize");
      const cs = clampObsLookSettings(out!.obsLook);
      assert.ok(cs.camScrim >= 0 && cs.camScrim <= 0.9 && cs.fullDim >= 0 && cs.fullDim <= 0.9);
    }
    assert.equal(sanitizeObsLook([1]), null);
    assert.equal(isValidOutputState({ live: song, aspectRatio: "16:9", obsLook: { camScale: 9 } }), false, "strict rejects out-of-range");
    for (const bad of [{ camLayout: "side" }, { camLayoutSet: 1 }, { camBandPosition: "left" }, { camBandOffsetPct: 101 }, { camBandHeightPct: 5 }, { camBandScale: NaN }, { camBandOpacity: 2 }, { camBandStyle: "red" }]) {
      assert.equal(isValidOutputState({ live: song, aspectRatio: "16:9", obsLook: bad }), false, `strict rejects ${JSON.stringify(bad)}`);
      assert.deepEqual(sanitizeOutputState({ live: song, aspectRatio: "16:9", obsLook: bad })!.obsLook, {}, "fail-open drops the bad field");
    }
  });

  // ── Remote publish throttle (editor drags) ───────────────────────────────
  check("throttle: 1000 drag updates → ≤ ~8/s remote sends, final value delivered, no reordering", () => {
    let now = 0; const timers: { at: number; fn: () => void; id: number }[] = []; let nid = 0;
    const clock = { now: () => now, setTimeout: (fn: () => void, ms: number) => { const id = ++nid; timers.push({ at: now + ms, fn, id }); return id; }, clearTimeout: (h: unknown) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); } };
    const advance = (to: number) => { for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > to) break; timers.shift(); now = t.at; t.fn(); } now = to; };
    const sent: { v: number; at: number }[] = [];
    const p = createTrailingPublisher<number>((v) => sent.push({ v, at: now }), 125, clock);
    let seed = 5; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 1000; i++) { advance(now + Math.floor(rnd() * 20)); p.schedule(i); }
    const dragEnd = now;
    advance(now + 1000);
    assert.equal(sent[sent.length - 1].v, 999, "final value delivered");
    for (let i = 1; i < sent.length; i++) { assert.ok(sent[i].v > sent[i - 1].v, "monotonic"); assert.ok(sent[i].at - sent[i - 1].at >= 125, "spacing ≥125ms"); }
    assert.ok(sent.length <= Math.ceil(dragEnd / 125) + 2, `rate: ${sent.length} sends over ${dragEnd}ms`);
    // Immediate (slide) send drops the pending older editor value.
    const s2: number[] = []; const p2 = createTrailingPublisher<number>((v) => s2.push(v), 125, clock);
    p2.schedule(1); p2.schedule(2); p2.sendNow(3); advance(now + 1000);
    assert.deepEqual(s2, [1, 3], "no stale trailing value after an immediate send");
  });

  // ── Projector isolation ──────────────────────────────────────────────────
  check("projector (/live mode) render ignores obsLook-derived hints unless passed", () => {
    const a = renderToStaticMarkup(React.createElement(OutputCompositor, { mode: "live", slide: song, appearance: theme }));
    const b = renderToStaticMarkup(React.createElement(OutputCompositor, { mode: "live", slide: song, appearance: theme, obsOverlay: undefined, backgroundDim: undefined, obsBandExtras: undefined }));
    assert.equal(a, b);
    // obsOverlay only acts with transparent → a non-transparent surface is unchanged even if passed.
    const c = renderToStaticMarkup(React.createElement(OutputCompositor, { mode: "live", slide: song, appearance: theme, obsOverlay: { textColor: "#ff0000", scrim: 0.5 } }));
    assert.equal(a, c);
  });

  console.log(`\nobs-editor: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
