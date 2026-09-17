"use client";
// Theme Editor (PR 1) — the "Theme" drawer tab shown ONLY when the slide editor
// is editing a theme (never for songs). Every control writes a real theme config
// key or a real text box property.
//
// Single sources of truth (review gate):
//  • Typography reads from and writes to the current slide's text box directly
//    (the verse box on a scripture slide, the main box otherwise) — the saved
//    flat font fields are derived from those boxes on save.
//  • Background lives ONLY in the theme config (the drawer's per-slide
//    Background tab is hidden in theme mode); the canvas previews it via
//    themeBgStyle / backgroundNode, so slides are never rewritten.
import { FontOptions, WeightOptions } from "@/components/fonts/FontOptions";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import type { UseSlideEditorReturn } from "../editor/useSlideEditor";
import type { TextObject } from "@/lib/slide-objects";
import { BgAssetPicker } from "@/components/library/BgAssetPicker";
import { TRANSITIONS } from "./BottomBar/TransitionChooser";
import { TRANSITION_NAME_TO_EFFECT_ID } from "@/lib/transition-names";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { hasSavedScriptureStyle, clearScriptureStyle } from "@/components/operator/scripture/scriptureStyle";
import { extractLogoPalette } from "@/lib/actions";
import { buildColorwayFromPalette } from "@/lib/colorway";
import { mainTextOf, typographyTargetOf, parseThemeFontSize, type ThemeSlideMeta } from "@/lib/theme-editor-model";
import { cn } from "@/lib/utils";

type Cfg = Record<string, unknown>;

const LOGO_GRID = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
];
const rowCls = "eyebrow block mb-1";
const inCls = "w-full h-8 px-2 rounded-lg border border-[var(--color-border)] text-[12px] text-[var(--color-foreground)] bg-[var(--color-muted)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)] outline-none transition-colors duration-200 focus:border-[var(--color-brand)]";
const segOn = { borderColor: "var(--color-brand)", background: "color-mix(in oklab, var(--color-brand) 16%, transparent)", color: "var(--color-brand-hi)" };
const segOff: React.CSSProperties = { borderColor: "var(--color-border)" };
const colorCls = "h-8 w-full rounded-md border cursor-pointer bg-transparent";
const rangeStyle = { accentColor: "var(--color-brand)" };

function get<T>(cfg: Cfg, key: string, fallback: T): T {
  const v = cfg[key];
  return (v === undefined || v === null ? fallback : v) as T;
}

function Seg({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn("flex-1 h-8 rounded-md border text-[10px] font-semibold capitalize active:scale-[0.97] transition-transform", !on && "hover:bg-[var(--color-brand)]/10")}
      style={on ? segOn : segOff}>{label}</button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 border-b border-[var(--color-border)] pb-3 last:border-b-0">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-foreground)]">{title}</h3>
      {children}
    </section>
  );
}

/** Label bound to its control via htmlFor. */
function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return <div><label htmlFor={id} className={rowCls}>{label}</label>{children(id)}</div>;
}

function Group({ label, children, className = "flex gap-1" }: { label: string; children: React.ReactNode; className?: string }) {
  return <div><span className={rowCls}>{label}</span><div role="group" aria-label={label} className={className}>{children}</div></div>;
}

/** Font size input that never commits 0/NaN/out-of-range: keeps a draft while
 *  typing and only writes a valid 12–400 value (blur restores the last valid). */
function SizeInput({ id, value, onCommit }: { id: string; value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <input id={id} type="number" min={12} max={400} value={draft}
      onChange={(e) => { setDraft(e.target.value); const n = parseThemeFontSize(e.target.value); if (n !== null) onCommit(n); }}
      onBlur={() => setDraft(String(value))} className={inCls} />
  );
}

