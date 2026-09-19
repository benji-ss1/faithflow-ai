/**
 * PP7 "Clear Slide keeps the theme's media" — the PURE half
 * (src/lib/pp7-keep-theme-bg.ts + the wire + the layer model). The rendered half
 * is `test/pp7-keep-theme-bg-dom.test.tsx`; the rail/panel half is
 * `test/pp7-keep-theme-bg-rail.test.tsx`.
 *
 * Owner decision 2026-09-19: a theme's background stays on screen when the Slide
 * layer is cleared (F2 / rail / panel row); Clear Media and Clear All remove it;
 * idle stays plain black.
 *
 * Run: npx tsx test/pp7-keep-theme-bg.test.ts
 */
import assert from "node:assert/strict";
import {
  decideSlideClear, isKeepThemeBgSlide, pickOutputAppearance, themeMediaRetainable,
  readPp7KeepThemeBgFlag, PP7_KEEP_THEME_BG_STORAGE_KEY, type SlideClearInputs,
} from "../src/lib/pp7-keep-theme-bg";
import { sanitizeOutputState, sanitizeSlide, slideOutputIdentity, isValidOutputState, isValidLiveMessage, coerceLiveMessage, type SlidePayload, type ThemeAppearance } from "../src/lib/broadcast";
import { planOutput } from "../src/lib/output-plan";
import { PP7_CLEAR_ORDER } from "../src/lib/pp7-clear";
import {
  pp7AnyLive, pp7ClearAll, pp7ClearLayer, pp7LayerActive,
  type Pp7ClearEffects, type Pp7LayerInputs,
} from "../src/lib/pp7-layer-model";

let passed = 0, failed = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log("  PASS ", name); }
  catch (e) { failed++; console.log("  FAIL ", name); console.error(e); }
};

const imageTheme = { bgType: "image", bgImageUrl: "https://x/worship.jpg", textColor: "#fff" } as ThemeAppearance;
const videoTheme = { bgType: "video", bgVideoUrl: "https://x/loop.mp4" } as ThemeAppearance;
const auroraTheme = { bgType: "solid", bgColor: "#101040", bgAnimation: "aurora" } as ThemeAppearance;
const decorTheme = { bgColor: "#101010", layout: { lyrics: { decor: [{ id: "d", type: "image", url: "https://x/d.png", x: 0, y: 0, w: 100, h: 100 }] } } } as unknown as ThemeAppearance;
const solidTheme = { bgType: "solid", bgColor: "#123456" } as ThemeAppearance;
const gradientTheme = { bgType: "gradient", bgColor: "#111", bgColor2: "#333" } as ThemeAppearance;
const textOnlyTheme = { textColor: "#fff", fontFamily: "Inter" } as ThemeAppearance;
const song: SlidePayload = { kind: "text", text: "Amazing grace" };

const base = (o: Partial<SlideClearInputs> = {}): SlideClearInputs => ({
  prev: song, appearance: imageTheme, enabled: true, backgroundTemplateActive: false, cameraActive: false, ...o,
});

// ── which themes carry retainable media ──────────────────────────────────────
check("image / video / animated / decor themes carry media; colour, gradient, text-only do not", () => {
  for (const t of [imageTheme, videoTheme, auroraTheme, decorTheme]) assert.equal(themeMediaRetainable(t), true);
  for (const t of [solidTheme, gradientTheme, textOnlyTheme, null, undefined, {} as ThemeAppearance]) assert.equal(themeMediaRetainable(t), false);
  // An image theme with no URL has no media.
  assert.equal(themeMediaRetainable({ bgType: "image" } as ThemeAppearance), false);
  assert.equal(themeMediaRetainable({ bgType: "video" } as ThemeAppearance), false);
});

// ── the Slide-clear decision ─────────────────────────────────────────────────
check("Slide clear after a themed slide with a background image KEEPS the theme", () => {
  assert.equal(decideSlideClear(base()), "keep");
  for (const t of [videoTheme, auroraTheme, decorTheme]) assert.equal(decideSlideClear(base({ appearance: t })), "keep");
});

check("IDLE never keeps: nothing live / already empty is today's plain black", () => {
  assert.equal(decideSlideClear(base({ prev: { kind: "empty" } })), "plain");
  assert.equal(decideSlideClear(base({ prev: { kind: "empty" }, appearance: null })), "plain");
});

check("a theme without media (colour / gradient / text-only / none) clears exactly as today", () => {
  for (const t of [solidTheme, gradientTheme, textOnlyTheme, null]) assert.equal(decideSlideClear(base({ appearance: t })), "plain");
});

