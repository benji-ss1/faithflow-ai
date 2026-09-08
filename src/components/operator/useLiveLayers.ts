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
import { useCallback, useMemo, useState } from "react";

/** Stable EMPTY singletons for the disabled path. Returning a fresh `[]` per
 *  render made `liveLayers.overrides` (a broadcast-effect dep) and the whole
 *  `liveLayers` object (an OperatorConsole `ctx` memo dep) change identity every
 *  render — defeating both memoisation guards on the hot path even when the
 *  layers engine is OFF. These constants keep the disabled path byte-stable. */
const EMPTY_ROWS: LayerRow[] = [];
const EMPTY_OVERRIDES: LayerWire[] = [];
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
  toggleLayer: (id: string) => void;
  clearLayer: (id: string) => void;
  setZone: (id: string, zone: LayerZone) => void;
  setOpacity: (id: string, opacity: number) => void;
  swapBackground: (spec: BackgroundSpec | null) => void;
  /** Disable every layer (per-layer patches). The caller ALSO fires the legacy
   *  clear so pre-layers projectors blank too. */
  clearAll: () => void;
  /** Re-arm the slide layer after a new slide is sent live (R1b): drop a stale
   *  disabled slide override, preserving any lower-third zone. No-op otherwise. */
  rearmSlide: () => void;
  /** Drop all overrides (return to the pure derived stack). */
  reset: () => void;
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
    if (!isValidLiveMessage({ type: "layer-patch", layer: patch })) {
      console.warn("[layers] rejected invalid layer-patch:", patch.id);
      return;
    }
    setOverrideMap((prev) => {
      const next = new Map(prev);
      next.set(patch.id, patch);
      return next;
    });
    emit({ type: "layer-patch", layer: patch });
  }, [enabled, emit]);

  const patchFromBase = useCallback((id: string, build: (b: LayerWire) => LayerWire): void => {
    const b = baseLayerById(base, id);
    const existing = overrideMap.get(id);
    const seed: LayerWire | undefined = existing ?? b;
    if (!seed) return;
    applyPatch(build(seed));
  }, [base, overrideMap, applyPatch]);

  const toggleLayer = useCallback((id: string) => {
    patchFromBase(id, (b) => buildPatch(b, { enabled: !b.enabled }));
  }, [patchFromBase]);

  const clearLayer = useCallback((id: string) => {
    // Clear = disable + null the payload (content-bearing kinds). Keeps stable
    // identity so the layer can be re-enabled/re-populated later. For slide/media
    // buildPatch omits payload entirely (R1a) — a disabled slide override renders
    // blank, and the base slide flows back through when re-armed.
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
    patchFromBase("background", (b) => buildBackgroundSwap(b, spec));
  }, [patchFromBase]);

  const clearAll = useCallback(() => {
    if (!enabled) return;
    // Disable every derived layer (per-layer patches so the layers projector
    // clears each). The caller ALSO fires the legacy blank for pre-layers
    // projectors. Y2: build the patches FIRST (pure), commit state in one
    // updater with NO side effects, THEN emit outside the updater — React may
    // call a state updater more than once (StrictMode / batching) and emitting
    // inside would double-fire the wire.
    const patches = base.map((b) => buildPatch(b, { enabled: false, clearPayload: true }));
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
    const o = overrideMap.get("slide");
    if (!o || o.enabled) return; // nothing to re-arm
    const zone = o.zone;
    const sticky = zone && zone.kind !== "full";
    // The convergence patch (re-enable, preserve any sticky zone, no payload/R1a).
    const rearmed = buildPatch(o, { enabled: true, zone: sticky ? zone : { kind: "full" } });
    setOverrideMap((prev) => {
      const cur = prev.get("slide");
      if (!cur || cur.enabled) return prev;
      const next = new Map(prev);
      // Sticky zone → keep a zone-only override; else drop entirely so the base
      // (enabled) slide flows and the heartbeat snapshot converges to no override.
      if (sticky) next.set("slide", rearmed);
      else next.delete("slide");
      return next;
    });
    emit({ type: "layer-patch", layer: rearmed });
  }, [enabled, overrideMap, emit]);

  const reset = useCallback(() => setOverrideMap(new Map()), []);

  // Stable object identity: consumers (OperatorConsole `ctx` memo + broadcast
  // effect deps) key off `liveLayers` / `liveLayers.overrides`, so this must not
  // change identity unless a meaningful value did. Callbacks are useCallback-
  // stable; rows/overrides are memoised; disabled path uses EMPTY singletons.
  return useMemo<UseLiveLayers>(() => ({
    enabled,
    rows: enabled ? rows : EMPTY_ROWS,
    overrides: enabled ? overrides : EMPTY_OVERRIDES,
    toggleLayer,
    clearLayer,
    setZone,
    setOpacity,
    swapBackground,
    clearAll,
    rearmSlide,
    reset,
  }), [enabled, rows, overrides, toggleLayer, clearLayer, setZone, setOpacity, swapBackground, clearAll, rearmSlide, reset]);
}
