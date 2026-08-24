"use client";
import { useRef, useState } from "react";
import { X, Lock, Image as ImageIcon, Upload, Loader2, Play, Type, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { SlidePayload, TransitionSpec, ThemeAppearance } from "@/lib/broadcast";
import { newObjectId, CANVAS_W, CANVAS_H, type TextObject, type ImageObject, type ShapeObject } from "@/lib/slide-objects";
import { SlideRenderer } from "@/components/live/SlideRenderer";

/**
 * ScriptureSlideEditor — "edit slide" for scripture (Bible / memory verses).
 *
 * Replicates the SONG slide editor's styling capabilities, with ONE hard rule:
 * the verse text is IMMUTABLE. Operators can change font, size, weight, colour,
 * alignment, italic, uppercase, shadow, outline, line-height, letter-spacing,
 * background colour, and a background image (uploaded from their computer) — but
 * never the words of scripture (sourced from the Bible library, shown read-only).
 *
 * Self-contained: does NOT touch the song editor (useSlideEditor /
 * DesktopSlideEditorModal), so songs stay safe. Renders through the shared
 * object path: [background object, locked text object] → SlideObjectsLayer, so
 * every control actually applies AND the live SlideRenderer gives a true WYSIWYG
 * preview (theme + all styling exactly as it will project).
 */

const FONTS = ["Inter", "Sora", "Plus Jakarta Sans", "Georgia", "Helvetica", "Arial", "Times New Roman"];
const WEIGHTS = [400, 500, 600, 700, 800];

export type ScriptureDesign = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  italic: boolean;
  uppercase: boolean;
  shadow: boolean;
  stroke: string;
  strokeWidth: number;
  lineHeight: number;
  letterSpacing: number;
  bgColor: string;
  bgImageUrl: string;
  bgFit: "cover" | "contain";
};

const DEFAULT_DESIGN: ScriptureDesign = {
  fontFamily: "Sora", fontSize: 96, fontWeight: 700, color: "#ffffff", align: "center",
  italic: false, uppercase: false, shadow: true, stroke: "#000000", strokeWidth: 0,
  lineHeight: 1.15, letterSpacing: 0,
  bgColor: "#0a0a0a", bgImageUrl: "", bgFit: "cover",
};

