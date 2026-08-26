/*
 * OpenFlow shared types — the single source of truth for the mode set, imported
 * by the hook, the context builder, and the chat route so they can never drift.
 */
export type OpenFlowMode = "chat" | "service_builder" | "scripture" | "songs" | "image_generator";

/** The valid modes as a runtime tuple — the route validates against this, so
 *  adding a mode in one place surfaces everywhere. */
export const OPENFLOW_MODES = ["chat", "service_builder", "scripture", "songs", "image_generator"] as const satisfies readonly OpenFlowMode[];
