"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Play, Image as ImageIcon, Move, Maximize2, RotateCcw, Save, Wand2, Square, Palette } from "lucide-react";
import { toast } from "sonner";

// Editor toasts sit top-CENTRE so they never cover the editor's top-right Close
// button (the app's global toaster is top-right).
type ToastOpts = Parameters<typeof toast>[1];
const TOP_CENTER = { position: "top-center" } as const;
const etoast = Object.assign(
  (msg: string, o?: ToastOpts) => toast(msg, { ...TOP_CENTER, ...o }),
  {
    success: (msg: string, o?: ToastOpts) => toast.success(msg, { ...TOP_CENTER, ...o }),
    error: (msg: string, o?: ToastOpts) => toast.error(msg, { ...TOP_CENTER, ...o }),
  },
);
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import { projectableTextSlide } from "@/lib/broadcast";
import { CANVAS_W, CANVAS_H, newObjectId, type EditableSlide, type SlideObject, type ImageObject, type ShapeObject } from "@/lib/slide-objects";
import { SlideCanvas } from "@/components/operator/editor/SlideCanvas";
import { themeBackgroundStyle } from "@/components/live/SlideRenderer";
import { AnimatedThemeBg, ThemeVideoBackground } from "@/components/live/ThemeLayers";
import { BackgroundLayer } from "@/backgrounds/components/BackgroundLayer";
import { registerMediaAsset } from "@/lib/actions";
import { removeFlatBackground } from "./logoKey";
import { loadMediaFrame, saveMediaFrame, frameBox, type MediaFrame } from "./mediaFrame";
import { LayoutDefaultControl } from "@/components/operator/layout/LayoutDefaultControl";

/**
 * Live, WYSIWYG preview of the church's REAL active theme background — mirrors
 * the projector composition (OutputSlide / LivePreviewPanel): the theme's
 * solid/gradient/image base + its animation, its looping video background, and
 * any active Background Template (shader/image/video) layered on top exactly as
 * it goes live. Rendered inside the clipped editor canvas at preview scale, so
 * "Theme" background actually shows what will project — not a flat guess.
 * Templates render `frozen` (poster frame / one shader frame) to stay cheap.
 */
function ThemePreviewBackground({
  appearance, background,
}: {
  appearance: OperatorShellCtx["appearance"];
  background: OperatorShellCtx["background"];
}) {
  const themeVideoUrl = appearance?.bgType === "video" && appearance.bgVideoUrl ? appearance.bgVideoUrl : null;
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0" style={themeBackgroundStyle(appearance, "#0b0b0b")} />
      <AnimatedThemeBg appearance={appearance} />
      {themeVideoUrl && <ThemeVideoBackground url={themeVideoUrl} dim={appearance?.dim} />}
      {background && background.type !== "none" && (
        <BackgroundLayer background={background} frozen />
      )}
    </div>
  );
}

