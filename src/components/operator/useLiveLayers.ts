"use client";
/**
 * useLiveLayers — the operator-side layer store (Decoupling Phase 3).
 *
 * Derives the current layer stack from the exact OutputState the operator
 * broadcasts (via the Phase 2 `outputStateToLayers` adapter, mode "live") and
 * layers the operator's own overrides on top. Operator mutations (toggle,
 * clear, swap, zone, opacity) are:
 *   1. stored as id-keyed override patches (React state), and
 *   2. emitted as `layer-patch` LiveMessages over the SAME channels as the
 *      output broadcast (via the injected `emit`), so a projector updates a
 *      single layer without the whole world being resent.
 * The override array is ALSO folded into the full OutputState broadcast
 * (OperatorConsole reads `overrides`), so a late-joining projector converges to
 * the same stack via the heartbeat snapshot.
 *
 * Everything is inert unless `enabled` (NEXT_PUBLIC_LAYERS_V2 AND the church's
 * `layersV2` opt-in). Disabled ⇒ no patches are ever emitted and `overrides` is
 * always empty ⇒ the projector output is byte-identical to the legacy path.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Stable EMPTY singletons for the disabled path. Returning a fresh `[]` per
 *  render made `liveLayers.overrides` (a broadcast-effect dep) and the whole
 *  `liveLayers` object (an OperatorConsole `ctx` memo dep) change identity every
 *  render — defeating both memoisation guards on the hot path even when the
 *  layers engine is OFF. These constants keep the disabled path byte-stable. */
const EMPTY_ROWS: LayerRow[] = [];
const EMPTY_OVERRIDES: LayerWire[] = [];

// Per-ORIGIN monotonic revision counter (Phase 3 hardening). Module-level so it
// is one counter per operator tab/realm, SEEDED from Date.now(): a freshly
// opened operator therefore mints higher revs than a stale ghost tab that
// started earlier, and every subsequent write increments — so a later write
// always out-ranks an earlier one, across origins as well as within one. The
// projector keeps the highest rev per layer id (see applyLayerPatchBounded /
// rebuildOverridesFromSnapshot), so a lagging heartbeat or ghost snapshot can
// never clobber a fresher patch.
//
// LAYERS_ORIGIN_EPOCH (Y1b) is the immutable Date.now seed captured ONCE at
// module load = this tab's identity. It rides every OutputState this operator
// emits (as `layersEpoch`) so a projector can tell a fresh tab from a ghost tab
// and let a fresh tab authoritatively clear/replace the override map — even when
// the fresh tab has no overrides (the operator-refresh-clears invariant).
const LAYERS_ORIGIN_EPOCH = Date.now();
let __layerRev = LAYERS_ORIGIN_EPOCH;
function nextRev(): number { return ++__layerRev; }
import {
  isValidLiveMessage,
  type BackgroundSpec,
  type LayerWire,
  type LayerZone,
  type LiveMessage,
  type OutputState,
  type SlidePayload,
  type ThemeAppearance,
  type VideoInputState,
} from "@/lib/broadcast";
import { outputStateToLayers } from "@/lib/output-layers";
import { reconcileBackgroundOnBaseChange, shouldRearmSlideOnSend } from "@/lib/layer-store";

/** The subset of OutputState the derived layer stack needs. */
export interface LiveLayersInput {
  live: SlidePayload;
  background?: BackgroundSpec | null;
  videoInput?: VideoInputState | null;
  appearance?: ThemeAppearance | null;
}

/** A display row for the Layers Panel — the derived layer merged with any
 *  override, plus a computed "has active content" flag for the live indicator. */
export interface LayerRow {
  id: string;
  kind: LayerWire["kind"];
  z: number;
  enabled: boolean;
  opacity: number;
  zone: LayerZone;
  /** True when the layer currently paints real content (live indicator lit). */
  active: boolean;
  /** True when the operator has an override patch on this layer. */
  overridden: boolean;
}

