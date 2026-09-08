"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  SPRING_IDLE, SPRING_ARM_MS, springEnter, springLeave, springTick, isArmed, type SpringState,
} from "@/lib/spring-load";

// Thin React wrapper over the pure spring-load state machine (Wave 3, item 4).
// Manages the dwell timer; the reducer logic itself is tested in spring-load.ts.
// `enter(id)` while hovering a drop target, `leave(id)` on dragleave, `reset()`
// on drop/escape. `armed(id)` tells a row whether to show its armed affordance.
export function useSpringLoad(armMs = SPRING_ARM_MS) {
  const [state, setState] = useState<SpringState>(SPRING_IDLE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

  const enter = useCallback((id: string) => {
    setState((prev) => {
      const next = springEnter(prev, id, Date.now());
      if (next !== prev) {
        // Target changed → restart the dwell timer for the new target.
        clearTimer();
        timerRef.current = setTimeout(() => setState((s) => springTick(s, Date.now(), armMs)), armMs);
      }
      return next;
    });
  }, [armMs]);

  const leave = useCallback((id: string) => {
    setState((prev) => {
      const next = springLeave(prev, id);
      if (next !== prev) clearTimer();
      return next;
    });
  }, []);

  const reset = useCallback(() => { clearTimer(); setState(SPRING_IDLE); }, []);

  useEffect(() => () => clearTimer(), []); // clean up on unmount

  return {
    armedId: state.armed ? state.hoverId : null,
    armed: useCallback((id: string) => isArmed(state, id), [state]),
    hoverId: state.hoverId,
    enter,
    leave,
    reset,
  };
}
