/**
 * ProPresenter 7 clear model — pure, node-testable.
 *
 * PP7's clear rail sits on the right edge of the preview. Buttons top→bottom
 * (verified from PP7 screenshots, docs/PP7_BLUEPRINT.md): Audio, Messages,
 * Props, Announcements, Slide, Media, Video Input. Clear All is the circled ✕.
 * Each button clears ONLY its own layer. Official shortcuts: F1 Clear All,
 * F2 Slide, F3 Media, F4 Props, F5 Audio, F6 Messages, F7 Announcements.
 */

export type Pp7ClearLayer = "audio" | "messages" | "props" | "announcements" | "slide" | "media" | "videoInput";

/** Rail order, top → bottom (PP7). */
export const PP7_CLEAR_ORDER: readonly Pp7ClearLayer[] = [
  "audio", "messages", "props", "announcements", "slide", "media", "videoInput",
];

export const PP7_CLEAR_LABEL: Record<Pp7ClearLayer, string> = {
  audio: "Audio",
  messages: "Messages",
  props: "Props",
  announcements: "Announcements",
  slide: "Slide",
  media: "Media",
  videoInput: "Video Input",
};

export const PP7_CLEAR_KEY: Record<Pp7ClearLayer, string> = {
  slide: "F2",
  media: "F3",
  props: "F4",
  audio: "F5",
  messages: "F6",
  announcements: "F7",
  videoInput: "",
};

/**
 * CLEAR GROUPS (PP7 7.7+). A named clear that hits several layers at once.
 *
 * ProPresenter builds Clear All itself as an EDITABLE group, and warns that if
 * you edit it you no longer have a clear that truly clears everything. Victor
 * (2026-09-18) signed off NOT copying that flaw: our Clear All stays FIXED and
 * always clears everything, and named groups sit ALONGSIDE it. So the panic
 * button can never be broken by a configuration change.
 *
 * "All But Video Input" is ProPresenter's own worked example and the one that
 * matters most here: with IMAG, an operator needs to dump every graphic while
 * leaving the camera on screen. Until now they had no safe way to do that —
 * Clear All killed the camera too, so they cleared layers one at a time under
 * pressure.
 */
export type Pp7ClearGroup = {
  id: string;
  name: string;
  /** Cleared in rail order regardless of the order written here. */
  layers: readonly Pp7ClearLayer[];
  /** Put the church logo on the projector once the layers are clear. */
  toLogo?: boolean;
  /** Bare F-key, if it has one. */
  key?: string;
  /** Shown on hover so an operator knows what it will do BEFORE pressing it. */
  description: string;
};

const ALL_LAYERS = PP7_CLEAR_ORDER;

export const PP7_CLEAR_GROUPS: readonly Pp7ClearGroup[] = [
  {
    id: "all-but-video-input",
    name: "All But Video Input",
    layers: ALL_LAYERS.filter((l) => l !== "videoInput"),
    description: "Clears every layer but leaves the camera on screen (IMAG).",
  },
  {
    id: "to-logo",
    name: "Clear to Logo",
    // PP7's docs verify it clears the Media layer and sends the logo there.
    // Whether it also clears Props / Announcements / Video Input is NOT
    // documented (their guide pages are down — flagged [?] in PP7_LAYERS_SPEC).
    // We clear the content layers and leave the CAMERA, because "clear to logo"
    // is an end-of-service action and killing a live IMAG feed with it would be
    // a nasty surprise. Revisit if a real PP7 install says otherwise.
    layers: ALL_LAYERS.filter((l) => l !== "videoInput"),
    toLogo: true,
    key: "F12",
    description: "Clears the screen and shows the church logo.",
  },
];

export function pp7ClearGroupById(id: string): Pp7ClearGroup | undefined {
  return PP7_CLEAR_GROUPS.find((g) => g.id === id);
}

export type Pp7ClearTarget = Pp7ClearLayer | "all" | { group: string };

/**
 * Second Clear All binding (2026-09-17). A default Mac keyboard sends F1 to the
 * display-brightness control, so PP7's F1 does nothing until the operator turns
 * on "Use F1, F2 etc. as standard function keys" — the same press that "does
 * nothing" in the field reports. Cmd/Ctrl+Shift+C works on every platform and
 * on every keyboard, and does not collide with an existing operator hotkey.
 * F1 is unchanged.
 */
export const PP7_CLEAR_ALL_CHORD = { mod: true, shift: true, key: "C" } as const;

/**
 * Map a keydown to a PP7 clear. Plain F-keys, plus the Clear All chord
 * (Cmd/Ctrl+Shift+C) which is the only modifier combination accepted.
 */
export function decodePp7ClearKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }): Pp7ClearTarget | null {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && (e.key === "C" || e.key === "c")) return "all";
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  switch (e.key) {
    case "F1": return "all";
    // PP7's Clear to Logo. Same key on Mac and Windows.
    case "F12": return { group: "to-logo" };
    case "F2": return "slide";
    case "F3": return "media";
    case "F4": return "props";
    case "F5": return "audio";
    case "F6": return "messages";
    case "F7": return "announcements";
    default: return null;
  }
}

/** Which slide kinds belong on PP7's Media layer rather than the Slide layer. */
export function isMediaSlideKind(kind: string | undefined): boolean {
  return kind === "image" || kind === "video";
}

/** Which slide kinds show nothing (so the Slide layer is empty). */
export function isEmptySlideKind(kind: string | undefined): boolean {
  return !kind || kind === "empty" || kind === "blank";
}
