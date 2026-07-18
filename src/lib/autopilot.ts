// Autopilot state machine — pure, deterministic, unit-testable. Not tied
// to React so the operator console can run the same logic that a server
// action or worker would run. Consumers pass in the current state + an
// event + the church preferences; get back the next state + a reason
// string that goes straight into the suggestion history for auditability.

export type AutopilotState =
  | "idle"          // AI listening off, or no active suggestion
  | "listening"    // mic on, waiting for a detection
  | "detected"     // suggestion arrived, awaiting decision
  | "staged"       // suggestion sits in Preview
  | "live"         // suggestion pushed to Live
  | "rejected"
  | "edited";     // operator amended payload before staging

export type AutopilotEvent =
  | { kind: "listen_on" }
  | { kind: "listen_off" }
  // `detectionType` is carried through so the state machine can enforce the
  // "songs never auto-project" invariant (CLAUDE.md rule 7) at the core layer.
  // Older callers omitting it are treated as scripture (safest — scripture IS
  // allowed to auto-live).
  | { kind: "detection"; confidence: number; detectionType?: "scripture" | "song" | "lyric" | "command" | "other" }
  | { kind: "manual_approve" }
  | { kind: "manual_reject" }
  | { kind: "manual_edit" }
  | { kind: "send_live" }
  | { kind: "clear" };

export type AutopilotPrefs = {
  autoApproveEnabled: boolean;
  autoApproveThreshold: number;   // 0-100
  autoSendToLive: boolean;
};

export type ActionTaken =
  | "auto_approved"
  | "manual_approved"
  | "rejected"
  | "edited"
  | null;

export type Transition = {
  next: AutopilotState;
  reason: string;
  actionTaken: ActionTaken;
};

export function transition(
  current: AutopilotState,
  event: AutopilotEvent,
  prefs: AutopilotPrefs,
): Transition {
  switch (event.kind) {
    case "listen_on":
      return { next: "listening", reason: "AI listening enabled", actionTaken: null };
    case "listen_off":
      return { next: "idle", reason: "AI listening disabled", actionTaken: null };
    case "detection": {
      if (prefs.autoApproveEnabled && event.confidence >= prefs.autoApproveThreshold) {
        // CLAUDE.md rule 7 invariant, enforced here at the core state machine
        // (not just in the UI wiring) so any future auto-approve caller
        // — plugin, hotkey, server action — cannot accidentally push lyrics
        // to Live during preaching. Songs / lyrics ALWAYS route to "staged".
        const isSong = event.detectionType === "song" || event.detectionType === "lyric";
        const next: AutopilotState = (prefs.autoSendToLive && !isSong) ? "live" : "staged";
        const reason = isSong && prefs.autoSendToLive
          ? `Auto-approved (staged, songs/lyrics never auto-live — copyright policy)`
          : `Auto-approved at ${event.confidence}% (floor ${prefs.autoApproveThreshold}%${prefs.autoSendToLive ? ", auto-live on" : ""})`;
        return { next, reason, actionTaken: "auto_approved" };
      }
      return {
        next: "detected",
        reason: `Detected at ${event.confidence}% — awaiting operator${prefs.autoApproveEnabled ? ` (below floor ${prefs.autoApproveThreshold}%)` : ""}`,
        actionTaken: null,
      };
    }
    case "manual_approve":
      return { next: "staged", reason: "Operator approved", actionTaken: "manual_approved" };
    case "manual_reject":
      return { next: "rejected", reason: "Operator rejected", actionTaken: "rejected" };
    case "manual_edit":
      return { next: "edited", reason: "Operator edited before staging", actionTaken: "edited" };
    case "send_live":
      if (current !== "staged" && current !== "edited") {
        return { next: current, reason: "send_live ignored — nothing staged", actionTaken: null };
      }
      return { next: "live", reason: "Sent to Live", actionTaken: null };
    case "clear":
      return { next: prefs.autoApproveEnabled ? "listening" : "idle", reason: "Cleared", actionTaken: null };
  }
}