export function ThemeEditorTab({ editor, churchId, cfg, setCfg, meta, setMeta, makeDefault, setMakeDefault, isDefault }: {
  editor: UseSlideEditorReturn;
  churchId?: string;
  cfg: Cfg;
  setCfg: (patch: Cfg) => void;
  meta: Record<string, ThemeSlideMeta>;
  setMeta: (id: string, patch: Partial<ThemeSlideMeta>) => void;
  makeDefault: boolean;
  setMakeDefault: (v: boolean) => void;
  isDefault: boolean;
}) {
  const [paletteBusy, setPaletteBusy] = useState(false);
  // PR 2: a saved Scripture Style on THIS computer overrides the theme's
  // scripture boxes (decision 4) — say so, and offer to clear it.
  const [savedScripture, setSavedScripture] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  useEffect(() => {
    const read = () => setSavedScripture(hasSavedScriptureStyle(churchId));
    read();
    window.addEventListener("pf-scripture-style-changed", read);
    return () => window.removeEventListener("pf-scripture-style-changed", read);
  }, [churchId]);
  const resetSavedScripture = async () => {
    const ok = await confirm({ title: "Clear the saved Scripture Style?", description: "Scripture on this computer will use this theme's scripture boxes and options instead. This can't be undone.", confirmLabel: "Clear", danger: true });
    if (!ok) return;
    clearScriptureStyle(churchId);
    toast.success("Saved Scripture Style cleared");
  };
  const cur = editor.currentSlide;
  const curMeta = cur ? meta[cur.id] : undefined;
  const bgType = get<string>(cfg, "bgType", "solid");
  const isScripture = curMeta?.role === "scripture";
  const target: TextObject | null = cur ? typographyTargetOf(cur.objects, curMeta?.role) : null;
  const updTarget = (patch: Partial<TextObject>) => { if (target) editor.updateObject(target.id, patch); };

  async function autoColorway() {
    const logo = get(cfg, "logoUrl", "") as string;
    if (!logo) { toast.error("Add a logo image first"); return; }
    setPaletteBusy(true);
    try {
      const res = await extractLogoPalette(logo);
      if (!res.ok || !res.data) { toast.error((!res.ok && res.error) || "Couldn't read the logo"); return; }
      const cw = buildColorwayFromPalette(res.data.colors);
      if (!cw) { toast.error("No usable colours found in the logo"); return; }
      const { textColor, ...bg } = cw;
      setCfg(bg);
      // Readable text colour goes onto the main box of every slide (the boxes
      // are the typography source of truth).
      editor.patchAllSlides((s) => {
        const main = mainTextOf(s.objects);
        return main ? { ...s, objects: s.objects.map((o) => (o.id === main.id ? { ...o, color: textColor } : o)) } : s;
      });
      toast.success("Colourway generated from your logo");
    } catch {
      toast.error("Couldn't generate a colourway");
    } finally {
      setPaletteBusy(false);
    }
  }

  const transition = (cfg.transition && typeof cfg.transition === "object" ? cfg.transition : {}) as { name?: string; effectId?: string; durationMs?: number };
  const transitionName = transition.name ?? transition.effectId ?? "Fade";
  const transitionMs = typeof transition.durationMs === "number" ? transition.durationMs : get<number>(cfg, "transitionDurationMs", 300);
  // Only written when the operator touches the controls. Saves a REAL effect id
  // (PR 1 saved the display name as effectId; normalizeThemeTransition repairs
  // those on read). "Cut" keeps effectId "cut" + name "Cut" → a hard cut.
  const setTransition = (name: string, durationMs: number) =>
    setCfg({ transition: { effectId: TRANSITION_NAME_TO_EFFECT_ID[name] ?? "cut", name, durationMs, easing: "ease-in-out" }, transitionDurationMs: durationMs });

  return (
    <div className="p-3 space-y-3">
      {cur && (
        <Section title="This slide">
          <Field label="Slide name">{(id) => (
            <input id={id} value={curMeta?.name ?? ""} maxLength={60} placeholder={`Slide ${editor.currentIndex + 1}`}
              onChange={(e) => setMeta(cur.id, { name: e.target.value })} className={inCls} />
          )}</Field>
          <Group label="Used for">
            <Seg on={curMeta?.role === "lyrics"} label="Lyrics / text" onClick={() => setMeta(cur.id, { role: "lyrics" })} />
            <Seg on={curMeta?.role === "scripture"} label="Scripture" onClick={() => setMeta(cur.id, { role: "scripture" })} />
          </Group>
        </Section>
      )}

      <Section title={isScripture ? "Typography — verse box" : "Typography — lyrics box"}>
        {!target ? (
          <p className="text-[11px] text-[var(--color-muted-foreground)] leading-snug">
            {isScripture
              ? "Add a text box and set “This text box shows” to Verse in the Design tab."
              : "Add a text box and set “This text box shows” to Lyrics in the Design tab."}
          </p>
        ) : (
          <>
            <Field label="Font">{(id) => (
              <select id={id} value={target.fontFamily ?? "Inter"} onChange={(e) => updTarget({ fontFamily: e.target.value })} className={inCls}>
                <FontOptions current={target.fontFamily ?? "Inter"} />
              </select>
            )}</Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Weight">{(id) => (
                <select id={id} value={String(target.fontWeight ?? 600)} onChange={(e) => updTarget({ fontWeight: Number(e.target.value) })} className={inCls}>
                  <WeightOptions font={target.fontFamily ?? "Inter"} current={target.fontWeight ?? 600} />
                </select>
              )}</Field>
              <Field label="Colour">{(id) => (
                <input id={id} type="color" value={target.color ?? "#ffffff"} onChange={(e) => updTarget({ color: e.target.value })} className={colorCls} style={segOff} />
              )}</Field>
            </div>
            <Group label="Align">
              {(["left", "center", "right"] as const).map((a) => (
                <Seg key={a} on={(target.align ?? "center") === a} label={a} onClick={() => updTarget({ align: a })} />
              ))}
            </Group>
            <Group label="Text shadow">
              <Seg on={target.shadow === true} label="On" onClick={() => updTarget({ shadow: true })} />
              <Seg on={target.shadow === false} label="Off" onClick={() => updTarget({ shadow: false })} />
            </Group>
            <Field label={isScripture ? "Scripture size (px)" : "Lyrics size (px)"}>{(id) => (
              <SizeInput id={id} value={target.fontSize ?? (isScripture ? 56 : 72)} onCommit={(n) => updTarget({ fontSize: n })} />
            )}</Field>
          </>
        )}
      </Section>

      <Section title="Background">
        <Group label="Background type" className="grid grid-cols-4 gap-1">
          {(["solid", "gradient", "image", "video"] as const).map((t) => (
            <Seg key={t} on={bgType === t} label={t} onClick={() => setCfg({ bgType: t })} />
          ))}
        </Group>
        <div className="grid grid-cols-2 gap-2">
          <Field label={bgType === "gradient" ? "Colour 1" : "Colour"}>{(id) => (
            <input id={id} type="color" value={get(cfg, "bgColor", "#0b0b0b") as string} onChange={(e) => setCfg({ bgColor: e.target.value })} className={colorCls} style={segOff} />
          )}</Field>
          {bgType === "gradient" && (
            <Field label="Colour 2">{(id) => (
              <input id={id} type="color" value={get(cfg, "bgColor2", "#1a0a14") as string} onChange={(e) => setCfg({ bgColor2: e.target.value })} className={colorCls} style={segOff} />
            )}</Field>
          )}
        </div>
        {bgType === "gradient" && (
          <Field label={`Angle — ${get<number>(cfg, "bgAngle", 135)}°`}>{(id) => (
            <input id={id} type="range" min={0} max={360} value={get<number>(cfg, "bgAngle", 135)} onChange={(e) => setCfg({ bgAngle: Number(e.target.value) })} className="w-full" style={rangeStyle} />
          )}</Field>
        )}
        {bgType === "image" && (
          <BgAssetPicker kind="image" url={get(cfg, "bgImageUrl", "") as string}
            onUrl={(url) => setCfg(url ? { bgImageUrl: url } : { bgImageUrl: "", bgType: "solid" })} />
        )}
        {bgType === "video" && (
          <BgAssetPicker kind="video" url={get(cfg, "bgVideoUrl", "") as string}
            onUrl={(url) => setCfg(url ? { bgVideoUrl: url } : { bgVideoUrl: "", bgType: "solid" })} />
        )}
        <Field label={`Dim — ${Math.round(get<number>(cfg, "dim", 0) * 100)}%`}>{(id) => (
          <input id={id} type="range" min={0} max={100} value={get<number>(cfg, "dim", 0) * 100} onChange={(e) => setCfg({ dim: Number(e.target.value) / 100 })} className="w-full" style={rangeStyle} />
        )}</Field>
        {(bgType === "solid" || bgType === "gradient") && (
          <Group label="Animation" className="grid grid-cols-4 gap-1">
            {(["none", "drift", "aurora", "pulse"] as const).map((m) => (
              <Seg key={m} on={get(cfg, "bgAnimation", "none") === m} label={m} onClick={() => setCfg({ bgAnimation: m })} />
            ))}
          </Group>
        )}
      </Section>

      <Section title="Logo">
        <BgAssetPicker kind="image" url={get(cfg, "logoUrl", "") as string} maxMBOverride={5}
          label="Logo image" hint="A transparent PNG works best. Shown on every slide with this theme."
          onUrl={(url) => setCfg({ logoUrl: url, ...(url && get(cfg, "logoPosition", "none") === "none" ? { logoPosition: "bottom-right" } : {}) })} />
        <div>
          <span className={rowCls}>Position</span>
          <div role="group" aria-label="Logo position" className="grid w-32 grid-cols-3 gap-1">
            {LOGO_GRID.map((p) => {
              const on = get(cfg, "logoPosition", "none") === p;
              return (
                <button key={p} type="button" aria-label={`Logo ${p.replace("-", " ")}`} aria-pressed={on} title={p} onClick={() => setCfg({ logoPosition: p })}
                  className="h-8 rounded-md border" style={on ? { ...segOn, background: "var(--color-brand)" } : segOff} />
              );
            })}
          </div>
          <button type="button" aria-pressed={get(cfg, "logoPosition", "none") === "none"} onClick={() => setCfg({ logoPosition: "none" })} className="mt-1.5 h-7 px-3 rounded-md border text-[10px] font-semibold"
            style={get(cfg, "logoPosition", "none") === "none" ? segOn : segOff}>None</button>
        </div>
        <Field label={`Size — ${get<number>(cfg, "logoSizePx", 48)}px`}>{(id) => (
          <input id={id} type="range" min={24} max={400} value={get<number>(cfg, "logoSizePx", 48)} onChange={(e) => setCfg({ logoSizePx: Number(e.target.value) })} className="w-full" style={rangeStyle} />
        )}</Field>
        <Field label={`Opacity — ${Math.round(get<number>(cfg, "logoOpacity", 1) * 100)}%`}>{(id) => (
          <input id={id} type="range" min={0} max={100} value={get<number>(cfg, "logoOpacity", 1) * 100} onChange={(e) => setCfg({ logoOpacity: Number(e.target.value) / 100 })} className="w-full" style={rangeStyle} />
        )}</Field>
        <button type="button" onClick={autoColorway} disabled={paletteBusy || !get(cfg, "logoUrl", "")}
          className="w-full h-8 rounded-lg border text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[var(--color-brand)]/10 disabled:opacity-40" style={segOff}>
          <Sparkles className="w-3.5 h-3.5 text-[var(--color-brand)]" /> {paletteBusy ? "Reading logo…" : "Auto-colourway from logo"}
        </button>
      </Section>

      <Section title="Scripture">
        {savedScripture && (
          <div role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-snug text-[var(--color-foreground)]">
            This computer has a saved Scripture Style, which overrides this theme&apos;s scripture boxes.
            <button type="button" onClick={() => void resetSavedScripture()} className="mt-1.5 block h-7 px-3 rounded-md border text-[10px] font-semibold" style={segOff}>
              Clear saved Scripture Style
            </button>
          </div>
        )}
        <Group label="Show reference">
          <Seg on={get<boolean>(cfg, "scriptureShowReference", true) === true} label="On" onClick={() => setCfg({ scriptureShowReference: true })} />
          <Seg on={get<boolean>(cfg, "scriptureShowReference", true) === false} label="Off" onClick={() => setCfg({ scriptureShowReference: false })} />
        </Group>
        <Group label="Reference position">
          {(["above", "below", "inline"] as const).map((p) => (
            <Seg key={p} on={get(cfg, "scriptureReferencePosition", "above") === p} label={p} onClick={() => setCfg({ scriptureReferencePosition: p })} />
          ))}
        </Group>
        <Group label="Show translation">
          <Seg on={get<boolean>(cfg, "scriptureTranslationVisible", true) === true} label="On" onClick={() => setCfg({ scriptureTranslationVisible: true })} />
          <Seg on={get<boolean>(cfg, "scriptureTranslationVisible", true) === false} label="Off" onClick={() => setCfg({ scriptureTranslationVisible: false })} />
        </Group>
        <p className="text-[10px] text-[var(--color-muted-foreground)] leading-snug">
          To place the verse and reference, select a text box and set <b className="text-[var(--color-foreground)]">This text box shows</b> in the Design tab.
        </p>
      </Section>

      <Section title="Transition">
        <Field label="Effect">{(id) => (
          <select id={id} value={transitionName} onChange={(e) => setTransition(e.target.value, transitionMs)} className={inCls}>
            {TRANSITIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}</Field>
        <Field label={`Duration — ${transitionMs}ms`}>{(id) => (
          <input id={id} type="range" min={0} max={2000} step={50} value={transitionMs} onChange={(e) => setTransition(transitionName, Number(e.target.value))} className="w-full" style={rangeStyle} />
        )}</Field>
      </Section>

      {confirmDialog}
      <Section title="Default">
        {isDefault ? (
          <p className="text-[11px] text-[var(--color-muted-foreground)]">This is your default theme.</p>
        ) : (
          <div className="flex gap-1">
            <Seg on={makeDefault} label="Set as default on save" onClick={() => setMakeDefault(!makeDefault)} />
          </div>
        )}
      </Section>
    </div>
  );
}
