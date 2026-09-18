"use client";
/**
 * ctx → PP7 layer model adapters. The ONLY place the operator shell context is
 * translated into `src/lib/pp7-layer-model.ts` inputs/effects, so the PP7 clear
 * rail and the PP7 Layers panel always read and clear the same things.
 */
import { useCallback, useMemo, useRef } from "react";
import type { OperatorShellCtx } from "../../shell/types";
import { setActiveBackgroundId } from "@/backgrounds/store/backgroundStore";
import { clearVideoInputLive } from "@/lib/video-input-clear";
import { pp7MessagesLive, type Pp7ClearEffects, type Pp7LayerInputs } from "@/lib/pp7-layer-model";
import { usePp7DrawOrder } from "@/lib/pp7-draw-order";
import type { TimerApi, MessagesApi, TimersApi, MessagesBoardApi } from "../hooks";

export function usePp7LayerInputs(ctx: OperatorShellCtx, messagesActive: boolean): Pp7LayerInputs {
  const rows = ctx.liveLayers.rows;
  const kind = ctx.liveSlide?.kind;
  const announcementActive = !!ctx.announcement;
  const backgroundSpecActive = !!ctx.background && ctx.background.type !== "none";
  const videoInputActive = !!ctx.videoInput;
  const pp7DrawOrder = usePp7DrawOrder();
  return useMemo<Pp7LayerInputs>(() => ({
    kind,
    rowActive: (id: string) => !!rows.find((r) => r.id === id)?.active,
    announcementActive,
    backgroundSpecActive,
    videoInputActive,
    messagesActive,
    pp7DrawOrder,
  }), [kind, rows, announcementActive, backgroundSpecActive, videoInputActive, messagesActive, pp7DrawOrder]);
}

export function usePp7ClearEffects(ctx: OperatorShellCtx, onClearMessages: () => void): Pp7ClearEffects {
  return useMemo<Pp7ClearEffects>(() => ({
    killSlide: () => ctx.onKill(),
    setBackgroundNone: () => setActiveBackgroundId("none"),
    clearLayer: (id: string) => ctx.liveLayers.clearLayer(id),
    clearVideoInput: () => clearVideoInputLive(),
    clearAnnouncement: () => ctx.onSetAnnouncement(null),
    clearMessages: onClearMessages,
    clearLowerThird: ctx.onClearLowerThird ? () => ctx.onClearLowerThird?.() : undefined,
  }), [ctx, onClearMessages]);
}

/**
 * Messages layer state + clear, shared by the shell (which feeds the rail) and
 * the PP7 Layers panel. PP7 shows timers THROUGH the Messages layer, so timers
 * light it and clear with it.
 */
export function usePp7Messages(api: {
  messages: MessagesApi;
  messagesBoard: MessagesBoardApi;
  timer: TimerApi;
  timers: TimersApi;
}): { active: boolean; clear: () => void } {
  const { messages, messagesBoard, timer, timers } = api;
  const active = pp7MessagesLive({
    messagesShowing: messages.state.showing,
    boardHasVisible: messagesBoard.active.some((m) => !m.hidden),
    timerShown: timer.state.shown,
    anyTimerSlotShown: timers.slots.some((t) => t.shown),
  });
  const ref = useRef(api);
  ref.current = api;
  const clear = useCallback(() => {
    const { messages: m, messagesBoard: b, timer: t1, timers: ts } = ref.current;
    m.hide();
    b.clearAll();
    t1.hide();
    for (const slot of ts.slots) if (slot.shown) ts.hide(slot.def.id);
  }, []);
  return { active, clear };
}
