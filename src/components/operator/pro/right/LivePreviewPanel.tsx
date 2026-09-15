"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { BackgroundLayer } from "@/backgrounds/components/BackgroundLayer";
import { PresentationCanvas } from "@/components/live/PresentationCanvas";
import { OutputCompositor } from "@/components/live/OutputCompositor";
import type { OperatorShellCtx } from "../../shell/types";
import { CopyConfirm } from "../CopyConfirm";
import { getEffect, ensureEffectKeyframes, type EffectId } from "@/lib/effects";
import { TRANSITION_NAME_TO_EFFECT_ID, TRANSITION_PREVIEW_EVENT } from "../BottomBar";
import type { SlidePayload } from "@/lib/broadcast";
import { LayoutGrid } from "lucide-react";
import { MultiViewOverlay, OutputTile, useLocalOutputState, useObsEditorStore } from "./MultiView";
import { MULTIVIEW_SCREENS, MULTIVIEW_LABELS, PREVIEW_SCREEN_KEY, isMultiViewScreen, multiviewEnabled, type MultiViewScreen } from "@/lib/multiview";

/** Preview-box screen switcher + "All screens" entry. Main keeps the original
 *  preview render untouched; other screens render read-only OutputTiles. */
function useMultiViewControls() {
  const [enabled, setEnabled] = useState(false);
  const [screen, setScreenInner] = useState<MultiViewScreen>("main");
  const [allOpen, setAllOpen] = useState(false);
  useEffect(() => {
    const on = multiviewEnabled();
    setEnabled(on);
    if (!on) return;
    try {
      const saved = window.localStorage.getItem(PREVIEW_SCREEN_KEY);
      if (isMultiViewScreen(saved)) setScreenInner(saved);
    } catch { /* ignore */ }
  }, []);
  const setScreen = (s: MultiViewScreen) => {
    setScreenInner(s);
    try { window.localStorage.setItem(PREVIEW_SCREEN_KEY, s); } catch { /* ignore */ }
  };
  return { enabled, screen: enabled ? screen : "main" as MultiViewScreen, setScreen, allOpen, setAllOpen };
}

function PreviewOtherScreen({ ctx, screen }: { ctx: OperatorShellCtx; screen: MultiViewScreen }) {
  const state = useLocalOutputState();
  const obsStore = useObsEditorStore();
  return <OutputTile screen={screen} state={state} ctx={ctx} obsStore={obsStore} />;
}

// The live slide's text carries its reference/translation as a trailing
// line after a blank line ("...verse body...\n\nBook Ch:Verse (KJV)") — see
// every cardToSlide/applyAdvancedVerse call site across the app. The box was
// too small to read that label at a glance, and it wasn't pulled out
// separately at all, so book/chapter/verse/translation was easy to miss.
function splitBodyAndReference(text: string): { body: string; reference: string | null } {
  const idx = text.lastIndexOf("\n\n");
  if (idx < 0) return { body: text, reference: null };
  const reference = text.slice(idx + 2).trim();
  // Only treat it as a reference label if it actually looks like one
  // (short line, not another paragraph of verse text) — avoids splitting a
  // slide that legitimately has a blank line in the middle of its body.
  if (reference.length === 0 || reference.length > 80 || reference.includes("\n")) {
    return { body: text, reference: null };
  }
  return { body: text.slice(0, idx), reference };
}

