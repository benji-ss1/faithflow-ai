"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Task 8 — debounce interim transcript renders.
 *
 * Deepgram emits interim results ~5-10Hz; each one currently triggers a React
 * state commit which cascades through the transcript panel and the AI chip
 * strip. On slow machines this is jittery + wasteful.
 *
 * This helper only pushes a new value out when EITHER:
 *   - the delta from the last pushed value is >= minDeltaChars, OR
 *   - the wall-clock delta from the last push is >= minDeltaMs
 *
 * Final flushes always happen on empty input (the interim "resets" between
 * utterances) so operators never see a stuck stale interim.
 */
export function useDebouncedInterim(text: string, minDeltaChars = 3, minDeltaMs = 300): string {
  const [out, setOut] = useState<string>(text);
  const lastPushedRef = useRef<string>(text);
  const lastAtRef = useRef<number>(Date.now());

  useEffect(() => {
    if (text === lastPushedRef.current) return;
    // Always flush on empty (utterance boundary) so stale text can't linger.
    if (text.length === 0) {
      lastPushedRef.current = "";
      lastAtRef.current = Date.now();
      setOut("");
      return;
    }
    const now = Date.now();
    const charDelta = Math.abs(text.length - lastPushedRef.current.length);
    const msDelta = now - lastAtRef.current;
    if (charDelta >= minDeltaChars || msDelta >= minDeltaMs) {
      lastPushedRef.current = text;
      lastAtRef.current = now;
      setOut(text);
    }
  }, [text, minDeltaChars, minDeltaMs]);

  return out;
}
