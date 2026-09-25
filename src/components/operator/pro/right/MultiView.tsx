"use client";
/**
 * MultiView (2026-09-15) — preview any/all output screens from the operator.
 *
 * Read-only monitors: every tile renders the SHARED OutputCompositor at a fixed
 * 1920×1080 frame scaled into its box (same technique as ObsOverlayCard), fed
 * by the operator's own last OutputState (same window, no network). See
 * src/lib/multiview.ts for the per-route prop parity.
 *
 * Perf (stress review): state updates are coalesced to ≤4/s, tiles are memoised
 * on plain props (never the whole shell ctx, which changes on every audio tick),
 * and video/camera are never decoded or opened in a tile.
 *
 * Tiles deliberately have NO clear-live button (design review): the only clear
 * action clears every screen, so a per-tile X read as "clear this screen" and put
 * four destructive targets side by side mid-service. Clear stays on the Main
 * preview and the bottom bar.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Camera, Film } from "lucide-react";
import { OutputCompositor } from "@/components/live/OutputCompositor";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { StageLayoutRenderer } from "@/components/live/StageLayoutRenderer";
import { PresentationCanvas } from "@/components/live/PresentationCanvas";
import type { LayerWire, OutputState } from "@/lib/broadcast";
import {
  OBS_EDITOR_KEY, LEGACY_BAND_KEY, LEGACY_LOOK_KEY, OBS_PREVIEW_EVENT,
  readObsEditorStore, readObsPreviewState, type ObsEditorStore,
} from "@/lib/obs-look";
import { LAYERS_V2 } from "@/lib/output-layers";
import {
  MULTIVIEW_SCREENS, MULTIVIEW_LABELS, MULTIVIEW_TITLES, coercePreviewState, resolveScreenView, type MultiViewScreen,
} from "@/lib/multiview";

const STATE_COALESCE_MS = 250;

/** Operator's last published OutputState (same-window event, no network),
 *  coalesced to ≤4 updates/s. A rejected/malformed detail keeps the last good
 *  state — the real outputs also keep their last good frame. */
export function useLocalOutputState(): { state: OutputState | null; received: boolean } {
  const [state, setState] = useState<OutputState | null>(null);
  const [received, setReceived] = useState(false);
  useEffect(() => {
    const initial = coercePreviewState(readObsPreviewState());
    if (initial) { setState(initial); setReceived(true); }
    let pending: unknown = undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const next = coercePreviewState(pending);
      pending = undefined;
      if (next) { setState(next); setReceived(true); }
    };
    const on = (e: Event) => {
      pending = (e as CustomEvent).detail;
      if (!timer) timer = setTimeout(flush, STATE_COALESCE_MS);
    };
    window.addEventListener(OBS_PREVIEW_EVENT, on);
    return () => { window.removeEventListener(OBS_PREVIEW_EVENT, on); if (timer) clearTimeout(timer); };
  }, []);
  return { state, received };
}

/** The OBS editor store (livestream fallback look), kept in sync live. */
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

const CHECKER = "repeating-conic-gradient(var(--color-elevated, #2a2a2e) 0% 25%, var(--color-panel, #1c1c20) 0% 50%) 50% / 24px 24px";

type TileProps = {
  screen: MultiViewScreen;
  /** Quarter-size tile inside the 2x2 grid: smaller labels, no wasted chrome. */
  compact?: boolean;
  /** In the grid, clicking a tile switches the box to that screen full-size —
   *  the 2x2 wall answers "is every screen right?", this is how you then READ it. */
  onZoom?: (screen: MultiViewScreen) => void;
  state: OutputState | null;
  received: boolean;
  layerOverrides: LayerWire[] | Map<string, LayerWire> | null | undefined;
  obsStore: ObsEditorStore | null;
};

