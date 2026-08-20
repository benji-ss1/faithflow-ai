"use client";
import { Check, RotateCcw, Trash2 } from "lucide-react";
import { useBackgroundState } from "../hooks/useBackgroundState";
import { listBackgrounds, readSettings, writeSettings, resetSettings, removeCustomBackground } from "../store/backgroundStore";
import { ShaderBackground } from "./ShaderBackground";
import { BackgroundUploader } from "./BackgroundUploader";

/**
 * Backgrounds section (Phases 1–6 + uploads) — plugs into the Themes area
 * (does NOT modify the theme system). Pick a built-in template (live animated
 * thumbnails) or upload your own image/video; then tune speed/intensity/colours/
 * blur/overlay. Applies to the live projector instantly.
 */
export function BackgroundSelector() {
  const { active, setActive } = useBackgroundState();
  const items = listBackgrounds();
  const s = readSettings(active.id);
  const set = (patch: Parameters<typeof writeSettings>[1]) => writeSettings(active.id, patch);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">Backgrounds</div>
        <div className="text-[10px] text-[var(--color-muted-foreground)]">Behind the text · live on the projector</div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {items.map((bg) => {
          const isActive = active.id === bg.id;
          return (
            <div key={bg.id} className="relative group/bg">
              <button
                onClick={() => setActive(bg.id)}
                className="w-full relative rounded-md overflow-hidden border transition-all text-left"
                style={{ borderColor: isActive ? "var(--color-brand)" : "var(--color-border)", boxShadow: isActive ? "0 0 0 1px var(--color-brand)" : "none" }}
                title={bg.name}
              >
                <div className="relative aspect-video w-full overflow-hidden bg-black">
                  {bg.type === "none" ? (
                    <div className="absolute inset-0" style={{ background: "repeating-conic-gradient(var(--color-elevated) 0% 25%, transparent 0% 50%) 0 / 12px 12px" }} />
                  ) : bg.type === "shader" ? (
                    <ShaderBackground preset={bg.shaderPreset || "cleanSlate"} speed={bg.shaderSpeed ?? 1} intensity={bg.shaderIntensity ?? 1} primaryColor={bg.shaderPrimaryColor || "#0A0A0E"} secondaryColor={bg.shaderSecondaryColor || "#0F0F14"} />
                  ) : bg.type === "image" && bg.imageUrl ? (
                    <img src={bg.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  ) : bg.type === "video" && bg.videoUrl ? (
                    <video src={bg.videoUrl} muted loop playsInline className="absolute inset-0 w-full h-full object-cover" />
                  ) : null}
                </div>
                {isActive && (
                  <span className="absolute top-1 right-1 w-4 h-4 rounded-full inline-flex items-center justify-center" style={{ background: "var(--color-brand)", color: "var(--color-primary-foreground)" }}>
                    <Check className="w-2.5 h-2.5" />
                  </span>
                )}
                <div className="px-1.5 py-1 text-[10px] font-semibold text-[var(--color-foreground)] truncate">{bg.name}</div>
              </button>
              {!bg.isBuiltIn && (
                <button
                  onClick={() => removeCustomBackground(bg.id)}
                  className="absolute top-1 left-1 w-5 h-5 rounded inline-flex items-center justify-center bg-black/60 text-white/80 opacity-0 group-hover/bg:opacity-100 hover:bg-[var(--color-destructive)] transition"
                  title="Delete background"
                  aria-label="Delete background"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <BackgroundUploader />

      {/* Per-template settings. */}
      {active.type !== "none" && active.id !== "cleanSlate" && (
        <div className="flex flex-col gap-2.5 pt-2 mt-0.5 border-t" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">{active.name} settings</div>
            <button onClick={() => resetSettings(active.id)} className="inline-flex items-center gap-1 text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]" title="Reset to default">
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>

          {active.type === "shader" && (
            <>
              <Slider label="Speed" min={0.2} max={2} step={0.1} value={s.shaderSpeed ?? active.shaderSpeed ?? 1} onChange={(v) => set({ shaderSpeed: v })} suffix="×" />
              <Slider label="Intensity" min={0.5} max={1.5} step={0.05} value={s.shaderIntensity ?? active.shaderIntensity ?? 1} onChange={(v) => set({ shaderIntensity: v })} suffix="×" />
              <div className="flex items-center gap-4">
                <ColorField label="Primary" value={s.shaderPrimaryColor ?? active.shaderPrimaryColor ?? "#0A0A0E"} onChange={(v) => set({ shaderPrimaryColor: v })} />
                <ColorField label="Secondary" value={s.shaderSecondaryColor ?? active.shaderSecondaryColor ?? "#0F0F14"} onChange={(v) => set({ shaderSecondaryColor: v })} />
              </div>
            </>
          )}

          {active.type === "image" && (
            <>
              <Slider label="Blur" min={0} max={20} step={1} value={s.imageBlur ?? active.imageBlur ?? 0} onChange={(v) => set({ imageBlur: v })} suffix="px" />
              <Segmented label="Fit" value={s.imageFit ?? active.imageFit ?? "fill"} options={["fill", "fit", "stretch"]} onChange={(v) => set({ imageFit: v as "fill" | "fit" | "stretch" })} />
            </>
          )}

          {active.type === "video" && (
            <Slider label="Playback" min={0.25} max={1} step={0.05} value={s.videoPlaybackSpeed ?? active.videoPlaybackSpeed ?? 0.5} onChange={(v) => set({ videoPlaybackSpeed: v })} suffix="×" />
          )}

          {/* Readability overlay — for every type. */}
          <div className="flex items-center gap-4">
            <ColorField label="Overlay" value={s.overlayColor ?? "#000000"} onChange={(v) => set({ overlayColor: v })} />
            <div className="flex-1"><Slider label="Overlay dim" min={0} max={0.8} step={0.05} value={s.overlayOpacity ?? 0} onChange={(v) => set({ overlayOpacity: v })} suffix="" /></div>
          </div>
          <div className="text-[10px] text-[var(--color-muted-foreground)]">Overlay dim darkens the background so text stays readable.</div>
        </div>
      )}
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange, suffix }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-[11px] text-[var(--color-muted-foreground)]">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-[var(--color-brand)]" />
      <span className="w-10 text-right text-[10px] font-mono text-[var(--color-muted-foreground)]">{value.toFixed(2)}{suffix}</span>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <span className="text-[11px] text-[var(--color-muted-foreground)]">{label}</span>
      <span className="w-5 h-5 rounded border border-[var(--color-border)]" style={{ background: value }} />
      <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="w-0 h-0 opacity-0 absolute" aria-label={label} />
    </label>
  );
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-[11px] text-[var(--color-muted-foreground)]">{label}</span>
      <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden">
        {options.map((o) => (
          <button key={o} onClick={() => onChange(o)} className="h-6 px-2 text-[10px] font-medium capitalize"
            style={value === o ? { background: "var(--color-brand)", color: "var(--color-primary-foreground)" } : { color: "var(--color-muted-foreground)" }}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
