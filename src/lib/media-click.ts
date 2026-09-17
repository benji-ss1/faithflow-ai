/**
 * What a plain CLICK on a media tile does (Media Bin + Media library).
 * User-directed 2026-09-17: a click sends the media LIVE as a slide. It must
 * never change the background behind every slide — only the explicit "Bg"
 * button / "Set as background" actions do that. Audio can't be projected.
 * Pure + test-locked (test/media-click-sends-live.test.ts).
 */
export type MediaClickAction = "send-live" | "audio-blocked";

export function mediaClickAction(kind: string | null | undefined): MediaClickAction {
  const k = (kind || "").toLowerCase();
  if (k === "audio" || k.startsWith("audio/")) return "audio-blocked";
  return "send-live";
}

export const AUDIO_NOT_PROJECTABLE_MESSAGE = "Audio can't be shown on screen — playback from the Media Bin is coming soon";
