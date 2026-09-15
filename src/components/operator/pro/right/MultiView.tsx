"use client";
/**
 * MultiView (2026-09-15) — preview any/all output screens from the operator.
 *
 * Read-only monitors: every tile renders the SHARED OutputCompositor at a fixed
 * 1920×1080 frame scaled into its box (same technique as ObsOverlayCard), fed
 * by the operator's own last OutputState (same window, no network). See
 * src/lib/multiview.ts for the per-route prop parity.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, Camera } from "lucide-react";
import { OutputCompositor } from "@/components/live/OutputCompositor";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { OutputState } from "@/lib/broadcast";
import {
  OBS_EDITOR_KEY, LEGACY_BAND_KEY, LEGACY_LOOK_KEY, OBS_PREVIEW_EVENT,
  readObsEditorStore, readObsPreviewState, type ObsEditorStore,
} from "@/lib/obs-look";
import {
  MULTIVIEW_SCREENS, MULTIVIEW_LABELS, coercePreviewState, resolveScreenView, type MultiViewScreen,
} from "@/lib/multiview";
import type { OperatorShellCtx } from "../../shell/types";

/** Operator's last published OutputState (same-window event, no network). */
export function useLocalOutputState(): OutputState | null {
  const [state, setState] = useState<OutputState | null>(null);
  useEffect(() => {
    setState(coercePreviewState(readObsPreviewState()));
    // A rejected/malformed detail keeps the last good state — the real outputs
    // also keep their last good frame, so the monitor never falsely goes blank.
    const on = (e: Event) => setState((prev) => coercePreviewState((e as CustomEvent).detail) ?? prev);
    window.addEventListener(OBS_PREVIEW_EVENT, on);
    return () => window.removeEventListener(OBS_PREVIEW_EVENT, on);
  }, []);
  return state;
}

/** The OBS editor store (decides the livestream look), kept in sync live. */
export function useObsEditorStore(): ObsEditorStore | null {
  const [store, setStore] = useState<ObsEditorStore | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        setStore(readObsEditorStore(localStorage.getItem(OBS_EDITOR_KEY), localStorage.getItem(LEGACY_BAND_KEY), localStorage.getItem(LEGACY_LOOK_KEY)));
      } catch { setStore(null); }
    };
    read();
    window.addEventListener("presentflow:obs-editor-changed", read);
    return () => window.removeEventListener("presentflow:obs-editor-changed", read);
  }, []);
  return store;
}

const CHECKER = "repeating-conic-gradient(#2a2a2e 0% 25%, #1c1c20 0% 50%) 50% / 24px 24px";

export function OutputTile({
  screen, state, ctx, obsStore, showLabel = true,
}: {
  screen: MultiViewScreen;
  state: OutputState | null;
  ctx: OperatorShellCtx;
  obsStore: ObsEditorStore | null;
  showLabel?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / 1920);
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const view = resolveScreenView(screen, state, {
    layersEnabled: ctx.layersEngineOn,
    layerOverrides: ctx.liveLayers.overrides,
    obsStore,
  });
  const stage = view.stage;

  return (
    <div
      ref={boxRef}
      className="relative w-full overflow-hidden rounded-md border border-[var(--color-border)]"
      style={{ aspectRatio: "16 / 9", background: view.transparent ? CHECKER : "#000" }}
      data-multiview-screen={screen}
    >
      {scale > 0 && (
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: 1920, height: 1080, transform: `scale(${scale})` }}>
          <div className={stage ? "absolute inset-x-0 top-0 h-[72%]" : "absolute inset-0"}>
            <OutputCompositor {...view.props} />
            {stage?.operatorMessage && (
              <div className="absolute left-0 right-0 bottom-0 z-20 bg-black/70 border-t-4 px-10 py-5" style={{ borderColor: "var(--color-brand, #e8501a)" }}>
                <div className="text-white text-5xl font-semibold leading-tight">{stage.operatorMessage}</div>
              </div>
            )}
          </div>
          {stage && (
            <div className="absolute inset-x-0 bottom-0 h-[28%] border-t-4 border-white/10 bg-white/[0.02]">
              <span className="absolute top-4 left-8 z-10 text-2xl font-mono uppercase tracking-widest text-white/40">Next</span>
              {stage.next && stage.next.kind !== "empty" && (
                <div className="absolute inset-0 opacity-70">
                  <SlideRenderer slide={stage.next} appearance={state?.appearance ?? undefined} projectorFit />
                </div>
              )}
            </div>
          )}
          {view.lowerThird && (
            <div className="absolute bottom-16 left-16 right-16 max-w-[70%]">
              <div className="bg-black/70 border-l-4 border-[color:var(--color-brand)] p-5">
                <div className="text-white font-semibold text-2xl leading-tight">{view.lowerThird.line1}</div>
                {view.lowerThird.line2 && <div className="text-white/70 text-lg mt-1">{view.lowerThird.line2}</div>}
              </div>
            </div>
          )}
        </div>
      )}
      {showLabel && (
        <div className="absolute top-1 left-1 z-10 flex items-center gap-1 pointer-events-none">
          <span className="text-[9px] font-mono uppercase tracking-wider text-white bg-black/70 px-1.5 py-0.5 rounded">
            {MULTIVIEW_LABELS[screen]}{view.detail ? ` · ${view.detail}` : ""}
          </span>
        </div>
      )}
      {view.cameraHidden && (
        <span
          className="absolute bottom-1 right-1 z-10 inline-flex items-center gap-1 text-[9px] text-white/90 bg-black/70 px-1.5 py-0.5 rounded pointer-events-none"
          title="This screen shows your live camera. The preview doesn't open the camera again."
        >
          <Camera className="w-3 h-3" aria-hidden /> Camera
        </span>
      )}
    </div>
  );
}

export function MultiViewOverlay({ ctx, onClose }: { ctx: OperatorShellCtx; onClose: () => void }) {
  const state = useLocalOutputState();
  const obsStore = useObsEditorStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const isLive = !!state && state.live.kind !== "empty";
  return (
    <div
      className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex flex-col px-4 py-4"
      role="dialog"
      aria-modal="true"
      aria-label="All screens"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-auto w-full max-w-[1600px] flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">All screens</h2>
          <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${isLive ? "bg-[color:var(--color-destructive,#e11d48)] text-white" : "bg-white/10 text-white/60"}`}>
            {isLive ? "Live" : "Idle"}
          </span>
          <span className="text-[11px] text-white/50">Preview only — nothing here changes your screens.</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md text-white/80 hover:text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-brand)]"
          aria-label="Close all screens"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="mx-auto w-full max-w-[1600px] flex-1 min-h-0 overflow-y-auto">
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
          {MULTIVIEW_SCREENS.map((screen) => (
            <OutputTile key={screen} screen={screen} state={state} ctx={ctx} obsStore={obsStore} />
          ))}
        </div>
      </div>
    </div>
  );
}
