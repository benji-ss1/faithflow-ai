/*
 * OpenFlow shared types — the single source of truth for the mode set, imported
 * by the hook, the context builder, and the chat route so they can never drift.
 */
export type OpenFlowMode = "chat" | "service_builder" | "scripture" | "songs" | "image_generator";

/** The valid modes as a runtime tuple — the route validates against this, so
 *  adding a mode in one place surfaces everywhere. */
export const OPENFLOW_MODES = ["chat", "service_builder", "scripture", "songs", "image_generator"] as const satisfies readonly OpenFlowMode[];

/** Callbacks the structured cards use to act on the operator's real service —
 *  supplied by OpenFlowPanel (which holds the shell ctx). */
export type OpenFlowActions = {
  planId: string;
  /** Project scripture verses to the live output (uses the shell's send-to-live). */
  projectScripture: (verses: { verse: number; text: string }[], reference: string) => void;
  /** Called after a card mutates the plan, so the sidebar playlist refreshes. */
  onApplied: () => void;
  /** Seed the composer (e.g. the "Edit" button on a plan). */
  onSeedComposer: (text: string) => void;
  /** Re-run the last request (the "Regenerate" button). */
  onRegenerate: () => void;
};
