// Desktop-app announcement bar config. Set `ANNOUNCEMENT` to show a dismissible
// banner across the top of the operator for updates / big news; set it back to
// `null` to hide it. Bump `id` whenever the message changes so it re-shows even
// for operators who dismissed the previous one (dismissal is keyed by id).

export type Announcement = {
  /** Unique id — change it to re-surface a dismissed bar. */
  id: string;
  /** The message shown in the bar. Keep it short. */
  message: string;
  /** Optional call-to-action link. */
  ctaLabel?: string;
  ctaHref?: string;
  /** Visual tone. "brand" = orange (default), "info" = blue. */
  tone?: "brand" | "info";
};

// No active announcement right now. Example:
//   export const ANNOUNCEMENT: Announcement | null = {
//     id: "2026-08-wave-one",
//     message: "Wave One is live — thanks for helping shape PresentFlow.",
//     ctaLabel: "What's new",
//     ctaHref: "/operator",
//     tone: "brand",
//   };
export const ANNOUNCEMENT: Announcement | null = null;
