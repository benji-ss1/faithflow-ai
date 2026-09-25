/**
 * What a stage widget SHOWS while you are designing it.
 *
 * ONE definition, imported by the editing canvas, the layout thumbnails and
 * the editor. Two copies is how the small picture and the thing you are
 * dragging start disagreeing about what a box is — the same class of bug that
 * produced four separate copies of the text-sizing formula.
 */
import { STAGE_WIDGET_LABELS, type StageWidget } from "@/engine/stage";

export function sampleText(w: StageWidget): string {
  switch (w.kind) {
    case "timer": return "0:00";
    case "clock": return "12:00";
    case "current_text": return "Words";
    case "next_text": return "Next";
    case "static_text": return w.text || "Text";
    default: return STAGE_WIDGET_LABELS[w.kind];
  }
}
