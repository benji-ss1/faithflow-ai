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
 * and video is never decoded in a tile.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X, Camera, Film } from "lucide-react";
import { OutputCompositor } from "@/components/live/OutputCompositor";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { PresentationCanvas } from "@/components/live/PresentationCanvas";
import { AnnouncementLayer } from "@/components/live/AnnouncementLayer";
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
  state: OutputState | null;
  received: boolean;
  layerOverrides: LayerWire[] | Map<string, LayerWire> | null | undefined;
  obsStore: ObsEditorStore | null;
  onKill?: () => void;
};

export const OutputTile = memo(function OutputTile({ screen, state, received, layerOverrides, obsStore, onKill }: TileProps) {
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
      title={view.transparent ? `${MULTIVIEW_TITLES[screen]} — checkerboard means see-through (your video shows behind)` : MULTIVIEW_TITLES[screen]}
    >
      {scale > 0 && (
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: 1920, height: 1080, transform: `scale(${scale})` }}>
          <div className={stage ? "absolute inset-x-0 top-0 h-[72%]" : "absolute inset-0"}>
            <OutputCompositor {...view.props} />
            <AnnouncementLayer ann={view.announcement} />
          </div>
          {stage && (
            <div className="absolute inset-x-0 bottom-0 h-[28%] border-t-4 border-white/10 bg-white/[0.02]">
              <div className="absolute top-4 left-8 z-10 flex items-center gap-4">
                <span className="text-2xl font-mono uppercase tracking-widest text-white/40">Next</span>
                {stage.nextItem && <span className="text-3xl font-semibold text-white/70 truncate max-w-[1400px]">{stage.nextItem.title}</span>}
              </div>
              {stage.next && stage.next.kind !== "empty" ? (
                <div className="opacity-75 w-full h-full">
                  <PresentationCanvas><SlideRenderer slide={stage.next} projectorFit appearance={state?.appearance ?? undefined} /></PresentationCanvas>
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
          <span className="text-[11px] text-white/60 bg-black/50 px-2 py-0.5 rounded">
            {received ? "Nothing on this screen" : "Waiting for output…"}
          </span>
        </div>
      )}
      {view.videoHidden && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="inline-flex items-center gap-1 text-[11px] text-white/80 bg-black/60 px-2 py-0.5 rounded">
            <Film className="w-3.5 h-3.5" aria-hidden /> Video playing (not previewed)
          </span>
        </div>
      )}
      <div className="absolute top-1 left-1 z-10 flex items-center gap-1 pointer-events-none">
        {isLive && (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-white bg-[color:var(--color-destructive,#e11d48)] px-1.5 py-0.5 rounded">
            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-white pf-ai-live-dot" /> Live
          </span>
        )}
        <span className="text-[10px] font-mono uppercase tracking-wider text-white bg-black/70 px-1.5 py-0.5 rounded">
          {MULTIVIEW_LABELS[screen]}{view.detail ? ` · ${view.detail}` : ""}
        </span>
      </div>
      {onKill && isLive && (
        <button
          type="button"
          onClick={onKill}
          className="absolute top-1 right-1 z-10 w-6 h-6 flex items-center justify-center rounded bg-black/60 text-white hover:bg-[var(--color-destructive)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
          title="Clear live"
          aria-label="Clear live"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      {view.cameraHidden && (
        <span className="absolute bottom-1 right-1 z-10 inline-flex items-center gap-1 text-[10px] text-white/90 bg-black/70 px-1.5 py-0.5 rounded pointer-events-none">
          <Camera className="w-3 h-3" aria-hidden /> Camera not previewed
        </span>
      )}
    </div>
  );
});

export function MultiViewOverlay({
  layerOverrides, onKill, onClose,
}: {
  layerOverrides: TileProps["layerOverrides"];
  onKill: () => void;
  onClose: () => void;
}) {
  const { state, received } = useLocalOutputState();
  const obsStore = useObsEditorStore();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); onCloseRef.current(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      try { opener?.focus?.(); } catch { /* ignore */ }
    };
  }, []);
  const isLive = !!state && state.live.kind !== "empty";
  return (
    <div
      className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-sm flex flex-col px-4 py-4"
      role="dialog"
      aria-modal="true"
      aria-label="All screens"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-auto w-full max-w-[1600px] flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <h2 className="text-sm font-semibold text-white">All screens</h2>
          <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${isLive ? "bg-[color:var(--color-destructive,#e11d48)] text-white" : "bg-white/10 text-white/70"}`}>
            {isLive ? "Live" : "Idle"}
          </span>
          <span className="text-[11px] text-white/70">Preview only — looking here never changes your screens.</span>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="shrink-0 h-9 w-9 inline-flex items-center justify-center rounded-md text-white/80 hover:text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
          aria-label="Close all screens"
          title="Close (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="mx-auto w-full max-w-[1600px] flex-1 min-h-0 overflow-y-auto">
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
          {MULTIVIEW_SCREENS.map((screen) => (
            <OutputTile key={screen} screen={screen} state={state} received={received} layerOverrides={layerOverrides} obsStore={obsStore} onKill={onKill} />
          ))}
        </div>
        <p className="mt-3 text-[11px] text-white/50">Timers and pop-up messages aren&apos;t shown in these previews.</p>
      </div>
    </div>
  );
}

/** One non-Main screen inside the small preview box. */
export function PreviewOtherScreen({ screen, layerOverrides, onKill }: { screen: MultiViewScreen; layerOverrides: TileProps["layerOverrides"]; onKill: () => void }) {
  const { state, received } = useLocalOutputState();
  const obsStore = useObsEditorStore();
  return <OutputTile screen={screen} state={state} received={received} layerOverrides={layerOverrides} obsStore={obsStore} onKill={onKill} />;
}