check("KILL SWITCH off => always today's behaviour", () => {
  assert.equal(decideSlideClear(base({ enabled: false })), "plain");
  // …even when the slide is already in the kept state: the caller releases it.
  assert.equal(decideSlideClear(base({ enabled: false, prev: { kind: "empty", keepThemeBg: true } })), "plain");
});

check("a second Slide clear while the theme is kept is a no-op (F2 twice must not drop it)", () => {
  assert.equal(decideSlideClear(base({ prev: { kind: "empty", keepThemeBg: true } })), "noop");
});

check("a slide that owns its background clears WITH that background (baked into the slide)", () => {
  assert.equal(decideSlideClear(base({ prev: { kind: "text", text: "x", bgImageUrl: "https://x/own.jpg" } })), "plain");
  assert.equal(decideSlideClear(base({ prev: { kind: "text", text: "x", bgColor: "#ff0000" } })), "plain");
  // A slide whose image IS the live theme's (baked in by "Apply theme to song",
  // src/lib/theme-bake.ts) is the THEME's media, not the slide's: it keeps.
  assert.equal(decideSlideClear(base({ prev: { kind: "text", text: "x", bgImageUrl: "https://x/worship.jpg", bgColor: "#010101" } })), "keep");
  assert.equal(decideSlideClear(base({ prev: { kind: "text", text: "x", bgImageUrl: "https://x/worship.jpg" } })), "keep");
  // …but a DIFFERENT image is the slide's own.
  assert.equal(decideSlideClear(base({ prev: { kind: "text", text: "x", bgImageUrl: "https://x/other.jpg" } })), "plain");
  // A video/animated theme's baked colour (its bgColor or the #010101 nudge) is the theme's too.
  assert.equal(decideSlideClear(base({ appearance: auroraTheme, prev: { kind: "text", text: "x", bgColor: "#101040" } })), "keep");
  assert.equal(decideSlideClear(base({ appearance: videoTheme, prev: { kind: "text", text: "x", bgColor: "#010101" } })), "keep");
  // The default black bgColor every song/scripture slide carries is "unset".
  assert.equal(decideSlideClear(base({ prev: { kind: "text", text: "x", bgColor: "#000000" } })), "keep");
  // A designed slide whose first object covers the canvas hides the theme.
  const covers = { kind: "text", text: "", objects: [{ id: "i", kind: "image", url: "https://x/f.png", x: 0, y: 0, w: 1920, h: 1080 }] } as unknown as SlidePayload;
  assert.equal(decideSlideClear(base({ prev: covers })), "plain");
});

check("media / logo slides are not Slide-layer content (Slide clear stays plain)", () => {
  for (const prev of [{ kind: "image", url: "https://x/i.jpg" }, { kind: "video", url: "https://x/v.mp4" }, { kind: "logo" }] as SlidePayload[]) {
    assert.equal(decideSlideClear(base({ prev })), "plain");
  }
});

check("a Background Template or a live camera behind the slide: plain (theme bg was not showing)", () => {
  assert.equal(decideSlideClear(base({ backgroundTemplateActive: true })), "plain");
  assert.equal(decideSlideClear(base({ cameraActive: true })), "plain");
});

check("a blank slide keeps the theme only when it has no colour of its own", () => {
  assert.equal(decideSlideClear(base({ prev: { kind: "blank" } })), "keep");
  assert.equal(decideSlideClear(base({ prev: { kind: "blank", bgColor: "#000000" } })), "keep");
  assert.equal(decideSlideClear(base({ prev: { kind: "blank", bgColor: "#ff00ff" } })), "plain");
});

// ── which appearance the outputs emit ────────────────────────────────────────
check("the retained (last live) appearance is emitted ONLY while the theme is kept", () => {
  const dflt = { textColor: "#eee" } as ThemeAppearance;
  const keep: SlidePayload = { kind: "empty", keepThemeBg: true };
  assert.equal(pickOutputAppearance(keep, imageTheme, dflt), imageTheme);
  assert.equal(pickOutputAppearance({ kind: "empty" }, imageTheme, dflt), dflt);
  assert.equal(pickOutputAppearance(song, imageTheme, dflt), dflt);
  assert.equal(pickOutputAppearance(keep, null, dflt), dflt, "nothing retained => normal appearance");
  // Same reference when not kept — flag off / idle is a no-op for memo consumers.
  assert.equal(pickOutputAppearance({ kind: "empty" }, null, dflt), dflt);
});

