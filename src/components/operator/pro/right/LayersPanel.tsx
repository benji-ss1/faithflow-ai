"use client";
/**
 * LayersPanel — the operator Layers strip (Decoupling Phase 3, ProPresenter
 * parity §1/§16/§22.1/Ch8). Shows the LIVE layer stack top-to-bottom with a lit
 * "what's live" indicator per layer, per-layer clear + visibility toggle, a
 * background "swap" that reuses the existing Background Templates picker, a
 * slide zone control (Full / Lower third), and a guarded press-and-HOLD Clear
 * All. Each row has a "what's live" hover tooltip describing its current
 * content, and its Clear button lights with the layer accent while the layer is
 * live (Ch8 error-recovery dashboard).
 *
 * Gating: rendered ONLY when `ctx.layersEngineOn` (global NEXT_PUBLIC_LAYERS_V2
 * kill-switch AND the church's `layersV2` opt-in). The RightIconBar hides the
 * entry entirely when the env kill-switch is off (zero DOM), and shows a
 * disabled affordance when the env flag is on but the church has not opted in.
 * No emojis — lucide icon components only.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Image as ImageIcon, Eye, EyeOff, Trash2, RectangleHorizontal, Square,
  RotateCw, ListOrdered, Check, Upload, Award, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { slideOutputIdentity, type BackgroundSpec } from "@/lib/broadcast";
import type { OperatorShellCtx } from "../../shell/types";
import type { LayerRow } from "../../useLiveLayers";
import { BackgroundSelector } from "@/backgrounds/components/BackgroundSelector";
import { setActiveBackgroundId } from "@/backgrounds/store/backgroundStore";
import { setMediaOnActiveTheme } from "@/lib/theme-quick-apply";
import { uploadImageFile } from "@/lib/media-upload";
import { LAYER_META, HIT, liveDescription } from "./layerMeta";
import { ClearAllButton } from "./ClearAllButton";

export function LayersPanel({ ctx }: { ctx: OperatorShellCtx }) {
  const { liveLayers, layersEngineOn } = ctx;
  const [swapOpen, setSwapOpen] = useState(false);
  const [slideActionsOpen, setSlideActionsOpen] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);
  const liveSlideIsText = ctx.liveSlide?.kind === "text";

  if (!layersEngineOn) {
    // Honest early-access copy (Y13) — no reference to a settings toggle that
    // does not exist yet. Enabling is admin/back-office only for now.
    return (
      <div className="p-3 text-[12px] leading-relaxed text-[var(--color-muted-foreground)]" role="note">
        The layers engine is in early access. It lets you control background,
        camera, slide and logo independently while live. Contact PresentFlow to
        enable it for your church.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Legend inline (Y12 — no duplicate title; PopoverShell already titles it). */}
      <div className="flex items-center justify-end px-2 h-6">
        <span className="text-[10px] text-[var(--color-muted-foreground)]">lit = live</span>
      </div>

      <div className="flex flex-col divide-y divide-[var(--color-border)]">
        {liveLayers.rows.map((row) => (
          <LayerRowView
            key={row.id}
            row={row}
            // A disabled layer is either HIDDEN (eye-hide, non-destructive,
            // content preserved) or CLEARED (destructive, payload gone). Only the
            // former is in the off-wire eyeHidden set.
            cleared={!row.enabled && !liveLayers.isEyeHidden(row.id)}
            liveDesc={liveDescription(row, ctx)}
            liveSlideIsText={liveSlideIsText}
            onToggle={() => liveLayers.toggleLayer(row.id)}
            onClear={() => {
              // Clearing the background layer ALSO resets the Background Template
              // store to None so the base BackgroundSpec goes away on every
              // projector (layersV2 or not) AND the legacy Themes/background UI
              // shows None — honest single-source-of-truth clear, no divergence.
              if (row.kind === "background") setActiveBackgroundId("none");
              liveLayers.clearLayer(row.id);
            }}
            onZone={(full) => liveLayers.setZone(row.id, full ? { kind: "full" } : { kind: "lowerThird" })}
            onSwap={row.kind === "background" ? () => { setSwapOpen((v) => !v); setSlideActionsOpen(false); } : undefined}
            swapOpen={row.kind === "background" && swapOpen}
            // Wave 6F rec11: the swap button shows a LIVE thumbnail of the
            // current background (updates on swap / media-set) rather than a
            // static icon, so the operator always sees what's actually behind
            // the text.
            bg={row.kind === "background" ? ctx.background ?? null : undefined}
            onSlideActions={row.kind === "slide" ? () => { setSlideActionsOpen((v) => !v); setSwapOpen(false); } : undefined}
            slideActionsOpen={row.kind === "slide" && slideActionsOpen}
            // Wave 6F rec5: the Logo row gets a swap/upload affordance mirroring
            // the background row — pick/upload the church logo, applied live.
            onLogo={row.kind === "logo" ? () => { setLogoOpen((v) => !v); setSwapOpen(false); setSlideActionsOpen(false); } : undefined}
            logoOpen={row.kind === "logo" && logoOpen}
            logoUrl={row.kind === "logo" ? ctx.appearance?.logoUrl ?? null : undefined}
          />
        ))}
      </div>

      {/* Background Templates picker — reused, not rebuilt. Applies to the base
          background layer live via the existing background store. */}
      {swapOpen && (
        <div className="border-t border-[var(--color-border)] p-2 max-h-[280px] overflow-y-auto pf-transcript-scroll">
          <BackgroundSelector />
          {/* Wave 6F rec11 — honest Save affordance. The Background Template is a
              GLOBAL live layer: picking one applies it to the projector instantly
              AND persists it automatically (background store → localStorage,
              "last pick wins" across restart). There is therefore no separate
              Save/Save-to-all to press here — per-slide background overrides are
              saved from the slide editor's "Save to all". This line makes that
              explicit so the operator isn't hunting for a Save button. */}
          <div
            className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--color-muted-foreground)]"
            role="note"
          >
            <Check className="w-3 h-3 text-[var(--pf-layer-background)]" />
            Applied live · saved automatically
          </div>
        </div>
      )}

      {/* Slide content actions — mirrors the background "swap" idiom. Re-send the
          current live slide (a hard, forced re-project) + jump-to-slide chips for
          the slides in the currently-live item. */}
      {slideActionsOpen && <SlideActions ctx={ctx} />}

      {/* Logo picker — set the church logo shown on every slide (rec5). Reuses
          the media upload path + the theme "set logo" machinery, applied live. */}
      {logoOpen && <LogoSwap logoUrl={ctx.appearance?.logoUrl ?? null} />}

      <ClearAllButton
        onClearAll={() => {
          // Layers projectors clear per-layer via the hook; ALSO fire the legacy
          // blank so pre-layers projectors (church not on layers) clear too.
          setActiveBackgroundId("none"); // reset the Background Template store too
          liveLayers.clearAll();
          ctx.onKill();
        }}
      />
    </div>
  );
}

