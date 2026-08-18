"use client";
import { useEffect, useState } from "react";
import { useProjectionZoneStore } from "@/lib/projection-zone-store";
import { normalizeZone, DEFAULT_ZONE, type ProjectionZone } from "@/lib/projection-zone";

// The Projection Zone's bottom control strip — Size / Font / Margins / Screen +
// Center / Reset — factored out so it can sit UNDER the slide-editor canvas
// exactly as the user asked ("keep the simple size slide bar and resolution
// edits below, don't change anything there"). It reads/writes the SAME global
// projection-zone store as the full ZoneEditor, so tuning here moves the real
// projector output live. Geometry only — it never touches slide content.
const AMBER = "#ff7a2c";

type Display = { id: number; label: string; width: number; height: number; isPrimary: boolean };

export function ProjectionZoneControls({ className }: { className?: string }) {
  const store = useProjectionZoneStore();
  const active = store.activeProfile;
  const [displays, setDisplays] = useState<Display[]>([]);

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { screens?: { list?: () => Promise<unknown> } } }).electronAPI?.screens;
    if (!api?.list) return;
    Promise.resolve(api.list()).then((list) => {
      if (!Array.isArray(list)) return;
      setDisplays(list.map((d) => {
        const dd = d as { id: number; label?: string; size?: { width: number; height: number }; scaleFactor?: number; isPrimary?: boolean };
        const sf = dd.scaleFactor ?? 1;
        return { id: dd.id, label: dd.label ?? `Display ${dd.id}`, width: Math.round((dd.size?.width ?? 1920) * sf), height: Math.round((dd.size?.height ?? 1080) * sf), isPrimary: !!dd.isPrimary };
      }));
    }).catch(() => { /* not in Electron */ });
  }, []);

  if (!active) return null;
  const z = normalizeZone(active);
  const res = active.outputResolution ?? { width: 1920, height: 1080 };
  const patch = (p: Partial<ProjectionZone>) => store.update(active.id, p);
  const pickDisplay = (label: string) => {
    const d = displays.find((x) => x.label === label);
    if (d) store.update(active.id, { targetScreenName: d.label, outputResolution: { width: d.width, height: d.height } });
  };

  return (
    <div className={className} style={{ background: "#0f0f11", borderColor: "#ffffff14" }}>
      <div className="px-4 pt-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] text-white/45">
          Projection zone — where text lands on the projector. Changes are live.
          {Math.min(z.w, z.h) > 0.98 && <span style={{ color: AMBER }}> Reduce Size below 100% first to reposition it up/down.</span>}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-white/50">
          {displays.length > 0 && (
            <select value={active.targetScreenName ?? ""} onChange={(e) => pickDisplay(e.target.value)}
              className="bg-[#17171b] text-white rounded px-2 py-1 border" style={{ borderColor: "#ffffff1a" }}>
              <option value="">Screen…</option>
              {displays.map((d) => <option key={d.id} value={d.label}>{d.label}{d.isPrimary ? " (primary)" : ""} — {d.width}×{d.height}</option>)}
            </select>
          )}
          <span className="tabular-nums">{res.width}×{res.height}</span>
        </div>
      </div>
      <div className="px-4 py-2.5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-[12px] text-white/80">
        <label className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-white/50">Size</span>
          <input type="range" min={0.25} max={1} step={0.01} value={Math.min(z.w, z.h)}
            onChange={(e) => { const s = Number(e.target.value); const cx = z.x + z.w / 2, cy = z.y + z.h / 2; patch({ w: s, h: s, x: Math.max(0, Math.min(1 - s, cx - s / 2)), y: Math.max(0, Math.min(1 - s, cy - s / 2)) }); }}
            className="flex-1 accent-[#ff7a2c]" />
          <span className="w-10 text-right tabular-nums">{Math.round(Math.min(z.w, z.h) * 100)}%</span>
        </label>
        <label className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-white/50">Font</span>
          <input type="range" min={0.5} max={2} step={0.05} value={z.fontScale}
            onChange={(e) => patch({ fontScale: Number(e.target.value) })} className="flex-1 accent-[#ff7a2c]" />
          <span className="w-10 text-right tabular-nums">{z.fontScale.toFixed(2)}×</span>
        </label>
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-white/50">Margins</span>
          {(["marginTop", "marginBottom", "marginLeft", "marginRight"] as const).map((m, i) => (
            <label key={m} className="flex items-center gap-1">
              <span className="text-white/40">{["T", "B", "L", "R"][i]}</span>
              <input type="number" min={0} max={40} value={Math.round(z[m] * (m.includes("Left") || m.includes("Right") ? 1920 : 1080))}
                onChange={(e) => { const px = Number(e.target.value) || 0; const denom = (m === "marginLeft" || m === "marginRight") ? 1920 : 1080; patch({ [m]: Math.max(0, px) / denom } as Partial<ProjectionZone>); }}
                className="w-12 bg-[#17171b] rounded px-1 py-0.5 border text-white" style={{ borderColor: "#ffffff1a" }} />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 justify-end">
          <button className="px-3 py-1.5 rounded-md text-[12px]" style={{ color: AMBER, border: `1px solid ${AMBER}55` }}
            onClick={() => patch({ x: (1 - z.w) / 2, y: (1 - z.h) / 2 })}>Center</button>
          <button className="px-3 py-1.5 rounded-md text-[12px] text-white/70 hover:text-white" style={{ border: "1px solid #ffffff1a" }}
            onClick={() => patch({ ...DEFAULT_ZONE })}>Reset</button>
        </div>
      </div>
    </div>
  );
}