export interface UseLiveLayers {
  enabled: boolean;
  /** The derived, override-merged stack, top row first (descending z). */
  rows: LayerRow[];
  /** The active override patches — folded into OutputState.layers for late join. */
  overrides: LayerWire[];
  /** This operator tab's origin epoch (Y1b) — folded into OutputState.layersEpoch
   *  so a projector can tell a fresh tab (authoritative) from a ghost tab. */
  epoch: number;
  toggleLayer: (id: string) => void;
  clearLayer: (id: string) => void;
  setZone: (id: string, zone: LayerZone) => void;
  setOpacity: (id: string, opacity: number) => void;
  swapBackground: (spec: BackgroundSpec | null) => void;
  /** Disable every layer (per-layer patches). The caller ALSO fires the legacy
   *  clear so pre-layers projectors blank too. */
  clearAll: () => void;
  /** Re-arm after a slide is sent live (R1b): drop a stale disabled slide
   *  override (T/"Clear Lyrics" hide included — 2026-09-16), preserving any
   *  lower-third zone, AND restore every layer hidden by `blackout()`. No-op
   *  otherwise. */
  rearmSlide: () => void;
  /** Live-screen X (2026-09-16): NON-DESTRUCTIVELY hide every layer that is
   *  currently showing (payload preserved). The caller ALSO clears the slide.
   *  The next slide sent live restores all of them via `rearmSlide`. */
  blackout: () => void;
  /** Drop all overrides (return to the pure derived stack). */
  reset: () => void;
  /** True when a DISABLED layer is disabled because of an EYE-hide (non-
   *  destructive, payload preserved) rather than a CLEAR (destructive, payload
   *  gone). Store-local (reads the same off-wire eyeHidden set the R1b re-arm
   *  uses); NEVER emitted. Lets the panel show "hidden" vs "cleared" honestly. */
  isEyeHidden: (id: string) => boolean;
}

function baseLayerById(base: LayerWire[], id: string): LayerWire | undefined {
  return base.find((l) => l.id === id);
}

/** Does a derived+patched layer currently paint real content? Exhaustive over
 *  every LayerKind — the `never` guard makes adding a kind a compile error until
 *  its active-rule is spelled out here. */
function computeActive(kind: LayerWire["kind"], enabled: boolean, payload: unknown): boolean {
  if (!enabled) return false;
  switch (kind) {
    case "background":
      return !!payload && (payload as BackgroundSpec).type !== "none";
    case "camera":
      return !!payload;
    case "slide":
    case "media": {
      const s = payload as SlidePayload | undefined;
      if (!s) return false;
      if (s.kind === "empty") return false;
      if (s.kind === "text") return !!s.text && s.text.trim().length > 0;
      return true; // image/video/etc.
    }
    case "logo":
      // A theme logo is only genuinely LIVE when it actually paints — the
      // derived layer carries the logo url in its payload iff ThemeLogoLayer
      // would render (logoUrl set + position != "none"). No payload → no logo
      // configured → the indicator stays dark even though the layer is enabled.
      return !!(payload && (payload as { url?: string }).url);
    case "band":
    case "announcement":
    case "timer":
    case "message":
      // Overlay-style layers paint whenever enabled (their presence in the stack
      // already means content was set); no extra payload gate today.
      return true;
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return enabled;
    }
  }
}

/** A well-typed shallow patch of a LayerWire that PRESERVES the discriminated
 *  union member (switch on kind) — replaces scattered `as LayerWire` casts.
 *  `clearPayload` nulls the payload for the content-bearing kinds (clear); a
 *  slide/media patch NEVER carries payload (R1a — the projector always renders
 *  the CURRENT base slide in the chosen zone, so a stale snapshot can't stick). */
function buildPatch(
  base: LayerWire,
  fields: { enabled?: boolean; zone?: LayerZone; opacity?: number; clearPayload?: boolean },
): LayerWire {
  const enabled = fields.enabled ?? base.enabled;
  const zone = fields.zone ?? base.zone;
  const opacity = fields.opacity ?? base.opacity;
  const common = { id: base.id, z: base.z, enabled, zone, opacity, transportScope: base.transportScope };
  switch (base.kind) {
    case "slide":
    case "media":
      // Payload deliberately OMITTED — zone/visibility only (R1a).
      return { ...common, kind: base.kind };
    case "background":
      return { ...common, kind: "background", payload: fields.clearPayload ? null : base.payload };
    case "camera":
      return { ...common, kind: "camera", payload: fields.clearPayload ? null : base.payload };
    case "logo":
      // Payload deliberately OMITTED — the theme logo renders from `appearance`
      // (resolveLayeredInput reads only logo.enabled), and the operator's live
      // indicator reads the url from the DERIVED base layer, not the override.
      // So a logo toggle/clear carries visibility only and never puts the logo
      // url on the wire (keeps every logo patch trivially wire-valid).
      return { ...common, kind: "logo" };
    case "band":
      return { ...common, kind: "band", payload: base.payload };
    case "announcement":
      return { ...common, kind: "announcement", payload: base.payload };
    case "timer":
      return { ...common, kind: "timer", payload: base.payload };
    case "message":
      return { ...common, kind: "message", payload: base.payload };
    default: {
      const _exhaustive: never = base;
      return _exhaustive;
    }
  }
}