export const OutputTile = memo(function OutputTile({ screen, state, received, layerOverrides, obsStore, compact = false, onZoom }: TileProps) {
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

  // Route parity: outputs gate the layers render on the env flag alone.
  const view = useMemo(
    () => resolveScreenView(screen, state, { layersEnabled: LAYERS_V2, layerOverrides, obsStore }),
    [screen, state, layerOverrides, obsStore],
  );
  const stage = view.stage;
  const isLive = !view.empty;

  return (
    <div
      ref={boxRef}
      className={`relative w-full overflow-hidden rounded-md ${isLive ? "border-2 border-[color:var(--color-destructive,#e11d48)]" : "border border-[var(--color-border)]"}`}
      style={{ aspectRatio: "16 / 9", background: view.transparent ? CHECKER : "#000" }}
      data-multiview-screen={screen}
      title={onZoom
        ? `${MULTIVIEW_TITLES[screen]} — click to see this screen full size`
        : (view.transparent ? `${MULTIVIEW_TITLES[screen]} — checkerboard means see-through (your video shows behind)` : MULTIVIEW_TITLES[screen])}
    >
      {onZoom && (
        <button
          type="button"
          onClick={() => onZoom(screen)}
          aria-label={`Show ${MULTIVIEW_TITLES[screen]} full size`}
          className="absolute inset-0 z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]"
        />
      )}
      {scale > 0 && view.stageLayout && (
        // An operator-designed layout REPLACES the stage screen, so the tile
        // must show the layout rather than the legacy current/next split —
        // otherwise the dashboard confidently shows something that is not on
        // the monitor at all, which is worse than showing nothing.
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: 1920, height: 1080, transform: `scale(${scale})` }}>
          <StageLayoutRenderer
            layout={view.stageLayout}
            screen="stage"
            scene={view.stageScene ?? null}
            wireTimers={view.stageTimers ?? []}
          />
        </div>
      )}
      {scale > 0 && !view.stageLayout && (
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: 1920, height: 1080, transform: `scale(${scale})` }}>
          <div className={stage ? "absolute inset-x-0 top-0 h-[72%]" : "absolute inset-0"}>
            <OutputCompositor {...view.props} announcement={view.announcement} />
          </div>
          {stage && (
            <div className="absolute inset-x-0 bottom-0 h-[28%] border-t-4 border-white/10 bg-white/[0.02]">
              <div className="absolute top-4 left-8 z-10 flex items-center gap-4">
                <span className="text-2xl font-mono uppercase tracking-widest text-white/40">Next</span>
                {stage.nextItem && <span className="text-3xl font-semibold text-white/70 truncate max-w-[1400px]">{stage.nextItem.title}</span>}
              </div>
              {stage.next && stage.next.kind !== "empty" ? (
                <div className="opacity-75 w-full h-full">
                  <PresentationCanvas><SlideRenderer slide={stage.next} projectorFit appearance={view.props.appearance ?? undefined} ignoreThemeLayout /></PresentationCanvas>
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/20 text-3xl">— end of item —</div>
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
      {view.empty && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={`${compact ? "text-[9px] px-1" : "text-[11px] px-2"} text-white/60 bg-black/50 py-0.5 rounded text-center`}>
            {received ? "Nothing on this screen" : "Waiting for output…"}
          </span>
        </div>
      )}
      {view.videoHidden && !view.empty && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={`inline-flex items-center gap-1 ${compact ? "text-[9px] px-1" : "text-[11px] px-2"} text-white/80 bg-black/60 py-0.5 rounded`}>
            <Film className="w-3 h-3" aria-hidden /> {compact ? "Video" : "Video playing (not previewed)"}
          </span>
        </div>
      )}
      <div className="absolute top-1 left-1 z-10 flex items-center gap-1 pointer-events-none">
        {isLive && (
          <span className={`inline-flex items-center gap-1 ${compact ? "text-[8px] px-1" : "text-[10px] px-1.5"} font-mono uppercase tracking-wider text-white bg-[color:var(--color-destructive,#e11d48)] py-0.5 rounded`}>
            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-white pf-ai-live-dot" />{compact ? "" : " Live"}
          </span>
        )}
        <span className={`${compact ? "text-[8px] px-1" : "text-[10px] px-1.5"} font-mono uppercase tracking-wider text-white bg-black/70 py-0.5 rounded`}>
          {MULTIVIEW_LABELS[screen]}{!compact && view.detail ? ` · ${view.detail}` : ""}
        </span>
      </div>
      {view.cameraHidden && (
        <span className={`absolute bottom-1 right-1 z-10 inline-flex items-center gap-1 ${compact ? "text-[8px] px-1" : "text-[10px] px-1.5"} text-white/90 bg-black/70 py-0.5 rounded pointer-events-none`}>
          <Camera className="w-3 h-3" aria-hidden /> {compact ? "Cam" : "Camera not previewed"}
        </span>
      )}
    </div>
  );
});

/**
 * All four screens as a 2x2 grid, rendered INSIDE the operator's preview box.
 *
 * Deliberately not a modal (2026-09-16 operator directive): a full-screen
 * takeover meant you couldn't touch anything else and had to dismiss it before
 * making a change. Here the wall sits in the box, the rest of the console stays
 * live, and every tile follows the output automatically — one subscription
 * shared by all four, coalesced to <=4 updates/s.
 */
export function MultiViewGrid({ layerOverrides, onZoom }: { layerOverrides: TileProps["layerOverrides"]; onZoom: (screen: MultiViewScreen) => void }) {
  const { state, received } = useLocalOutputState();
  const obsStore = useObsEditorStore();
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-1">
        {MULTIVIEW_SCREENS.map((screen) => (
          <OutputTile key={screen} screen={screen} state={state} received={received} layerOverrides={layerOverrides} obsStore={obsStore} compact onZoom={onZoom} />
        ))}
      </div>
      <p className="text-[10px] leading-snug text-[var(--color-muted-foreground)]">
        Click a screen to see it full size. A stage screen showing a designed layout is drawn as it really is, timers included. On the other screens, timers, pop-up messages and stage countdowns aren&apos;t shown, and videos and cameras show a label instead of playing.
      </p>
    </div>
  );
}

/** One non-Main screen inside the small preview box. */
export function PreviewOtherScreen({ screen, layerOverrides }: { screen: MultiViewScreen; layerOverrides: TileProps["layerOverrides"] }) {
  const { state, received } = useLocalOutputState();
  const obsStore = useObsEditorStore();
  return <OutputTile screen={screen} state={state} received={received} layerOverrides={layerOverrides} obsStore={obsStore} />;
}
