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
 * Agreement contract (asserted in tests) — for EACH mode/transparent combo the
 * derived stack must agree with `planOutput()`'s decision for the same input:
 *   - the `background` layer is ENABLED iff planOutput enables its background
 *     layer (active template AND not transparent AND no live camera —
 *     camera-wins-over-template; stage has no camera so a template still shows);
 *   - a `camera` layer is present, enabled iff a live videoInput is set — EXCEPT
 *     stage, which never has a live camera (disabled), matching planOutput's
 *     stage-nulls-videoInput rule (the legacy path fuses the camera into the
 *     slide's over-video render — same signal);
 *   - the `slide` layer is always present + enabled; its `bgTransparent` flag is
 *     set iff planOutput resolves the slide to the over-video render mode (the
 *     layer-model expression of the legacy `overVideo` "slide background goes
 *     transparent so the camera/theme-video shows through");
 *   - a `logo` (theme logo) layer is present at z=20, enabled iff planOutput
 *     enables its theme-logo layer (on for everything EXCEPT transparent keying);
 *   - a lower-third scripture slide surfaces as a `lowerThird` zone on the slide.
 *
 * Mode awareness: pass `opts.mode` ("live" default | "stage" | "livestream" |
 * "ndi") and `opts.transparent` to derive the stack for a specific output
 * surface, mirroring planOutput's per-mode precedence (stage: camera disabled;
 * transparent livestream/ndi: background + logo disabled).
 *
 * ── Phase 3 opt-in (documented here, NOT built yet) ─────────────────────────
 * `LAYERS_V2` below stays a GLOBAL env kill-switch. When Phase 3 flips the
 * compositor to render from this derived stack, the render swap gates on BOTH
 * the env flag AND a per-church, DB-backed `layersV2` setting (a church-settings
 * boolean, so a single church can opt in on real hardware before it is a
 * platform default). The DB field is deliberately NOT created in Phase 2 — this
 * is the recorded decision, so no church path changes until Phase 3 wires it.
 * See docs/DECOUPLING_PLAN.md "Phase 2 — as built".
 */
import type { LayerWire, OutputState } from "@/lib/broadcast";

/**
 * Phase 3 render-swap flag. Default OFF: today NOTHING renders from the layer
 * model. Routes store incoming layer-patch overrides but gate any future
 * consumption behind this GLOBAL kill-switch (read from the public env at build
 * time). Phase 3 additionally gates per-church on a DB-backed `layersV2` setting
 * (see the header note) — that field is not built yet.
 */
export const LAYERS_V2: boolean = process.env.NEXT_PUBLIC_LAYERS_V2 === "1";

/** Output surface the derived stack is for. Mirrors planOutput's CompositorMode. */
export type LayersMode = "live" | "stage" | "livestream" | "ndi";
export interface LayersOpts {
  mode?: LayersMode;
  /** OBS/NDI alpha keying (livestream/ndi only) — background + logo suppressed. */
  transparent?: boolean;
}

// z-order for the derived stack. Matches the legacy compositor intent:
// background (0) < camera (5) < slide (10) < logo (20) < overlays (30+).
const Z_BACKGROUND = 0;
const Z_CAMERA = 5;
const Z_SLIDE = 10;
const Z_LOGO = 20;
const Z_ANNOUNCEMENT = 30;

/**
 * Derive the ordered LayerWire[] for an output composite from legacy
 * OutputState fields. Ascending z; disabled layers are KEPT in the list (stable
 * identity — mirrors planOutput, which keeps disabled layers in its list too).
 */
export function outputStateToLayers(state: OutputState, opts?: LayersOpts): LayerWire[] {
  const mode: LayersMode = opts?.mode ?? "live";
  // Transparent keying only exists for livestream/ndi (parity with planOutput).
  const transparent = (mode === "livestream" || mode === "ndi") && !!opts?.transparent;

  const background = state.background ?? null;
  // Stage (confidence monitor) never has a live camera — planOutput nulls it
  // there, so the derived camera layer must be disabled on stage too.
  const rawVideo = state.videoInput ?? null;
  const videoInput = mode === "stage" ? null : rawVideo;
  const appearance = state.appearance ?? null;

  const bgActive = !!background && background.type !== "none";
  // camera-wins-over-background-template + transparent suppresses bg (parity).
  const backgroundEnabled = bgActive && !transparent && !videoInput;

  // over-video resolution — mirrors planOutput's `videoBehind`: a live camera or
  // a theme video sits behind the slide, no template showing, not transparent,
  // not stage. That is exactly when the slide's own background goes transparent.
  const hasVideoBehind = !!videoInput || (appearance?.bgType === "video" && !!appearance.bgVideoUrl);
  const overVideo = mode !== "stage" && !transparent && hasVideoBehind && !backgroundEnabled;

  // Theme logo: on for everything except transparent keying modes (parity).
  const showThemeLogo = !transparent;

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
  // scrub on the Realtime/LAN fan-out in scrubOutputStateForRemote).
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
    bgTransparent: overVideo,
    transportScope: "all",
  });

  // Theme logo layer (over the slide). Present with stable identity; enabled
  // agrees with planOutput's theme-logo decision.
  layers.push({
    id: "logo",
    kind: "logo",
    z: Z_LOGO,
    enabled: showThemeLogo,
    transportScope: "all",
  });

  // Announcement overlay (over the logo) — enabled iff one is set.
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
