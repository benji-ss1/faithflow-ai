"use client";
/**
 * Pp7ClearRail — ProPresenter 7 clear rail, on the right edge of the preview.
 *
 * Matches PP7 (docs/PP7_BLUEPRINT.md, verified from screenshots): a narrow
 * column of layer buttons, top → bottom Audio, Messages, Props, Announcements,
 * Slide, Media, Video Input. The column turns maroon while anything is live and
 * each layer with content gets a red cell. Clear All is the white circled ✕ on
 * the column's left edge. Every button clears ONLY its own layer, and the same
 * clears run from F1–F7.
 *
 * Only mounted when the PP7 layers flag is on. Reuses existing actions:
 * slide = onKill, media = background store / media slide, video input + props
 * (theme logo) = liveLayers.clearLayer, announcements = onSetAnnouncement(null),
 * messages = legacy composer + message board.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Music, Send, Layers, Megaphone, SquareMenu, Image as ImageIcon, Video, X } from "lucide-react";
import type { OperatorShellCtx } from "../../shell/types";
import { shouldIgnore, modalDialogOpen } from "@/hooks/useOperatorHotkeys";
import {
  PP7_CLEAR_ORDER, decodePp7ClearKey, pp7ClearGroupById, PP7_CLEAR_GROUPS,
  type Pp7ClearLayer,
} from "@/lib/pp7-clear";
import { pp7ClearGroup, pp7ClearTitle } from "@/lib/pp7-layer-model";
import { useShortcutLabel } from "@/lib/usePlatformLabel";
import {
  PP7_LAYER_AVAILABLE, pp7AnyLive, pp7ClearAll, pp7ClearLayer, pp7LayerActive,
} from "@/lib/pp7-layer-model";
import { usePp7LayerInputs, usePp7ClearEffects } from "./usePp7Layers";

const ICONS: Record<Pp7ClearLayer, React.ComponentType<{ className?: string }>> = {
  audio: Music,
  messages: Send,
  props: Layers,
  announcements: Megaphone,
  slide: SquareMenu,
  media: ImageIcon,
  videoInput: Video,
};

// PP7 rail colours (from screenshots).
const COLUMN_IDLE = "#1c1c1e";
const COLUMN_LIVE = "#4a1515";

export function Pp7ClearRail({
  ctx,
  messagesActive,
  onClearMessages,
}: {
  ctx: OperatorShellCtx;
  messagesActive: boolean;
  onClearMessages: () => void;
}) {
  // The layer mapping + clear actions live in the shared pure model so this
  // rail and the PP7 Layers panel can never disagree (src/lib/pp7-layer-model.ts).
  const inputs = usePp7LayerInputs(ctx, messagesActive);
  const effects = usePp7ClearEffects(ctx, onClearMessages);

  const active = useMemo(() => pp7LayerActive(inputs), [inputs]);
  const available = PP7_LAYER_AVAILABLE;

  const clear = useCallback(
    (layer: Pp7ClearLayer) => pp7ClearLayer(layer, inputs, effects),
    [inputs, effects],
  );

  // Clear All = every PP7 layer clear, plus the livestream lower third. Runs the
  // per-layer clears (not liveLayers.clearAll) so the camera, media and slide all
  // work normally afterwards. The theme logo (Props) stays off until re-enabled
  // from the Layers panel, as a cleared prop does in ProPresenter.
  const clearAll = useCallback(() => pp7ClearAll(inputs, effects), [inputs, effects]);

  // Named Clear Groups (PP7 7.7+). Additive to Clear All, never a replacement —
  // our Clear All stays fixed so the panic button cannot be configured away.
  const clearGroup = useCallback((id: string) => {
    const g = pp7ClearGroupById(id);
    if (!g) return;
    // Clear to Logo is hidden when the church has no logo, so it can never be a
    // button that looks like it worked and did nothing.
    if (g.toLogo && !effects.showLogo) return;
    pp7ClearGroup(g, inputs, effects);
  }, [inputs, effects]);

  // Second Clear All binding (2026-09-17): a default Mac keyboard sends F1 to
  // the brightness control, so PP7's F1 "does nothing" until the operator flips
  // a macOS setting. "⌘⇧C" / "Ctrl+Shift+C" works everywhere. F1 still works.
  const clearAllChord = useShortcutLabel({ mod: true, shift: true, key: "C" });

  // F1–F7 + Cmd/Ctrl+Shift+C (PP7 shortcuts). Ignored while typing and while a
  // genuinely MODAL dialog is open. 2026-09-17: the guard used to be
  // `anyOverlayOpen()`, which also blocked every clear while a popover, dropdown
  // or select was open — precisely when an operator reaches for F6/F4. It is now
  // `modalDialogOpen()` (Radix Dialog/AlertDialog only).
  //
  // F5 (Audio) is PREVENTED even though there is no audio layer yet: letting it
  // through reloaded the page mid-service in a plain browser tab. It is now a
  // deliberate no-op that cannot reload.
  const handlersRef = useRef({ clear, clearAll, clearGroup });
  handlersRef.current = { clear, clearAll, clearGroup };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || shouldIgnore(e.target) || modalDialogOpen()) return;
      const target = decodePp7ClearKey(e);
      if (!target) return;
      e.preventDefault();
      if (typeof target === "object") { handlersRef.current.clearGroup(target.group); return; }
      if (target === "audio") return; // no audio layer yet — no-op, and NO reload
      if (target === "all") handlersRef.current.clearAll();
      else handlersRef.current.clear(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const anyLive = pp7AnyLive(active);

  return (
    <div
      className="relative shrink-0 w-10 flex flex-col"
      style={{ background: anyLive ? COLUMN_LIVE : COLUMN_IDLE }}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Clear layers"
    >
      {PP7_CLEAR_ORDER.map((layer, i) => {
        const Icon = ICONS[layer];
        const label = pp7ClearTitle(layer, active[layer]) + (available[layer] && active[layer] ? " — live" : "");
        return (
          <button
            key={layer}
            type="button"
            aria-disabled={!available[layer]}
            tabIndex={available[layer] ? undefined : -1}
            aria-pressed={available[layer] ? active[layer] : undefined}
            onClick={() => { if (available[layer]) clear(layer); }}
            title={label}
            aria-label={label}
            data-active={active[layer] ? "true" : "false"}
            className={`relative flex-1 min-h-0 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 ${i > 0 ? "border-t border-black/40" : ""} ${!available[layer] ? "cursor-not-allowed bg-black/30" : active[layer] ? "bg-[#7a1f1f] hover:bg-[#8f2626]" : "hover:bg-white/10"}`}
          >
            <Icon className={`w-4 h-4 ${available[layer] ? "text-white/85" : "text-white/20"}`} />
            {/* Unavailable layer: a visible strike, so nobody presses it
                expecting PP7 behaviour (the aria-disabled alone read as live). */}
            {!available[layer] && (
              <span aria-hidden className="pointer-events-none absolute w-5 h-px bg-white/30 rotate-45" />
            )}
          </button>
        );
      })}

      {/* Named Clear Groups, BELOW the per-layer buttons and visibly separate
          from them — they clear several layers at once, so they must not look
          like another single-layer button. Clear All stays the circled ✕ and is
          never one of these (Victor 2026-09-18: the panic button is fixed). */}
      <div className="shrink-0 border-t-2 border-black/60">
        {PP7_CLEAR_GROUPS.map((g) => {
          // Clear to Logo is HIDDEN, not disabled, when the church has no logo:
          // clearing "to" nothing looks like a crash mid-service.
          if (g.toLogo && !effects.showLogo) return null;
          const label = `${g.name}${g.key ? ` (${g.key})` : ""} — ${g.description}`;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => clearGroup(g.id)}
              title={label}
              aria-label={label}
              className="w-full h-7 flex items-center justify-center hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 border-b border-black/40 last:border-b-0"
            >
              {g.toLogo
                ? <ImageIcon className="w-3.5 h-3.5 text-white/85" />
                : <span aria-hidden className="text-[9px] font-bold tracking-tight text-white/85">ABV</span>}
            </button>
          );
        })}
      </div>

      {/* Clear All — PP7's white circled ✕ on the rail's left edge. */}
      <button
        type="button"
        onClick={clearAll}
        title={`Clear All (F1 or ${clearAllChord})`}
        aria-label={`Clear All (F1 or ${clearAllChord})`}
        className="absolute top-1/2 -left-3 -translate-y-1/2 z-20 w-6 h-6 rounded-full bg-white text-[#1c1c1e] flex items-center justify-center shadow hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <X className="w-4 h-4" strokeWidth={3} />
      </button>
    </div>
  );
}
