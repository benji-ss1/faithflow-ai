"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { X, Lock, Image as ImageIcon, Upload, Loader2, Play, Save, Type, AlignLeft, AlignCenter, AlignRight, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { SlidePayload, TransitionSpec, ThemeAppearance } from "@/lib/broadcast";
import { projectableTextSlide } from "@/lib/broadcast";
import type { EditableSlide, SlideObject, TextObject } from "@/lib/slide-objects";
import { SlideCanvas } from "@/components/operator/editor/SlideCanvas";
import {
  type ScriptureDesign, DEFAULT_SCRIPTURE_DESIGN, scriptureEditableSlide,
  designFromSlide, saveScriptureStyle, referenceLabel,
} from "./scriptureStyle";

/**
 * ScriptureSlideEditor — canvas-based "edit slide" for Bible / memory verses.
 *
 * Uses the SAME drag/resize canvas as the song editor (SlideCanvas), so the
 * operator can move and resize the verse text AND the reference/translation
 * line freely — and style each. ONE hard rule: the WORDS of scripture are
 * immutable (there is no text-editing field for the verse; its text comes from
 * the Bible library). The reference line carries the translation and projects
 * to the live screen so the congregation always sees the verse + translation.
 *
 * Self-contained: drives SlideCanvas with local state — does NOT touch the song
 * editor's useSlideEditor/DesktopSlideEditorModal, so songs stay safe. Projects
 * via projectableTextSlide (the exact song-editor converter).
 */

const FONTS = ["Sora", "Plus Jakarta Sans", "Inter", "Georgia", "Times New Roman", "Helvetica", "Arial", "Courier New"];
const WEIGHTS = [400, 500, 600, 700, 800];

