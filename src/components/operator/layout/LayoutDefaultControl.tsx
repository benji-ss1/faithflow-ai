"use client";
// Shared "Projection Layout" control — the ONE place an operator sets how EVERY
// projected slide is laid out: Full screen, or a Lower / Upper / Mid third band
// (with height, text size, push, and band paint). It reads and writes the
// church-wide default (the same preset scripture already used, now generalized
// by applyChurchLayout in OperatorConsole so it applies to songs + verses too),
// so "set it once → it's your option going forward for everything" holds.
//
// Self-contained + token-styled so it drops into any editor (song canvas, media,
// scripture) without pulling that editor's local style system. Saving is
// immediate (debounced) and church-scoped; every value is clamped to the same
// ranges the wire validator enforces, so a bad value can never reach the
// projector.
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, PanelBottom, ArrowUpToLine, ArrowDownToLine, AlignVerticalJustifyCenter } from "lucide-react";
import { toast } from "sonner";
import {
  loadScriptureStyle,
  saveScriptureStyle,
  bandTopPct,
  type ScriptureLayout,
  type ThirdPosition,
  type BandStyle,
} from "@/components/operator/scripture/scriptureStyle";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));

export function LayoutDefaultControl({ churchId, compact }: { churchId?: string; compact?: boolean }) {
  const [layout, setLayout] = useState<ScriptureLayout>("fullscreen");
  const [band, setBand] = useState<BandStyle | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  // Load the church default once (and refresh if another surface changes it).
  useEffect(() => {
    const load = () => { const d = loadScriptureStyle(churchId); setLayout(d.layout); setBand(d.band); loaded.current = true; };
    load();
    const onChanged = () => load();
    window.addEventListener("pf-scripture-style-changed", onChanged);
    return () => window.removeEventListener("pf-scripture-style-changed", onChanged);
  }, [churchId]);

  // Flush/clear any pending debounced save on unmount.
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // Debounced persist — preserves the verse/reference styling in the saved design.
  const persist = useCallback((nextLayout: ScriptureLayout, nextBand: BandStyle | null) => {
    if (!loaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const d = loadScriptureStyle(churchId); // keep verse/reference sub-styles
      saveScriptureStyle(churchId, { ...d, layout: nextLayout, band: nextBand ?? d.band });
    }, 250);
  }, [churchId]);

  const updateLayout = (l: ScriptureLayout) => { setLayout(l); persist(l, band); };
  const updateBand = (patch: Partial<BandStyle>) => {
    setBand((b) => {
      const next = { ...(b as BandStyle), ...patch } as BandStyle;
      persist(layout, next);
      return next;
    });
  };

  if (!band) return null; // not loaded yet
  const isThird = layout === "lowerThird";
  const topPct = bandTopPct(band);

  return (
    <div className="space-y-3">
      {/* Full vs Third */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1.5">Projection layout · all slides</div>
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => updateLayout("fullscreen")}
            className={`inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold px-2 py-2 rounded-md border transition ${!isThird ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-foreground)]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:border-[var(--color-brand)]/40"}`}>
            <Maximize2 className="w-3.5 h-3.5" /> Full screen
          </button>
          <button type="button" onClick={() => updateLayout("lowerThird")}
            className={`inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold px-2 py-2 rounded-md border transition ${isThird ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-foreground)]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:border-[var(--color-brand)]/40"}`}>
            <PanelBottom className="w-3.5 h-3.5" /> Third band
          </button>
        </div>
        <p className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed mt-1.5">
          {isThird
            ? "Words sit in a band — put it in the upper, mid or lower third, over your own camera/graphics."
            : "Classic full-screen words."} This is your default for every slide — verses, songs and media.
        </p>
      </div>

      {isThird && (
        <>
          {/* Live preview of where the band lands */}
          {!compact && (
            <div className="relative w-full rounded-md border border-[var(--color-border)] overflow-hidden bg-[var(--color-muted)]/30" style={{ aspectRatio: "16 / 9" }}>
              <div className="absolute left-0 right-0 flex items-center justify-center"
                style={{ top: `${topPct}%`, height: `${band.heightPct}%`, background: band.mode === "none" ? "transparent" : band.mode === "gradient" ? `linear-gradient(${band.angle}deg, ${band.color}, ${band.color2})` : band.color, opacity: band.mode === "none" ? 1 : band.opacity }}>
                <span className="text-[9px] font-semibold text-white/90 drop-shadow" style={{ fontSize: `${Math.round(9 * band.fontScale)}px` }}>Your words here</span>
              </div>
            </div>
          )}

          {/* Position */}
          <div>
            <div className="text-[10px] text-[var(--color-muted-foreground)] mb-1">Third</div>
            <div className="grid grid-cols-3 gap-1.5">
              {([["upper", ArrowUpToLine, "Upper"], ["mid", AlignVerticalJustifyCenter, "Mid"], ["lower", ArrowDownToLine, "Lower"]] as const).map(([p, Icon, lbl]) => (
                <button key={p} type="button" onClick={() => updateBand({ position: p as ThirdPosition })}
                  className={`inline-flex items-center justify-center gap-1 text-[11px] font-semibold px-1.5 py-1.5 rounded-md border transition ${band.position === p ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-foreground)]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:border-[var(--color-brand)]/40"}`}>
                  <Icon className="w-3.5 h-3.5" /> {lbl}
                </button>
              ))}
            </div>
          </div>

          <Slider label="Push" min={-25} max={25} step={1} value={band.offsetY} onChange={(v) => updateBand({ offsetY: clamp(v, -25, 25) })} format={(v) => (v === 0 ? "0" : v > 0 ? `down ${v}` : `up ${-v}`)} />
          <Slider label="Text size" min={0.6} max={2} step={0.05} value={band.fontScale} onChange={(v) => updateBand({ fontScale: clamp(v, 0.6, 2) })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Height" min={16} max={48} step={1} value={band.heightPct} onChange={(v) => updateBand({ heightPct: clamp(v, 16, 48) })} format={(v) => `${v}%`} />

          {/* Band paint */}
          <div>
            <div className="text-[10px] text-[var(--color-muted-foreground)] mb-1">Band</div>
            <div className="grid grid-cols-3 gap-1.5">
              {(["none", "solid", "gradient"] as const).map((m) => (
                <button key={m} type="button" onClick={() => updateBand({ mode: m })}
                  className={`text-[11px] font-semibold px-1.5 py-1.5 rounded-md border capitalize transition ${band.mode === m ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-foreground)]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:border-[var(--color-brand)]/40"}`}>
                  {m}
                </button>
              ))}
            </div>
            {band.mode !== "none" && (
              <div className="mt-1.5 space-y-1.5">
                <ColorRow label={band.mode === "gradient" ? "From" : "Colour"} value={band.color} onChange={(v) => updateBand({ color: v })} />
                {band.mode === "gradient" && <ColorRow label="To" value={band.color2} onChange={(v) => updateBand({ color2: v })} />}
                <Slider label="Opacity" min={0} max={1} step={0.02} value={band.opacity} onChange={(v) => updateBand({ opacity: clamp(v, 0, 1) })} format={(v) => `${Math.round(v * 100)}%`} />
              </div>
            )}
            <p className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed mt-1">
              {band.mode === "none" ? "No band — words float with a shadow so they read over any feed." : "A scrim behind the words. Black at ~70% is safest over anything."}
            </p>
          </div>
        </>
      )}
      <p className="text-[10px] text-emerald-500/90 leading-relaxed">Saved automatically — applies to every slide going forward.</p>
      <button
        type="button"
        onClick={() => { try { window.dispatchEvent(new CustomEvent("presentflow:reapply-layout-live")); toast.success("Applied to the slide on screen"); } catch { /* ignore */ } }}
        className="w-full text-[11px] font-semibold px-2 py-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:border-[var(--color-brand)]/40"
      >
        Apply to the slide on screen now
      </button>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange, format }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[var(--color-muted-foreground)] w-14 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-[var(--color-brand)]" />
      <span className="text-[10px] font-mono text-[var(--color-muted-foreground)] w-12 text-right">{format(value)}</span>
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[var(--color-muted-foreground)] w-14 shrink-0">{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-full rounded-md border border-[var(--color-border)] bg-transparent" />
    </div>
  );
}