function LayerRowView({
  row, cleared, liveDesc, liveSlideIsText, onToggle, onClear, onZone, onSwap, swapOpen,
  onSlideActions, slideActionsOpen, bg, onLogo, logoOpen, logoUrl,
}: {
  row: LayerRow;
  cleared: boolean;
  liveDesc: string;
  liveSlideIsText: boolean;
  onToggle: () => void;
  onClear: () => void;
  onZone: (full: boolean) => void;
  onSwap?: () => void;
  swapOpen?: boolean;
  onSlideActions?: () => void;
  slideActionsOpen?: boolean;
  /** Live background spec for the background row's swap thumbnail (rec11). */
  bg?: BackgroundSpec | null;
  /** Logo row: open the logo picker; current logo url for its thumbnail (rec5). */
  onLogo?: () => void;
  logoOpen?: boolean;
  logoUrl?: string | null;
}) {
  const meta = LAYER_META[row.kind];
  const { Icon } = meta;
  const isLowerThird = row.zone.kind === "lowerThird";
  // Y9: zones only mean something for text slides — disable with a tooltip when
  // the live slide payload isn't text (image/video/empty), where lowerThird is
  // a silent no-op on the projector.
  const zoneDisabled = row.kind === "slide" && !liveSlideIsText;

  return (
    // Y10: a "what's live" hover tooltip on the whole row.
    <div className="flex items-center gap-1.5 px-2 py-1" title={liveDesc}>
      {/* Live indicator — lit when the layer has active content. */}
      <span
        aria-label={row.active ? `${meta.label} is live` : `${meta.label} is idle`}
        className="w-2 h-2 rounded-full shrink-0 transition-[background,box-shadow] duration-150"
        style={{
          background: row.active ? meta.accent : "var(--color-border)",
          boxShadow: row.active ? `0 0 8px ${meta.accent}` : "none",
        }}
      />
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: row.active ? meta.accent : "var(--color-muted-foreground)" }} />
      <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
        <span
          className={cn(
            "text-[12px] min-w-0 truncate",
            row.enabled
              ? "text-[var(--color-foreground)]"
              : cleared
                // CLEARED: no line-through (nothing to "un-strike"); dimmed.
                ? "text-[var(--color-muted-foreground)] opacity-60"
                // HIDDEN: struck through — the content is still there, just off.
                : "text-[var(--color-muted-foreground)] line-through",
          )}
        >
          {meta.label}
        </span>
        {cleared && (
          <span className="shrink-0 text-[9px] uppercase tracking-wider text-[var(--color-muted-foreground)] opacity-60">
            Cleared
          </span>
        )}
      </span>

      {/* Slide zone toggle (Full / Lower third). */}
      {row.kind === "slide" && (
        <button
          type="button"
          onClick={() => { if (!zoneDisabled) onZone(isLowerThird); }}
          disabled={zoneDisabled}
          title={zoneDisabled ? "Zones apply to text slides" : (isLowerThird ? "Lower third — tap for full" : "Full — tap for lower third")}
          aria-label={zoneDisabled ? "Zones apply to text slides" : (isLowerThird ? "Switch slide to full" : "Switch slide to lower third")}
          className={cn(HIT, "text-[var(--color-muted-foreground)]", zoneDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-white/5 hover:text-[var(--color-foreground)]")}
        >
          {isLowerThird ? <RectangleHorizontal className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
        </button>
      )}

      {/* Slide content actions — mirrors the background "swap" affordance. */}
      {onSlideActions && (
        <button
          type="button"
          onClick={onSlideActions}
          title="Slide actions"
          aria-label="Slide actions"
          aria-expanded={slideActionsOpen}
          className={cn(HIT, "hover:bg-white/5", slideActionsOpen ? "text-[var(--color-brand)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")}
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Background swap — reuse the Background Templates picker. */}
      {onSwap && (
        <button
          type="button"
          onClick={onSwap}
          title="Swap background"
          aria-label="Swap background"
          aria-expanded={swapOpen}
          className={cn(HIT, "hover:bg-white/5", swapOpen ? "text-[var(--color-brand)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")}
        >
          <BackgroundThumb bg={bg} />
        </button>
      )}

      {/* Logo set/upload — mirrors the background swap affordance (rec5). Shows
          the current logo thumbnail; opens the picker to change it live. */}
      {onLogo && (
        <button
          type="button"
          onClick={onLogo}
          title="Set church logo"
          aria-label="Set church logo"
          aria-expanded={logoOpen}
          className={cn(HIT, "hover:bg-white/5", logoOpen ? "text-[var(--color-brand)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")}
        >
          {logoUrl
            ? <img src={logoUrl} alt="" className="block w-5 h-5 rounded-[3px] object-contain ring-1 ring-white/15" />
            : <Award className="w-3.5 h-3.5" />}
        </button>
      )}

      {/* Visibility toggle. */}
      <button
        type="button"
        onClick={onToggle}
        title={row.enabled ? "Hide layer" : cleared ? "Layer cleared — re-enable to show content again" : "Show layer"}
        aria-label={row.enabled ? `Hide ${meta.label}` : cleared ? `Re-enable ${meta.label}` : `Show ${meta.label}`}
        className={cn(
          HIT,
          "hover:bg-white/5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
          // A cleared layer's eye is dimmed — visibility isn't the reason it's dark.
          cleared && "opacity-40",
        )}
      >
        {row.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
      </button>

      {/* Per-layer clear. Extra left margin separates it from Hide (Y14). The
          icon lights with the layer accent while the layer is live (Y10/Ch8). */}
      <button
        type="button"
        onClick={onClear}
        title={`Clear ${meta.label}`}
        aria-label={`Clear ${meta.label}`}
        className={cn(HIT, "ml-1 hover:bg-white/5 hover:text-red-400")}
        style={{ color: row.active ? meta.accent : "var(--color-muted-foreground)" }}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/**
 * BackgroundThumb — a tiny live preview of the CURRENT background, shown inside
 * the background row's "swap" button (rec11). Reflects the active background the
 * instant it changes (swap / media-set / theme apply) because it renders from
 * the live `ctx.background` spec. Falls back to the neutral image icon when
 * there's no background (none/undefined) so the affordance still reads clearly.
 */
function BackgroundThumb({ bg }: { bg?: BackgroundSpec | null }) {
  if (!bg || bg.type === "none") {
    return <ImageIcon className="w-3.5 h-3.5" />;
  }
  const box = "block w-5 h-5 rounded-[3px] overflow-hidden ring-1 ring-white/15 object-cover";
  if (bg.type === "image" && bg.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={bg.imageUrl} alt="" className={box} />;
  }
  if (bg.type === "video" && bg.videoUrl) {
    return <video src={bg.videoUrl} muted playsInline className={box} />;
  }
  // Shader (or an image/video missing its url): a gradient swatch from the
  // spec's own colours so it still tracks the live look.
  const a = bg.primaryColor || "#0A0A0E";
  const b = bg.secondaryColor || "#1a1a24";
  return (
    <span
      className="block w-5 h-5 rounded-[3px] ring-1 ring-white/15"
      style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
    />
  );
}

/**
 * LogoSwap — set the church logo shown on every slide (wave 6F rec5). Mirrors
 * the background "swap" panel: a small surface under the Logo row to upload (or
 * re-pick) the church logo image. Reuses the SHARED media upload path
 * (`uploadImageFile` → /api/media presign flow) and the existing theme-logo
 * machinery (`setMediaOnActiveTheme("logo", url)`), which persists the logo on
 * the active theme AND pushes it live to the projector — so no new render path
 * or storage is introduced. Shows the current logo and offers a one-tap Undo on
 * change. No emojis; tokens/lucide only.
 */
function LogoSwap({ logoUrl }: { logoUrl: string | null }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadImageFile(file, "logo");
      const change = await setMediaOnActiveTheme("logo", url);
      if (!change) {
        toast.error("Couldn't set the logo — no active theme found.");
        return;
      }
      toast.success("Church logo updated", {
        action: {
          label: "Undo",
          onClick: () => { void change.revert().then((ok) => ok ? toast.success("Logo reverted") : toast.error("Couldn't revert")); },
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="border-t border-[var(--color-border)] p-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {/* Current logo preview. */}
        <span className="shrink-0 w-9 h-9 rounded-md ring-1 ring-white/15 bg-black/30 flex items-center justify-center overflow-hidden">
          {logoUrl
            ? <img src={logoUrl} alt="" className="w-full h-full object-contain" />
            : <Award className="w-4 h-4 text-[var(--color-muted-foreground)]" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-[var(--color-foreground)] truncate">
            {logoUrl ? "Current church logo" : "No logo set"}
          </div>
          <div className="text-[10px] text-[var(--color-muted-foreground)]">
            Shown on every slide · applied live
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 h-8 rounded text-[12px] font-medium transition-colors",
          busy
            ? "bg-white/5 text-[var(--color-muted-foreground)] opacity-60 cursor-wait"
            : "bg-white/5 text-[var(--color-foreground)] hover:bg-white/10",
        )}
        title="Upload a church logo (transparent PNG works best)"
      >
        {busy
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
          : <><Upload className="w-3.5 h-3.5" /> {logoUrl ? "Replace logo" : "Upload logo"}</>}
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={(e) => { void onFile(e.target.files?.[0]); }}
      />
    </div>
  );
}

/**
 * Slide-row content actions — the slide-layer analogue of the background "swap"
 * picker. Small + functional: a hard RE-SEND of the current live slide (forced,
 * so it re-projects even if identity is unchanged — useful after a hide/clear or
 * a projector reconnect), plus jump-to-slide chips for the slides in the item
 * that is currently live. Clicking a chip projects that slide live (instant,
 * forced). No emojis; --pf/token-driven, matching the panel idiom.
 */
function SlideActions({ ctx }: { ctx: OperatorShellCtx }) {
  const item = ctx.plan.items[ctx.liveItemIdx];
  const slides = item?.slides ?? [];
  const liveId = ctx.liveSlide ? slideOutputIdentity(ctx.liveSlide) : null;
  const canResend = ctx.liveSlide?.kind !== "empty";

  return (
    <div className="border-t border-[var(--color-border)] p-2 flex flex-col gap-2">
      <button
        type="button"
        disabled={!canResend}
        onClick={() => ctx.onSendSlideToLive(ctx.liveSlide, null, { instant: true, force: true })}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 h-8 rounded text-[12px] font-medium transition-colors",
          canResend
            ? "bg-white/5 text-[var(--color-foreground)] hover:bg-white/10"
            : "bg-white/5 text-[var(--color-muted-foreground)] opacity-40 cursor-not-allowed",
        )}
        title={canResend ? "Re-project the current live slide" : "Nothing is live to re-send"}
      >
        <RotateCw className="w-3.5 h-3.5" /> Re-send current
      </button>

      {slides.length > 0 ? (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] px-0.5 pb-1 truncate" title={item?.title || "Current item"}>
            Jump · {item?.title || "Current item"}
          </div>
          <div className="flex flex-wrap gap-1">
            {slides.map((s, i) => {
              const isLive = liveId != null && slideOutputIdentity(s) === liveId;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => ctx.onSendSlideToLive(s, null, { instant: true, force: true })}
                  title={`Project slide ${i + 1} live`}
                  aria-label={`Project slide ${i + 1} live`}
                  aria-current={isLive || undefined}
                  className={cn(
                    "h-7 min-w-7 px-2 rounded text-[12px] font-mono tabular-nums transition-colors",
                    isLive
                      ? "bg-[var(--color-brand)] text-white"
                      : "bg-white/5 text-[var(--color-muted-foreground)] hover:bg-white/10 hover:text-[var(--color-foreground)]",
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-[var(--color-muted-foreground)] px-0.5">
          No slides in the current item to jump to.
        </div>
      )}
    </div>
  );
}