export function ScriptureSlideEditor({
  verse, initial, appearance, onClose, onShow, transition,
}: {
  verse: { text: string; reference: string };
  initial?: Partial<ScriptureDesign>;
  appearance?: ThemeAppearance | null;
  onClose: () => void;
  onShow: (slide: SlidePayload, transition?: TransitionSpec | null) => void;
  transition?: TransitionSpec | null;
}) {
  const [d, setD] = useState<ScriptureDesign>({ ...DEFAULT_DESIGN, ...initial });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<ScriptureDesign>) => setD((prev) => ({ ...prev, ...patch }));

  // Upload an image from the computer → S3 (presign → PUT → persistent URL).
  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const presign = await fetch("/api/media/presign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, purpose: "media" }),
      }).then((r) => r.json()) as { url?: string; key?: string; error?: string };
      if (presign.error || !presign.url || !presign.key) throw new Error(presign.error || "Presign failed");
      const put = await fetch(presign.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("Upload failed");
      const got = await fetch("/api/media/url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: presign.key }),
      }).then((r) => r.json()) as { url?: string; error?: string };
      if (got.error || !got.url) throw new Error(got.error || "Could not get URL");
      set({ bgImageUrl: got.url });
      toast.success("Image added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // Build the slide as a DESIGNED slide: a full-canvas background object +
  // the locked verse text object. This forces the renderer's object path so
  // every style control (size/uppercase/shadow/outline/spacing) actually
  // applies, and the preview matches the projector exactly.
  function buildPayload(): SlidePayload {
    const bgObject: ImageObject | ShapeObject = d.bgImageUrl
      ? { id: newObjectId(), kind: "image", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, url: d.bgImageUrl, fit: d.bgFit, locked: true }
      : { id: newObjectId(), kind: "shape", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, shape: "rect", fill: d.bgColor, strokeWidth: 0, radius: 0, locked: true };
    const textObject: TextObject = {
      id: newObjectId(), kind: "text",
      x: 80, y: 0, w: CANVAS_W - 160, h: CANVAS_H,
      text: verse.text,
      fontFamily: d.fontFamily, fontSize: d.fontSize, fontWeight: d.fontWeight,
      color: d.color, align: d.align, italic: d.italic, uppercase: d.uppercase,
      shadow: d.shadow, stroke: d.stroke, strokeWidth: d.strokeWidth,
      lineHeight: d.lineHeight, letterSpacing: d.letterSpacing,
      locked: true,
    };
    return {
      kind: "text",
      text: verse.text,
      reference: verse.reference,
      bgColor: d.bgColor,
      ...(d.bgImageUrl ? { bgImageUrl: d.bgImageUrl } : {}),
      objects: [bgObject, textObject],
    };
  }

  function show() {
    onShow(buildPayload(), transition);
    toast.success("Sent to projector");
  }

  const btn = "h-8 px-2 rounded-md text-xs border inline-flex items-center justify-center gap-1";
  const bstyle = { borderColor: "#2a3232", background: "#1a2020", color: "#e4e4e7" } as React.CSSProperties;
  const toggle = (on: boolean) => ({ ...bstyle, borderColor: on ? "#2dd4bf" : "#2a3232", color: on ? "#5eead4" : "#e4e4e7" });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.72)" }} onClick={onClose}>
      <div
        className="flex flex-col rounded-xl border overflow-hidden"
        style={{ width: "min(1080px, 95vw)", height: "min(720px, 92vh)", borderColor: "#2a3232", background: "#1e2525" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b" style={{ borderColor: "#2a3232" }}>
          <Type className="w-4 h-4 text-teal-300" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-zinc-100 leading-none">Edit scripture slide</div>
            <div className="text-[10px] text-zinc-500 leading-none mt-1">{verse.reference}</div>
          </div>
          <button onClick={show} className="h-8 px-3 rounded-md text-xs font-bold inline-flex items-center gap-1.5 bg-teal-500 text-[#08110f] hover:bg-teal-400">
            <Play className="w-3.5 h-3.5" /> Show to projector
          </button>
          <button onClick={onClose} title="Close" className="h-8 w-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* WYSIWYG preview — the actual live renderer */}
          <div className="flex-1 min-w-0 flex items-center justify-center p-6" style={{ background: "#141a1a" }}>
            <div className="w-full rounded-lg overflow-hidden border shadow-2xl" style={{ aspectRatio: "16 / 9", borderColor: "#2a3232" }}>
              <SlideRenderer slide={buildPayload()} appearance={appearance ?? undefined} />
            </div>
          </div>

          {/* Controls */}
          <div className="w-[330px] shrink-0 border-l overflow-y-auto" style={{ borderColor: "#2a3232", background: "#1e2525" }}>
            <Section label="Scripture (locked)">
              <div className="rounded-md border p-2.5 text-[12px] leading-relaxed text-zinc-300 max-h-24 overflow-y-auto" style={{ borderColor: "#2a3232", background: "#161c1c" }}>
                {verse.text}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
                <Lock className="w-3 h-3" /> The words of scripture can’t be changed — only the styling.
              </div>
            </Section>

            <Section label="Text">
              <Row label="Font">
                <select value={d.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} className={btn + " w-full"} style={bstyle}>
                  {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </Row>
              <Row label="Size">
                <div className="flex items-center gap-2">
                  <input type="range" min={40} max={200} step={2} value={d.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} className="flex-1" />
                  <span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{d.fontSize}</span>
                </div>
              </Row>
              <Row label="Weight">
                <select value={d.fontWeight} onChange={(e) => set({ fontWeight: Number(e.target.value) })} className={btn + " w-full"} style={bstyle}>
                  {WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </Row>
              <Row label="Colour">
                <input type="color" value={d.color} onChange={(e) => set({ color: e.target.value })} className="h-8 w-full rounded-md border bg-transparent" style={{ borderColor: "#2a3232" }} />
              </Row>
              <Row label="Align">
                <div className="flex gap-1">
                  {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([a, Icon]) => (
                    <button key={a} onClick={() => set({ align: a })} className={cn(btn, "flex-1")} style={toggle(d.align === a)}><Icon className="w-3.5 h-3.5" /></button>
                  ))}
                </div>
              </Row>
              <Row label="Style">
                <div className="flex gap-1">
                  <button onClick={() => set({ italic: !d.italic })} className={cn(btn, "flex-1 italic")} style={toggle(d.italic)}>I</button>
                  <button onClick={() => set({ uppercase: !d.uppercase })} className={cn(btn, "flex-1")} style={toggle(d.uppercase)}>AA</button>
                  <button onClick={() => set({ shadow: !d.shadow })} className={cn(btn, "flex-1")} style={toggle(d.shadow)}>Shadow</button>
                </div>
              </Row>
              <Row label="Line">
                <div className="flex items-center gap-2">
                  <input type="range" min={0.8} max={2} step={0.05} value={d.lineHeight} onChange={(e) => set({ lineHeight: Number(e.target.value) })} className="flex-1" />
                  <span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{d.lineHeight.toFixed(2)}</span>
                </div>
              </Row>
              <Row label="Spacing">
                <div className="flex items-center gap-2">
                  <input type="range" min={-5} max={30} step={1} value={d.letterSpacing} onChange={(e) => set({ letterSpacing: Number(e.target.value) })} className="flex-1" />
                  <span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{d.letterSpacing}</span>
                </div>
              </Row>
            </Section>

            <Section label="Outline">
              <Row label="Width">
                <div className="flex items-center gap-2">
                  <input type="range" min={0} max={24} step={1} value={d.strokeWidth} onChange={(e) => set({ strokeWidth: Number(e.target.value) })} className="flex-1" />
                  <span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{d.strokeWidth}</span>
                </div>
              </Row>
              {d.strokeWidth > 0 && (
                <Row label="Colour">
                  <input type="color" value={d.stroke} onChange={(e) => set({ stroke: e.target.value })} className="h-8 w-full rounded-md border bg-transparent" style={{ borderColor: "#2a3232" }} />
                </Row>
              )}
            </Section>

            <Section label="Background">
              <Row label="Colour">
                <input type="color" value={d.bgColor} onChange={(e) => set({ bgColor: e.target.value })} className="h-8 w-full rounded-md border bg-transparent" style={{ borderColor: "#2a3232" }} />
              </Row>
              <div className="mt-1">
                <button onClick={() => fileRef.current?.click()} disabled={uploading} className={cn(btn, "w-full")} style={bstyle}>
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {uploading ? "Uploading…" : "Add image from computer"}
                </button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); e.target.value = ""; }} />
                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-zinc-500"><ImageIcon className="w-3 h-3" /> PNG, JPG, WEBP, GIF, AVIF</div>
              </div>
              {d.bgImageUrl ? (
                <div className="mt-2">
                  <Row label="Fit">
                    <div className="flex gap-1">
                      {(["cover", "contain"] as const).map((f) => (
                        <button key={f} onClick={() => set({ bgFit: f })} className={cn(btn, "flex-1 capitalize")} style={toggle(d.bgFit === f)}>{f}</button>
                      ))}
                    </div>
                  </Row>
                  <button onClick={() => set({ bgImageUrl: "" })} className="mt-1 text-[11px] text-red-300 hover:opacity-80">Remove image</button>
                </div>
              ) : null}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-3 border-b" style={{ borderColor: "#2a3232" }}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 mb-2">{label}</div>
      {children}
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[11px] text-zinc-400 w-14 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
