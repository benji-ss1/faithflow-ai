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

// DYNAMIC announcement — driven by the changelog so it updates itself. Every time
// a new What's-New entry ships (a new version at the TOP of CHANGELOG), the bar
// automatically shows that headline and, because the id is keyed to the version,
// re-surfaces for everyone who dismissed the previous one — no manual editing here.
// "See what's new" (ctaHref "#whats-new") opens the What's New modal in place.
import { CHANGELOG } from "@/lib/changelog";

function buildAnnouncement(): Announcement | null {
  const latest = CHANGELOG[0];
  if (!latest) return null;
  return {
    id: `whatsnew-${latest.version}`,
    message: `New in ${latest.version}: ${latest.headline}`,
    ctaLabel: "See what's new",
    ctaHref: "#whats-new",
    tone: "brand",
  };
}

export const ANNOUNCEMENT: Announcement | null = buildAnnouncement();
