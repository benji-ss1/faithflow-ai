"use client";
import { useCallback, useMemo, useState } from "react";
import { X, Play, Image as ImageIcon, Move, Maximize2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import { projectableTextSlide } from "@/lib/broadcast";
import { CANVAS_W, CANVAS_H, newObjectId, type EditableSlide, type SlideObject, type ImageObject } from "@/lib/slide-objects";
import { SlideCanvas } from "@/components/operator/editor/SlideCanvas";

/**
 * MediaImageEditor — double-click a Media Library image to crop / pan / zoom /
 * stretch / reposition it so it fits the screen one-to-one (great for portrait
 * iPhone images that Fit/Fill/Stretch can't frame well).
 *
 * Non-destructive: the edit is a designed slide with ONE image object carrying
 * geometry (x,y,w,h) + fit + pan (posX/posY) + zoom. No re-upload. Rendered by
 * the SAME SlideCanvas (edit) and SlideObjectsLayer (projector), so the editing
 * surface is pixel-identical to the live output. The slide sets a black matte
 * (bgColor) so the image REPLACES the theme on the projector (letterbox = black),
 * while the media library keeps showing the theme behind its UI.
 */

type Fit = "contain" | "cover" | "fill";
const FITS: { value: Fit; label: string; hint: string }[] = [
  { value: "contain", label: "Fit", hint: "Whole image, letterboxed" },
  { value: "cover", label: "Fill", hint: "Fills the screen, crop with pan/zoom" },
  { value: "fill", label: "Stretch", hint: "Fills exactly (may distort)" },
];

export function MediaImageEditor({
  asset, ctx, onClose,
}: {
  asset: { url: string; fileName: string };
  ctx: OperatorShellCtx;
  onClose: () => void;
}) {
  const [matte] = useState("#000000");
  const [imgId] = useState(() => newObjectId());
  const [slide, setSlide] = useState<EditableSlide>(() => ({
    id: "media-edit",
    bgColor: matte,
    objects: [{
      id: imgId, kind: "image",
      x: 0, y: 0, w: CANVAS_W, h: CANVAS_H,
      url: asset.url, fit: "cover", posX: 50, posY: 50, zoom: 1,
    } as ImageObject],
  }));
  const [selectedIds, setSelectedIds] = useState<string[]>([imgId]);

  const img = slide.objects.find((o): o is ImageObject => o.kind === "image") ?? null;

  const updateObject = useCallback((id: string, patch: Partial<SlideObject>) => {
    setSlide((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as SlideObject) : o)) }));
  }, []);
  const updateObjects = useCallback((patches: { id: string; patch: Partial<SlideObject> }[]) => {
    setSlide((s) => ({ ...s, objects: s.objects.map((o) => { const p = patches.find((x) => x.id === o.id); return p ? ({ ...o, ...p.patch } as SlideObject) : o; }) }));
  }, []);
  const onSelectObject = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), []);
  const patchImg = (patch: Partial<ImageObject>) => { if (img) updateObject(img.id, patch); };

  // Fit presets reset the box to the full canvas + centre + reset zoom, then set fit.
  function applyFit(fit: Fit) {
    patchImg({ fit, x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, posX: 50, posY: 50, zoom: 1 });
  }
  function resetAll() { applyFit("cover"); }

  const payload = useMemo(() => projectableTextSlide("", matte, undefined, slide.objects), [slide.objects, matte]);
  function show() {
    // If the presigned URL ever fails wire-validation the image object is dropped
    // and the projector would show a black matte — never toast success in that case
    // (the editor still shows the image, so a silent black screen would be a lie).
    const hasImage = payload.kind === "text" && Array.isArray(payload.objects) && payload.objects.some((o) => o.kind === "image");
    if (!hasImage) { toast.error("Couldn't project this image — try re-uploading it."); return; }
    ctx.onSendSlideToLive(payload, undefined, { instant: true, force: true });
    toast.success("Image on the projector", { icon: "🖼️" });
  }

  const btn = "h-8 px-2 rounded-md text-xs border inline-flex items-center justify-center gap-1";
  const bstyle = { borderColor: "#2a3232", background: "#1a2020", color: "#e4e4e7" } as React.CSSProperties;
  const on = (active: boolean) => ({ ...bstyle, borderColor: active ? "#2dd4bf" : "#2a3232", color: active ? "#5eead4" : "#e4e4e7" });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.78)" }}>
      <div className="flex flex-col rounded-xl border overflow-hidden" style={{ width: "min(1160px, 96vw)", height: "min(740px, 94vh)", borderColor: "#2a3232", background: "#1e2525" }}>
        {/* Header */}
        <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b" style={{ borderColor: "#2a3232" }}>
          <ImageIcon className="w-4 h-4 text-teal-300" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-zinc-100 leading-none truncate">Edit image</div>
            <div className="text-[10px] text-zinc-500 leading-none mt-1 truncate">{asset.fileName} — drag to move, handles to crop, pan/zoom on the right</div>
          </div>
          <button onClick={show} className="h-8 px-3 rounded-md text-xs font-bold inline-flex items-center gap-1.5 bg-teal-500 text-[#08110f] hover:bg-teal-400"><Play className="w-3.5 h-3.5" /> Show to projector</button>
          <button onClick={onClose} title="Close" className="h-8 w-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/5"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* WYSIWYG canvas — black matte so it matches the projector exactly */}
          <div className="flex-1 min-w-0 min-h-0 relative flex items-center justify-center p-6" style={{ background: "#0d0d10" }}>
            <div className="w-full relative" style={{ aspectRatio: "16 / 9", background: matte, boxShadow: "0 0 0 1px #2a3232" }}>
              <SlideCanvas
                slide={slide}
                selectedIds={selectedIds}
                onSelectObject={onSelectObject}
                onSetSelection={setSelectedIds}
                onUpdateObject={updateObject}
                onUpdateObjects={updateObjects}
                onRemoveObjects={() => { /* single fixed image */ }}
                readOnly={false}
              />
            </div>
          </div>

          {/* Controls */}
          <div className="w-[300px] shrink-0 border-l overflow-y-auto" style={{ borderColor: "#2a3232", background: "#1e2525" }}>
            <Section label="Projected size">
              <div className="flex gap-1">
                {FITS.map((f) => (
                  <button key={f.value} onClick={() => applyFit(f.value)} title={f.hint} className={cn(btn, "flex-1")} style={on(img?.fit === f.value)}>{f.label}</button>
                ))}
              </div>
              <div className="mt-1.5 text-[10px] text-zinc-500">{FITS.find((f) => f.value === img?.fit)?.hint}</div>
            </Section>

            <Section label="Position (pan)">
              <Row label="Left ↔"><div className="flex items-center gap-2"><input type="range" min={0} max={100} step={1} value={img?.posX ?? 50} onChange={(e) => patchImg({ posX: Number(e.target.value) })} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-7 text-right">{img?.posX ?? 50}</span></div></Row>
              <Row label="Up ↕"><div className="flex items-center gap-2"><input type="range" min={0} max={100} step={1} value={img?.posY ?? 50} onChange={(e) => patchImg({ posY: Number(e.target.value) })} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-7 text-right">{img?.posY ?? 50}</span></div></Row>
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500"><Move className="w-3 h-3" /> Or drag the image on the canvas.</div>
            </Section>

            <Section label="Zoom / crop">
              <Row label="Zoom"><div className="flex items-center gap-2"><input type="range" min={1} max={5} step={0.05} value={img?.zoom ?? 1} onChange={(e) => patchImg({ zoom: Number(e.target.value) })} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{(img?.zoom ?? 1).toFixed(2)}×</span></div></Row>
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500"><Maximize2 className="w-3 h-3" /> Zoom in then pan to crop out parts of the image.</div>
            </Section>

            <Section label="Reset">
              <button onClick={resetAll} className={cn(btn, "w-full")} style={bstyle}><RotateCcw className="w-3.5 h-3.5" /> Reset to full screen</button>
              <div className="mt-1.5 text-[10px] text-zinc-500">The image replaces the theme on the live screen (letterbox is black). The theme still shows in the media library.</div>
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
      <span className="text-[11px] text-zinc-400 w-12 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