// ── the wire ─────────────────────────────────────────────────────────────────
check("wire: keepThemeBg is strictly `true`; anything else is dropped, never passed through", () => {
  assert.deepEqual(sanitizeSlide({ kind: "empty", keepThemeBg: true }), { kind: "empty", keepThemeBg: true });
  assert.deepEqual(sanitizeSlide({ kind: "empty" }), { kind: "empty" });
  for (const bad of [false, "yes", 1, null, {}, [], "true"]) {
    assert.deepEqual(sanitizeSlide({ kind: "empty", keepThemeBg: bad }), { kind: "empty" }, JSON.stringify(bad));
  }
  // The flag never leaks onto other kinds.
  assert.equal("keepThemeBg" in (sanitizeSlide({ kind: "text", text: "x", keepThemeBg: true }) as object), false);
  assert.equal("keepThemeBg" in (sanitizeSlide({ kind: "blank", keepThemeBg: true }) as object), false);
});

check("wire: an OutputState carrying the flag validates, sanitizes, and round-trips", () => {
  const st = { live: { kind: "empty", keepThemeBg: true }, next: null, itemTitle: "", slideNumber: "", aspectRatio: "16:9", fitMode: "contain", safeArea: false, operatorMessage: null, lowerThird: null, countdownEndsAt: null, appearance: imageTheme };
  assert.equal(isValidOutputState(st), true);
  assert.equal(sanitizeOutputState(st)?.live.kind, "empty");
  assert.equal(isKeepThemeBgSlide(sanitizeOutputState(st)?.live), true);
  assert.equal(isKeepThemeBgSlide(sanitizeOutputState({ ...st, live: { kind: "empty", keepThemeBg: "x" } })?.live), false);
  // Strict validator rejects a non-true flag; the salvage path recovers the slide.
  assert.equal(isValidOutputState({ ...st, live: { kind: "empty", keepThemeBg: "x" } }), false);
  const set = { type: "set", slide: { kind: "empty", keepThemeBg: true } };
  assert.equal(isValidLiveMessage(set), true);
  const badSet = coerceLiveMessage({ type: "set", slide: { kind: "empty", keepThemeBg: 7 } });
  assert.deepEqual((badSet as { slide: SlidePayload }).slide, { kind: "empty" });
});

check("NO FADE-PULSE: empty and empty-with-theme share one output identity (rule 7)", () => {
  assert.equal(slideOutputIdentity({ kind: "empty" }), slideOutputIdentity({ kind: "empty", keepThemeBg: true }));
  assert.equal(slideOutputIdentity({ kind: "empty", keepThemeBg: true }), "e");
});

check("the output plan does not change for empty-with-theme (only the slide's own paint does)", () => {
  for (const mode of ["live", "stage", "livestream", "ndi"] as const) {
    const a = planOutput({ mode, slide: { kind: "empty" }, appearance: imageTheme });
    const b = planOutput({ mode, slide: { kind: "empty", keepThemeBg: true }, appearance: imageTheme });
    assert.deepEqual(a, b, mode);
  }
});

check("kill-switch reader: env + localStorage semantics (default ON, '0' off, '1' on)", () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null } };
  try {
    delete process.env.NEXT_PUBLIC_PP7_KEEP_THEME_BG;
    assert.equal(readPp7KeepThemeBgFlag(), true, "default ON");
    store.set(PP7_KEEP_THEME_BG_STORAGE_KEY, "0");
    assert.equal(readPp7KeepThemeBgFlag(), false, "per-machine off");
    store.set(PP7_KEEP_THEME_BG_STORAGE_KEY, "1");
    process.env.NEXT_PUBLIC_PP7_KEEP_THEME_BG = "0";
    assert.equal(readPp7KeepThemeBgFlag(), true, "per-machine on wins over env");
    store.delete(PP7_KEEP_THEME_BG_STORAGE_KEY);
    assert.equal(readPp7KeepThemeBgFlag(), false, "env off");
    delete process.env.NEXT_PUBLIC_PP7_KEEP_THEME_BG;
    store.set("presentflow.pp7Layers.v1", "0");
    assert.equal(readPp7KeepThemeBgFlag(), false, "parent PP7 layers off => off");
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete process.env.NEXT_PUBLIC_PP7_KEEP_THEME_BG;
  }
});

