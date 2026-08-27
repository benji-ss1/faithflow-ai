"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { X, Lock, Image as ImageIcon, Play, Save, Type, AlignLeft, AlignCenter, AlignRight, BookOpen } from "lucide-react";
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

  // Identify verse (first text) + reference (second text) objects.
  const texts = slide.objects.filter((o): o is TextObject => o.kind === "text");
  const verseObj = texts[0] ?? null;
  const refObj = texts[1] ?? null;
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
    return d;
  }
  // No per-slide background — theme background is authoritative on the projector.
  function show() {
    const p = projectableTextSlide(verse.text, undefined, undefined, slide.objects);
    // Carry the reference in the dedicated field too (footer guarantee; deduped
    // against the reference object so it never shows twice).
    if (p.kind === "text" && refObj && !refObj.hidden && refObj.text) p.reference = refObj.text;
    onShow(p, transition);
  }
  function saveAll() { saveScriptureStyle(churchId, currentDesign()); onSaved?.(); toast.success("Style saved — applied to all scripture slides"); }

  // Dropdown / plain-control chrome (Font, Weight) — Design Language v2.
  const btn = "h-8 px-2 rounded-lg text-xs border inline-flex items-center justify-center gap-1 transition-[transform,box-shadow,border-color,background-color,color] duration-150 [transition-timing-function:var(--ease-spring)]";
  const bstyle = {
    borderColor: "var(--color-border)",
    background: "var(--color-muted)",
    color: "var(--color-foreground)",
    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.28)",
  } as React.CSSProperties;
  // Segmented-control segment styling (active = elevated + ember; inactive = muted).
  const segBase = "h-8 rounded-lg text-xs inline-flex items-center justify-center gap-1 transition-[transform,box-shadow,color,background-color] duration-150 [transition-timing-function:var(--ease-spring)] active:scale-[0.97]";
  const seg = (on: boolean): React.CSSProperties =>
    on
      ? {
          background: "var(--color-elevated)",
          color: "var(--color-brand)",
          boxShadow: "var(--edge-top), var(--shadow-md), inset 0 0 0 1px color-mix(in oklab, var(--color-brand) 40%, transparent)",
        }
      : { background: "transparent", color: "var(--color-muted-foreground)" };
  const SEG_WRAP = "flex gap-[3px] rounded-xl border border-[var(--color-border)] bg-[var(--color-app-bg)] p-[3px] shadow-[var(--edge-top),inset_0_1px_2px_rgba(0,0,0,0.28)]";
  // Full-width toggle (Reference show / Translation) — inactive is outline, active is ember-filled-subtle.
  const toggle = (on: boolean): React.CSSProperties =>
    on
      ? {
          borderColor: "color-mix(in oklab, var(--color-brand) 55%, var(--color-border))",
          background: "color-mix(in oklab, var(--color-brand) 16%, var(--color-card))",
          color: "var(--color-brand-hi)",
          boxShadow: "var(--edge-top), var(--shadow-sm)",
        }
      : {
          borderColor: "var(--color-border)",
          background: "var(--color-card)",
          color: "var(--color-muted-foreground)",
          boxShadow: "var(--edge-top), var(--shadow-sm)",
        };
  const emberSlider = { accentColor: "var(--color-brand)" } as React.CSSProperties;
  const CHECKER = "linear-gradient(45deg,#111 25%,transparent 25%),linear-gradient(-45deg,#111 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#111 75%),linear-gradient(-45deg,transparent 75%,#111 75%)";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.75)" }}>
      <div className="flex flex-col rounded-xl border overflow-hidden shadow-[var(--edge-top),var(--shadow-lg)]" style={{ width: "min(1200px, 96vw)", height: "min(760px, 94vh)", borderColor: "var(--color-border)", background: "var(--color-panel)" }}>
        {/* Header */}
        <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b" style={{ borderColor: "var(--color-border)" }}>
          <Type className="w-4 h-4" style={{ color: "var(--color-brand)" }} />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold leading-none" style={{ color: "var(--color-foreground)" }}>Edit scripture slide</div>
            <div className="text-[10px] leading-none mt-1" style={{ color: "var(--color-muted-foreground)" }}>{verse.reference}{verse.translation ? ` · ${verse.translation}` : ""} — drag to move, handles to resize</div>
          </div>
          <button onClick={saveAll} title="Save this style — applies to ALL scripture slides" className="h-8 px-3 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] transition-[transform,box-shadow,border-color] duration-150 [transition-timing-function:var(--ease-spring)] hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--color-brand)_55%,var(--color-border))] hover:shadow-[var(--edge-top),var(--shadow-md)]" style={{ borderColor: "var(--color-border)", color: "var(--color-foreground)" }}><Save className="w-3.5 h-3.5" /> Save (all slides)</button>
          <button onClick={show} className="h-8 px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 bg-[linear-gradient(180deg,#F2712E_0%,#E8501A_100%)] text-black shadow-[var(--edge-top),var(--shadow-ember)] transition-[transform,box-shadow] duration-150 [transition-timing-function:var(--ease-spring)] hover:-translate-y-px hover:shadow-[var(--edge-top),var(--shadow-ember-lg)]"><Play className="w-3.5 h-3.5" /> Show to projector</button>
          <button onClick={onClose} title="Close" className="h-8 w-8 flex items-center justify-center rounded-lg transition-colors duration-150 hover:bg-white/[0.06]" style={{ color: "var(--color-muted-foreground)" }}><X className="w-4 h-4" /></button>
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
          <div className="w-[320px] shrink-0 border-l overflow-y-auto" style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}>
            <Section label={selText ? (isVerseSelected ? "Verse text" : "Reference / translation") : "Selection"}>
              {selText ? (
                <>
                  {isVerseSelected && (
                    <div className="mb-2 flex items-center gap-1.5 text-[10px] text-zinc-500"><Lock className="w-3 h-3" /> Words are locked — move, resize &amp; style only.</div>
                  )}
                  <Row label="Font"><select value={selText.fontFamily ?? "Sora"} onChange={(e) => patchSelected({ fontFamily: e.target.value })} className={btn + " w-full"} style={bstyle}>{FONTS.map((f) => <option key={f} value={f}>{f}</option>)}</select></Row>
                  <Row label="Size"><div className="flex items-center gap-2"><input type="range" min={20} max={220} step={2} value={selText.fontSize ?? 96} onChange={(e) => patchSelected({ fontSize: Number(e.target.value) })} className="flex-1" style={emberSlider} /><span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{selText.fontSize ?? 96}</span></div></Row>
                  <Row label="Weight"><select value={selText.fontWeight ?? 700} onChange={(e) => patchSelected({ fontWeight: Number(e.target.value) })} className={btn + " w-full"} style={bstyle}>{WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}</select></Row>
                  <Row label="Colour"><input type="color" value={selText.color ?? "#ffffff"} onChange={(e) => patchSelected({ color: e.target.value })} className="h-8 w-full rounded-lg border bg-transparent shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)]" style={{ borderColor: "var(--color-border)" }} /></Row>
                  <Row label="Align"><div className={SEG_WRAP}>{([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([a, Icon]) => (<button key={a} onClick={() => patchSelected({ align: a })} className={cn(segBase, "flex-1")} style={seg(selText.align === a)}><Icon className="w-3.5 h-3.5" /></button>))}</div></Row>
                  <Row label="Style"><div className={SEG_WRAP}>
                    <button onClick={() => patchSelected({ italic: !selText.italic })} className={cn(segBase, "flex-1 italic")} style={seg(!!selText.italic)}>I</button>
                    <button onClick={() => patchSelected({ uppercase: !selText.uppercase })} className={cn(segBase, "flex-1")} style={seg(!!selText.uppercase)}>AA</button>
                    <button onClick={() => patchSelected({ shadow: !(selText.shadow ?? true) })} className={cn(segBase, "flex-1")} style={seg(selText.shadow ?? true)}>Shadow</button>
                  </div></Row>
                  <Row label="Line"><div className="flex items-center gap-2"><input type="range" min={0.8} max={2} step={0.05} value={selText.lineHeight ?? 1.15} onChange={(e) => patchSelected({ lineHeight: Number(e.target.value) })} className="flex-1" style={emberSlider} /><span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{(selText.lineHeight ?? 1.15).toFixed(2)}</span></div></Row>
                  <Row label="Spacing"><div className="flex items-center gap-2"><input type="range" min={-5} max={30} step={1} value={selText.letterSpacing ?? 0} onChange={(e) => patchSelected({ letterSpacing: Number(e.target.value) })} className="flex-1" style={emberSlider} /><span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{selText.letterSpacing ?? 0}</span></div></Row>
                  <Row label="Outline"><div className="flex items-center gap-2"><input type="range" min={0} max={24} step={1} value={selText.strokeWidth ?? 0} onChange={(e) => patchSelected({ strokeWidth: Number(e.target.value) })} className="flex-1" style={emberSlider} /><span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{selText.strokeWidth ?? 0}</span></div></Row>
                  {(selText.strokeWidth ?? 0) > 0 && <Row label="Outline ·"><input type="color" value={selText.stroke ?? "#000000"} onChange={(e) => patchSelected({ stroke: e.target.value })} className="h-8 w-full rounded-lg border bg-transparent shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)]" style={{ borderColor: "var(--color-border)" }} /></Row>}
                </>
              ) : (
                <div className="text-[11px] text-zinc-500">Click the verse or the reference on the canvas to edit its style. Drag to move; use the handles to resize.</div>
              )}
            </Section>

            <Section label="Reference / translation">
              <Row label="Show"><button onClick={toggleReference} className={cn(btn, "w-full font-semibold")} style={toggle(!!refObj && !refObj.hidden)}>{refObj && !refObj.hidden ? "Shown on screen" : "Hidden"}</button></Row>
              <Row label="Translation"><button onClick={toggleTranslation} className={cn(btn, "w-full font-semibold")} style={toggle(showTranslation)}>{showTranslation ? `Shown${verse.translation ? ` (${verse.translation})` : ""}` : "Hidden"}</button></Row>
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mt-1"><BookOpen className="w-3 h-3" /> Projects to the live screen so the congregation sees the verse &amp; translation.</div>
            </Section>

            <Section label="Background">
              <div className="flex items-start gap-1.5 text-[11px] text-zinc-400">
                <ImageIcon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" />
                <span>The background always follows the <span className="text-zinc-200">active theme</span>. Change it in Themes — it applies to every slide, scripture included.</span>
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
      <div className="eyebrow mb-2">{label}</div>
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
