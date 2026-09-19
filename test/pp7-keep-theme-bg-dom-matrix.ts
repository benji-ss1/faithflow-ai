/**
 * DOM fixture matrix for the "Clear Slide keeps the theme's media" parity tests.
 *
 * Every fixture is a route-shaped OutputCompositor prop set showing an EMPTY
 * slide (what the projector shows after a Slide clear). `test/fixtures/
 * output-dom-empty-main.golden.json` is what `main` rendered for each BEFORE the
 * feature existed. Types only — importable on `main` to (re)generate the golden.
 */
import type { BackgroundSpec, SlidePayload, ThemeAppearance, VideoInputState } from "../src/lib/broadcast";
import type { CompositorMode } from "../src/lib/output-plan";

export interface EmptyFixture {
  name: string;
  mode: CompositorMode;
  slide: SlidePayload;
  appearance?: ThemeAppearance | null;
  background?: BackgroundSpec | null;
  videoInput?: VideoInputState | null;
  transparent?: boolean;
  transition?: { effectId: string; durationMs: number; easing: string } | null;
}

export const imageTheme = { textColor: "#fff", bgType: "image", bgImageUrl: "https://x/worship-bg.jpg", logoUrl: "https://x/logo.png", logoPosition: "bottom-right" } as ThemeAppearance;
export const videoTheme = { textColor: "#fff", bgType: "video", bgVideoUrl: "https://x/theme-loop.mp4" } as ThemeAppearance;
export const auroraTheme = { textColor: "#fff", bgType: "solid", bgColor: "#101040", bgAnimation: "aurora" } as ThemeAppearance;
export const decorTheme = {
  textColor: "#fff", bgType: "image", bgImageUrl: "https://x/worship-bg.jpg",
  layout: { lyrics: { decor: [{ id: "d1", type: "image", url: "https://x/decor.png", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] } },
} as unknown as ThemeAppearance;
export const solidTheme = { textColor: "#fff", bgType: "solid", bgColor: "#123456" } as ThemeAppearance;
export const media = { type: "image", imageUrl: "https://x/global-bg.png" } as BackgroundSpec;
export const cam = { deviceId: "cam-1" } as VideoInputState;
const empty: SlidePayload = { kind: "empty" };

export function emptyMatrix(): EmptyFixture[] {
  const out: EmptyFixture[] = [];
  for (const mode of ["live", "stage", "livestream", "ndi"] as const) {
    out.push(
      { name: "image theme", mode, slide: empty, appearance: imageTheme },
      { name: "video theme", mode, slide: empty, appearance: videoTheme },
      { name: "animated theme", mode, slide: empty, appearance: auroraTheme },
      { name: "decor theme", mode, slide: empty, appearance: decorTheme },
      { name: "solid colour theme", mode, slide: empty, appearance: solidTheme },
      { name: "no theme", mode, slide: empty, appearance: null },
      { name: "image theme + global media", mode, slide: empty, appearance: imageTheme, background: media },
      { name: "image theme + camera", mode, slide: empty, appearance: imageTheme, videoInput: cam },
      { name: "image theme + fade", mode, slide: empty, appearance: imageTheme, transition: { effectId: "fade", durationMs: 600, easing: "ease" } },
    );
    if (mode === "livestream" || mode === "ndi") {
      out.push(
        { name: "image theme transparent", mode, slide: empty, appearance: imageTheme, transparent: true },
        { name: "decor theme transparent", mode, slide: empty, appearance: decorTheme, transparent: true },
        { name: "image theme + global media transparent", mode, slide: empty, appearance: imageTheme, background: media, transparent: true },
      );
    }
  }
  return out;
}

export function emptyKey(f: EmptyFixture): string {
  return `${f.mode}|${f.name}`;
}