// ── the layer model (rail + panel) ───────────────────────────────────────────
function inputs(o: Partial<Pp7LayerInputs> & { rows?: string[] } = {}): Pp7LayerInputs {
  const rows = new Set(o.rows ?? []);
  return {
    kind: o.kind,
    rowActive: o.rowActive ?? ((id) => rows.has(id)),
    announcementActive: o.announcementActive ?? false,
    backgroundSpecActive: o.backgroundSpecActive ?? false,
    videoInputActive: o.videoInputActive ?? false,
    messagesActive: o.messagesActive ?? false,
    pp7DrawOrder: o.pp7DrawOrder,
    themeBgKept: o.themeBgKept,
  };
}
function spy() {
  const calls: string[] = [];
  const fx: Pp7ClearEffects = {
    killSlide: (o) => calls.push(o?.keepTheme === false ? "kill(all)" : "kill"),
    releaseThemeBg: () => calls.push("release"),
    setBackgroundNone: () => calls.push("bgNone"),
    clearLayer: (id) => calls.push(`clearLayer:${id}`),
    clearVideoInput: () => calls.push("clearVideoInput"),
    clearAnnouncement: () => calls.push("clearAnnouncement"),
    clearMessages: () => calls.push("clearMessages"),
    clearLowerThird: () => calls.push("lowerThird"),
  };
  return { calls, fx };
}

check("Slide is IDLE and Media LIT while the theme is kept (Media is discoverable)", () => {
  const a = pp7LayerActive(inputs({ kind: "empty", themeBgKept: true }));
  assert.equal(a.slide, false, "the words are gone");
  assert.equal(a.media, true, "the theme's media is the Media layer");
  assert.equal(pp7AnyLive(a), true);
  // Everything else stays dark.
  assert.deepEqual(PP7_CLEAR_ORDER.filter((l) => a[l]), ["media"]);
});

check("IDLE (nothing sent) is fully dark; a plain empty slide never lights Media", () => {
  assert.equal(pp7AnyLive(pp7LayerActive(inputs({ kind: "empty" }))), false);
  assert.equal(pp7AnyLive(pp7LayerActive(inputs({ kind: undefined }))), false);
  assert.equal(pp7LayerActive(inputs({ kind: "empty", themeBgKept: false })).media, false);
});

check("with the flag absent the mapping is unchanged for every existing shape", () => {
  for (const kind of [undefined, "empty", "blank", "text", "image", "video", "logo"]) {
    for (const rows of [[], ["slide"], ["background"], ["background", "slide"], ["camera", "slide", "logo"]]) {
      for (const bg of [false, true]) {
        for (const cam of [false, true]) {
          const a = pp7LayerActive(inputs({ kind, rows, backgroundSpecActive: bg, videoInputActive: cam }));
          const b = pp7LayerActive(inputs({ kind, rows, backgroundSpecActive: bg, videoInputActive: cam, themeBgKept: false }));
          assert.deepEqual(a, b);
        }
      }
    }
  }
});

check("Clear Slide fires only the slide effect (no release: the theme stays)", () => {
  const { calls, fx } = spy();
  pp7ClearLayer("slide", inputs({ kind: "text", rows: ["slide"] }), fx);
  assert.deepEqual(calls, ["kill"]);
});

check("Clear Media releases the kept theme background (and still clears the template)", () => {
  const { calls, fx } = spy();
  pp7ClearLayer("media", inputs({ kind: "empty", themeBgKept: true }), fx);
  assert.deepEqual(calls, ["bgNone", "release"]);
  // A media slide is still killed, without the keep decision.
  const b = spy();
  pp7ClearLayer("media", inputs({ kind: "image", rows: ["slide", "background"] }), b.fx);
  assert.deepEqual(b.calls, ["bgNone", "clearLayer:background", "kill(all)", "release"]);
});

check("Clear All blanks the slide WITHOUT keeping the theme, then releases anything kept", () => {
  const { calls, fx } = spy();
  pp7ClearAll(inputs({ kind: "text", rows: ["slide"] }), fx);
  assert.ok(calls.includes("kill(all)") && !calls.includes("kill"), "Clear All must not keep the theme");
  assert.ok(calls.indexOf("release") > calls.indexOf("kill(all)"), "release runs after the slide clear");
});

check("Clear Slide alone leaves Media/Props/Announcements/Messages/Video Input untouched", () => {
  const { calls, fx } = spy();
  pp7ClearLayer("slide", inputs({ kind: "text", rows: ["slide", "background", "camera", "logo"], announcementActive: true, messagesActive: true }), fx);
  assert.deepEqual(calls, ["kill"]);
});

console.log(`\nPP7 keep theme background (pure): ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