export function LivePreviewPanel({ ctx, onVideoRef }: { ctx: OperatorShellCtx; onVideoRef?: (el: HTMLVideoElement | null) => void }) {
  const isLive = ctx.liveSlide.kind !== "empty";
  const mv = useMultiViewControls();
  // 2026-09-01 fix ("copy text on slide doesn't work"): the reference now lives
  // in the slide's dedicated `.reference` field, NOT appended into `text` after a
  // blank line. Reading it only via splitBodyAndReference(text) returned null for
  // every real scripture verse → the reference strip + copy button never rendered.
  // Prefer the structured field; fall back to the legacy text-appended form.
  const reference = ctx.liveSlide.kind === "text"
    ? (ctx.liveSlide.reference ?? splitBodyAndReference(ctx.liveSlide.text).reference)
    : null;
  // Full copyable text = verse body + reference (whichever way it's stored).
  const copyText = ctx.liveSlide.kind === "text"
    ? (reference && !ctx.liveSlide.text.includes(reference) ? `${ctx.liveSlide.text}\n\n${reference}` : ctx.liveSlide.text)
    : (reference ?? "");

  // ── Transition preview overlay ────────────────────────────────────────────
  // When the operator clicks a transition in the picker, replay its projector
  // ENTER animation ONCE right here so they see how it looks. Fully isolated: an
  // overlay that renders the current slide (or a sample when idle) with the real
  // effect CSS, then removes itself on animation end. It NEVER touches the live
  // render path below, so there's zero risk of the projector pulse/churn bugs.
  const [demo, setDemo] = useState<{ nonce: number; animation: string } | null>(null);
  useEffect(() => {
    ensureEffectKeyframes();
    const onPreview = (e: Event) => {
      const d = (e as CustomEvent<{ name?: string; durationMs?: number }>).detail;
      const name = d?.name;
      if (!name) return;
      const effectId = TRANSITION_NAME_TO_EFFECT_ID[name];
      const durationMs = d?.durationMs ?? 600;
      // Cut, or a ~instant duration, has nothing to animate — clear any overlay so
      // a 0ms animation can never leave the black incoming layer stuck on screen.
      if (!effectId || durationMs < 50) { setDemo(null); return; }
      const eff = getEffect(effectId as EffectId);
      if (!eff) return;
      const animation = eff.css(durationMs, "ease-in-out").in;
      setDemo((cur) => ({ nonce: (cur?.nonce ?? 0) + 1, animation }));
    };
    window.addEventListener(TRANSITION_PREVIEW_EVENT, onPreview);
    return () => window.removeEventListener(TRANSITION_PREVIEW_EVENT, onPreview);
  }, []);
  // The slide shown in the demo: the current live slide, or a neutral sample so
  // the motion is visible when the projector is idle.
  const demoSlide: SlidePayload = isLive
    ? ctx.liveSlide
    : { kind: "text", text: "Transition preview" };

  return (
    <div className="p-2 flex flex-col gap-2">
      {/* 2026-07-25 Phase 1 refactor:
          - `SCREEN 1` label → `LIVE ●` (red pulse when active) / `IDLE ○`
            (grey when nothing on projector). Matches operator mental model.
          - min-h bumped 200 → 220 px so verses/lyrics have visibly more room
            (AutoFitText inside SlideRenderer keeps its binary-search scaling
            so long content still fits within the 16:9 aspect-video frame).
          - When live, subtle outer red glow via box-shadow layered on top of
            the existing 2px red border so the preview reads as "hot" from
            across the room, not just from the pixel-precise border color. */}
      {/* 2026-07-25 pull-back — going aspect-less made the preview grow
          to fill the whole right column when text was long (screenshot
          14:28:52 showed John 3:16 taking up ~600 px vertical). Back to
          aspect-video (16:9, matches audience projector), with a
          bounded height so the box is ALWAYS the same reasonable size
          regardless of content. Longer stanzas paginate at the
          sanctuary-readability floor rather than growing the box.
          Explicit height (h-[220px]) locks it — aspect-video would
          try to derive from sidebar width and could still oscillate. */}
      {/* 2026-07-25 field bug fix — was h-[220px] which clipped long verses
          mid-word (John 3:18 screenshot cut off "of God"). Bumped to
          h-[280px] AND the sidebar widened to 360px in ProOperatorShell.
          Combined that's ~35% more visible area, so the sanctuary-readability
          floor (24px min) fits most single verses without any clipping.
          Kept aspect-agnostic (no aspect-video) so the box is a stable
          size regardless of content length. */}
      {/* MultiView 2026-09-15: pick which screen this box monitors + open all
          screens. Kill-switch localStorage presentflow.pro.multiview.v1="0". */}
      {mv.enabled && (
        <div className="flex items-center gap-1">
          <div className="flex flex-1 min-w-0 rounded-md border border-[var(--color-border)] p-0.5" role="radiogroup" aria-label="Screen to preview">
            {MULTIVIEW_SCREENS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={mv.screen === s}
                onClick={() => mv.setScreen(s)}
                className={`flex-1 min-w-0 truncate px-1 py-1 rounded text-[10px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] ${mv.screen === s ? "bg-[var(--color-brand)] text-white" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
              >
                {MULTIVIEW_LABELS[s]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => mv.setAllOpen(true)}
            className="shrink-0 h-7 px-2 inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] text-[10px] font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-brand)]"
            title="See all screens at once"
            aria-label="See all screens at once"
          >
            <LayoutGrid className="w-3.5 h-3.5" aria-hidden /> All
          </button>
        </div>
      )}
      {mv.allOpen && <MultiViewOverlay ctx={ctx} onClose={() => mv.setAllOpen(false)} />}
      {mv.screen !== "main" && <PreviewOtherScreen ctx={ctx} screen={mv.screen} />}
      {/* 2026-08-13 — restored true 16:9 (aspect-video) + projectorFit sizing so
          this preview is proportionally WYSIWYG with the projector. The earlier
          aspect-agnostic h-[280px] + non-projector fit was the cause of the
          preview-looks-bigger-than-projector mismatch; projectorFit paginates
          long verses at the sanctuary floor instead of clipping/growing, so the
          16:9 box stays stable. Panel width is fixed, so aspect-video height is
          stable (no oscillation). */}
      {/* Main stays MOUNTED when another screen is picked (hidden only) so the
          preview video ref that drives VideoControlBar is never dropped. */}
      <div hidden={mv.screen !== "main"}>
      <div
        className={
          isLive
            ? "relative aspect-video w-full rounded-md overflow-hidden border-2 border-[color:var(--color-destructive,#e11d48)] bg-black"
            : "relative aspect-video w-full rounded-md overflow-hidden border border-[var(--color-border)] bg-black"
        }
        style={isLive ? { boxShadow: "0 0 12px 2px rgba(225, 29, 72, 0.35)" } : undefined}
      >
        {isLive && (
          <div className="absolute top-1 left-1 z-10 text-[9px] font-mono uppercase tracking-wider text-white bg-[color:var(--color-destructive,#e11d48)] px-1.5 py-0.5 rounded flex items-center gap-1">
            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-white pf-ai-live-dot" />
            LIVE
          </div>
        )}
        {ctx.layersEngineOn ? (
          /* Layers engine ON: render the preview through the SAME
             resolveLayeredPlan/override path as /live (OutputCompositor with the
             operator's own layer overrides) so the operator monitor is WYSIWYG
             with the projector under a clear/hide/swap/zone override — not just
             for the un-overridden state. transition is pinned null: the preview
             is a monitor, not a projector, and a fade on a tiny box adds no
             information (and avoids any enter-animation churn). Flag OFF keeps
             the byte-identical legacy render below. */
          <OutputCompositor
            mode="live"
            slide={ctx.liveSlide}
            appearance={ctx.appearance}
            background={ctx.background ?? null}
            videoInput={ctx.videoInput ?? null}
            transition={null}
            fontScale={ctx.fontScale}
            referenceScale={ctx.referenceScale}
            referenceColor={ctx.referenceColor}
            zone={ctx.zone}
            aspectRatio={ctx.aspectRatio}
            onVideoRef={onVideoRef}
            layersEnabled
            layerOverrides={ctx.liveLayers.overrides}
            previewFrozen
          />
        ) : (
          <PresentationCanvas zone={ctx.zone}>
            {/* WYSIWYG: show the active background behind the slide, exactly like
                the projector (slide goes transparent via overVideo). */}
            {/* key on the preset forces a fresh WebGL canvas on theme switch —
                reusing the canvas permanently loses its context (freezes the shader). */}
            {ctx.background && ctx.background.type !== "none" && <BackgroundLayer key={ctx.background.shaderPreset ?? ctx.background.type} background={ctx.background} frozen />}
            <SlideRenderer slide={ctx.liveSlide} appearance={ctx.appearance ?? undefined} projectorFit fontScale={ctx.fontScale} referenceScale={ctx.referenceScale} referenceColor={ctx.referenceColor} overVideo={!!(ctx.background && ctx.background.type !== "none")} onVideoRef={onVideoRef} />
          </PresentationCanvas>
        )}
        {ctx.liveSlide.kind !== "empty" && (
          <button
            onClick={ctx.onKill}
            className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded bg-black/60 text-white hover:bg-[var(--color-destructive)]"
            title="Clear live"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {/* One-shot transition demo overlay (see comment above). Two layers so the
            effect is actually VISIBLE: a static contrasting "outgoing" backdrop, and
            the incoming slide (opaque black, like a real projector slide) animating in
            over it. A black-on-black fade would otherwise be imperceptible on the idle
            monitor. Keyed on nonce so each click replays; self-removes when its OWN
            enter animation finishes (guarded so a child's animationend can't kill it). */}
        {demo && (
          <div className="absolute inset-0 z-[6] pointer-events-none overflow-hidden">
            {/* Outgoing frame — a distinct, non-black backdrop for the effect to reveal from. */}
            <div className="absolute inset-0" style={{ background: "linear-gradient(135deg,#3a3a42,#1b1b20)" }} />
            {/* Incoming slide — the real transition plays on THIS layer. */}
            <div
              key={demo.nonce}
              className="absolute inset-0 bg-black"
              style={{ animation: demo.animation }}
              onAnimationEnd={(e) => { if (e.target === e.currentTarget) setDemo(null); }}
            >
              <PresentationCanvas zone={ctx.zone}>
                <SlideRenderer slide={demoSlide} appearance={ctx.appearance ?? undefined} projectorFit fontScale={ctx.fontScale} referenceScale={ctx.referenceScale} referenceColor={ctx.referenceColor} />
              </PresentationCanvas>
            </div>
          </div>
        )}
      </div>
      </div>
      {/* Always-legible reference strip — book, chapter:verse, translation —
          pulled out of the slide text so it's never cramped inside the tiny
          preview box regardless of panel width. */}
      {reference && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-[var(--color-elevated)] border border-[var(--color-border)]">
          <span className="flex-1 min-w-0 text-[12px] font-semibold text-center truncate" title={reference}>{reference}</span>
          <CopyConfirm
            text={copyText || reference}
            label={undefined}
            className="shrink-0 p-0.5"
          />
        </div>
      )}
      <div className="flex items-center justify-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
        <span
          aria-hidden
          className={
            isLive
              ? "inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--color-destructive,#e11d48)] pf-ai-live-dot"
              : "inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-muted-foreground)] opacity-60"
          }
        />
        <span className={isLive ? "text-[color:var(--color-destructive,#e11d48)] font-semibold" : ""}>
          {isLive ? "Live" : "Idle"}
        </span>
      </div>
    </div>
  );
}