// Upload a processed image through the EXISTING media path (presign → S3 PUT →
// registerMediaAsset) and return a persistent (6h) URL + the new asset id — the
// same pipeline the import wizard uses, no new endpoint. Used to commit a
// "remove flat background" result as a real, reusable library asset.
async function uploadProcessedImage(blob: Blob, fileName: string): Promise<{ id: string; url: string }> {
  const presignRes = await fetch("/api/media/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, contentType: "image/png", size: blob.size, purpose: "media" }),
  });
  if (!presignRes.ok) {
    const err = (await presignRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Presign failed (${presignRes.status})`);
  }
  const { url: uploadUrl, key } = (await presignRes.json()) as { url: string; key: string };
  const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob });
  if (!putRes.ok) throw new Error("Storage upload failed");
  const reg = await registerMediaAsset({ kind: "image", fileName, s3Key: key, mimeType: "image/png", sizeBytes: blob.size });
  if (!reg?.ok || !reg.data) throw new Error((reg as { error?: string } | undefined)?.error ?? "Registration failed");
  // Persistent GET URL for the just-written key (same as BgAssetPicker).
  const urlRes = await fetch("/api/media/url", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
  });
  if (!urlRes.ok) throw new Error("Could not get media URL");
  const { url } = (await urlRes.json()) as { url: string };
  return { id: reg.data.id, url };
}

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
  asset: assetProp, ctx, onClose, onAssetReplaced,
}: {
  asset: { id: string; url: string; fileName: string };
  ctx: OperatorShellCtx;
  onClose: () => void;
  // Fired when a processed ("remove flat background") copy is committed as a new
  // library asset — lets the browser show it + retarget editing to it, so the
  // transparent logo persists durably (its own asset id + fresh presigned URL),
  // instead of freezing an expiring URL into the original asset's saved frame.
  onAssetReplaced?: (a: { id: string; url: string; fileName: string }) => void;
}) {
  // The asset being edited can be SWAPPED to a processed transparent copy after a
  // "remove flat background" commit; framing then persists against that asset.
  const [asset, setAsset] = useState(assetProp);
  // The ORIGINAL (un-keyed) source URL — always re-key from this, never from an
  // already-processed copy.
  const sourceUrlRef = useRef(assetProp.url);
  const [imgId] = useState(() => newObjectId());
  const [shapeId] = useState(() => newObjectId());
  const [blurId] = useState(() => newObjectId()); // full-screen blurred bg layer (Blur fill)
  const saved0 = useMemo(() => loadMediaFrame(ctx.churchId, assetProp.id), [ctx.churchId, assetProp.id]);

  // Background mode + source. "matte" = full-screen image on black (the default,
  // byte-identical to before). "background" = a smaller logo centred over a
  // solid colour / the live theme / a gradient.
  const [bgMode, setBgMode] = useState<"matte" | "background">(saved0?.bgMode ?? "matte");
  const [bgKind, setBgKind] = useState<"solid" | "theme" | "gradient" | "blur">(saved0?.bgKind ?? "solid");
  const [bgSolid, setBgSolid] = useState(saved0?.bgSolid ?? "#0b1220");
  const [gradFrom, setGradFrom] = useState(saved0?.gradFrom ?? "#1e293b");
  const [gradTo, setGradTo] = useState(saved0?.gradTo ?? "#0b1220");
  const [gradAngle, setGradAngle] = useState(saved0?.gradAngle ?? 135);
  const [logoSizePct, setLogoSizePct] = useState(saved0?.logoSizePct ?? 60);

  // "Remove flat background (beta)" — client-side chroma/luma keying of a baked
  // flat (near-black / near-white) logo background. `removeBg` on ⇒ the preview
  // shows the keyed image (a blob URL); the keyed PNG is UPLOADED as a new asset
  // only on Save/Save & Show (blob URLs aren't wire-valid for the projector).
  const [removeBg, setRemoveBg] = useState(false);
  const [bgThreshold, setBgThreshold] = useState(38);
  const [keying, setKeying] = useState(false);
  // Latest processed blob awaiting upload (null once committed / when off).
  const pendingBlobRef = useRef<Blob | null>(null);
  // Persistent URL of the committed processed asset (so we don't re-upload an
  // unchanged keying on a second Save).
  const committedRef = useRef<{ id: string; url: string } | null>(null);
  // Current blob object URL used for the preview (revoked on replace/unmount).
  const previewObjUrlRef = useRef<string | null>(null);
  const revokePreview = useCallback(() => {
    if (previewObjUrlRef.current) { URL.revokeObjectURL(previewObjUrlRef.current); previewObjUrlRef.current = null; }
  }, []);

  // Seed the slide from a saved frame. In background mode the logo is a centred
  // box sized by logoSizePct; in matte mode it fills the canvas.
  const [slide, setSlide] = useState<EditableSlide>(() => {
    const inBg = saved0?.bgMode === "background";
    const s = saved0?.logoSizePct ?? 60;
    const cx = saved0?.logoPosX ?? 50, cy = saved0?.logoPosY ?? 50;
    // A saved box (handle crop/resize) wins; frames saved before boxes existed
    // fall back to the old geometry (same as buildMediaFrameSlide).
    const box = saved0 ? frameBox(saved0) : null;
    const w = box ? box.w : inBg ? Math.round(CANVAS_W * s / 100) : CANVAS_W;
    const h = box ? box.h : inBg ? Math.round(CANVAS_H * s / 100) : CANVAS_H;
    const x = box ? box.x : inBg ? Math.round(CANVAS_W * cx / 100 - w / 2) : 0;
    const y = box ? box.y : inBg ? Math.round(CANVAS_H * cy / 100 - h / 2) : 0;
    const logo: ImageObject = {
      id: imgId, kind: "image", x, y, w, h,
      url: asset.url,
      fit: inBg ? "contain" : (saved0?.fit ?? "cover"),
      posX: inBg ? 50 : (saved0?.posX ?? 50),
      posY: inBg ? 50 : (saved0?.posY ?? 50),
      zoom: inBg ? 1 : (saved0?.zoom ?? 1),
      // Seed blur-fill from the saved frame so the canvas shows it on open (1:1).
      ...(!inBg && saved0?.blurFill ? { blurFill: true } : {}),
    };
    const objects: SlideObject[] = !inBg
      ? [logo]
      : saved0?.bgKind === "gradient"
      ? [{ id: shapeId, kind: "shape", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, shape: "rect", fill: saved0.gradFrom ?? "#1e293b", fill2: saved0.gradTo ?? "#0b1220", fillAngle: saved0.gradAngle ?? 135 } as ShapeObject, logo]
      : saved0?.bgKind === "blur"
      ? [{ id: blurId, kind: "image", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, url: sourceUrlRef.current, fit: "cover", posX: 50, posY: 50, zoom: 1, blur: true, locked: true } as ImageObject, logo]
      : [logo];
    return {
      id: "media-edit",
      bgColor: inBg ? (saved0?.bgKind === "theme" ? undefined : (saved0?.bgKind === "gradient" ? (saved0?.gradFrom ?? "#1e293b") : (saved0?.bgSolid ?? "#0b1220"))) : "#000000",
      objects,
    };
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([imgId]);

  // Find the LOGO by its id — a "Blur fill" background adds a SECOND image object
  // (the blurred backdrop), so a plain kind==="image" find would grab the wrong one.
  const img = slide.objects.find((o): o is ImageObject => o.kind === "image" && o.id === imgId) ?? null;

  // Live theme-background node for the editor canvas — renders the church's REAL
  // active theme (animated gradient / theme video / active Background Template)
  // exactly as it will project, so "Theme" is true WYSIWYG BEFORE Save & Show.
  const backgroundNode = useMemo(
    () => (bgMode === "background" && bgKind === "theme"
      ? <ThemePreviewBackground appearance={ctx.appearance} background={ctx.background} />
      : undefined),
    [bgMode, bgKind, ctx.appearance, ctx.background],
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
    if (bgKind === "blur") return "#000000"; // black backstop under the blurred image
    return bgSolid;
  }, [bgMode, bgKind, bgSolid, gradFrom]);

  // Reconcile the slide's background (bgColor + optional gradient shape at
  // objects[0]) with the current bg controls, PRESERVING the logo object's
  // geometry (the user may have dragged/sized it). Runs whenever bg state
  // changes. In matte mode there is never a shape.
  useEffect(() => {
    setSlide((s) => {
      const logo = s.objects.find((o) => o.kind === "image" && o.id === imgId);
      if (!logo) return s;
      const wantShape = bgMode === "background" && bgKind === "gradient";
      const wantBlur = bgMode === "background" && bgKind === "blur";
      const bg: SlideObject | null = wantShape
        ? { id: shapeId, kind: "shape", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, shape: "rect", fill: gradFrom, fill2: gradTo, fillAngle: gradAngle } as ShapeObject
        : wantBlur
        ? { id: blurId, kind: "image", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, url: sourceUrlRef.current, fit: "cover", posX: 50, posY: 50, zoom: 1, blur: true, locked: true } as ImageObject
        : null;
      return { ...s, bgColor: bgColorFor(), objects: bg ? [bg, logo] : [logo] };
    });
  }, [bgMode, bgKind, bgSolid, gradFrom, gradTo, gradAngle, shapeId, blurId, imgId, asset.url, bgColorFor]);

  // Switch mode: matte → full-canvas image; background → centred logo box sized
  // by logoSizePct. Preserve nothing fancy — a clean, predictable reset per mode.
  function switchMode(mode: "matte" | "background") {
    setBgMode(mode);
    if (mode === "matte") {
      // "Remove flat background" only makes sense for a logo over a background;
      // going full-screen reverts to the original source image.
      if (removeBg) {
        setRemoveBg(false);
        pendingBlobRef.current = null;
        committedRef.current = null;
        revokePreview();
        updateObject(imgId, { url: sourceUrlRef.current } as Partial<SlideObject>);
      }
      patchImg({ fit: "cover", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, posX: 50, posY: 50, zoom: 1 });
    } else {
      const w = Math.round(CANVAS_W * logoSizePct / 100), h = Math.round(CANVAS_H * logoSizePct / 100);
      // blurFill is a full-screen-only effect — drop it so it doesn't linger
      // inside the small logo box (Logo mode has its own "Blur fill" background).
      patchImg({ fit: "contain", x: Math.round((CANVAS_W - w) / 2), y: Math.round((CANVAS_H - h) / 2), w, h, posX: 50, posY: 50, zoom: 1, blurFill: false });
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
  // Set true IN the effect body: under StrictMode (and any remount) the cleanup
  // runs then the effect re-runs — a ref only initialised once would stay false
  // forever and Auto-fill / Remove-background would never clear their busy state.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revokePreview(); };
  }, [revokePreview]);

  // Remove-flat-background keying: (re)runs when enabled or the threshold moves.
  // Debounced so dragging the slider doesn't thrash the canvas. The result is a
  // blob-URL preview; it's uploaded to a real asset only on Save (blob URLs
  // aren't valid on the projector wire).
  useEffect(() => {
    if (!removeBg || bgMode !== "background") return;
    let cancelled = false;
    setKeying(true);
    const t = window.setTimeout(() => {
      removeFlatBackground(sourceUrlRef.current, bgThreshold)
        .then(({ blob, flat }) => {
          if (cancelled || !mounted.current) return;
          pendingBlobRef.current = blob;
          committedRef.current = null; // a fresh keying needs a fresh upload
          revokePreview();
          const objUrl = URL.createObjectURL(blob);
          previewObjUrlRef.current = objUrl;
          updateObject(imgId, { url: objUrl } as Partial<SlideObject>);
          if (!flat) etoast("No flat background detected — keying may look off. Lower the threshold or turn it off.", { icon: "⚠️" });
        })
        .catch(() => {
          if (cancelled || !mounted.current) return;
          etoast.error("Couldn't remove the background (the image may block cross-origin reads).");
          setRemoveBg(false);
        })
        .finally(() => { if (!cancelled && mounted.current) setKeying(false); });
    }, 220);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [removeBg, bgThreshold, bgMode, imgId, updateObject, revokePreview]);

  function toggleRemoveBg() {
    if (removeBg) {
      setRemoveBg(false);
      pendingBlobRef.current = null;
      committedRef.current = null;
      revokePreview();
      updateObject(imgId, { url: sourceUrlRef.current } as Partial<SlideObject>);
    } else {
      setRemoveBg(true); // the effect runs the keying
    }
  }

  // Commit any pending keyed image as a real library asset (existing upload path)
  // and retarget editing to it. Returns the URL + asset id to persist/project, or
  // null on failure. A no-op (returns the current asset) when keying isn't active.
  const [saving, setSaving] = useState(false);
  // Frames are keyed per church. Until the church id has loaded, saving would
  // write under a shared "default" key, so Save stays disabled.
  const churchReady = !!ctx.churchId;

  // ── Dialog behaviour: Escape closes, Tab is trapped, focus is restored, and NO
  // key reaches the operator's global hotkeys (T/G/X/arrows) while it's open.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const opener = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    const focusables = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((el) => el.offsetParent !== null || el === document.activeElement);
    const raf = window.requestAnimationFrame(() => { focusables()[0]?.focus(); });
    const onKey = (e: KeyboardEvent) => {
      if (!dialogRef.current) return;
      // Stop the event reaching the operator's window-level hotkey listeners
      // (T/G/X/arrows). Listening on DOCUMENT in the bubble phase means the
      // editor's own inputs + React handlers still get the key first, and not
      // calling preventDefault keeps typing working.
      e.stopPropagation();
      // SlideCanvas's arrow-key nudge also lives on window, so it's blocked above —
      // re-implement it here for the image (Shift = 1px, else 10px).
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (!typing && e.key.startsWith("Arrow") && selectedRef.current.includes(imgId)) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 10;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        setSlide((sl) => ({ ...sl, objects: sl.objects.map((o) => (o.id === imgId && !o.locked ? ({ ...o, x: o.x + dx, y: o.y + dy } as SlideObject) : o)) }));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        const els = focusables();
        if (els.length === 0) { e.preventDefault(); return; }
        const first = els[0], last = els[els.length - 1];
        const active = document.activeElement as HTMLElement | null;
        const inside = !!active && dialogRef.current.contains(active);
        if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const onKeyUp = (e: KeyboardEvent) => { if (dialogRef.current) e.stopPropagation(); };
    document.addEventListener("keyup", onKeyUp);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      try { if (opener && document.contains(opener)) opener.focus(); } catch { /* non-fatal */ }
    };
  }, [imgId]);
  async function ensureCommitted(): Promise<{ url: string; assetId: string } | null> {
    if (!removeBg) return { url: asset.url, assetId: asset.id };
    if (committedRef.current) return { url: committedRef.current.url, assetId: committedRef.current.id };
    const blob = pendingBlobRef.current;
    if (!blob) return { url: asset.url, assetId: asset.id }; // keying not ready → original
    const base = (assetProp.fileName || "logo").replace(/\.[^.]+$/, "");
    const fileName = `${base} (bg removed).png`;
    try {
      const up = await uploadProcessedImage(blob, fileName);
      committedRef.current = up;
      pendingBlobRef.current = null;
      const newAsset = { id: up.id, url: up.url, fileName };
      setAsset(newAsset);
      updateObject(imgId, { url: up.url } as Partial<SlideObject>);
      onAssetReplaced?.(newAsset);
      return { url: up.url, assetId: up.id };
    } catch {
      etoast.error("Couldn't save the background-removed image.");
      return null;
    }
  }
  function autoFill() {
    if (!img || autofitting) return;
    setAutofitting(true);
    const im = new Image();
    im.crossOrigin = "anonymous";
    // Watchdog: if the load neither resolves nor errors (flaky wifi), release
    // the button after 8s so the operator isn't stuck.
    const watchdog = window.setTimeout(() => {
      im.onload = null; im.onerror = null;
      if (mounted.current) { etoast("Auto-fill timed out — use the Zoom slider.", { icon: "🔍" }); setAutofitting(false); }
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
            etoast(`Wide logo (${contentAspect.toFixed(1)}:1) — filled the width. Zoom in to crop-fill the height.`, { icon: "↔️" });
          } else if (contentAspect < BOX_ASPECT / 1.15) {
            // Tall image: contain fills the HEIGHT.
            applyFit("contain");
            etoast(`Tall image — filled the height. Zoom in to crop-fill the width.`, { icon: "↕️" });
          } else {
            // Roughly 16:9 already → cover genuinely fills the whole screen.
            applyFit("cover");
            etoast.success("Filled the screen", { icon: "✨" });
          }
          setAutofitting(false);
          return;
        }
        // There IS transparent padding — blow the content up to fill the box.
        // contain keeps the whole logo visible; zoom = 1/largest content dimension.
        const zoom = Math.max(1, Math.min(8, 0.98 / Math.max(cw, ch)));
        patchImg({ fit: "contain", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, zoom, posX: Math.round(cx * 100), posY: Math.round(cy * 100) });
        etoast.success("Filled the screen with the logo", { icon: "✨" });
      } catch {
        etoast("Couldn't auto-measure this image — use the Zoom slider to fill the screen.", { icon: "🔍" });
      } finally {
        setAutofitting(false);
      }
    };
    im.onerror = () => { window.clearTimeout(watchdog); if (mounted.current) { etoast.error("Couldn't load this image to measure it."); setAutofitting(false); } };
    im.src = asset.url;
  }

  // Build the projectable payload for a given logo URL (used at Save & Show time
  // so we project the COMMITTED persistent URL, not a transient blob preview URL).
  function buildPayload(logoUrl: string) {
    // Only the LOGO's url is swapped to the committed/keyed url — the blur-bg image
    // object (blurId) keeps the original image so the backdrop isn't keyed transparent.
    const objects = slide.objects.map((o) => (o.kind === "image" && o.id === imgId ? { ...o, url: logoUrl } : o));
    return projectableTextSlide("", slide.bgColor, undefined, objects);
  }
  function persist(assetId: string = asset.id) {
    if (!img) return;
    const frame: MediaFrame = { fit: img.fit ?? "cover", posX: img.posX ?? 50, posY: img.posY ?? 50, zoom: img.zoom ?? 1 };
    if (img.blurFill && bgMode === "matte" && (img.fit ?? "cover") === "contain") frame.blurFill = true;
    if (bgMode === "background") {
      frame.bgMode = "background";
      frame.bgKind = bgKind;
      frame.bgSolid = bgSolid;
      frame.gradFrom = gradFrom;
      frame.gradTo = gradTo;
      frame.gradAngle = gradAngle;
      // Persist the logo box as size% + centre% so it restores independent of
      // canvas px. Clamp to the same ranges loadMediaFrame enforces so a
      // handle-drag past the canvas edge round-trips consistently.
      const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
      frame.logoSizePct = clamp(Math.round((img.w / CANVAS_W) * 100), 10, 100);
      frame.logoPosX = clamp(Math.round(((img.x + img.w / 2) / CANVAS_W) * 100), 0, 100);
      frame.logoPosY = clamp(Math.round(((img.y + img.h / 2) / CANVAS_H) * 100), 0, 100);
    } else {
      frame.bgMode = "matte";
    }
    // The exact box (handle crop / resize / drag) — so it survives Save + reopen
    // and projects as edited (buildMediaFrameSlide reads it).
    frame.boxX = Math.round(img.x); frame.boxY = Math.round(img.y);
    frame.boxW = Math.round(img.w); frame.boxH = Math.round(img.h);
    // Saved ONLY under the asset being projected. (A keyed "remove flat background"
    // copy is a NEW asset; its frame is never copied onto the original — that put a
    // backdrop frame on the opaque original and projected it as a solid rectangle.)
    saveMediaFrame(ctx.churchId, assetId, frame);
  }
  async function save() {
    if (saving || !churchReady) return;
    setSaving(true);
    try {
      const c = await ensureCommitted();
      if (!c) return; // upload failed — ensureCommitted already toasted
      persist(c.assetId);
      etoast.success("Framing saved — this image will project framed", { icon: "💾" });
    } finally { setSaving(false); }
  }
  async function saveAndShow() {
    if (saving || !churchReady) return;
    setSaving(true);
    try {
      // Commit any "remove flat background" keying to a real, wire-valid asset
      // FIRST — the projector can't render a blob: preview URL.
      const c = await ensureCommitted();
      if (!c) return;
      // Build the payload from the committed URL (state updates are async, so we
      // can't rely on slide.objects having swapped yet in this tick).
      const payload = buildPayload(c.url);
      // If the URL ever fails wire-validation the image object is dropped and the
      // projector would show a black matte — never toast success in that case (the
      // editor still shows the image, so a silent black screen would be a lie).
      const hasImage = payload.kind === "text" && Array.isArray(payload.objects) && payload.objects.some((o) => o.kind === "image");
      if (!hasImage) { etoast.error("Couldn't project this image — try re-uploading it."); return; }
      persist(c.assetId);
      // Normal media send path (ctx.onSendSlideToLive → the shell's layers
      // engine) — Save & Show never bypasses it. The object payload carries
      // blurFill on its image object, so the projector (SlideObjectsLayer)
      // paints identically to this canvas.
      ctx.onSendSlideToLive(payload, undefined, { instant: true, force: true });
      etoast.success("Saved & on the projector");
    } finally { setSaving(false); }
  }

  busyRef.current = saving || keying || autofitting;

  // Portal drags still BUBBLE through the React tree into the opener (e.g. the
  // Media Bin's drop zone) — swallow them here so dragging in the editor never
  // lights the bin overlay or imports a file. preventDefault on OS file drags so
  // the browser doesn't navigate to the dropped file.
  const stopDrag = (e: React.DragEvent) => {
    e.stopPropagation();
    if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault();
  };

  // Size slider follows the actual box (a handle resize updates it too).
  const shownLogoSize = bgMode === "background" && img
    ? Math.max(10, Math.min(100, Math.round((img.w / CANVAS_W) * 100)))
    : logoSizePct;

  const btn = "h-8 px-2 rounded-md text-xs border inline-flex items-center justify-center gap-1";
  const bstyle = { borderColor: "#2a3232", background: "#1a2020", color: "#e4e4e7" } as React.CSSProperties;
  const on = (active: boolean) => ({ ...bstyle, borderColor: active ? "#2dd4bf" : "#2a3232", color: active ? "#5eead4" : "#e4e4e7" });

  const overlay = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="media-image-editor-title"
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.78)" }}
      onDragEnter={stopDrag}
      onDragOver={stopDrag}
      onDragLeave={stopDrag}
      onDrop={stopDrag}
    >
      <div className="flex flex-col rounded-xl border overflow-hidden" style={{ width: "min(1160px, 96vw)", height: "min(740px, 94vh)", borderColor: "#2a3232", background: "#1e2525" }}>
        {/* Header */}
        <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b" style={{ borderColor: "#2a3232" }}>
          <ImageIcon className="w-4 h-4 text-teal-300" />
          <div className="flex-1 min-w-0">
            <div id="media-image-editor-title" className="text-[13px] font-semibold text-zinc-100 leading-none truncate">Edit image</div>
            <div className="text-[10px] text-zinc-500 leading-none mt-1 truncate">{churchReady ? `${asset.fileName} — drag to move, handles to crop, pan/zoom on the right` : "Loading your church… Save will be available in a moment."}</div>
          </div>
          <button onClick={() => void save()} disabled={autofitting || keying || saving || !churchReady} title={churchReady ? "Save this framing for the image" : "Loading your church…"} className="h-8 px-3 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 border border-[#2a3232] bg-[#1a2020] text-zinc-200 hover:border-teal-500/60 disabled:opacity-50"><Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save"}</button>
          <button onClick={() => void saveAndShow()} disabled={autofitting || keying || saving || !churchReady} title={churchReady ? undefined : "Loading your church…"} className="h-8 px-3 rounded-md text-xs font-bold inline-flex items-center gap-1.5 bg-teal-500 text-[#08110f] hover:bg-teal-400 disabled:opacity-50"><Play className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save & Show"}</button>
          <button onClick={onClose} title="Close" aria-label="Close" className="h-8 w-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/5"><X className="w-4 h-4" /></button>
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
                backgroundNode={backgroundNode}
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

            <Section label="Projection layout">
              <LayoutDefaultControl churchId={ctx.churchId} compact />
              <div className="mt-1.5 text-[10px] text-zinc-500">Set to a Lower / Upper / Mid third to place your images &amp; videos — and songs &amp; verses — in a band instead of full screen. This is your default for everything.</div>
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
                  {/* Blur fill — ALWAYS visible (not tucked behind Auto-fill). Turning
                      it on forces Fit (blur fills the letterbox bars of a contained
                      image). It's saved on the image + persists everywhere. */}
                  <button
                    onClick={() => patchImg(img?.blurFill ? { blurFill: false } : { blurFill: true, fit: "contain", x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, posX: 50, posY: 50, zoom: 1 })}
                    className={cn(btn, "w-full mt-2")}
                    style={on(!!img?.blurFill)}
                  >
                    <Maximize2 className="w-3.5 h-3.5" /> {img?.blurFill ? "Blur fill: ON" : "Blur fill the bars"}
                  </button>
                  <div className="mt-1 text-[10px] text-zinc-500">Fills the black bars with a blurred copy of this image — perfect for portrait flyers so nothing sits thin on screen. Always matches, and it saves so it shows everywhere.</div>
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
                  {/* Blur fill — the same effect Full-screen mode offers, but as the
                      BACKGROUND behind the logo: a screen-filling blurred copy of the
                      image so nothing sits on a flat colour (Spotify-style backdrop). */}
                  <button onClick={() => setBgKind(bgKind === "blur" ? "solid" : "blur")} className={cn(btn, "w-full mt-1.5")} style={on(bgKind === "blur")}>
                    <Maximize2 className="w-3.5 h-3.5" /> {bgKind === "blur" ? "Blur fill: ON" : "Blur fill the bars"}
                  </button>
                  <div className="mt-1 text-[10px] text-zinc-500">Fills the background with a blurred copy of this image behind the logo — great for wide/odd logos and flyers. Saves so it shows everywhere.</div>
                </Section>

                <Section label="Logo size">
                  <Row label="Size"><div className="flex items-center gap-2"><input type="range" min={10} max={100} step={1} value={shownLogoSize} onChange={(e) => setLogoSize(Number(e.target.value))} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{shownLogoSize}%</span></div></Row>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500"><Move className="w-3 h-3" /> Drag the logo on the canvas to position it; handles resize it.</div>
                </Section>

                <Section label="Logo">
                  <button onClick={toggleRemoveBg} disabled={keying || saving} className={cn(btn, "w-full")} style={on(removeBg)}>
                    <Wand2 className="w-3.5 h-3.5" /> {keying ? "Removing…" : removeBg ? "Remove flat background: ON" : "Remove flat background (beta)"}
                  </button>
                  {removeBg && (
                    <Row label="Amount"><div className="flex items-center gap-2"><input type="range" min={5} max={80} step={1} value={bgThreshold} onChange={(e) => setBgThreshold(Number(e.target.value))} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-7 text-right">{bgThreshold}</span></div></Row>
                  )}
                  <div className="mt-1 text-[10px] text-zinc-500">Keys out a baked flat (near-black or near-white) background around the logo so it sits cleanly on your background. Detected from the image corners — best on solid-colour logo boxes, not photos. Saved as a new transparent copy in your library.</div>
                </Section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
  // Portal to <body> so the editor is never trapped under a parent stacking
  // context (e.g. the shell's `relative z-[1]` column) — it always sits on top
  // and receives clicks, wherever it was opened from. SSR-safe.
  if (typeof document === "undefined") return overlay;
  return createPortal(overlay, document.body);
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
