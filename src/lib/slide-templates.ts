// Built-in slide starter templates — professional layouts an operator can apply
// to a slide in the editor instead of building from a blank canvas. Each build()
// returns fresh objects (new ids each call) in the 1920×1080 canvas space, plus
// an optional background. Purely client-side; produces standard SlideObjects the
// editor + projector already render.
import { newObjectId, CANVAS_W, type SlideObject, type TextObject, type ShapeObject, type EditableSlide } from "./slide-objects";

function t(o: Partial<TextObject> & { text: string }): TextObject {
  return {
    id: newObjectId(), kind: "text",
    x: 160, y: 0, w: 1600, h: 200,
    fontFamily: "Inter", fontSize: 96, fontWeight: 600, color: "#ffffff", align: "center",
    ...o,
  };
}
function shape(o: Partial<ShapeObject>): ShapeObject {
  return {
    id: newObjectId(), kind: "shape",
    x: 0, y: 0, w: 200, h: 12, shape: "rect",
    fill: "#14b8a6", opacity: 1, radius: 4,
    ...o,
  };
}

export type SlideTemplate = {
  id: string;
  name: string;
  build: () => Pick<EditableSlide, "objects" | "bgColor">;
};

export const SLIDE_TEMPLATES: SlideTemplate[] = [
  {
    id: "title", name: "Title",
    build: () => ({
      objects: [
        t({ text: "Title", y: 360, h: 240, fontSize: 150, fontWeight: 800 }),
        t({ text: "Subtitle", y: 630, h: 120, fontSize: 64, fontWeight: 400, color: "#cbd5e1" }),
      ] as SlideObject[],
    }),
  },
  {
    id: "scripture", name: "Scripture",
    build: () => ({
      objects: [
        t({ text: "For God so loved the world…", y: 260, h: 520, fontSize: 100, fontWeight: 600 }),
        t({ text: "John 3:16", y: 830, h: 100, fontSize: 56, fontWeight: 500, color: "#94a3b8" }),
      ] as SlideObject[],
    }),
  },
  {
    id: "announcement", name: "Announcement",
    build: () => ({
      objects: [
        shape({ x: 160, y: 300, w: 220, h: 14 }),
        t({ text: "Announcement", x: 160, y: 340, w: 1600, h: 170, fontSize: 120, fontWeight: 800, align: "left" }),
        t({ text: "Details go here.", x: 160, y: 540, w: 1600, h: 360, fontSize: 60, fontWeight: 400, color: "#e2e8f0", align: "left" }),
      ] as SlideObject[],
    }),
  },
  {
    id: "two-column", name: "Two-column",
    build: () => ({
      objects: [
        t({ text: "Left column", x: 120, y: 300, w: 800, h: 480, fontSize: 72, align: "left" }),
        t({ text: "Right column", x: 1000, y: 300, w: 800, h: 480, fontSize: 72, align: "left" }),
      ] as SlideObject[],
    }),
  },
  {
    id: "lower-third", name: "Lower third",
    build: () => ({
      objects: [
        shape({ x: 0, y: 820, w: CANVAS_W, h: 200, fill: "#000000", opacity: 0.6, radius: 0 }),
        t({ text: "Name", x: 120, y: 850, w: 1400, h: 90, fontSize: 72, fontWeight: 700, align: "left" }),
        t({ text: "Role / Title", x: 120, y: 945, w: 1400, h: 60, fontSize: 44, fontWeight: 400, color: "#cbd5e1", align: "left" }),
      ] as SlideObject[],
    }),
  },
];
