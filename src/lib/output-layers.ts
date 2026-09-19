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
import { MAX_LAYERS, REV_MAX_SKEW_MS, type LayerWire, type OutputState } from "@/lib/broadcast";

/**
 * Fold ONE incoming `layer-patch` into a projector's id-keyed override map,
 * bounded so a hostile same-channel sender cannot grow the map without limit:
 * an EXISTING id may always be updated; a NEW id is dropped once the map is full
 * (mirrors MAX_LAYERS on the OutputState.layers array). Extracted so all four
 * output routes share one implementation (was inlined + duplicated). Mutates
 * `map` in place; returns it for chaining.
 */
export function applyLayerPatchBounded(
  map: Map<string, LayerWire>,
  patch: LayerWire,
): Map<string, LayerWire> {
  const existing = map.get(patch.id);
  // Rev gate (Phase 3 hardening): when BOTH the incoming patch and the stored
  // layer carry a monotonic `rev`, DROP the patch if it is older — a lagging
  // heartbeat / ghost-tab snapshot can never regress a fresher incremental
  // patch. Missing rev on either side is tolerant (apply — legacy behaviour).
  // SELF-HEAL (Y1a): if the STORED rev exceeds the incoming rev by more than the
  // sanity window, the stored one cannot be an honest Date.now()-seeded rev — it
  // was pinned by a hostile 2^52 patch or a wrong-clock-year sender. An honest
  // (lower) rev is then allowed to take over WITHOUT a reload, so a bad stamp can
  // never permanently pin a layer. Honest revs (within the window) are unaffected.
  if (existing && typeof existing.rev === "number" && typeof patch.rev === "number" && patch.rev < existing.rev) {
    if (existing.rev - patch.rev <= REV_MAX_SKEW_MS) return map; // normal: older patch loses
    // else fall through — stored rev is stale/hostile, adopt the honest patch
  }
  if (map.has(patch.id) || map.size < MAX_LAYERS) map.set(patch.id, patch);
  return map;
}

/**
 * Rebuild a projector's id-keyed override map from a full-OutputState heartbeat
 * snapshot's `layers` (late-join / self-heal convergence): clear, then re-add
 * each layer under the same MAX_LAYERS bound. Extracted from the 4× duplicated
 * inline block in /live, /stage, /livestream, /ndi. Mutates `map` in place and
 * returns the fresh values array the route stores in React state to re-render.
 */
/** A mutable holder for the receiver's last-folded origin epoch (Y1b). Kept in a
 *  route-level ref alongside the override map so successive snapshots can compare
 *  epochs. `current` starts undefined (no epoch seen yet). */
export interface EpochRef { current: number | undefined; }

/**
 * Ghost-operator guard (field wave 6B). True when an incoming "output" snapshot
 * comes from a STRICTLY-OLDER operator origin epoch than the one this receiver
 * has already accepted — i.e. a stale/duplicate operator tab left open on the
 * same BroadcastChannel. Such a ghost answers the projector's ping heartbeats
 * with its own full snapshot (typically live:{kind:"empty"} + no overrides),
 * which — applied blindly — CLOBBERS the projector's base live slide/background/
 * camera/logo. Because a slide/media layer "show" (eye re-enable) carries no
 * payload (R1a), that left the operator's eye-toggle with no base to restore and
 * the projector black. `rebuildOverridesFromSnapshot` already rejects an older
 * tab's OVERRIDE snapshot by epoch (Y1b); this lets the routes apply the SAME
 * authority to the WHOLE snapshot (base slide + non-layer fields).
 *
 * Provably inert on the legacy path: returns false whenever either epoch is
 * absent (LAYERS_V2 off ⇒ no epoch on the wire) or equal (single operator), so
 * gating on it never changes single-operator / engine-off behaviour. A fresh or
 * higher-epoch operator is never stale, so a real operator refresh still wins.
 */
export function isStaleLayersSnapshot(
  snapEpoch: number | undefined,
  storedEpoch: number | undefined,
): boolean {
  return (
    typeof snapEpoch === "number" &&
    typeof storedEpoch === "number" &&
    snapEpoch < storedEpoch
  );
}