/** Swap-background patch (carries the new BackgroundSpec payload). */
function buildBackgroundSwap(base: LayerWire, spec: BackgroundSpec | null): LayerWire {
  return {
    id: base.id, z: base.z, kind: "background",
    enabled: !!spec && spec.type !== "none",
    zone: base.zone, opacity: base.opacity, transportScope: base.transportScope,
    payload: spec,
  };
}

export function useLiveLayers(
  input: LiveLayersInput,
  emit: (msg: LiveMessage) => void,
  enabled: boolean,
): UseLiveLayers {
  const [overrideMap, setOverrideMap] = useState<Map<string, LayerWire>>(() => new Map());

  // Wave 5A: which layers were hidden via the EYE toggle (as opposed to a CLEAR/
  // trash block). An eye-hide is NON-DESTRUCTIVE and PERSISTS across slide
  // advances (R1b refinement): the slide re-arm on a new send skips a layer that
  // is eye-hidden, but still re-arms a CLEAR-style block so it can't permanently
  // swallow output. Store-local (never on the wire) — the projector doesn't need
  // to know WHY a layer is disabled, only that it is.
  const eyeHiddenRef = useRef<Set<string>>(new Set());

  // 2026-09-16: layers hidden by the Live-screen X (`blackout`), keyed by id →
  // whether an override existed before the blackout. The next send restores
  // exactly these (a layer the operator had ALREADY hidden stays hidden). Any
  // explicit operator action on a layer (toggle/clear/swap/clear-all/reset)
  // removes it from this set so a restore never fights the operator.
  const blackoutRef = useRef<Map<string, boolean>>(new Map());

  // Derived base stack from the live OutputState (adapter is pure).
  const base = useMemo<LayerWire[]>(() => {
    const state: OutputState = {
      // Only the fields outputStateToLayers reads matter; the rest are dummies.
      live: input.live,
      next: null,
      itemTitle: "",
      slideNumber: "",
      aspectRatio: "16:9",
      fitMode: "contain",
      safeArea: false,
      operatorMessage: null,
      lowerThird: null,
      countdownEndsAt: null,
      background: input.background ?? null,
      appearance: input.appearance ?? null,
      videoInput: input.videoInput ?? null,
    };
    return outputStateToLayers(state, { mode: "live" });
  }, [input.live, input.background, input.appearance, input.videoInput]);

  const overrides = useMemo(() => Array.from(overrideMap.values()), [overrideMap]);

  const rows = useMemo<LayerRow[]>(() => {
    const merged = base.map((b) => {
      const o = overrideMap.get(b.id);
      const enabledEff = o ? o.enabled : b.enabled;
      const payload = o && "payload" in o && o.payload !== undefined ? o.payload : ("payload" in b ? b.payload : undefined);
      const zone: LayerZone = (o?.zone ?? b.zone ?? { kind: "full" });
      const opacity = typeof o?.opacity === "number" ? o.opacity : (typeof b.opacity === "number" ? b.opacity : 1);
      const rowOut: LayerRow = {
        id: b.id,
        kind: b.kind,
        z: b.z,
        enabled: enabledEff,
        opacity,
        zone,
        active: computeActive(b.kind, enabledEff, payload),
        overridden: !!o,
      };
      return rowOut;
    });
    // Top row first (highest z on top of the stack).
    return merged.sort((a, b) => b.z - a.z);
  }, [base, overrideMap]);

  // Build + emit + store a patch. No-op (and never touches state) when disabled.
  const applyPatch = useCallback((patch: LayerWire) => {
    if (!enabled) return;
    // Stamp a fresh monotonic rev at the single emit choke so both the stored
    // override AND the wire message carry it (the OutputState.layers heartbeat is
    // folded from the stored overrides, so it inherits the rev too).
    const stamped: LayerWire = { ...patch, rev: nextRev() };
    if (!isValidLiveMessage({ type: "layer-patch", layer: stamped })) {
      console.warn("[layers] rejected invalid layer-patch:", stamped.id);
      return;
    }
    setOverrideMap((prev) => {
      const next = new Map(prev);
      next.set(stamped.id, stamped);
      return next;
    });
    emit({ type: "layer-patch", layer: stamped });
  }, [enabled, emit]);

  const patchFromBase = useCallback((id: string, build: (b: LayerWire) => LayerWire): void => {
    const b = baseLayerById(base, id);
    const existing = overrideMap.get(id);
    const seed: LayerWire | undefined = existing ?? b;
    if (!seed) return;
    applyPatch(build(seed));
  }, [base, overrideMap, applyPatch]);

  const toggleLayer = useCallback((id: string) => {
    // Non-destructive visibility flip. Seed from the current override (if any)
    // else the derived base so an existing swap payload is PRESERVED across a
    // hide→show (SHOW restores exactly what was there). Track eye-hidden state so
    // the R1b slide re-arm can let an eye-hide persist across advances.
    const cur = overrideMap.get(id) ?? baseLayerById(base, id);
    if (!cur) return;
    const newEnabled = !cur.enabled;
    blackoutRef.current.delete(id);
    if (newEnabled) eyeHiddenRef.current.delete(id);
    else eyeHiddenRef.current.add(id);
    applyPatch(buildPatch(cur, { enabled: newEnabled }));
  }, [overrideMap, base, applyPatch]);

  const clearLayer = useCallback((id: string) => {
    // Clear = disable + null the payload (content-bearing kinds). Keeps stable
    // identity so the layer can be re-enabled/re-populated later. For slide/media
    // buildPatch omits payload entirely (R1a) — a disabled slide override renders
    // blank, and the base slide flows back through when re-armed. A CLEAR is
    // destructive (NOT an eye-hide), so drop any eye-hidden mark → the slide
    // re-arm on the next send applies again.
    eyeHiddenRef.current.delete(id);
    blackoutRef.current.delete(id);
    patchFromBase(id, (b) => buildPatch(b, { enabled: false, clearPayload: true }));
  }, [patchFromBase]);

  const setZone = useCallback((id: string, zone: LayerZone) => {
    patchFromBase(id, (b) => buildPatch(b, { zone }));
  }, [patchFromBase]);

  const setOpacity = useCallback((id: string, opacity: number) => {
    const clamped = Math.max(0, Math.min(1, opacity));
    patchFromBase(id, (b) => buildPatch(b, { opacity: clamped }));
  }, [patchFromBase]);

  const swapBackground = useCallback((spec: BackgroundSpec | null) => {
    // Self-heal hygiene: a swap replaces the background payload/visibility
    // outright, so any stale "background" eye-hidden mark no longer describes the
    // layer — drop it so a later slide re-arm / hide↔show reads clean state.
    // (Inert today: buildBackgroundSwap sets enabled from the spec directly.)
    eyeHiddenRef.current.delete("background");
    blackoutRef.current.delete("background");
    patchFromBase("background", (b) => buildBackgroundSwap(b, spec));
  }, [patchFromBase]);

  // Reconcile a STALE background override when the operator changes the base
  // Background Template (via the reused BackgroundSelector, which drives the base
  // store — NOT a layer patch). Without this, a prior background CLEAR/hide
  // override would keep suppressing the freshly-picked template ("swap after
  // clear shows nothing"). On a base-background change WHILE a background override
  // exists, emit a fresh-rev swap so the new selection shows AND out-ranks the
  // old override on every projector. No override present → the derived base layer
  // already tracks the store, so this is a no-op (common path unchanged).
  const prevBgRef = useRef<BackgroundSpec | null | undefined>(input.background);
  useEffect(() => {
    if (prevBgRef.current === input.background) return;
    prevBgRef.current = input.background;
    if (!enabled) return;
    // Wave 5A: NEVER clobber a HIDDEN background override when the base store
    // resets to none (applying a theme-with-background calls
    // setActiveBackgroundId("none")). A blind swapBackground(null) here rewrote
    // the hidden override's payload to null, so SHOW restored nothing — the
    // reported one-way toggle. Decide via the pure helper: re-emit a swap only
    // for a real new pick, or to FOLLOW a clear when the override was actively
    // showing; a hidden override is left intact so its captured payload survives.
    const decision = reconcileBackgroundOnBaseChange(overrideMap.get("background"), input.background ?? null);
    if (decision.emitSwap) swapBackground(decision.spec);
  }, [enabled, input.background, overrideMap, swapBackground]);

  const clearAll = useCallback(() => {
    if (!enabled) return;
    // Disable every derived layer (per-layer patches so the layers projector
    // clears each). The caller ALSO fires the legacy blank for pre-layers
    // projectors. Y2: build the patches FIRST (pure), commit state in one
    // updater with NO side effects, THEN emit outside the updater — React may
    // call a state updater more than once (StrictMode / batching) and emitting
    // inside would double-fire the wire.
    eyeHiddenRef.current = new Set(); // Clear All is destructive — no eye-hides survive
    blackoutRef.current = new Map();  // …and nothing comes back on the next send
    const patches = base.map((b) => ({ ...buildPatch(b, { enabled: false, clearPayload: true }), rev: nextRev() }));
    setOverrideMap(() => {
      const next = new Map<string, LayerWire>();
      for (const p of patches) next.set(p.id, p);
      return next;
    });
    for (const p of patches) emit({ type: "layer-patch", layer: p });
  }, [enabled, base, emit]);

  // R1b — re-arm the slide layer when a NEW slide is sent live. A prior operator
  // "hide"/"clear" on the slide layer must not swallow the next real slide: on a
  // successful send we drop a stale enabled=false slide override (re-enabling the
  // layer) while PRESERVING any zone override (lower-third mode should stick
  // across sends). No-op when the engine is off, when there is no slide override,
  // or when the slide layer is already enabled. Emits the convergence patch.
  const rearmSlide = useCallback(() => {
    if (!enabled) return;
    const patches: LayerWire[] = [];
    const commits: Array<{ id: string; keep: LayerWire | null }> = [];

    // (1) Slide layer. 2026-09-16: T/"Clear Lyrics" (eye/rail hide) is TEMPORARY
    // — the next send re-arms it just like a CLEAR-style block (user-directed,
    // supersedes the Wave 5A eye-hide-persists rule for the slide layer only).
    const o = overrideMap.get("slide");
    if (o && shouldRearmSlideOnSend(o)) {
      eyeHiddenRef.current.delete("slide");
      blackoutRef.current.delete("slide");
      const zone = o.zone;
      const sticky = zone && zone.kind !== "full";
      // The convergence patch (re-enable, preserve any sticky zone, no payload/R1a).
      const rearmed: LayerWire = { ...buildPatch(o, { enabled: true, zone: sticky ? zone : { kind: "full" } }), rev: nextRev() };
      patches.push(rearmed);
      // Sticky zone → keep a zone-only override; else drop entirely so the base
      // (enabled) slide flows and the heartbeat snapshot converges to no override.
      commits.push({ id: "slide", keep: sticky ? rearmed : null });
    }

    // (2) Restore every layer the Live-screen X hid (blackout). Only layers still
    // disabled are touched — one the operator re-showed/swapped meanwhile was
    // already removed from blackoutRef by that action.
    for (const [id, hadOverride] of Array.from(blackoutRef.current)) {
      const cur = overrideMap.get(id);
      // Not (yet) disabled in THIS render's map — e.g. a send in the same tick as
      // the X, before React committed the blackout. Keep the entry so the next
      // send still restores it (never strand a layer hidden).
      if (!cur || cur.enabled) continue;
      blackoutRef.current.delete(id);
      eyeHiddenRef.current.delete(id);
      // No prior override → the restore carries NO content payload (null for
      // background/camera), so every projector renders its CURRENT derived base
      // (a camera/background changed during the blackout shows correctly) rather
      // than the snapshot captured at X time. The projector map keeps this entry
      // (the heartbeat can't remove it), which is harmless: enabled + null payload
      // = "use base" in resolveLayeredInput.
      const restored: LayerWire = { ...buildPatch(cur, { enabled: true, clearPayload: !hadOverride }), rev: nextRev() };
      patches.push(restored);
      // No override before the blackout → drop it so the live derived base flows
      // (e.g. a camera/background picked meanwhile); else keep the prior override
      // (a layer swap payload / zone / opacity survives the blackout).
      commits.push({ id, keep: hadOverride ? restored : null });
    }

    if (patches.length === 0) return;
    setOverrideMap((prev) => {
      const next = new Map(prev);
      for (const c of commits) {
        const cur = prev.get(c.id);
        if (!cur || cur.enabled) continue;
        if (c.keep) next.set(c.id, c.keep);
        else next.delete(c.id);
      }
      return next;
    });
    for (const p of patches) emit({ type: "layer-patch", layer: p });
  }, [enabled, overrideMap, emit]);

  // Live-screen X (2026-09-16): hide EVERYTHING currently showing — background,
  // camera, logo, slide — NON-destructively (payloads preserved, eye-hide marks
  // so the rail offers "Show"), and remember what was hidden so the next send
  // (`rearmSlide`) brings it all back. Same build-then-commit-then-emit shape as
  // clearAll (Y2) so a double-invoked updater can't double-fire the wire.
  const blackout = useCallback(() => {
    if (!enabled) return;
    const patches: LayerWire[] = [];
    for (const row of rows) {
      // A background template that is only dark because a live camera wins over it
      // (derived enabled=false, no operator override) must ALSO be blacked out —
      // otherwise hiding the camera un-suppresses it and X shows the template.
      const cameraSuppressedBg = row.kind === "background" && !overrideMap.has(row.id)
        && !!input.background && input.background.type !== "none";
      if (!row.active && !cameraSuppressedBg) continue; // idle or already hidden/cleared → leave it as the operator set it
      // The slide itself is cleared by the caller (onKill) — hiding its layer too
      // would leave a dead "Show Slide" cue on the rail with nothing to show.
      if (row.id === "slide") continue;
      const cur = overrideMap.get(row.id) ?? baseLayerById(base, row.id);
      if (!cur) continue;
      blackoutRef.current.set(row.id, overrideMap.has(row.id));
      eyeHiddenRef.current.add(row.id);
      patches.push({ ...buildPatch(cur, { enabled: false }), rev: nextRev() });
    }
    if (patches.length === 0) return;
    setOverrideMap((prev) => {
      const next = new Map(prev);
      for (const p of patches) next.set(p.id, p);
      return next;
    });
    for (const p of patches) emit({ type: "layer-patch", layer: p });
  }, [enabled, rows, overrideMap, base, input.background, emit]);

  const reset = useCallback(() => { eyeHiddenRef.current = new Set(); blackoutRef.current = new Map(); setOverrideMap(new Map()); }, []);

  // Read-only view of the off-wire eye-hidden set (see eyeHiddenRef). Depends on
  // overrideMap so it re-evaluates alongside the rows it annotates.
  const isEyeHidden = useCallback((id: string) => eyeHiddenRef.current.has(id), [overrideMap]);

  // Stable object identity: consumers (OperatorConsole `ctx` memo + broadcast
  // effect deps) key off `liveLayers` / `liveLayers.overrides`, so this must not
  // change identity unless a meaningful value did. Callbacks are useCallback-
  // stable; rows/overrides are memoised; disabled path uses EMPTY singletons.
  return useMemo<UseLiveLayers>(() => ({
    enabled,
    rows: enabled ? rows : EMPTY_ROWS,
    overrides: enabled ? overrides : EMPTY_OVERRIDES,
    epoch: LAYERS_ORIGIN_EPOCH,
    toggleLayer,
    clearLayer,
    setZone,
    setOpacity,
    swapBackground,
    clearAll,
    rearmSlide,
    blackout,
    reset,
    isEyeHidden,
  }), [enabled, rows, overrides, toggleLayer, clearLayer, setZone, setOpacity, swapBackground, clearAll, rearmSlide, blackout, reset, isEyeHidden]);
}
