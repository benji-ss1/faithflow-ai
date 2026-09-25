/**
 * The plain text of a slide, for surfaces that show WORDS rather than render a
 * slide — a stage layout's current_text / next_text widgets, and the MultiView
 * tile that mirrors them.
 *
 * ONE copy, shared. /stage had this inline and MultiView needed the same thing;
 * a second copy is how the operator's dashboard and the monitor it claims to
 * mirror start disagreeing about what is on screen.
 *
 * Returns "" for media slides, which is honest: there are no words to show.
 */
import type { SlidePayload } from "./broadcast";

export function slideText(s: SlidePayload | null | undefined): string {
  if (!s || typeof s !== "object") return "";
  const o = s as Record<string, unknown>;
  if (typeof o.text === "string") return o.text;
  if (Array.isArray(o.lines)) return (o.lines as unknown[]).filter((l) => typeof l === "string").join("\n");
  if (typeof o.body === "string") return o.body;
  return "";
}
