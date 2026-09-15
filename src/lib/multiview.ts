/**
 * MultiView — operator monitor wall (2026-09-15).
 *
 * Pure resolution of "what does each output screen show right now" from the
 * operator's OWN last-published OutputState (publishObsPreviewState — same
 * window, zero network, BroadcastChannel stays primary per CLAUDE.md rule 8).
 * Each resolver mirrors the matching route's OutputCompositor props:
 *   main       → src/app/live/page.tsx
 *   stage      → src/app/stage/page.tsx
 *   livestream → src/app/livestream/page.tsx (+ ObsOverlayCard preview rule:
 *                the OBS editor's selected look decides the look)
 *   ndi        → src/app/ndi/page.tsx (default Transparent Graphics mode)
 *
 * READ-ONLY: nothing here posts, persists output state, or opens a camera.
 * Previews never pass videoInput (each would open its own getUserMedia stream);
 * the tile shows a "camera" badge instead.
 */
import type { OutputState, SlidePayload, ThemeAppearance } from "./broadcast";
import { sanitizeOutputState } from "./broadcast";
import type { OutputCompositorProps } from "@/components/live/OutputCompositor";
import { DEFAULT_OBS_BAND, livestreamRenderPlan } from "./obs-lowerthird";
import { resolveObsRender, obsThemeColorsOf, type ObsEditorStore } from "./obs-look";

export type MultiViewScreen = "main" | "stage" | "livestream" | "ndi";
export const MULTIVIEW_SCREENS: MultiViewScreen[] = ["main", "stage", "livestream", "ndi"];
export const MULTIVIEW_LABELS: Record<MultiViewScreen, string> = {
  main: "Main",
  stage: "Stage",
  livestream: "Livestream",
  ndi: "NDI",
};

export const PREVIEW_SCREEN_KEY = "presentflow.pro.previewScreen.v1";
export const MULTIVIEW_KILL_KEY = "presentflow.pro.multiview.v1";

/** Default ON; kill-switch = localStorage "0" or NEXT_PUBLIC_MULTIVIEW="0". */
export function multiviewEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_MULTIVIEW === "0") return false;
  try {
    if (typeof window !== "undefined" && window.localStorage.getItem(MULTIVIEW_KILL_KEY) === "0") return false;
  } catch { /* storage blocked → default on */ }
  return true;
}

export function isMultiViewScreen(v: unknown): v is MultiViewScreen {
  return typeof v === "string" && (MULTIVIEW_SCREENS as string[]).includes(v);
}

/** Coerce whatever publishObsPreviewState last stored into a safe OutputState. */
export function coercePreviewState(raw: unknown): OutputState | null {
  if (!raw || typeof raw !== "object") return null;
  try { return sanitizeOutputState(raw) ?? null; } catch { return null; }
}

export type ScreenView = {
  props: OutputCompositorProps;
  /** Stage-only chrome worth showing in a preview. */
  stage?: { next: SlidePayload | null; operatorMessage: string | null };
  /** Livestream full-mode lower third drawn by the route over the slide. */
  lowerThird?: { line1: string; line2: string } | null;
  /** True when the output keys over something (OBS camera / NDI alpha). */
  transparent: boolean;
  /** The live output uses a camera the preview deliberately doesn't open. */
  cameraHidden: boolean;
  /** Human sub-label, e.g. livestream look. */
  detail?: string;
  empty: boolean;
};

const EMPTY: SlidePayload = { kind: "empty" };

