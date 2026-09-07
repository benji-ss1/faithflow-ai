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
  /** Drop all overrides (return to the pure derived stack). */
  reset: () => void;
}

function baseLayerById(base: LayerWire[], id: string): LayerWire | undefined {
  return base.find((l) => l.id === id);
}

/** Does a derived+patched layer currently paint real content? */
function computeActive(kind: LayerWire["kind"], enabled: boolean, payload: unknown): boolean {
  if (!enabled) return false;
  switch (kind) {
    case "background":
      return !!payload && (payload as BackgroundSpec).type !== "none";
    case "camera":
      return !!payload;
    case "slide": {
      const s = payload as SlidePayload | undefined;
      if (!s) return false;
      if (s.kind === "empty") return false;
      if (s.kind === "text") return !!s.text && s.text.trim().length > 0;
      return true; // image/video/etc.
    }
    case "logo":
      return true; // logo layer is "on" whenever enabled
    default:
      return enabled;
  }
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
      return {
        id: b.id,
        kind: b.kind,
        z: b.z,
        enabled: enabledEff,
        opacity,
        zone,
        active: computeActive(b.kind, enabledEff, payload),
        overridden: !!o,
      } as LayerRow;
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

  const patchFromBase = useCallback((id: string, mutate: (b: LayerWire) => LayerWire): void => {
    const b = baseLayerById(base, id);
    const existing = overrideMap.get(id);
    const seed: LayerWire | undefined = existing ?? b;
    if (!seed) return;
    applyPatch(mutate({ ...seed }));
  }, [base, overrideMap, applyPatch]);

  const toggleLayer = useCallback((id: string) => {
    patchFromBase(id, (b) => ({ ...b, enabled: !b.enabled }));
  }, [patchFromBase]);

  const clearLayer = useCallback((id: string) => {
    // Clear = disable + null the payload (per-kind). Keeps stable identity so
    // the layer can be re-enabled/re-populated later.
    patchFromBase(id, (b) => {
      const patch = { ...b, enabled: false } as LayerWire;
      if (patch.kind === "background" || patch.kind === "camera" || patch.kind === "logo") patch.payload = null;
      return patch;
    });
  }, [patchFromBase]);

  const setZone = useCallback((id: string, zone: LayerZone) => {
    patchFromBase(id, (b) => ({ ...b, zone }));
  }, [patchFromBase]);

  const setOpacity = useCallback((id: string, opacity: number) => {
    const clamped = Math.max(0, Math.min(1, opacity));
    patchFromBase(id, (b) => ({ ...b, opacity: clamped }));
  }, [patchFromBase]);

  const swapBackground = useCallback((spec: BackgroundSpec | null) => {
    patchFromBase("background", (b) => ({ ...b, kind: "background", enabled: !!spec && spec.type !== "none", payload: spec }));
  }, [patchFromBase]);

  const clearAll = useCallback(() => {
    if (!enabled) return;
    // Disable every derived layer (per-layer patches so the layers projector
    // clears each). The caller ALSO fires the legacy blank for pre-layers
    // projectors.
    setOverrideMap(() => {
      const next = new Map<string, LayerWire>();
      for (const b of base) {
        const patch = { ...b, enabled: false } as LayerWire;
        if (patch.kind === "background" || patch.kind === "camera" || patch.kind === "logo") patch.payload = null;
        next.set(b.id, patch);
        emit({ type: "layer-patch", layer: patch });
      }
      return next;
    });
  }, [enabled, base, emit]);

  const reset = useCallback(() => setOverrideMap(new Map()), []);

  return {
    enabled,
    rows: enabled ? rows : [],
    overrides: enabled ? overrides : [],
    toggleLayer,
    clearLayer,
    setZone,
    setOpacity,
    swapBackground,
    clearAll,
    reset,
  };
}
