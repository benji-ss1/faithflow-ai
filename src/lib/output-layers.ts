/**
 * output-layers — the PURE legacy→layers adapter (Decoupling Phase 2).
 *
 * `outputStateToLayers()` derives the additive `LayerWire[]` model from the
 * legacy monolithic OutputState fields. It is the SPEC DOCUMENTATION + future
 * migration seam for Phase 3: the compositor still renders from the legacy
 * fields today (see docs/DECOUPLING_PLAN.md), so this function is NOT yet
 * consumed at render time. It exists so the derived layer stack can be locked in
 * against `planOutput()`'s precedence decisions (test/output-layers.test.ts)
 * BEFORE any renderer switches over.
 *
 * No React / no browser APIs — pure + deterministic, node-testable.
 *
 * Agreement contract (asserted in tests): for the projector ("live") composite,
 *   - the `background` layer is ENABLED iff planOutput enables its background
 *     layer (active template AND no live camera — camera-wins-over-template);
 *   - a `camera` layer is present+enabled iff a live videoInput is set (the
 *     legacy path fuses it into the slide's over-video render — same signal);
 *   - the `slide` layer is always present + enabled;
 *   - a lower-third scripture slide surfaces as a `lowerThird` zone on the slide.
 */
import type { LayerWire, OutputState } from "@/lib/broadcast";

/**
 * Phase 3 render-swap flag. Default OFF: today NOTHING renders from the layer
 * model. Routes store incoming layer-patch overrides but gate any future
 * consumption behind this. Read from the public env at build time.
 */
export const LAYERS_V2: boolean = process.env.NEXT_PUBLIC_LAYERS_V2 === "1";

// z-order for the derived stack. Matches the legacy compositor intent:
// background (0) < camera (5) < slide (10) < overlay bands/announcements (20+).
const Z_BACKGROUND = 0;
const Z_CAMERA = 5;
const Z_SLIDE = 10;
const Z_ANNOUNCEMENT = 20;

/**
 * Derive the ordered LayerWire[] for the projector composite from legacy
 * OutputState fields. Ascending z; disabled layers are KEPT in the list (stable
 * identity — mirrors planOutput, which keeps disabled layers in its list too).
 */
export function outputStateToLayers(state: OutputState): LayerWire[] {
  const background = state.background ?? null;
  const videoInput = state.videoInput ?? null;
  const bgActive = !!background && background.type !== "none";
  // camera-wins-over-background-template (parity with planOutput).
  const backgroundEnabled = bgActive && !videoInput;

  const layers: LayerWire[] = [];

  // Background template layer (behind everything).
  layers.push({
    id: "background",
    kind: "background",
    z: Z_BACKGROUND,
    enabled: backgroundEnabled,
    payload: background,
    transportScope: "all",
  });

  // Live camera layer. Present whenever a camera is selected; a local deviceId
  // is meaningless off-box, so it is same-machine only (mirrors the videoInput
  // scrub on the Realtime/LAN fan-out in OperatorConsole).
  layers.push({
    id: "camera",
    kind: "camera",
    z: Z_CAMERA,
    enabled: !!videoInput,
    payload: videoInput,
    transportScope: "local",
  });

  // The slide/content layer — always present, always painting.
  const isLowerThird = state.live.kind === "text" && state.live.scriptureLayout === "lowerThird";
  layers.push({
    id: "slide",
    kind: "slide",
    z: Z_SLIDE,
    enabled: true,
    payload: state.live,
    zone: isLowerThird ? { kind: "lowerThird" } : { kind: "full" },
    transportScope: "all",
  });

  // Announcement overlay (over the slide) — enabled iff one is set.
  if (state.announcement) {
    layers.push({
      id: "announcement",
      kind: "announcement",
      z: Z_ANNOUNCEMENT,
      enabled: true,
      payload: state.announcement,
      transportScope: "all",
    });
  }

  return layers;
}
