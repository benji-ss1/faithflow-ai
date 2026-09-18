// The object types the slide/theme editor can add to a slide.
//
// ProPresenter puts these on a toolbar above the canvas; we had them only in the
// right drawer's "Add" tab. This list is the single source of truth for BOTH
// surfaces, so the toolbar and the drawer can never drift apart and a new object
// kind can never be added to one and forgotten in the other.
//
// `source` names the editor handler each entry drives:
//   "text" | "rect" | "ellipse" -> editor.addTextObject / addShape(kind)
//   "image" | "video"           -> open the media library, then addImage/addVideo
//
// Only kinds our renderers actually support appear here. PP7 also offers video
// input, website and parametric arrow/star objects; those are deliberately
// ABSENT per the no-fake-controls policy (PP7_REBUILD_PLAN §4) — see
// docs/THEME_EDITOR_PARITY_PLAN.md §3.

export type EditorObjectSource = "text" | "rect" | "ellipse" | "image" | "video";

export type EditorToolbarItem = {
  source: EditorObjectSource;
  /** Visible label AND the accessible name. Never a glyph — Windows rule. */
  label: string;
  /** True when picking it opens the media library before inserting. */
  needsMedia: boolean;
};

export const OBJECT_TOOLBAR_ITEMS: readonly EditorToolbarItem[] = [
  { source: "text", label: "Text", needsMedia: false },
  { source: "rect", label: "Rectangle", needsMedia: false },
  { source: "ellipse", label: "Ellipse", needsMedia: false },
  { source: "image", label: "Image", needsMedia: true },
  { source: "video", label: "Video", needsMedia: true },
] as const;

/** Every object kind the toolbar can produce, for coverage assertions. */
export function toolbarSources(): EditorObjectSource[] {
  return OBJECT_TOOLBAR_ITEMS.map((i) => i.source);
}