export function ScriptureSlideEditor({
  verse, initial, appearance, churchId, onClose, onShow, onSaved, transition,
}: {
  verse: { text: string; reference: string; translation?: string };
  initial?: ScriptureDesign;
  appearance?: ThemeAppearance | null;
  churchId?: string;
  onClose: () => void;
  onShow: (slide: SlidePayload, transition?: TransitionSpec | null) => void;
  onSaved?: () => void;
  transition?: TransitionSpec | null;
}) {
  const baseDesign = useMemo<ScriptureDesign>(() => initial ?? DEFAULT_SCRIPTURE_DESIGN, [initial]);
  const [slide, setSlide] = useState<EditableSlide>(() =>
    scriptureEditableSlide(verse.text, verse.reference, verse.translation, baseDesign));
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const v = slide.objects.find((o) => o.kind === "text");
    return v ? [v.id] : [];
  });
  const [showTranslation, setShowTranslation] = useState(baseDesign.reference.showTranslation);
  const [bgFit, setBgFit] = useState(baseDesign.bgFit);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Identify verse (first text) + reference (second text) objects.
  const texts = slide.objects.filter((o): o is TextObject => o.kind === "text");
  const verseObj = texts[0] ?? null;
  const refObj = texts[1] ?? null;
  const bgObj = slide.objects.find((o) => o.kind === "image" || o.kind === "shape") ?? null;
  const selected = slide.objects.find((o) => o.id === selectedIds[0]) ?? null;
  const selText = selected && selected.kind === "text" ? selected : null;
  const isVerseSelected = !!selText && !!verseObj && selText.id === verseObj.id;

  // ── Canvas handlers (drive SlideCanvas with local state) ──────────────────
  const updateObject = useCallback((id: string, patch: Partial<SlideObject>) => {
    setSlide((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as SlideObject) : o)) }));
  }, []);
  const updateObjects = useCallback((patches: { id: string; patch: Partial<SlideObject> }[]) => {
    setSlide((s) => ({ ...s, objects: s.objects.map((o) => { const p = patches.find((x) => x.id === o.id); return p ? ({ ...o, ...p.patch } as SlideObject) : o; }) }));
  }, []);
  const onSelectObject = useCallback((id: string | null, additive?: boolean) => {
    setSelectedIds((prev) => (id == null ? [] : additive ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id]));
  }, []);
  const removeObjects = useCallback(() => { /* scripture objects are fixed — no delete */ }, []);

  const patchSelected = (patch: Partial<TextObject>) => { if (selText) updateObject(selText.id, patch); };

  // Background helpers (mutate the bg object in place).
  function setBgColor(color: string) {
    if (!bgObj) return;
    if (bgObj.kind === "shape") updateObject(bgObj.id, { fill: color });
    else setSlide((s) => ({ ...s, bgColor: color, objects: s.objects.map((o) => o.id === bgObj.id ? { id: o.id, kind: "shape", x: 0, y: 0, w: o.w, h: o.h, shape: "rect", fill: color, strokeWidth: 0, radius: 0, locked: true } : o) }));
    setSlide((s) => ({ ...s, bgColor: color }));
  }

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const presign = await fetch("/api/media/presign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, purpose: "media" }) }).then((r) => r.json()) as { url?: string; key?: string; error?: string };
      if (presign.error || !presign.url || !presign.key) throw new Error(presign.error || "Presign failed");
      const put = await fetch(presign.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("Upload failed");
      const got = await fetch("/api/media/url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: presign.key }) }).then((r) => r.json()) as { url?: string; error?: string };
      if (got.error || !got.url) throw new Error(got.error || "Could not get URL");
      const url = got.url;
      setSlide((s) => ({ ...s, bgImageUrl: url, objects: s.objects.map((o) => (o.id === bgObj?.id ? { id: o.id, kind: "image", x: 0, y: 0, w: 1920, h: 1080, url, fit: bgFit, locked: true } : o)) }));
      toast.success("Image added");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); }
    finally { setUploading(false); }
  }
  function removeBgImage() {
    setSlide((s) => ({ ...s, bgImageUrl: undefined, objects: s.objects.map((o) => (o.id === bgObj?.id ? { id: o.id, kind: "shape", x: 0, y: 0, w: 1920, h: 1080, shape: "rect", fill: s.bgColor || "#0a0a0a", strokeWidth: 0, radius: 0, locked: true } : o)) }));
  }

  function toggleReference() {
    if (!refObj) return;
    updateObject(refObj.id, { hidden: !refObj.hidden });
  }
  function toggleTranslation() {
    const next = !showTranslation;
    setShowTranslation(next);
    if (refObj) updateObject(refObj.id, { text: referenceLabel(verse.reference, verse.translation, next) });
  }

  function currentDesign(): ScriptureDesign {
    const d = designFromSlide(slide, baseDesign);
    d.reference.showTranslation = showTranslation;
    d.reference.show = refObj ? !refObj.hidden : false;
    d.bgFit = bgFit;
    return d;
  }
  function show() { onShow(projectableTextSlide(verse.text, slide.bgColor, slide.bgImageUrl, slide.objects), transition); }
  function saveAll() { saveScriptureStyle(churchId, currentDesign()); onSaved?.(); toast.success("Style saved — applied to all scripture slides"); }

  const btn = "h-8 px-2 rounded-md text-xs border inline-flex items-center justify-center gap-1";
  const bstyle = { borderColor: "#2a3232", background: "#1a2020", color: "#e4e4e7" } as React.CSSProperties;
  const toggle = (on: boolean) => ({ ...bstyle, borderColor: on ? "#2dd4bf" : "#2a3232", color: on ? "#5eead4" : "#e4e4e7" });
  const CHECKER = "linear-gradient(45deg,#111 25%,transparent 25%),linear-gradient(-45deg,#111 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#111 75%),linear-gradient(-45deg,transparent 75%,#111 75%)";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.75)" }}>
      <div className="flex flex-col rounded-xl border overflow-hidden" style={{ width: "min(1200px, 96vw)", height: "min(760px, 94vh)", borderColor: "#2a3232", background: "#1e2525" }}>
        {/* Header */}
        <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b" style={{ borderColor: "#2a3232" }}>
          <Type className="w-4 h-4 text-teal-300" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-zinc-100 leading-none">Edit scripture slide</div>
            <div className="text-[10px] text-zinc-500 leading-none mt-1">{verse.reference}{verse.translation ? ` · ${verse.translation}` : ""} — drag to move, handles to resize</div>
          </div>
          <button onClick={saveAll} title="Save this style — applies to ALL scripture slides" className={cn(btn, "font-semibold")} style={bstyle}><Save className="w-3.5 h-3.5" /> Save (all slides)</button>
          <button onClick={show} className="h-8 px-3 rounded-md text-xs font-bold inline-flex items-center gap-1.5 bg-teal-500 text-[#08110f] hover:bg-teal-400"><Play className="w-3.5 h-3.5" /> Show to projector</button>
          <button onClick={onClose} title="Close" className="h-8 w-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/5"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* Canvas */}
          <div className="flex-1 min-w-0 min-h-0 relative" style={{ backgroundColor: "#0d0d10", backgroundImage: CHECKER, backgroundSize: "28px 28px" }}>
            <SlideCanvas
              slide={slide}
              selectedIds={selectedIds}
              onSelectObject={onSelectObject}
              onSetSelection={setSelectedIds}
              onUpdateObject={updateObject}
              onUpdateObjects={updateObjects}
              onRemoveObjects={removeObjects}
              readOnly={false}
            />
          </div>

          {/* Controls */}
          <div className="w-[320px] shrink-0 border-l overflow-y-auto" style={{ borderColor: "#2a3232", background: "#1e2525" }}>
            <Section label={selText ? (isVerseSelected ? "Verse text" : "Reference / translation") : "Selection"}>
              {selText ? (
                <>
                  {isVerseSelected && (
                    <div className="mb-2 flex items-center gap-1.5 text-[10px] text-zinc-500"><Lock className="w-3 h-3" /> Words are locked — move, resize &amp; style only.</div>
                  )}
                  <Row label="Font"><select value={selText.fontFamily ?? "Sora"} onChange={(e) => patchSelected({ fontFamily: e.target.value })} className={btn + " w-full"} style={bstyle}>{FONTS.map((f) => <option key={f} value={f}>{f}</option>)}</select></Row>
                  <Row label="Size"><div className="flex items-center gap-2"><input type="range" min={20} max={220} step={2} value={selText.fontSize ?? 96} onChange={(e) => patchSelected({ fontSize: Number(e.target.value) })} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{selText.fontSize ?? 96}</span></div></Row>
                  <Row label="Weight"><select value={selText.fontWeight ?? 700} onChange={(e) => patchSelected({ fontWeight: Number(e.target.value) })} className={btn + " w-full"} style={bstyle}>{WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}</select></Row>
                  <Row label="Colour"><input type="color" value={selText.color ?? "#ffffff"} onChange={(e) => patchSelected({ color: e.target.value })} className="h-8 w-full rounded-md border bg-transparent" style={{ borderColor: "#2a3232" }} /></Row>
                  <Row label="Align"><div className="flex gap-1">{([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([a, Icon]) => (<button key={a} onClick={() => patchSelected({ align: a })} className={cn(btn, "flex-1")} style={toggle(selText.align === a)}><Icon className="w-3.5 h-3.5" /></button>))}</div></Row>
                  <Row label="Style"><div className="flex gap-1">
                    <button onClick={() => patchSelected({ italic: !selText.italic })} className={cn(btn, "flex-1 italic")} style={toggle(!!selText.italic)}>I</button>
                    <button onClick={() => patchSelected({ uppercase: !selText.uppercase })} className={cn(btn, "flex-1")} style={toggle(!!selText.uppercase)}>AA</button>
                    <button onClick={() => patchSelected({ shadow: !(selText.shadow ?? true) })} className={cn(btn, "flex-1")} style={toggle(selText.shadow ?? true)}>Shadow</button>
                  </div></Row>
                  <Row label="Line"><div className="flex items-center gap-2"><input type="range" min={0.8} max={2} step={0.05} value={selText.lineHeight ?? 1.15} onChange={(e) => patchSelected({ lineHeight: Number(e.target.value) })} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{(selText.lineHeight ?? 1.15).toFixed(2)}</span></div></Row>
                  <Row label="Spacing"><div className="flex items-center gap-2"><input type="range" min={-5} max={30} step={1} value={selText.letterSpacing ?? 0} onChange={(e) => patchSelected({ letterSpacing: Number(e.target.value) })} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{selText.letterSpacing ?? 0}</span></div></Row>
                  <Row label="Outline"><div className="flex items-center gap-2"><input type="range" min={0} max={24} step={1} value={selText.strokeWidth ?? 0} onChange={(e) => patchSelected({ strokeWidth: Number(e.target.value) })} className="flex-1" /><span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{selText.strokeWidth ?? 0}</span></div></Row>
                  {(selText.strokeWidth ?? 0) > 0 && <Row label="Outline ·"><input type="color" value={selText.stroke ?? "#000000"} onChange={(e) => patchSelected({ stroke: e.target.value })} className="h-8 w-full rounded-md border bg-transparent" style={{ borderColor: "#2a3232" }} /></Row>}
                </>
              ) : (
                <div className="text-[11px] text-zinc-500">Click the verse or the reference on the canvas to edit its style. Drag to move; use the handles to resize.</div>
              )}
            </Section>

            <Section label="Reference / translation">
              <Row label="Show"><button onClick={toggleReference} className={cn(btn, "w-full")} style={toggle(!!refObj && !refObj.hidden)}>{refObj && !refObj.hidden ? "Shown on screen" : "Hidden"}</button></Row>
              <Row label="Translation"><button onClick={toggleTranslation} className={cn(btn, "w-full")} style={toggle(showTranslation)}>{showTranslation ? `Shown${verse.translation ? ` (${verse.translation})` : ""}` : "Hidden"}</button></Row>
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mt-1"><BookOpen className="w-3 h-3" /> Projects to the live screen so the congregation sees the verse &amp; translation.</div>
            </Section>

            <Section label="Background">
              <Row label="Colour"><input type="color" value={slide.bgColor ?? "#0a0a0a"} onChange={(e) => setBgColor(e.target.value)} className="h-8 w-full rounded-md border bg-transparent" style={{ borderColor: "#2a3232" }} /></Row>
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className={cn(btn, "w-full mt-1")} style={bstyle}>{uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}{uploading ? "Uploading…" : "Add image from computer"}</button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); e.target.value = ""; }} />
              <div className="mt-1.5 flex items-center gap-1 text-[10px] text-zinc-500"><ImageIcon className="w-3 h-3" /> PNG, JPG, WEBP, GIF, AVIF</div>
              {slide.bgImageUrl ? (
                <div className="mt-2">
                  <Row label="Fit"><div className="flex gap-1">{(["cover", "contain"] as const).map((f) => (<button key={f} onClick={() => { setBgFit(f); if (bgObj?.kind === "image") updateObject(bgObj.id, { fit: f }); }} className={cn(btn, "flex-1 capitalize")} style={toggle(bgFit === f)}>{f}</button>))}</div></Row>
                  <button onClick={removeBgImage} className="mt-1 text-[11px] text-red-300 hover:opacity-80">Remove image</button>
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
