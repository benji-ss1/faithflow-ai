// Phase 5D — rich slide object model. Coordinates are 1920x1080 virtual space.
// Renderers scale to actual paint area. When editable.objects.length === 0 we
// fall back to `lyrics` as one full-slide text object so legacy song slides
// keep working without a data migration.
import type { SlidePayload } from "./broadcast";

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

export type TextObject = {
  id: string;
  kind: "text";
  x: number; y: number; w: number; h: number;
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  align?: "left" | "center" | "right";
  italic?: boolean;
  underline?: boolean;
};

export type ShapeObject = {
  id: string;
  kind: "shape";
  x: number; y: number; w: number; h: number;
  shape: "rect" | "ellipse";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  opacity?: number;
};

export type ImageObject = {
  id: string;
  kind: "image";
  x: number; y: number; w: number; h: number;
  url: string;
  fit?: "contain" | "cover";
};

export type SlideObject = TextObject | ShapeObject | ImageObject;

export type SlideTransition = {
  effectId: string;
  durationMs: number;
  easing: string;
};

export type EditableSlide = {
  id: string;
  bgColor?: string;
  bgImageUrl?: string;
  objects: SlideObject[];
  // Phase 5D-2 — optional per-slide default transition
  transition?: SlideTransition;
  // Legacy fallback — if objects is empty, we render this as one full-slide
  // text object so pre-Phase-5D song slides still work.
  lyrics?: string;
};

// ---------- Factories -------------------------------------------------------

let _idCounter = 0;
export function newObjectId(): string {
  _idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `obj_${Date.now().toString(36)}_${_idCounter}_${rand}`;
}

export function emptyTextObject(x = 80, y = 400, w = 1760, h = 280, text = "New text"): TextObject {
  return {
    id: newObjectId(), kind: "text",
    x, y, w, h, text,
    fontFamily: "Inter", fontSize: 96, fontWeight: 600,
    color: "#ffffff", align: "center",
  };
}

export function emptyShape(shape: "rect" | "ellipse" = "rect"): ShapeObject {
  return {
    id: newObjectId(), kind: "shape",
    x: 760, y: 440, w: 400, h: 200,
    shape,
    fill: "#14b8a6", stroke: "#0f766e", strokeWidth: 0, radius: 12, opacity: 1,
  };
}

export function emptyImage(url: string): ImageObject {
  return {
    id: newObjectId(), kind: "image",
    x: 660, y: 340, w: 600, h: 400,
    url, fit: "contain",
  };
}

// Synthesize a single full-canvas text object from legacy lyrics so the
// operator can edit legacy slides without a data migration.
export function fromLegacyLyrics(id: string, lyrics: string): EditableSlide {
  return {
    id,
    objects: [{
      ...emptyTextObject(0, 0, CANVAS_W, CANVAS_H, lyrics),
    }],
    lyrics,
  };
}

// Normalize a slide row from the DB into an EditableSlide. If objectsJson
// is present and non-empty use it; else fall back to a synthesized text obj.
export function normalizeEditableSlide(row: {
  id: string;
  lyrics: string;
  objectsJson?: unknown;
}): EditableSlide {
  const raw = row.objectsJson as Partial<EditableSlide> | null | undefined;
  if (raw && Array.isArray(raw.objects) && raw.objects.length > 0) {
    return {
      id: row.id,
      bgColor: raw.bgColor,
      bgImageUrl: raw.bgImageUrl,
      objects: raw.objects as SlideObject[],
      transition: raw.transition,
      lyrics: row.lyrics,
    };
  }
  return fromLegacyLyrics(row.id, row.lyrics);
}

// ---------- Projector compat ------------------------------------------------
// The projector still consumes SlidePayload. Until per-object projector
// rendering ships (Run 2/3), collapse an EditableSlide into a text payload
// carrying the concatenated visible text so /live doesn't break.
export function slidePayloadFromEditable(slide: EditableSlide): SlidePayload {
  const textParts = slide.objects
    .filter((o): o is TextObject => o.kind === "text")
    .map((o) => o.text)
    .filter((t) => typeof t === "string" && t.trim().length > 0);
  const text = textParts.length > 0
    ? textParts.join("\n")
    : (slide.lyrics ?? "");
  return { kind: "text", text, bgColor: slide.bgColor };
}

// Extract visible text (for `lyrics` regeneration + downstream lyric matching)
export function extractLyricsFromEditable(slide: EditableSlide): string {
  const parts = slide.objects
    .filter((o): o is TextObject => o.kind === "text")
    .map((o) => o.text?.trim() ?? "")
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : (slide.lyrics ?? "");
}
