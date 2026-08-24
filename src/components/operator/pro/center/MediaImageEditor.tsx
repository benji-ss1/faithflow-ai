"use client";
import { useCallback, useMemo, useState } from "react";
import { X, Play, Image as ImageIcon, Move, Maximize2, RotateCcw, Save, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import { projectableTextSlide } from "@/lib/broadcast";
import { CANVAS_W, CANVAS_H, newObjectId, type EditableSlide, type SlideObject, type ImageObject } from "@/lib/slide-objects";
import { SlideCanvas } from "@/components/operator/editor/SlideCanvas";
import { loadMediaFrame, saveMediaFrame } from "./mediaFrame";

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
  asset: { id: string; url: string; fileName: string };
  ctx: OperatorShellCtx;
  onClose: () => void;
}) {
  const [matte] = useState("#000000");
  const [imgId] = useState(() => newObjectId());
  // Seed from a previously-saved framing for this asset, if any, so re-opening
  // the editor shows the operator's last crop instead of resetting to full.
  const [slide, setSlide] = useState<EditableSlide>(() => {
    const saved = loadMediaFrame(ctx.churchId, asset.id);
    return {
      id: "media-edit",
      bgColor: matte,
      objects: [{
        id: imgId, kind: "image",
        x: 0, y: 0, w: CANVAS_W, h: CANVAS_H,
        url: asset.url,
        fit: saved?.fit ?? "cover",
        posX: saved?.posX ?? 50,
        posY: saved?.posY ?? 50,
        zoom: saved?.zoom ?? 1,
      } as ImageObject],
    };
  });
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

  // Auto-fill: measure the image's non-transparent bounding box and set zoom +
  // pan so the visible artwork fills the screen. This is the fix for logo PNGs
  // that sit inside a large transparent/padded canvas — no objectFit mode can
  // enlarge baked-in padding, so we blow up the content itself.
  // Reads pixels via a canvas, which requires CORS; on any failure (tainted
  // canvas / load error) we fall back gracefully and tell the operator to zoom.
  const [autofitting, setAutofitting] = useState(false);
  function autoFill() {
    if (!img) return;
    setAutofitting(true);
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      try {
        const nW = im.naturalWidth, nH = im.naturalHeight;
        if (!nW || !nH) throw new Error("no dims");
        // Downscale the scan for speed; alpha bbox is the same in fractions.
        const scale = Math.min(1, 400 / Math.max(nW, nH));
        const sw = Math.max(1, Math.round(nW * scale)), sh = Math.max(1, Math.round(nH * scale));
        const c = document.createElement("canvas");
        c.width = sw; c.height = sh;
        const g = c.getContext("2d", { willReadFrequently: true });
        if (!g) throw new Error("no ctx");
        g.drawImage(im, 0, 0, sw, sh);
        const data = g.getImageData(0, 0, sw, sh).data; // throws SecurityError if tainted
        let minX = sw, minY = sh, maxX = -1, maxY = -1;
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            if (data[(y * sw + x) * 4 + 3] > 16) { // alpha threshold
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < minX || maxY < minY) throw new Error("empty"); // fully transparent
        const cw = (maxX - minX + 1) / sw, ch = (maxY - minY + 1) / sh; // content size (0-1)
        const cx = (minX + maxX + 1) / 2 / sw, cy = (minY + maxY + 1) / 2 / sh; // content centre (0-1)
        // Aspect of the visible content (not the file): decides what "fill" can mean.
        const contentAspect = (cw * nW) / (ch * nH);
        const BOX_ASPECT = CANVAS_W / CANVAS_H; // 16:9 ≈ 1.78
        if (cw > 0.92 && ch > 0.92) {
          // No transparent margin to trim — this is a tight/opaque image. Do the
          // maximal non-cropping thing and be honest about the aspect reality.
          if (contentAspect > BOX_ASPECT * 1.15) {
            // Wide banner (e.g. 3:1 logo lockup): contain fills the WIDTH; it can't
            // fill height without cropping the sides off the logo.
            applyFit("contain");
            toast(`Wide logo (${contentAspect.toFixed(1)}:1) — filled the width. Zoom in to crop-fill the height.`, { icon: "↔️" });
          } else if (contentAspect < BOX_ASPECT / 1.15) {
            // Tall image: contain fills the HEIGHT.
            applyFit("contain");
            toast(`Tall image — filled the height. Zoom in to crop-fill the width.`, { icon: "↕️" });
          } else {
            // Roughly 16:9 already → cover genuinely fills the whole screen.
            applyFit("cover");
            toast.success("Filled the screen", { icon: "✨" });
          }
          setAutofitting(false);
          return;
        }
        // There IS transparent padding — blow the content up to fill the box.
        // contain keeps the whole logo visible; zoom = 1/largest content dimension.
        const zoom = Math.max(1, Math.min(8, 0.98 / Math.max(cw, ch)));
        patchImg({ fit: "contain", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, zoom, posX: Math.round(cx * 100), posY: Math.round(cy * 100) });
        toast.success("Filled the screen with the logo", { icon: "✨" });
      } catch {
        toast("Couldn't auto-measure this image — use the Zoom slider to fill the screen.", { icon: "🔍" });
      } finally {
        setAutofitting(false);
      }
    };
    im.onerror = () => { toast.error("Couldn't load this image to measure it."); setAutofitting(false); };
    im.src = asset.url;
  }

  const payload = useMemo(() => projectableTextSlide("", matte, undefined, slide.objects), [slide.objects, matte]);
  function hasImagePayload() {
    return payload.kind === "text" && Array.isArray(payload.objects) && payload.objects.some((o) => o.kind === "image");
  }
  function persist() {
    if (!img) return;
    saveMediaFrame(ctx.churchId, asset.id, { fit: img.fit ?? "cover", posX: img.posX ?? 50, posY: img.posY ?? 50, zoom: img.zoom ?? 1 });
  }
  function save() {
    persist();
    toast.success("Framing saved — this image will project framed", { icon: "💾" });
  }
  function show() {
    // If the URL ever fails wire-validation the image object is dropped and the
    // projector would show a black matte — never toast success in that case (the
    // editor still shows the image, so a silent black screen would be a lie).
    if (!hasImagePayload()) { toast.error("Couldn't project this image — try re-uploading it."); return; }
    ctx.onSendSlideToLive(payload, undefined, { instant: true, force: true });
    toast.success("Image on the projector", { icon: "🖼️" });
  }
  function saveAndShow() {
    if (!hasImagePayload()) { toast.error("Couldn't project this image — try re-uploading it."); return; }
    persist();
    ctx.onSendSlideToLive(payload, undefined, { instant: true, force: true });
    toast.success("Saved & on the projector", { icon: "🖼️" });
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
          <button onClick={save} title="Save this framing for the image" className="h-8 px-3 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 border border-[#2a3232] bg-[#1a2020] text-zinc-200 hover:border-teal-500/60"><Save className="w-3.5 h-3.5" /> Save</button>
          <button onClick={saveAndShow} className="h-8 px-3 rounded-md text-xs font-bold inline-flex items-center gap-1.5 bg-teal-500 text-[#08110f] hover:bg-teal-400"><Play className="w-3.5 h-3.5" /> Save & Show</button>
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
              <button onClick={autoFill} disabled={autofitting} className={cn(btn, "w-full mt-2")} style={on(false)}>
                <Wand2 className="w-3.5 h-3.5" /> {autofitting ? "Measuring…" : "Auto-fill screen with logo"}
              </button>
              <div className="mt-1 text-[10px] text-zinc-500">Blows a padded logo up to fill the screen automatically. For photos, use Fill + Zoom.</div>
            </Section>

            <Section label="Position (pan)">
              <Row label="Left ↔"><div className="flex items-center gap-2"><input type="range" min={0} max={100} step={1} value={img?.posX ?? 50} onChange={(e) => patchImg({ posX: Number(e.target.value) })} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-7 text-right">{img?.posX ?? 50}</span></div></Row>
              <Row label="Up ↕"><div className="flex items-center gap-2"><input type="range" min={0} max={100} step={1} value={img?.posY ?? 50} onChange={(e) => patchImg({ posY: Number(e.target.value) })} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-7 text-right">{img?.posY ?? 50}</span></div></Row>
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500"><Move className="w-3 h-3" /> Or drag the image on the canvas.</div>
            </Section>

            <Section label="Zoom / crop">
              <Row label="Zoom"><div className="flex items-center gap-2"><input type="range" min={1} max={8} step={0.05} value={img?.zoom ?? 1} onChange={(e) => patchImg({ zoom: Number(e.target.value) })} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{(img?.zoom ?? 1).toFixed(2)}×</span></div></Row>
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
