// The slide/theme editor inspector — its sections, and the full inventory of
// every control that exists in it.
//
// WHY THIS FILE EXISTS: PR 4 regroups one long "Design" scroll into PP7's
// Shape / Text / Build vocabulary. That move is exactly the kind of change that
// silently loses a control, so this inventory was written FIRST, from the panel
// as it stood before the move, and `test/editor-inspector.test.ts` asserts every
// entry still exists afterwards (CLAUDE.md rule 0).
//
// `writes` names the object field each control sets, so the test checks what a
// control DOES, not just that a matching label survived somewhere.
//
// Labels are the operator-facing words. A volunteer has to recognise them, so
// they are deliberately plain ("Outline", not "Stroke"; "Corner radius", not
// "Border radius"), and the inventory freezes them: renaming one fails the test
// until it is renamed here too, deliberately.

export type InspectorSection = "shape" | "text" | "build";

export type InspectorControl = {
  /** Operator-facing label, exactly as rendered. */
  label: string;
  /** Which tab it belongs to after the regrouping. */
  section: InspectorSection;
  /** Which object kinds show it. "all" = every kind. */
  kinds: readonly ("all" | "text" | "shape" | "image" | "video")[];
  /** The object field(s) it writes. Empty ONLY for editor-state controls. */
  writes: readonly string[];
  /**
   * Some toggles render a label that changes with their state ("Loop on" /
   * "Loop off", "Muted" / "Sound on"). `labelPattern` is the source fragment the
   * inventory test looks for instead of an exact label match.
   */
  labelPattern?: string;
};

/**
 * PP7's Shape tab is position/size/transform/opacity/fill/stroke; its Text tab
 * is typography; its Build tab is per-object animation. Ours maps onto that.
 */
export const INSPECTOR_CONTROLS: readonly InspectorControl[] = [
  // ---- Shape: object-level geometry and arrangement (every kind) ----------
  { label: "Layer order", section: "shape", kinds: ["all"], writes: [] }, // reorders, doesn't patch a field
  { label: "Align X", section: "shape", kinds: ["all"], writes: ["x"] },
  { label: "Align Y", section: "shape", kinds: ["all"], writes: ["y"] },
  { label: "X", section: "shape", kinds: ["all"], writes: ["x"] },
  { label: "Y", section: "shape", kinds: ["all"], writes: ["y"] },
  { label: "W", section: "shape", kinds: ["all"], writes: ["w"] },
  { label: "H", section: "shape", kinds: ["all"], writes: ["h"] },
  { label: "Flip", section: "shape", kinds: ["all"], writes: ["flipH", "flipV"] },
  { label: "Rotation", section: "shape", kinds: ["all"], writes: ["rotation"] },
  { label: "Opacity", section: "shape", kinds: ["all"], writes: ["opacity"] },

  // ---- Shape: per-kind paint ---------------------------------------------
  { label: "Fill", section: "shape", kinds: ["shape"], writes: ["fill"] },
  { label: "Border", section: "shape", kinds: ["shape"], writes: ["stroke"] },
  { label: "Fill 2", section: "shape", kinds: ["shape"], writes: ["fill2"] },
  { label: "Angle", section: "shape", kinds: ["shape"], writes: ["fillAngle"] },
  { label: "Border width", section: "shape", kinds: ["shape"], writes: ["strokeWidth"] },
  { label: "Corner radius", section: "shape", kinds: ["shape"], writes: ["radius"] },
  { label: "Fit", section: "shape", kinds: ["image", "video"], writes: ["fit"] },
  { label: "Loop", section: "shape", kinds: ["video"], writes: ["loop"], labelPattern: "Loop ${" },
  { label: "Sound", section: "shape", kinds: ["video"], writes: ["muted"], labelPattern: "? \"Muted\" : \"Sound on\"" },

  // ---- Text --------------------------------------------------------------
  { label: "Text", section: "text", kinds: ["text"], writes: ["text"] },
  { label: "Font", section: "text", kinds: ["text"], writes: ["fontFamily"] },
  { label: "Size (px)", section: "text", kinds: ["text"], writes: ["fontSize"] },
  { label: "Weight", section: "text", kinds: ["text"], writes: ["fontWeight"] },
  { label: "Colour", section: "text", kinds: ["text"], writes: ["color"] },
  { label: "Align", section: "text", kinds: ["text"], writes: ["align"] },
  { label: "Italic", section: "text", kinds: ["text"], writes: ["italic"] },
  { label: "Underline", section: "text", kinds: ["text"], writes: ["underline"] },
  { label: "Uppercase", section: "text", kinds: ["text"], writes: ["uppercase"] },
  { label: "Shadow", section: "text", kinds: ["text"], writes: ["shadow"] },
  { label: "Line height", section: "text", kinds: ["text"], writes: ["lineHeight"] },
  { label: "Letter spacing", section: "text", kinds: ["text"], writes: ["letterSpacing"] },
  { label: "Outline", section: "text", kinds: ["text"], writes: ["stroke"] },
  { label: "Outline width", section: "text", kinds: ["text"], writes: ["strokeWidth"] },

  // ---- Build (per-object entrance animation) ------------------------------
  { label: "Entrance", section: "build", kinds: ["all"], writes: ["anim", "animDelayMs"] },
] as const;

export const INSPECTOR_SECTIONS: readonly { id: InspectorSection; label: string }[] = [
  { id: "shape", label: "Shape" },
  { id: "text", label: "Text" },
  { id: "build", label: "Build" },
] as const;

export function controlsFor(section: InspectorSection): InspectorControl[] {
  return INSPECTOR_CONTROLS.filter((c) => c.section === section);
}

/**
 * Which sections to show for the selected object kind. A tab with nothing in it
 * is not rendered at all — an empty "Text" tab on a shape would read as a
 * broken feature, and an always-present tab that is always empty is a fake
 * control (PP7_REBUILD_PLAN §4).
 */
export function sectionsForKind(kind: "text" | "shape" | "image" | "video"): InspectorSection[] {
  return INSPECTOR_SECTIONS
    .filter((s) => controlsFor(s.id).some((c) => c.kinds.includes("all") || c.kinds.includes(kind)))
    .map((s) => s.id);
}

/**
 * Controls the CURRENT build has that do nothing yet. Reported to the owner
 * rather than carried quietly into a new tab.
 *
 * Empty, and it must stay empty: every control in the inventory above writes a
 * field a renderer reads. Anything added here needs the owner's sign-off, not a
 * nicer tab to hide in.
 */
export const DEAD_CONTROLS: readonly string[] = [] as const;
