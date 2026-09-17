"use client";
// Theme Editor (PR 1) — the "Theme" drawer tab shown ONLY when the slide editor
// is editing a theme (never for songs). Every control writes a real theme config
// key (see ThemeConfig in src/lib/actions.ts). Typography + background changes
// are mirrored onto the theme's slides so the canvas previews them.
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import type { UseSlideEditorReturn } from "../editor/useSlideEditor";
import type { SlideObject, TextObject } from "@/lib/slide-objects";
import { BgAssetPicker } from "@/components/library/BgAssetPicker";
import { TRANSITIONS } from "./BottomBar/TransitionChooser";
import { extractLogoPalette } from "@/lib/actions";
import { buildColorwayFromPalette } from "@/lib/colorway";
import { mainTextOf, type ThemeSlideMeta } from "@/lib/theme-editor-model";
import { cn } from "@/lib/utils";

type Cfg = Record<string, unknown>;

const FONT_CHOICES = ["Inter", "Sora", "Plus Jakarta Sans", "Playfair Display", "Cormorant Garamond", "Fraunces", "Spectral", "Montserrat", "DM Serif Display", "Georgia", "Helvetica", "Arial", "Times New Roman"];
const LOGO_GRID = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
];
const rowCls = "eyebrow block mb-1";
const inCls = "w-full h-8 px-2 rounded-lg border border-[var(--color-border)] text-[12px] text-[var(--color-foreground)] bg-[var(--color-muted)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)] outline-none transition-colors duration-200 focus:border-[var(--color-brand)]";
const segOn = { borderColor: "var(--color-brand)", background: "color-mix(in oklab, var(--color-brand) 16%, transparent)", color: "var(--color-brand-hi)" };
const segOff: React.CSSProperties = { borderColor: "var(--color-border)" };

function get<T>(cfg: Cfg, key: string, fallback: T): T {
  const v = cfg[key];
  return (v === undefined || v === null ? fallback : v) as T;
}

