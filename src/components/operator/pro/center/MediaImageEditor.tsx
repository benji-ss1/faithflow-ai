"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Play, Image as ImageIcon, Move, Maximize2, RotateCcw, Save, Wand2, Square, Palette } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import { projectableTextSlide } from "@/lib/broadcast";
import { CANVAS_W, CANVAS_H, newObjectId, type EditableSlide, type SlideObject, type ImageObject, type ShapeObject } from "@/lib/slide-objects";
import { SlideCanvas } from "@/components/operator/editor/SlideCanvas";
import { themeBackgroundStyle } from "@/components/live/SlideRenderer";
import { loadMediaFrame, saveMediaFrame, type MediaFrame } from "./mediaFrame";

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
  const [imgId] = useState(() => newObjectId());
  const [shapeId] = useState(() => newObjectId());
  const saved0 = useMemo(() => loadMediaFrame(ctx.churchId, asset.id), [ctx.churchId, asset.id]);

  // Background mode + source. "matte" = full-screen image on black (the default,
  // byte-identical to before). "background" = a smaller logo centred over a
  // solid colour / the live theme / a gradient.
  const [bgMode, setBgMode] = useState<"matte" | "background">(saved0?.bgMode ?? "matte");
  const [bgKind, setBgKind] = useState<"solid" | "theme" | "gradient">(saved0?.bgKind ?? "solid");
  const [bgSolid, setBgSolid] = useState(saved0?.bgSolid ?? "#0b1220");
  const [gradFrom, setGradFrom] = useState(saved0?.gradFrom ?? "#1e293b");
  const [gradTo, setGradTo] = useState(saved0?.gradTo ?? "#0b1220");
  const [gradAngle, setGradAngle] = useState(saved0?.gradAngle ?? 135);
  const [logoSizePct, setLogoSizePct] = useState(saved0?.logoSizePct ?? 60);

  // Seed the slide from a saved frame. In background mode the logo is a centred
  // box sized by logoSizePct; in matte mode it fills the canvas.
  const [slide, setSlide] = useState<EditableSlide>(() => {
    const inBg = saved0?.bgMode === "background";
    const s = saved0?.logoSizePct ?? 60;
    const cx = saved0?.logoPosX ?? 50, cy = saved0?.logoPosY ?? 50;
    const w = inBg ? Math.round(CANVAS_W * s / 100) : CANVAS_W;
    const h = inBg ? Math.round(CANVAS_H * s / 100) : CANVAS_H;
    const x = inBg ? Math.round(CANVAS_W * cx / 100 - w / 2) : 0;
    const y = inBg ? Math.round(CANVAS_H * cy / 100 - h / 2) : 0;
    const logo: ImageObject = {
      id: imgId, kind: "image", x, y, w, h,
      url: asset.url,
      fit: inBg ? "contain" : (saved0?.fit ?? "cover"),
      posX: inBg ? 50 : (saved0?.posX ?? 50),
      posY: inBg ? 50 : (saved0?.posY ?? 50),
      zoom: inBg ? 1 : (saved0?.zoom ?? 1),
    };
    const objects: SlideObject[] = inBg && saved0?.bgKind === "gradient"
      ? [{ id: shapeId, kind: "shape", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, shape: "rect", fill: saved0.gradFrom ?? "#1e293b", fill2: saved0.gradTo ?? "#0b1220", fillAngle: saved0.gradAngle ?? 135 } as ShapeObject, logo]
      : [logo];
    return {
      id: "media-edit",
      bgColor: inBg ? (saved0?.bgKind === "theme" ? undefined : (saved0?.bgKind === "gradient" ? (saved0?.gradFrom ?? "#1e293b") : (saved0?.bgSolid ?? "#0b1220"))) : "#000000",
      objects,
    };
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([imgId]);

  const img = slide.objects.find((o): o is ImageObject => o.kind === "image") ?? null;

  // Theme background CSS for the editor canvas (WYSIWYG for the "theme" source).
  const themeBgStyle = useMemo(
    () => (bgMode === "background" && bgKind === "theme" ? themeBackgroundStyle(ctx.appearance, "#0b0b0b") : undefined),
    [bgMode, bgKind, ctx.appearance],
  );

  const updateObject = useCallback((id: string, patch: Partial<SlideObject>) => {
    setSlide((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as SlideObject) : o)) }));
  }, []);
  const updateObjects = useCallback((patches: { id: string; patch: Partial<SlideObject> }[]) => {
    setSlide((s) => ({ ...s, objects: s.objects.map((o) => { const p = patches.find((x) => x.id === o.id); return p ? ({ ...o, ...p.patch } as SlideObject) : o; }) }));
  }, []);
  const onSelectObject = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), []);
  const patchImg = (patch: Partial<ImageObject>) => { if (img) updateObject(img.id, patch); };

  // The slide bg colour for the CURRENT background settings (matte → black;
  // theme → undefined so the live theme shows through; gradient → gradFrom as an
  // opaque backstop under the shape; solid → the chosen colour).
  const bgColorFor = useCallback((): string | undefined => {
    if (bgMode === "matte") return "#000000";
    if (bgKind === "theme") return undefined;
    if (bgKind === "gradient") return gradFrom;
    return bgSolid;
  }, [bgMode, bgKind, bgSolid, gradFrom]);

  // Reconcile the slide's background (bgColor + optional gradient shape at
  // objects[0]) with the current bg controls, PRESERVING the logo object's
  // geometry (the user may have dragged/sized it). Runs whenever bg state
  // changes. In matte mode there is never a shape.
  useEffect(() => {
    setSlide((s) => {
      const logo = s.objects.find((o) => o.kind === "image");
      if (!logo) return s;
      const wantShape = bgMode === "background" && bgKind === "gradient";
      const shape: ShapeObject | null = wantShape
        ? { id: shapeId, kind: "shape", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, shape: "rect", fill: gradFrom, fill2: gradTo, fillAngle: gradAngle }
        : null;
      return { ...s, bgColor: bgColorFor(), objects: shape ? [shape, logo] : [logo] };
    });
  }, [bgMode, bgKind, bgSolid, gradFrom, gradTo, gradAngle, shapeId, bgColorFor]);

  // Switch mode: matte → full-canvas image; background → centred logo box sized
  // by logoSizePct. Preserve nothing fancy — a clean, predictable reset per mode.
  function switchMode(mode: "matte" | "background") {
    setBgMode(mode);
    if (mode === "matte") {
      patchImg({ fit: "cover", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, posX: 50, posY: 50, zoom: 1 });
    } else {
      const w = Math.round(CANVAS_W * logoSizePct / 100), h = Math.round(CANVAS_H * logoSizePct / 100);
      patchImg({ fit: "contain", x: Math.round((CANVAS_W - w) / 2), y: Math.round((CANVAS_H - h) / 2), w, h, posX: 50, posY: 50, zoom: 1 });
    }
  }

  // Resize the logo box around its current centre (so sizing doesn't yank it).
  function setLogoSize(pct: number) {
    setLogoSizePct(pct);
    if (!img) return;
    const cx = img.x + img.w / 2, cy = img.y + img.h / 2;
    const w = Math.round(CANVAS_W * pct / 100), h = Math.round(CANVAS_H * pct / 100);
    patchImg({ w, h, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), fit: "contain" });
  }

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
  // Guard against setState / toast after the editor is closed mid-measure, and
  // against a hung image load leaving the button stuck on "Measuring…".
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  function autoFill() {
    if (!img || autofitting) return;
    setAutofitting(true);
    const im = new Image();
    im.crossOrigin = "anonymous";
    // Watchdog: if the load neither resolves nor errors (flaky wifi), release
    // the button after 8s so the operator isn't stuck.
    const watchdog = window.setTimeout(() => {
      im.onload = null; im.onerror = null;
      if (mounted.current) { toast("Auto-fill timed out — use the Zoom slider.", { icon: "🔍" }); setAutofitting(false); }
    }, 8000);
    im.onload = () => {
      window.clearTimeout(watchdog);
      if (!mounted.current) return; // editor closed before load resolved
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
    im.onerror = () => { window.clearTimeout(watchdog); if (mounted.current) { toast.error("Couldn't load this image to measure it."); setAutofitting(false); } };
    im.src = asset.url;
  }

  const payload = useMemo(() => projectableTextSlide("", slide.bgColor, undefined, slide.objects), [slide.objects, slide.bgColor]);
  function hasImagePayload() {
    return payload.kind === "text" && Array.isArray(payload.objects) && payload.objects.some((o) => o.kind === "image");
  }
  function persist() {
    if (!img) return;
    const frame: MediaFrame = { fit: img.fit ?? "cover", posX: img.posX ?? 50, posY: img.posY ?? 50, zoom: img.zoom ?? 1 };
    if (bgMode === "background") {
      frame.bgMode = "background";
      frame.bgKind = bgKind;
      frame.bgSolid = bgSolid;
      frame.gradFrom = gradFrom;
      frame.gradTo = gradTo;
      frame.gradAngle = gradAngle;
      // Persist the logo box as size% + centre% so it restores independent of canvas px.
      frame.logoSizePct = Math.round((img.w / CANVAS_W) * 100);
      frame.logoPosX = Math.round(((img.x + img.w / 2) / CANVAS_W) * 100);
      frame.logoPosY = Math.round(((img.y + img.h / 2) / CANVAS_H) * 100);
    } else {
      frame.bgMode = "matte";
    }
    saveMediaFrame(ctx.churchId, asset.id, frame);
  }
  function save() {
    persist();
    toast.success("Framing saved — this image will project framed", { icon: "💾" });
  }
  function saveAndShow() {
    // If the URL ever fails wire-validation the image object is dropped and the
    // projector would show a black matte — never toast success in that case (the
    // editor still shows the image, so a silent black screen would be a lie).
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
          <button onClick={save} disabled={autofitting} title="Save this framing for the image" className="h-8 px-3 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 border border-[#2a3232] bg-[#1a2020] text-zinc-200 hover:border-teal-500/60 disabled:opacity-50"><Save className="w-3.5 h-3.5" /> Save</button>
          <button onClick={saveAndShow} disabled={autofitting} className="h-8 px-3 rounded-md text-xs font-bold inline-flex items-center gap-1.5 bg-teal-500 text-[#08110f] hover:bg-teal-400 disabled:opacity-50"><Play className="w-3.5 h-3.5" /> Save & Show</button>
          <button onClick={onClose} title="Close" className="h-8 w-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/5"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* WYSIWYG canvas — SlideCanvas paints the real background (matte black,
              solid, gradient, or the live theme) so it matches the projector. */}
          <div className="flex-1 min-w-0 min-h-0 relative flex items-center justify-center p-6" style={{ background: "#0d0d10" }}>
            <div className="w-full relative" style={{ aspectRatio: "16 / 9", boxShadow: "0 0 0 1px #2a3232" }}>
              <SlideCanvas
                slide={slide}
                selectedIds={selectedIds}
                onSelectObject={onSelectObject}
                onSetSelection={setSelectedIds}
                onUpdateObject={updateObject}
                onUpdateObjects={updateObjects}
                onRemoveObjects={() => { /* single fixed image */ }}
                readOnly={false}
                themeBgStyle={themeBgStyle}
              />
            </div>
          </div>

          {/* Controls */}
          <div className="w-[300px] shrink-0 border-l overflow-y-auto" style={{ borderColor: "#2a3232", background: "#1e2525" }}>
            <Section label="Mode">
              <div className="flex gap-1">
                <button onClick={() => switchMode("matte")} className={cn(btn, "flex-1")} style={on(bgMode === "matte")}><Maximize2 className="w-3.5 h-3.5" /> Full screen</button>
                <button onClick={() => switchMode("background")} className={cn(btn, "flex-1")} style={on(bgMode === "background")}><Square className="w-3.5 h-3.5" /> Logo on background</button>
              </div>
              <div className="mt-1.5 text-[10px] text-zinc-500">{bgMode === "matte" ? "Image fills the screen (black letterbox), replacing the theme." : "Place the logo centred over a background — good for wide/odd-shaped logos."}</div>
            </Section>

            {bgMode === "matte" ? (
              <>
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
              </>
            ) : (
              <>
                <Section label="Background">
                  <div className="flex gap-1">
                    <button onClick={() => setBgKind("solid")} className={cn(btn, "flex-1")} style={on(bgKind === "solid")}>Solid</button>
                    <button onClick={() => setBgKind("theme")} className={cn(btn, "flex-1")} style={on(bgKind === "theme")}>Theme</button>
                    <button onClick={() => setBgKind("gradient")} className={cn(btn, "flex-1")} style={on(bgKind === "gradient")}>Gradient</button>
                  </div>
                  {bgKind === "solid" && (
                    <Row label="Colour"><input type="color" value={hexOnly(bgSolid)} onChange={(e) => setBgSolid(e.target.value)} className="h-7 w-full rounded bg-transparent cursor-pointer" /></Row>
                  )}
                  {bgKind === "theme" && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-zinc-500"><Palette className="w-3 h-3" /> Uses the church's active theme background (shown live and in this preview).</div>
                  )}
                  {bgKind === "gradient" && (
                    <>
                      <Row label="From"><input type="color" value={hexOnly(gradFrom)} onChange={(e) => setGradFrom(e.target.value)} className="h-7 w-full rounded bg-transparent cursor-pointer" /></Row>
                      <Row label="To"><input type="color" value={hexOnly(gradTo)} onChange={(e) => setGradTo(e.target.value)} className="h-7 w-full rounded bg-transparent cursor-pointer" /></Row>
                      <Row label="Angle"><div className="flex items-center gap-2"><input type="range" min={0} max={360} step={5} value={gradAngle} onChange={(e) => setGradAngle(Number(e.target.value))} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{gradAngle}°</span></div></Row>
                    </>
                  )}
                </Section>

                <Section label="Logo size">
                  <Row label="Size"><div className="flex items-center gap-2"><input type="range" min={10} max={100} step={1} value={logoSizePct} onChange={(e) => setLogoSize(Number(e.target.value))} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{logoSizePct}%</span></div></Row>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500"><Move className="w-3 h-3" /> Drag the logo on the canvas to position it; handles resize it.</div>
                </Section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// <input type="color"> only accepts #rrggbb. Coerce a stored value (short hex /
// rgb()) to a safe 7-char hex so the picker shows something sensible.
function hexOnly(c: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) return "#" + c.slice(1).split("").map((h) => h + h).join("");
  return "#000000";
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
