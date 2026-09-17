// Shared fixture matrix for the Theme → Projector (PR 2) no-regression proof.
// The baseline JSON (test/fixtures/theme-pr2-baseline.json) was generated from
// main BEFORE PR 2 (scripts: `npx tsx test/theme-pr2-fixtures.ts --write`), so
// test/theme-pr2-parity.test.ts proves every existing input renders
// byte-identically after PR 2.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SlidePayload, ThemeAppearance } from "../src/lib/broadcast";

(globalThis as unknown as { React: typeof React }).React = React;

export const SLIDES: Record<string, SlidePayload> = {
  lyric: { kind: "text", text: "Amazing grace how sweet the sound\nThat saved a wretch like me" },
  scripturePlain: { kind: "text", text: "16 For God so loved the world", reference: "John 3:16 (KJV)" },
  soleText: { kind: "text", text: "Way maker", objects: [{ kind: "text", x: 80, y: 340, w: 1760, h: 400, text: "Way maker", fontFamily: "Inter", color: "#ffffff", align: "center" }] },
  designed: { kind: "text", text: "Hello", objects: [
    { kind: "shape", x: 0, y: 0, w: 1920, h: 200, shape: "rect", fill: "#112233" },
    { kind: "text", x: 100, y: 400, w: 1700, h: 300, text: "Hello", fontSize: 90 },
  ] },
  lowerThird: { kind: "text", text: "For God so loved", reference: "John 3:16", scriptureLayout: "lowerThird", scriptureBand: { topPct: 68, heightPct: 30, fontScale: 1, color: "#000000", opacity: 0.7 } },
  blank: { kind: "blank" },
  empty: { kind: "empty" },
};

export const APPEARANCES: Record<string, ThemeAppearance | null> = {
  none: null,
  basic: { bgType: "solid", bgColor: "#101020", textColor: "#ffeecc", fontFamily: "Inter, sans-serif", fontWeight: 700, align: "left" },
  gradient: { bgType: "gradient", bgColor: "#000000", bgColor2: "#333333", bgAngle: 135, textShadow: false },
};

export const PROP_SETS: Record<string, Record<string, unknown>> = {
  projector: { projectorFit: true },
  projectorScaled: { projectorFit: true, fontScale: 1.3, referenceScale: 1.2, referenceColor: "#ff0000" },
  thumb: { textMinPx: 8 },
  overVideo: { projectorFit: true, overVideo: true },
  overVideoTop: { projectorFit: true, overVideo: true, verticalAlign: "top" },
  transparent: { projectorFit: true, transparentBg: true },
  band: { projectorFit: true, overVideo: true, fitBandFraction: 0.38 },
};

export async function renderMatrix(extraAppearance?: (a: ThemeAppearance | null) => ThemeAppearance | null, extraProps: Record<string, unknown> = {}): Promise<Record<string, string>> {
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  const out: Record<string, string> = {};
  for (const [sk, slide] of Object.entries(SLIDES)) {
    for (const [ak, app] of Object.entries(APPEARANCES)) {
      for (const [pk, props] of Object.entries(PROP_SETS)) {
        const appearance = extraAppearance ? extraAppearance(app) : app;
        out[`${sk}/${ak}/${pk}`] = renderToStaticMarkup(React.createElement(SlideRenderer, { slide, appearance, ...props, ...extraProps }));
      }
    }
  }
  return out;
}

export async function renderCompositorMatrix(extraAppearance?: (a: ThemeAppearance | null) => ThemeAppearance | null): Promise<Record<string, string>> {
  const { OutputCompositor } = await import("../src/components/live/OutputCompositor");
  const out: Record<string, string> = {};
  for (const mode of ["live", "stage", "livestream"] as const) {
    for (const [sk, slide] of Object.entries(SLIDES)) {
      for (const [ak, app] of Object.entries(APPEARANCES)) {
        const appearance = extraAppearance ? extraAppearance(app) : app;
        const props: Record<string, unknown> = { mode, slide, appearance, fontScale: 1 };
        out[`${mode}/${sk}/${ak}`] = renderToStaticMarkup(React.createElement(OutputCompositor, props as never));
        if (mode === "livestream") {
          out[`${mode}-transparent/${sk}/${ak}`] = renderToStaticMarkup(React.createElement(OutputCompositor, { ...props, transparent: true } as never));
        }
      }
    }
  }
  return out;
}

export async function scriptureMatrix(): Promise<Record<string, unknown>> {
  const { applyChurchLayout } = await import("../src/components/operator/scripture/scriptureStyle");
  const { slideOutputIdentity } = await import("../src/lib/broadcast");
  const inputs: Record<string, SlidePayload> = {
    verse: { kind: "text", text: "16 For God so loved the world", reference: "John 3:16 (KJV)" },
    verseNoTrans: { kind: "text", text: "1 In the beginning", reference: "Genesis 1:1" },
    song: { kind: "text", text: "Amazing grace" },
    image: { kind: "image", url: "https://x/a.png" },
  };
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(inputs)) {
    const styled = applyChurchLayout(s, "church-1");
    const norm = JSON.parse(JSON.stringify(styled, (key, v) => (key === "id" ? "ID" : v)));
    out[k] = { styled: norm, identity: slideOutputIdentity(styled) };
  }
  return out;
}

if (process.argv.includes("--write")) {
  (async () => {
    const fs = await import("node:fs");
    const data = { renderer: await renderMatrix(), compositor: await renderCompositorMatrix(), scripture: await scriptureMatrix() };
    fs.writeFileSync(new URL("./fixtures/theme-pr2-baseline.json", import.meta.url), JSON.stringify(data, null, 1));
    console.log("wrote", Object.keys(data.renderer).length, Object.keys(data.compositor).length);
  })();
}