export function resolveScreenView(
  screen: MultiViewScreen,
  state: OutputState | null,
  opts: { layersEnabled: boolean; layerOverrides?: OutputCompositorProps["layerOverrides"]; obsStore?: ObsEditorStore | null },
): ScreenView {
  const s = state;
  const slide = s?.live ?? EMPTY;
  const fontScale = typeof s?.fontScale === "number" ? s.fontScale : 1;
  const referenceScale = typeof s?.referenceScale === "number" ? s.referenceScale : 1;
  const referenceColor = typeof s?.referenceColor === "string" ? s.referenceColor : undefined;
  const appearance: ThemeAppearance | null = s?.appearance ?? null;
  const background = s?.background ?? null;
  const layers = {
    layersEnabled: opts.layersEnabled,
    layerOverrides: opts.layersEnabled ? (opts.layerOverrides ?? undefined) : undefined,
  };
  const common = { transition: null, videoInput: null, videoMuted: true, previewFrozen: true } as const;
  const hasCamera = !!s?.videoInput;
  const empty = slide.kind === "empty";

  switch (screen) {
    case "main":
      return {
        props: {
          ...common, ...layers, mode: "live", slide, appearance, background, fontScale,
          referenceScale, referenceColor, zone: s?.zone ?? null, aspectRatio: s?.aspectRatio,
        },
        transparent: false, cameraHidden: hasCamera, empty,
      };
    case "stage":
      return {
        props: {
          ...common, ...layers, mode: "stage", slide, appearance, background, fontScale,
          referenceScale, referenceColor, zone: s?.zone ?? null,
        },
        stage: { next: s?.next ?? null, operatorMessage: s?.operatorMessage ?? null },
        transparent: false, cameraHidden: false, empty,
      };
    case "ndi":
      return {
        props: { ...common, ...layers, mode: "ndi", slide, appearance, background, fontScale, transparent: true },
        transparent: true, cameraHidden: false, detail: "Graphics", empty,
      };
    case "livestream": {
      const store = opts.obsStore ?? null;
      const look = store?.look ?? "full";
      const themeColors = obsThemeColorsOf(appearance);
      const lowerThird = s?.lowerThird ?? null;
      const r = resolveObsRender({
        url: { transparent: look !== "full", mode: look === "lowerthird" ? "lower_third" : "full", band: store?.band ?? DEFAULT_OBS_BAND, live: true },
        liveLook: store ? { ...store.settings, look } : null,
        liveBand: store?.band ?? null,
        fontScale, appearance, themeColors, lowerThird,
        hasTemplateBackground: !!background,
      });
      // Route parity (livestream/page.tsx): lower-third mode drops backdrops and
      // substitutes the operator lower third for the slide text.
      const { showBackdrop, showFullOverlays } = livestreamRenderPlan(r.mode, slide, lowerThird, r.obsBand ?? DEFAULT_OBS_BAND, themeColors);
      const lt1 = typeof lowerThird?.line1 === "string" ? lowerThird.line1.trim() : "";
      const lt2 = typeof lowerThird?.line2 === "string" ? lowerThird.line2.trim() : "";
      const compositorSlide: SlidePayload = r.mode === "lower_third" && lt1 && !r.obsBandExtras?.lowerThird
        ? { kind: "text", text: lt2 ? `${lt1}\n${lt2}` : lt1 }
        : slide;
      const compositorAppearance = !showBackdrop && r.appearance
        ? { ...r.appearance, logoUrl: undefined, bgVideoUrl: undefined }
        : r.appearance;
      return {
        props: {
          ...common, ...layers, mode: "livestream", slide: compositorSlide, appearance: compositorAppearance,
          background: showBackdrop ? background : null, fontScale: r.fontScale, referenceScale, referenceColor,
          transparent: r.transparent, obsBand: r.obsBand, obsThemeColors: themeColors,
          obsBandExtras: r.obsBandExtras, obsOverlay: r.obsOverlay, backgroundDim: r.backgroundDim,
        },
        lowerThird: r.mode === "full" && showFullOverlays ? lowerThird : null,
        transparent: r.transparent,
        cameraHidden: hasCamera && showBackdrop,
        detail: look === "camera" ? "Over camera" : look === "lowerthird" ? "Lower third" : "Full look",
        empty,
      };
    }
  }
}
