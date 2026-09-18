/**
 * The shared fixture MATRIX for the PP7 draw-order parity tests.
 *
 * Every combination of mode × slide × background × appearance × camera ×
 * transparent × transitions × aspect that the four output routes can produce.
 * `test/fixtures/output-plan-main.golden.json` is the byte-record of what
 * `planOutput()` returned for this matrix on `main` BEFORE the draw-order
 * change — the flag-off path must still reproduce it exactly.
 */
import type { SlidePayload, ThemeAppearance, VideoInputState, BackgroundSpec } from "../src/lib/broadcast";
import type { PlanInput, CompositorMode } from "../src/lib/output-plan";

const slides: SlidePayload[] = [
  { kind: "empty" },
  { kind: "blank" },
  { kind: "text", text: "John 3:16" },
  { kind: "text", text: "band", scriptureLayout: "lowerThird" },
  { kind: "image", url: "https://x/i.png" },
  { kind: "video", url: "https://x/v.mp4" },
  { kind: "logo" },
];
const backgrounds: (BackgroundSpec | null)[] = [
  null,
  { type: "none" } as BackgroundSpec,
  { type: "shader", shaderPreset: "aurora" } as BackgroundSpec,
  { type: "video", videoUrl: "https://x/bg.mp4" } as BackgroundSpec,
  { type: "image", imageUrl: "https://x/bg.png" } as BackgroundSpec,
];
const appearances: (ThemeAppearance | null)[] = [
  null,
  { textColor: "#fff", bgColor: "#000" } as ThemeAppearance,
  { textColor: "#fff", bgType: "video", bgVideoUrl: "https://x/t.mp4" } as ThemeAppearance,
  { textColor: "#fff", logoUrl: "https://x/logo.png", logoPosition: "bottom-right" } as ThemeAppearance,
  // A theme carrying DECOR (theme gaps PR A) — it plans an extra `theme-decor`
  // layer, so the matrix has to exercise it or the goldens would never see it.
  {
    textColor: "#fff", bgColor: "#101010",
    layout: { lyrics: { decor: [{ id: "d1", type: "image", url: "https://x/decor.png", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] } },
  } as unknown as ThemeAppearance,
];
const cameras: (VideoInputState | null)[] = [
  null,
  { deviceId: "cam-1" } as VideoInputState,
  { deviceId: "cam-1", overlay: "full" } as VideoInputState,
  { deviceId: "cam-1", overlay: "lower_third" } as unknown as VideoInputState,
];
const modes: CompositorMode[] = ["live", "stage", "livestream", "ndi"];

/** The full cross-product, in a STABLE order (the golden file depends on it). */
export function matrix(): PlanInput[] {
  const out: PlanInput[] = [];
  for (const mode of modes) {
    for (const slide of slides) {
      for (const background of backgrounds) {
        for (const appearance of appearances) {
          for (const videoInput of cameras) {
            for (const transparent of [false, true]) {
              for (const transitionsEnabled of [false, true]) {
                for (const aspectRatio of ["16:9", "4:3"] as const) {
                  out.push({ mode, slide, background, appearance, videoInput, transparent, transitionsEnabled, aspectRatio });
                }
              }
            }
          }
        }
      }
    }
  }
  return out;
}

/** A stable, human-readable key for one fixture (used in failure messages). */
export function keyOf(i: PlanInput): string {
  return [
    i.mode, i.slide.kind, (i.slide as { scriptureLayout?: string }).scriptureLayout ?? "-",
    i.background?.type ?? "-", i.appearance?.bgType ?? (i.appearance ? "theme" : "-"),
    i.appearance?.logoUrl ? "logo" : "-",
    i.videoInput ? `cam:${(i.videoInput as { overlay?: string }).overlay ?? "default"}` : "-",
    i.transparent ? "key" : "-", i.transitionsEnabled ? "tx" : "-", i.aspectRatio,
  ].join("|");
}