export function rebuildOverridesFromSnapshot(
  map: Map<string, LayerWire>,
  layers: LayerWire[] | undefined | null,
  opts?: { snapEpoch?: number; epochRef?: EpochRef },
): LayerWire[] {
  // Array.isArray guard: a malformed wire snapshot (e.g. layers: 42) must not
  // throw inside the receiver — treat it as "no overrides".
  // Entries that aren't objects with a string id (null, 7, …) are dropped too.
  const snap: LayerWire[] = Array.isArray(layers)
    ? layers.filter((l): l is LayerWire => !!l && typeof l === "object" && typeof (l as { id?: unknown }).id === "string")
    : [];
  // ── Origin-epoch authority (Y1b) ─────────────────────────────────────────
  // The epoch identifies the operator TAB that produced this snapshot. When it
  // is present we can make a snapshot from a NEWER tab authoritative even if it
  // carries NO overrides — restoring the "operator refresh clears the projector
  // map" invariant WITHOUT reopening the ghost-clobber (an OLDER tab's snapshot
  // is ignored, never merged). A SAME-epoch snapshot keeps the rev-gated merge
  // below. Absent epoch (legacy sender / engine off) ⇒ merge path (unchanged).
  const snapEpoch = opts?.snapEpoch;
  const epochRef = opts?.epochRef;
  if (typeof snapEpoch === "number" && epochRef) {
    const storedEpoch = epochRef.current;
    if (storedEpoch === undefined || snapEpoch > storedEpoch) {
      // Newer (or first-seen) tab — authoritatively REPLACE. Clear the map and
      // adopt only this snapshot's entries (empty snapshot ⇒ cleared map).
      map.clear();
      for (const l of snap) applyLayerPatchBounded(map, l);
      epochRef.current = snapEpoch;
      return Array.from(map.values());
    }
    if (snapEpoch < storedEpoch) {
      // Older tab (ghost) — ignore entirely so it can't clobber the live tab.
      return Array.from(map.values());
    }
    // snapEpoch === storedEpoch → fall through to the rev-gated merge.
  }
  // Highest rev present in the snapshot. Used to decide whether the snapshot is
  // new enough to honour a REMOVAL (a layer the map has but the snapshot omits).
  // Legacy snapshots (no revs) → -Infinity, so a map entry that carries a rev
  // (a fresh live patch) is never removed by an un-revved snapshot; a fully
  // legacy map (no revs) still clears+rebuilds exactly as before.
  let snapMaxRev = Number.NEGATIVE_INFINITY;
  const snapIds = new Set<string>();
  for (const l of snap) {
    snapIds.add(l.id);
    if (typeof l.rev === "number" && l.rev > snapMaxRev) snapMaxRev = l.rev;
  }
  // 1. Removals: drop map entries the snapshot no longer includes — but ONLY
  //    when the snapshot is at least as new as that entry. A map entry whose rev
  //    exceeds the snapshot's max is from a patch the snapshot hasn't folded yet
  //    → keep it (don't let a stale snapshot un-do a fresh patch).
  for (const [id, cur] of map) {
    if (snapIds.has(id)) continue;
    if (typeof cur.rev !== "number" || snapMaxRev >= cur.rev) map.delete(id);
  }
  // 2. Adopt snapshot entries, rev-gated + bounded (a stale snapshot entry can't
  //    overwrite a fresher stored patch of the same id).
  for (const l of snap) applyLayerPatchBounded(map, l);
  return Array.from(map.values());
}

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
  /** PP7 draw order (src/lib/pp7-draw-order.ts): Video Input below Media, and
   *  Announcements below Props. Off ⇒ the legacy derivation, byte-identical. */
  pp7DrawOrder?: boolean;
}

// z-order for the derived stack. Matches the legacy compositor intent:
// background (0) < camera (5) < slide (10) < logo (20) < overlays (30+).
const Z_BACKGROUND = 0;
const Z_CAMERA = 5;
const Z_SLIDE = 10;
const Z_LOGO = 20;
const Z_ANNOUNCEMENT = 30;
// …and under the PP7 draw order, where the camera is the back wall (below the
// media) and announcements sit below the props. Keeps the operator's Layers
// panel — which lists these rows by descending z — honest about what covers what.
const Z_CAMERA_PP7 = -10;
const Z_ANNOUNCEMENT_PP7 = 15;

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
  // PP7 draw order (2026-09-18): Media draws ABOVE Video Input, so a live camera
  // no longer suppresses the template — it is simply covered by it. This is what
  // lets the clear rail read "media is live" off THIS row alone, instead of the
  // three-way OR it used to need. Flag off ⇒ the legacy camera-wins rule.
  // Transparent keying suppresses the background either way (parity).
  const pp7 = !!opts?.pp7DrawOrder;
  const backgroundEnabled = bgActive && !transparent && (pp7 || !videoInput);

  // over-video resolution — mirrors planOutput's `videoBehind`: a live camera or
  // a theme video sits behind the slide, no template showing, not transparent,
  // not stage. That is exactly when the slide's own background goes transparent.
  const hasVideoBehind = !!videoInput || (appearance?.bgType === "video" && !!appearance.bgVideoUrl);
  const overVideo = pp7
    ? mode !== "stage" && !transparent && (hasVideoBehind || backgroundEnabled)
    : mode !== "stage" && !transparent && hasVideoBehind && !backgroundEnabled;

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
    z: pp7 ? Z_CAMERA_PP7 : Z_CAMERA,
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
  // agrees with planOutput's theme-logo decision. The payload carries the theme
  // logo url ONLY when a logo actually paints (ThemeLogoLayer renders nothing
  // without `logoUrl` / with logoPosition "none") — so the operator's live
  // indicator lights only when a logo is genuinely on the output, not merely
  // because the (always-enabled) logo layer exists.
  const logoPaints = !!appearance?.logoUrl && appearance.logoPosition !== "none";
  layers.push({
    id: "logo",
    kind: "logo",
    z: Z_LOGO,
    enabled: showThemeLogo,
    payload: logoPaints ? { url: appearance!.logoUrl } : null,
    transportScope: "all",
  });

  // Announcement overlay (over the logo) — enabled iff one is set.
  if (state.announcement) {
    layers.push({
      id: "announcement",
      kind: "announcement",
      z: pp7 ? Z_ANNOUNCEMENT_PP7 : Z_ANNOUNCEMENT,
      enabled: true,
      payload: state.announcement,
      transportScope: "all",
    });
  }

  return layers;
}
