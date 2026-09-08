/**
 * src/engine — additive engine module (P0–P2 shipped).
 *
 * Pure TypeScript layer that sits between OperatorConsole's state and the
 * broadcast wire. Replaces nothing; existing code is untouched. See
 * docs/ENGINE_INTEGRATION.md for the full blueprint + corrections.
 */
export * from "./types";
export * from "./cue-sheet";
export * from "./actions";
export * from "./arrangements";
export * from "./timers";
export * from "./timers/overlay";
