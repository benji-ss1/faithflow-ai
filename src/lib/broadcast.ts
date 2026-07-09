"use client";

export type SlidePayload =
  | { kind: "text"; text: string; bgColor?: string }
  | { kind: "image"; url: string; fit?: "contain" | "cover" }
  | { kind: "video"; url: string; fit?: "contain" | "cover" }
  | { kind: "blank"; bgColor?: string }
  | { kind: "logo"; url?: string }
  | { kind: "empty" };

/**
 * Extended output state — one message shape drives every output surface
 * (audience/live projector, stage display, livestream). Each surface
 * consumes only the fields it needs.
 */
export type OutputState = {
  live: SlidePayload;                // audience/projector output
  next: SlidePayload | null;         // for stage display "Next up"
  itemTitle: string;                 // "Amazing Grace", "John 3:16"
  slideNumber: string;               // "3 / 7"
  aspectRatio: "16:9" | "4:3" | "custom";
  fitMode: "contain" | "fill" | "crop";
  safeArea: boolean;
  operatorMessage: string | null;    // stage display operator note
  lowerThird: { line1: string; line2: string } | null; // livestream overlay
  countdownEndsAt: number | null;    // ms epoch — stage countdown target
};

export type LiveMessage =
  | { type: "set"; slide: SlidePayload }              // legacy: just live surface
  | { type: "clear" }
  | { type: "ping" }
  | { type: "pong"; slide: SlidePayload }
  | { type: "output"; state: OutputState };            // new: full multi-surface state

const CHANNEL = "faithflow-live";

export function openLiveChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL);
  } catch (e) {
    console.warn("[broadcast] BroadcastChannel unavailable:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export function safePost(ch: BroadcastChannel | null, msg: LiveMessage): boolean {
  if (!ch) return false;
  try {
    ch.postMessage(msg);
    return true;
  } catch (e) {
    console.warn("[broadcast] postMessage failed:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

export const EMPTY_OUTPUT: OutputState = {
  live: { kind: "empty" },
  next: null,
  itemTitle: "",
  slideNumber: "",
  aspectRatio: "16:9",
  fitMode: "contain",
  safeArea: false,
  operatorMessage: null,
  lowerThird: null,
  countdownEndsAt: null,
};
