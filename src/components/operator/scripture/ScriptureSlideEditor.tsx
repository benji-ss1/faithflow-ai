"use client";
import { useRef, useState } from "react";
import { X, Lock, Image as ImageIcon, Upload, Loader2, Play, Type, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { SlidePayload, TransitionSpec } from "@/lib/broadcast";
import { newObjectId, type TextObject } from "@/lib/slide-objects";

/**
 * ScriptureSlideEditor — "edit slide" for scripture (Increment 1).
 *
 * Replicates the SONG slide editor's styling capabilities for Bible / memory
 * verses, with ONE hard rule: the verse text is IMMUTABLE. Operators can change
 * font, weight, colour, alignment, background colour, and a background image
 * (uploaded from their computer) — but never the words of scripture. The verse
 * text is sourced from the Bible library and shown read-only.
 *
 * Self-contained: does not touch the working song editor (useSlideEditor /
 * DesktopSlideEditorModal). Projects via the shared SlidePayload object path
 * (a single locked text object + per-slide bgColor/bgImageUrl), so font/colour/
 * background reach the live output through the same SlideRenderer songs use.
 *
 * Increment 1 = style + image + Show (session-level). Named styles ("teams")
 * and per-verse persistence come in Increments 2–3.
 */

const FONTS = ["Inter", "Sora", "Plus Jakarta Sans", "Georgia", "Helvetica", "Arial", "Times New Roman"];
const WEIGHTS = [400, 500, 600, 700, 800];

export type ScriptureDesign = {
  fontFamily: string;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  bgColor: string;
  bgImageUrl: string;
  bgFit: "cover" | "contain";
};

const DEFAULT_DESIGN: ScriptureDesign = {
  fontFamily: "Sora", fontWeight: 700, color: "#ffffff", align: "center",
  bgColor: "#0a0a0a", bgImageUrl: "", bgFit: "cover",
};

export function ScriptureSlideEditor({
  verse, initial, onClose, onShow, transition,
}: {
  verse: { text: string; reference: string };
  initial?: Partial<ScriptureDesign>;
  onClose: () => void;
  onShow: (slide: SlidePayload, transition?: TransitionSpec | null) => void;
  transition?: TransitionSpec | null;
}) {
  const [d, setD] = useState<ScriptureDesign>({ ...DEFAULT_DESIGN, ...initial });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<ScriptureDesign>) => setD((prev) => ({ ...prev, ...patch }));

  // Upload an image from the computer → S3 (presign → PUT → persistent URL).
  // Same proven flow the theme background picker uses; any raster type.
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

  function buildPayload(): SlidePayload {
    // A single full-canvas locked text object carries the verse + style. The
    // renderer's sole-text path auto-fits the size and applies colour/font/
    // weight/align. bgColor/bgImageUrl style the slide background.
    const textObj: TextObject = {
      id: newObjectId(), kind: "text",
      x: 0, y: 0, w: 1920, h: 1080,
      text: verse.text,
      fontFamily: d.fontFamily, fontWeight: d.fontWeight, color: d.color, align: d.align,
      locked: true,
    };
    return {
      kind: "text",
      text: verse.text,
      reference: verse.reference,
      bgColor: d.bgColor,
      ...(d.bgImageUrl ? { bgImageUrl: d.bgImageUrl } : {}),
      objects: [textObj],
    };
  }

  function show() {
    onShow(buildPayload(), transition);
    toast.success("Sent to projector");
  }

  const previewBg: React.CSSProperties = d.bgImageUrl
    ? { background: `#000 url("${d.bgImageUrl}") center/${d.bgFit} no-repeat` }
    : { background: d.bgColor };

  const btn = "h-8 px-2 rounded-md text-xs border inline-flex items-center justify-center gap-1";
  const bstyle = { borderColor: "#2a3232", background: "#1a2020", color: "#e4e4e7" } as React.CSSProperties;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.72)" }} onClick={onClose}>
      <div
        className="flex flex-col rounded-xl border overflow-hidden"
        style={{ width: "min(1040px, 94vw)", height: "min(680px, 90vh)", borderColor: "#2a3232", background: "#1e2525" }}
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
          {/* Preview */}
          <div className="flex-1 min-w-0 flex items-center justify-center p-6" style={{ background: "#141a1a" }}>
            <div className="w-full rounded-lg overflow-hidden border shadow-2xl" style={{ aspectRatio: "16 / 9", borderColor: "#2a3232", ...previewBg }}>
              <div className="w-full h-full flex flex-col items-center justify-center px-[6%] text-center relative">
                <div
                  style={{
                    fontFamily: d.fontFamily, fontWeight: d.fontWeight, color: d.color,
                    textAlign: d.align, width: "100%",
                    fontSize: "clamp(16px, 3.4vw, 40px)", lineHeight: 1.25,
                    textShadow: "0 2px 12px rgba(0,0,0,0.55)",
                  }}
                >
                  {verse.text}
                </div>
                <div className="absolute bottom-[5%] left-0 right-0" style={{ color: d.color, opacity: 0.8, textAlign: d.align, fontSize: "clamp(9px,1.4vw,15px)", fontFamily: d.fontFamily, paddingInline: "6%" }}>
                  {verse.reference}
                </div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="w-[320px] shrink-0 border-l overflow-y-auto" style={{ borderColor: "#2a3232", background: "#1e2525" }}>
            {/* Locked scripture text */}
            <Section label="Scripture (locked)">
              <div className="rounded-md border p-2.5 text-[12px] leading-relaxed text-zinc-300 max-h-28 overflow-y-auto" style={{ borderColor: "#2a3232", background: "#161c1c" }}>
                {verse.text}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
                <Lock className="w-3 h-3" /> The words of scripture can’t be changed — only the styling.
              </div>
            </Section>

            {/* Text style */}
            <Section label="Text">
              <Row label="Font">
                <select value={d.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} className={btn + " w-full"} style={bstyle}>
                  {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
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
                    <button key={a} onClick={() => set({ align: a })} className={cn(btn, "flex-1")} style={{ ...bstyle, borderColor: d.align === a ? "#2dd4bf" : "#2a3232", color: d.align === a ? "#5eead4" : "#e4e4e7" }}>
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </Row>
            </Section>

            {/* Background */}
            <Section label="Background">
              <Row label="Colour">
                <input type="color" value={d.bgColor} onChange={(e) => set({ bgColor: e.target.value })} className="h-8 w-full rounded-md border bg-transparent" style={{ borderColor: "#2a3232" }} />
              </Row>
              <div className="mt-1">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className={cn(btn, "w-full")} style={bstyle}
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {uploading ? "Uploading…" : "Add image from computer"}
                </button>
                <input
                  ref={fileRef} type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                  className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); e.target.value = ""; }}
                />
                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-zinc-500">
                  <ImageIcon className="w-3 h-3" /> PNG, JPG, WEBP, GIF, AVIF
                </div>
              </div>
              {d.bgImageUrl ? (
                <div className="mt-2">
                  <Row label="Fit">
                    <div className="flex gap-1">
                      {(["cover", "contain"] as const).map((f) => (
                        <button key={f} onClick={() => set({ bgFit: f })} className={cn(btn, "flex-1 capitalize")} style={{ ...bstyle, borderColor: d.bgFit === f ? "#2dd4bf" : "#2a3232", color: d.bgFit === f ? "#5eead4" : "#e4e4e7" }}>{f}</button>
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
