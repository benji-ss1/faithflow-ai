/**
 * PP7 layer model — the single source of truth for "which PP7 layer is live"
 * and "what does clearing it do". Pure and node-testable: no React, no DOM.
 *
 * Both PP7 surfaces consume it so they can never drift:
 *   - the clear rail beside the preview (`right/Pp7ClearRail.tsx`)
 *   - the Layers panel opened from the right icon bar (`right/Pp7LayersPanel.tsx`)
 *
 * Rows/labels/keys come from `pp7-clear.ts` (PP7_CLEAR_ORDER / _LABEL / _KEY).
 * Extracted verbatim from Pp7ClearRail's former inline logic (2026-09-17) — the
 * rail's rendered output is unchanged, and is test-locked as such.
 */
import {
  PP7_CLEAR_ORDER, PP7_CLEAR_LABEL, PP7_CLEAR_KEY,
  isMediaSlideKind, isEmptySlideKind, type Pp7ClearLayer,
} from "./pp7-clear";

/** Everything the model needs to decide what is live, read from the operator ctx. */
export type Pp7LayerInputs = {
  /** `ctx.liveSlide?.kind`. */
  kind: string | undefined;
  /** `id => !!ctx.liveLayers.rows.find(r => r.id === id)?.active`. */
  rowActive: (id: string) => boolean;
  /** `!!ctx.announcement`. */
  announcementActive: boolean;
  /** `!!ctx.background && ctx.background.type !== "none"`. */
  backgroundSpecActive: boolean;
  /** `!!ctx.videoInput`. */
  videoInputActive: boolean;
  /** Messages/timers showing (PP7 shows timers through the Messages layer). */
  messagesActive: boolean;
};

/** Which PP7 layers this build can actually drive. Audio has no layer yet. */
export const PP7_LAYER_AVAILABLE: Record<Pp7ClearLayer, boolean> = {
  audio: false,
  messages: true,
  props: true,
  announcements: true,
  slide: true,
  media: true,
  videoInput: true,
};

/** Live/idle per PP7 layer. */
export function pp7LayerActive(i: Pp7LayerInputs): Record<Pp7ClearLayer, boolean> {
  const kind = i.kind;
  return {
    audio: false, // no audio layer yet
    messages: i.messagesActive,
    props: i.rowActive("logo"),
    announcements: i.announcementActive,
    slide: !isEmptySlideKind(kind) && !isMediaSlideKind(kind) && i.rowActive("slide"),
    // The background row is off while a camera is live (legacy plan), but under
    // PP7 order the media still paints over the camera — read the base too.
    media: i.rowActive("background")
      || (i.backgroundSpecActive && i.videoInputActive)
      || (isMediaSlideKind(kind) && i.rowActive("slide")),
    videoInput: i.videoInputActive && i.rowActive("camera"),
  };
}

/** True when any PP7 layer has content (rail column turns maroon). */
export function pp7AnyLive(active: Record<Pp7ClearLayer, boolean>): boolean {
  return PP7_CLEAR_ORDER.some((l) => active[l]);
}

/** The side effects a clear can run. Supplied by the shell/ctx. */
export type Pp7ClearEffects = {
  /** `ctx.onKill()` — blank the slide layer. */
  killSlide: () => void;
  /** `setActiveBackgroundId("none")`. */
  setBackgroundNone: () => void;
  /** `ctx.liveLayers.clearLayer(id)`. */
  clearLayer: (id: string) => void;
  /** `clearVideoInputLive()`. */
  clearVideoInput: () => void;
  /** `ctx.onSetAnnouncement(null)`. */
  clearAnnouncement: () => void;
  /**
   * Hide messages + the message board + every live timer overlay. In PP7 timers
   * ride the Messages layer, so F6 / the Messages row / Clear All all take the
   * countdown off the projector with the message.
   */
  clearMessages: () => void;
  /** `ctx.onClearLowerThird?.()` — Clear All only. */
  clearLowerThird?: () => void;
};

/**
 * Clear exactly ONE PP7 layer. Byte-for-byte the rail's former `clear()`.
 * `i` is read for the decisions (live slide kind, which rows are active).
 */
export function pp7ClearLayer(layer: Pp7ClearLayer, i: Pp7LayerInputs, fx: Pp7ClearEffects): void {
  switch (layer) {
    case "slide":
      if (!isMediaSlideKind(i.kind)) fx.killSlide();
      return;
    case "media":
      fx.setBackgroundNone();
      // A background override can show while the base store is already none
      // (e.g. a Layers-panel swap) — clear the layer too so it really goes.
      if (i.rowActive("background")) fx.clearLayer("background");
      if (isMediaSlideKind(i.kind)) fx.killSlide();
      return;
    case "videoInput":
      // Stop the feed like the camera panel's Clear, so it can go live again.
      if (i.videoInputActive) fx.clearVideoInput();
      return;
    case "props":
      // No `is the logo live` guard (2026-09-17): the guard made the button a
      // SILENT no-op for any church without a theme logo, and clearing an
      // already-clear layer is idempotent and harmless.
      fx.clearLayer("logo");
      return;
    case "announcements":
      fx.clearAnnouncement();
      return;
    case "messages":
      fx.clearMessages();
      return;
    case "audio":
      return;
  }
}

/**
 * Clear All — every PP7 layer clear in rail order, plus the livestream lower
 * third. Deliberately NOT `liveLayers.clearAll()`, so camera, media and slide
 * all work normally afterwards.
 */
export function pp7ClearAll(i: Pp7LayerInputs, fx: Pp7ClearEffects): void {
  for (const layer of PP7_CLEAR_ORDER) pp7ClearLayer(layer, i, fx);
  fx.clearLowerThird?.();
}

/**
 * Whether the Messages layer is live. Shared by the shell and the panel so the
 * rail and the panel can never disagree. PP7 shows timers through Messages.
 */
export function pp7MessagesLive(d: {
  messagesShowing: boolean;
  boardHasVisible: boolean;
  timerShown: boolean;
  anyTimerSlotShown: boolean;
}): boolean {
  return d.messagesShowing || d.boardHasVisible || d.timerShown || d.anyTimerSlotShown;
}

/**
 * The button title/aria-label for one layer, identical on the rail and in the
 * panel so the two surfaces read the same. Unavailable layers say so rather
 * than looking like a working button.
 */
export function pp7ClearTitle(layer: Pp7ClearLayer, _active?: boolean): string {
  if (!PP7_LAYER_AVAILABLE[layer]) return `${PP7_CLEAR_LABEL[layer]} (coming soon)`;
  const key = PP7_CLEAR_KEY[layer];
  return `Clear ${PP7_CLEAR_LABEL[layer]}${key ? ` (${key})` : ""}`;
}