function Seg({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
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

export function ThemeEditorTab({ editor, cfg, setCfg, meta, setMeta, makeDefault, setMakeDefault, isDefault }: {
  editor: UseSlideEditorReturn;
  cfg: Cfg;
  setCfg: (patch: Cfg) => void;
  meta: Record<string, ThemeSlideMeta>;
  setMeta: (id: string, patch: Partial<ThemeSlideMeta>) => void;
  makeDefault: boolean;
  setMakeDefault: (v: boolean) => void;
  isDefault: boolean;
}) {
  const [paletteBusy, setPaletteBusy] = useState(false);
  const cur = editor.currentSlide;
  const curMeta = cur ? meta[cur.id] : undefined;
  const bgType = get<string>(cfg, "bgType", "solid");

  // Push a style patch onto the matching text boxes of every theme slide.
  const patchTexts = (pick: (o: TextObject, objects: SlideObject[]) => boolean, patch: Partial<TextObject>) => {
    editor.patchAllSlides((s) => ({
      ...s,
      objects: s.objects.map((o) => (o.kind === "text" && pick(o, s.objects) ? ({ ...o, ...patch } as SlideObject) : o)),
    }));
  };
  const isMain = (o: TextObject, objects: SlideObject[]) => mainTextOf(objects)?.id === o.id;
  const textDefault = (key: string, value: unknown, patch: Partial<TextObject>, pick: (o: TextObject, objects: SlideObject[]) => boolean = isMain) => {
    setCfg({ [key]: value });
    patchTexts(pick, patch);
  };
  // Mirror the theme background onto the slides so the canvas previews it.
  const mirrorBg = (next: { bgType: string; bgColor?: string; bgImageUrl?: string }) => {
    editor.patchAllSlides((s) => ({
      ...s,
      bgColor: next.bgColor ?? s.bgColor,
      bgImageUrl: next.bgType === "image" ? (next.bgImageUrl ?? "") : "",
    }));
  };
  const setBg = (patch: Cfg) => {
    const merged = { ...cfg, ...patch };
    setCfg(patch);
    mirrorBg({ bgType: String(merged.bgType ?? "solid"), bgColor: merged.bgColor as string | undefined, bgImageUrl: merged.bgImageUrl as string | undefined });
  };

  async function autoColorway() {
    const logo = get(cfg, "logoUrl", "") as string;
    if (!logo) { toast.error("Add a logo image first"); return; }
    setPaletteBusy(true);
    try {
      const res = await extractLogoPalette(logo);
      if (!res.ok || !res.data) { toast.error((!res.ok && res.error) || "Couldn't read the logo"); return; }
      const cw = buildColorwayFromPalette(res.data.colors);
      if (!cw) { toast.error("No usable colours found in the logo"); return; }
      setBg(cw);
      patchTexts(isMain, { color: cw.textColor });
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
  const setTransition = (name: string, durationMs: number) =>
    setCfg({ transition: { effectId: name, name, durationMs, easing: "ease-in-out" }, transitionDurationMs: durationMs });

  return (
    <div className="p-3 space-y-3">
      {cur && (
        <Section title="This slide">
          <div><span className={rowCls}>Slide name</span>
            <input value={curMeta?.name ?? ""} maxLength={60} placeholder={`Slide ${editor.currentIndex + 1}`}
              onChange={(e) => setMeta(cur.id, { name: e.target.value })} className={inCls} /></div>
          <div><span className={rowCls}>Used for</span><div className="flex gap-1">
            <Seg on={curMeta?.role === "lyrics"} label="Lyrics / text" onClick={() => setMeta(cur.id, { role: "lyrics" })} />
            <Seg on={curMeta?.role === "scripture"} label="Scripture" onClick={() => setMeta(cur.id, { role: "scripture" })} />
          </div></div>
        </Section>
      )}

      <Section title="Typography">
        <div><span className={rowCls}>Font</span>
          <select value={get(cfg, "fontFamily", "Inter") as string} onChange={(e) => textDefault("fontFamily", e.target.value, { fontFamily: e.target.value })} className={inCls}>
            {FONT_CHOICES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select></div>
        <div className="grid grid-cols-2 gap-2">
          <div><span className={rowCls}>Weight</span>
            <select value={String(get(cfg, "fontWeight", 600))} onChange={(e) => textDefault("fontWeight", Number(e.target.value), { fontWeight: Number(e.target.value) })} className={inCls}>
              {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
            </select></div>
          <div><span className={rowCls}>Colour</span>
            <input type="color" value={get(cfg, "textColor", "#ffffff") as string} onChange={(e) => textDefault("textColor", e.target.value, { color: e.target.value })} className="h-8 w-full rounded-md border cursor-pointer bg-transparent" style={segOff} /></div>
        </div>
        <div><span className={rowCls}>Align</span><div className="flex gap-1">
          {(["left", "center", "right"] as const).map((a) => (
            <Seg key={a} on={get(cfg, "align", "center") === a} label={a} onClick={() => textDefault("align", a, { align: a })} />
          ))}
        </div></div>
        <div><span className={rowCls}>Text shadow</span><div className="flex gap-1">
          <Seg on={get<boolean>(cfg, "textShadow", false) === true} label="On" onClick={() => textDefault("textShadow", true, { shadow: true })} />
          <Seg on={get<boolean>(cfg, "textShadow", false) === false} label="Off" onClick={() => textDefault("textShadow", false, { shadow: false })} />
        </div></div>
        <div className="grid grid-cols-2 gap-2">
          <div><span className={rowCls}>Lyrics size (px)</span>
            <input type="number" min={12} max={400} value={get(cfg, "fontSizePx", 72) as number} onChange={(e) => textDefault("fontSizePx", Number(e.target.value), { fontSize: Number(e.target.value) })} className={inCls} /></div>
          <div><span className={rowCls}>Scripture size (px)</span>
            <input type="number" min={12} max={400} value={get(cfg, "fontSizeScripturePx", 56) as number} onChange={(e) => textDefault("fontSizeScripturePx", Number(e.target.value), { fontSize: Number(e.target.value) }, (o) => o.role === "verse")} className={inCls} /></div>
        </div>
      </Section>

      <Section title="Background">
        <div className="grid grid-cols-4 gap-1">
          {(["solid", "gradient", "image", "video"] as const).map((t) => (
            <Seg key={t} on={bgType === t} label={t} onClick={() => setBg({ bgType: t })} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><span className={rowCls}>{bgType === "gradient" ? "Colour 1" : "Colour"}</span>
            <input type="color" value={get(cfg, "bgColor", "#0b0b0b") as string} onChange={(e) => setBg({ bgColor: e.target.value })} className="h-8 w-full rounded-md border cursor-pointer bg-transparent" style={segOff} /></div>
          {bgType === "gradient" && (
            <div><span className={rowCls}>Colour 2</span>
              <input type="color" value={get(cfg, "bgColor2", "#1a0a14") as string} onChange={(e) => setCfg({ bgColor2: e.target.value })} className="h-8 w-full rounded-md border cursor-pointer bg-transparent" style={segOff} /></div>
          )}
        </div>
        {bgType === "gradient" && (
          <div><span className={rowCls}>Angle — {get<number>(cfg, "bgAngle", 135)}°</span>
            <input type="range" min={0} max={360} value={get<number>(cfg, "bgAngle", 135)} onChange={(e) => setCfg({ bgAngle: Number(e.target.value) })} className="w-full" style={{ accentColor: "var(--color-brand)" }} /></div>
        )}
        {bgType === "image" && (
          <BgAssetPicker kind="image" url={get(cfg, "bgImageUrl", "") as string}
            onUrl={(url) => setBg(url ? { bgImageUrl: url } : { bgImageUrl: "", bgType: "solid" })} />
        )}
        {bgType === "video" && (
          <BgAssetPicker kind="video" url={get(cfg, "bgVideoUrl", "") as string}
            onUrl={(url) => setBg(url ? { bgVideoUrl: url } : { bgVideoUrl: "", bgType: "solid" })} />
        )}
        <div><span className={rowCls}>Dim — {Math.round(get<number>(cfg, "dim", 0) * 100)}%</span>
          <input type="range" min={0} max={100} value={get<number>(cfg, "dim", 0) * 100} onChange={(e) => setCfg({ dim: Number(e.target.value) / 100 })} className="w-full" style={{ accentColor: "var(--color-brand)" }} /></div>
        {(bgType === "solid" || bgType === "gradient") && (
          <div><span className={rowCls}>Animation</span><div className="grid grid-cols-4 gap-1">
            {(["none", "drift", "aurora", "pulse"] as const).map((m) => (
              <Seg key={m} on={get(cfg, "bgAnimation", "none") === m} label={m} onClick={() => setCfg({ bgAnimation: m })} />
            ))}
          </div></div>
        )}
      </Section>

      <Section title="Logo">
        <BgAssetPicker kind="image" url={get(cfg, "logoUrl", "") as string} maxMBOverride={5}
          label="Logo image" hint="A transparent PNG works best. Shown on every slide with this theme."
          onUrl={(url) => setCfg({ logoUrl: url, ...(url && get(cfg, "logoPosition", "none") === "none" ? { logoPosition: "bottom-right" } : {}) })} />
        <div><span className={rowCls}>Position</span>
          <div className="grid w-32 grid-cols-3 gap-1">
            {LOGO_GRID.map((p) => (
              <button key={p} type="button" aria-label={p} title={p} onClick={() => setCfg({ logoPosition: p })}
                className="h-8 rounded-md border" style={get(cfg, "logoPosition", "none") === p ? { ...segOn, background: "var(--color-brand)" } : segOff} />
            ))}
          </div>
          <button type="button" onClick={() => setCfg({ logoPosition: "none" })} className="mt-1.5 h-7 px-3 rounded-md border text-[10px] font-semibold"
            style={get(cfg, "logoPosition", "none") === "none" ? segOn : segOff}>None</button>
        </div>
        <div><span className={rowCls}>Size — {get<number>(cfg, "logoSizePx", 48)}px</span>
          <input type="range" min={24} max={400} value={get<number>(cfg, "logoSizePx", 48)} onChange={(e) => setCfg({ logoSizePx: Number(e.target.value) })} className="w-full" style={{ accentColor: "var(--color-brand)" }} /></div>
        <div><span className={rowCls}>Opacity — {Math.round(get<number>(cfg, "logoOpacity", 1) * 100)}%</span>
          <input type="range" min={0} max={100} value={get<number>(cfg, "logoOpacity", 1) * 100} onChange={(e) => setCfg({ logoOpacity: Number(e.target.value) / 100 })} className="w-full" style={{ accentColor: "var(--color-brand)" }} /></div>
        <button type="button" onClick={autoColorway} disabled={paletteBusy || !get(cfg, "logoUrl", "")}
          className="w-full h-8 rounded-lg border text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[var(--color-brand)]/10 disabled:opacity-40" style={segOff}>
          <Sparkles className="w-3.5 h-3.5 text-[var(--color-brand)]" /> {paletteBusy ? "Reading logo…" : "Auto-colourway from logo"}
        </button>
      </Section>

      <Section title="Scripture">
        <div><span className={rowCls}>Show reference</span><div className="flex gap-1">
          <Seg on={get<boolean>(cfg, "scriptureShowReference", true) === true} label="On" onClick={() => setCfg({ scriptureShowReference: true })} />
          <Seg on={get<boolean>(cfg, "scriptureShowReference", true) === false} label="Off" onClick={() => setCfg({ scriptureShowReference: false })} />
        </div></div>
        <div><span className={rowCls}>Reference position</span><div className="flex gap-1">
          {(["above", "below", "inline"] as const).map((p) => (
            <Seg key={p} on={get(cfg, "scriptureReferencePosition", "above") === p} label={p} onClick={() => setCfg({ scriptureReferencePosition: p })} />
          ))}
        </div></div>
        <div><span className={rowCls}>Show translation</span><div className="flex gap-1">
          <Seg on={get<boolean>(cfg, "scriptureTranslationVisible", true) === true} label="On" onClick={() => setCfg({ scriptureTranslationVisible: true })} />
          <Seg on={get<boolean>(cfg, "scriptureTranslationVisible", true) === false} label="Off" onClick={() => setCfg({ scriptureTranslationVisible: false })} />
        </div></div>
        <p className="text-[10px] text-[var(--color-muted-foreground)] leading-snug">
          To place the verse and reference, select a text box and set its <b className="text-[var(--color-foreground)]">Theme role</b> in the Design tab.
        </p>
      </Section>

      <Section title="Transition">
        <div><span className={rowCls}>Effect</span>
          <select value={transitionName} onChange={(e) => setTransition(e.target.value, transitionMs)} className={inCls}>
            {TRANSITIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select></div>
        <div><span className={rowCls}>Duration — {transitionMs}ms</span>
          <input type="range" min={0} max={2000} step={50} value={transitionMs} onChange={(e) => setTransition(transitionName, Number(e.target.value))} className="w-full" style={{ accentColor: "var(--color-brand)" }} /></div>
      </Section>

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
