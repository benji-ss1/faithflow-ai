"use client";
import { Check, RotateCcw } from "lucide-react";
import { useBackgroundState } from "../hooks/useBackgroundState";
import { listBackgrounds, readSettings, writeSettings, resetSettings } from "../store/backgroundStore";
import { ShaderBackground } from "./ShaderBackground";

/**
 * Backgrounds section (Phase 6) — a NEW section that plugs into the existing
 * Themes area (does NOT modify the theme system). Pick a template (live animated
 * thumbnails), then tune it: speed, intensity, colours, and a readability overlay.
 * Applies to the live projector instantly. Uploads (image/video) come next.
 */
export function BackgroundSelector() {
  const { active, setActive } = useBackgroundState();
  const items = listBackgrounds();
  const isShader = active.type === "shader";
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
            <button
              key={bg.id}
              onClick={() => setActive(bg.id)}
              className="relative rounded-md overflow-hidden border transition-all text-left"
              style={{
                borderColor: isActive ? "var(--color-brand)" : "var(--color-border)",
                boxShadow: isActive ? "0 0 0 1px var(--color-brand)" : "none",
              }}
              title={bg.name}
            >
              <div className="relative aspect-video w-full overflow-hidden">
                {bg.type === "none" ? (
                  <div className="absolute inset-0" style={{ background: "repeating-conic-gradient(var(--color-elevated) 0% 25%, transparent 0% 50%) 0 / 12px 12px" }} />
                ) : bg.type === "shader" ? (
                  // Live animated thumbnail — the wow factor. Small canvas; DPR
                  // capped inside ShaderBackground so 6 at once stay cheap.
                  <ShaderBackground
                    preset={bg.shaderPreset || "cleanSlate"}
                    speed={bg.shaderSpeed ?? 1}
                    intensity={bg.shaderIntensity ?? 1}
                    primaryColor={bg.shaderPrimaryColor || "#0A0A0E"}
                    secondaryColor={bg.shaderSecondaryColor || "#0F0F14"}
                  />
                ) : null}
              </div>
              {isActive && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full inline-flex items-center justify-center" style={{ background: "var(--color-brand)", color: "var(--color-primary-foreground)" }}>
                  <Check className="w-2.5 h-2.5" />
                </span>
              )}
              <div className="px-1.5 py-1 text-[10px] font-semibold text-[var(--color-foreground)] truncate">{bg.name}</div>
            </button>
          );
        })}
      </div>

      {/* Settings — only when a customisable (shader) template is active. */}
      {isShader && active.id !== "cleanSlate" && (
        <div className="flex flex-col gap-2.5 pt-2 mt-0.5 border-t" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">{active.name} settings</div>
            <button onClick={() => resetSettings(active.id)} className="inline-flex items-center gap-1 text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]" title="Reset to default">
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>

          <Slider label="Speed" min={0.2} max={2} step={0.1} value={s.shaderSpeed ?? active.shaderSpeed ?? 1} onChange={(v) => set({ shaderSpeed: v })} suffix="×" />
          <Slider label="Intensity" min={0.5} max={1.5} step={0.05} value={s.shaderIntensity ?? active.shaderIntensity ?? 1} onChange={(v) => set({ shaderIntensity: v })} suffix="×" />

          <div className="flex items-center gap-4">
            <ColorField label="Primary" value={s.shaderPrimaryColor ?? active.shaderPrimaryColor ?? "#0A0A0E"} onChange={(v) => set({ shaderPrimaryColor: v })} />
            <ColorField label="Secondary" value={s.shaderSecondaryColor ?? active.shaderSecondaryColor ?? "#0F0F14"} onChange={(v) => set({ shaderSecondaryColor: v })} />
          </div>

          <div className="flex items-center gap-4">
            <ColorField label="Overlay" value={s.overlayColor ?? "#000000"} onChange={(v) => set({ overlayColor: v })} />
            <div className="flex-1">
              <Slider label="Overlay dim" min={0} max={0.8} step={0.05} value={s.overlayOpacity ?? 0} onChange={(v) => set({ overlayOpacity: v })} suffix="" />
            </div>
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
