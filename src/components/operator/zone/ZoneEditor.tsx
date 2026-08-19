"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectionZoneStore } from "@/lib/projection-zone-store";
import { MIN_ZONE, normalizeZone, DEFAULT_ZONE, type ProjectionZone } from "@/lib/projection-zone";

// Match the app's clean dark "sonar" palette: brand orange accent + near-black
// panels + a MUTED (not loud) boundary red. Kept as hex so alpha suffixes work.
const AMBER = "#e8501a"; // --color-brand
const RED = "#ff5a4d";   // muted boundary guide
const PANEL = "#0f0f11"; // clean dark card (matches the toasts/staged panel)
const ELEV = "#17171b";  // input/select surface
const SAMPLE = "For God so loved the world, that He gave His only begotten Son, that whoever believes in Him should not perish but have everlasting life.\n— John 3:16 (NKJV)";

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

/**
 * Projection Zone Customizer — visual editor (spec §2). Opens as a sheet on the
 * operator screen. Every change is LIVE (writes the profile store, which feeds
 * OutputState → the projector + stage move in real time). Geometry only — never
 * touches themes. Escape / Done closes; arrows nudge; ⌘Z / ⌘⇧Z undo/redo.
 */
export function ZoneEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useProjectionZoneStore();
  const active = store.activeProfile;
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [interacting, setInteracting] = useState<Handle | null>(null);
  // Electron does NOT support window.prompt() — use an inline name field instead.
  const [nameModal, setNameModal] = useState<{ mode: "new" | "rename"; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Detect the operator's connected displays so the preview matches the REAL
  // projector's resolution/aspect (spec accuracy). Physical px = size × scaleFactor.
  type Display = { id: number; label: string; width: number; height: number; isPrimary: boolean };
  const [displays, setDisplays] = useState<Display[]>([]);
  useEffect(() => {
    if (!open) return;
    const api = (window as unknown as { electronAPI?: { screens?: { list?: () => Promise<unknown> } } }).electronAPI?.screens;
    if (!api?.list) return;
    Promise.resolve(api.list()).then((list) => {
      if (!Array.isArray(list)) return;
      setDisplays(list.map((d) => {
        const dd = d as { id: number; label?: string; size?: { width: number; height: number }; scaleFactor?: number; isPrimary?: boolean };
        const sf = dd.scaleFactor ?? 1;
        return { id: dd.id, label: dd.label ?? `Display ${dd.id}`, width: Math.round((dd.size?.width ?? 1920) * sf), height: Math.round((dd.size?.height ?? 1080) * sf), isPrimary: !!dd.isPrimary };
      }));
    }).catch(() => { /* not in Electron / no API */ });
  }, [open]);

  // Undo/redo — per editor session. Snapshots of the active zone.
  const undoStack = useRef<ProjectionZone[]>([]);
  const redoStack = useRef<ProjectionZone[]>([]);
  const pushUndo = useCallback((z: ProjectionZone) => { undoStack.current.push(z); redoStack.current = []; }, []);

  const z = active ? normalizeZone(active) : DEFAULT_ZONE;

  const patch = useCallback((p: Partial<ProjectionZone>, snapshot = true) => {
    if (!active) return;
    if (snapshot) pushUndo(normalizeZone(active));
    store.update(active.id, p);
  }, [active, store, pushUndo]);

  // ── Pointer drag / resize on the canvas ──────────────────────────────────
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; start: ProjectionZone } | null>(null);
  const onPointerDown = (handle: Handle) => (e: React.PointerEvent) => {
    if (!active || !canvasRef.current) return;
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { handle, startX: e.clientX, startY: e.clientY, start: normalizeZone(active) };
    pushUndo(normalizeZone(active));
    setInteracting(handle);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; const el = canvasRef.current;
    if (!d || !el || !active) return;
    const rect = el.getBoundingClientRect();
    const dx = (e.clientX - d.startX) / rect.width;
    const dy = (e.clientY - d.startY) / rect.height;
    let { x, y, w, h } = d.start;
    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
    if (d.handle === "move") {
      x = clamp01(Math.min(d.start.x + dx, 1 - w));
      y = clamp01(Math.min(d.start.y + dy, 1 - h));
      // Center-snap (spec §2): within 3% of centre on an axis.
      const cx = x + w / 2, cy = y + h / 2;
      if (Math.abs(cx - 0.5) < 0.03) x = 0.5 - w / 2;
      if (Math.abs(cy - 0.5) < 0.03) y = 0.5 - h / 2;
    } else {
      if (d.handle.includes("e")) w = Math.max(MIN_ZONE, Math.min(1 - x, d.start.w + dx));
      if (d.handle.includes("s")) h = Math.max(MIN_ZONE, Math.min(1 - y, d.start.h + dy));
      if (d.handle.includes("w")) { const nx = clamp01(d.start.x + dx); const nw = d.start.w + (d.start.x - nx); if (nw >= MIN_ZONE) { x = nx; w = nw; } }
      if (d.handle.includes("n")) { const ny = clamp01(d.start.y + dy); const nh = d.start.h + (d.start.y - ny); if (nh >= MIN_ZONE) { y = ny; h = nh; } }
    }
    store.update(active.id, { x, y, w, h });
  };
  const endDrag = () => { dragRef.current = null; setInteracting(null); };

  // ── Keyboard: Escape close, arrows nudge, ⌘Z / ⌘⇧Z ───────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
      if (e.key === "Escape") { onClose(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) { const s = redoStack.current.pop(); if (s) { undoStack.current.push(normalizeZone(active)); store.update(active.id, s); } }
        else { const s = undoStack.current.pop(); if (s) { redoStack.current.push(normalizeZone(active)); store.update(active.id, s); } }
        return;
      }
      const step = (e.shiftKey ? 10 : 1) / 1920; // ~1pt / 10pt in normalized-x
      const stepY = (e.shiftKey ? 10 : 1) / 1080;
      const cz = normalizeZone(active);
      if (e.key === "ArrowLeft") { patch({ x: Math.max(0, cz.x - step) }); e.preventDefault(); }
      else if (e.key === "ArrowRight") { patch({ x: Math.min(1 - cz.w, cz.x + step) }); e.preventDefault(); }
      else if (e.key === "ArrowUp") { patch({ y: Math.max(0, cz.y - stepY) }); e.preventDefault(); }
      else if (e.key === "ArrowDown") { patch({ y: Math.min(1 - cz.h, cz.y + stepY) }); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, active, onClose, patch, store]);

  if (!open || !active) return null;

  const res = active.outputResolution ?? { width: 1920, height: 1080 };
  const canvasAspect = res.width > 0 && res.height > 0 ? `${res.width} / ${res.height}` : "16 / 9";
  const pickDisplay = (label: string) => {
    const d = displays.find((x) => x.label === label);
    if (d) store.update(active.id, { targetScreenName: d.label, outputResolution: { width: d.width, height: d.height } });
  };
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const handleStyle = (cursor: string): React.CSSProperties => ({
    position: "absolute", width: 12, height: 12, borderRadius: "50%",
    background: AMBER, border: "2px solid #08080C", cursor, touchAction: "none",
  });

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-[min(92vw,980px)] max-h-[92vh] overflow-auto rounded-2xl flex flex-col" style={{ background: PANEL, border: `1px solid ${AMBER}33`, boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}>
        {/* Inline name input (Electron has no window.prompt) */}
        {nameModal && (
          <div className="absolute inset-0 z-[10] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) setNameModal(null); }}>
            <div className="rounded-xl p-4 w-[320px]" style={{ background: ELEV, border: `1px solid ${AMBER}33` }}>
              <div className="text-white text-[13px] font-semibold mb-2">{nameModal.mode === "new" ? "New profile" : "Rename profile"}</div>
              <input autoFocus value={nameModal.value} onChange={(e) => setNameModal({ ...nameModal, value: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") { const v = nameModal.value.trim(); if (v) { if (nameModal.mode === "new") store.create(v, true); else store.rename(active.id, v); } setNameModal(null); } if (e.key === "Escape") setNameModal(null); }}
                className="w-full bg-[#0f0f11] text-white rounded-md px-2 py-1.5 border text-[13px]" style={{ borderColor: "#ffffff1a" }} />
              <div className="flex justify-end gap-2 mt-3">
                <button className="text-[12px] px-3 py-1.5 rounded-md text-white/70 hover:text-white" onClick={() => setNameModal(null)}>Cancel</button>
                <button className="text-[12px] px-3 py-1.5 rounded-md font-semibold" style={{ background: AMBER, color: "#0b0b0e" }}
                  onClick={() => { const v = nameModal.value.trim(); if (v) { if (nameModal.mode === "new") store.create(v, true); else store.rename(active.id, v); } setNameModal(null); }}>OK</button>
              </div>
            </div>
          </div>
        )}
        {confirmDelete && (
          <div className="absolute inset-0 z-[10] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmDelete(false); }}>
            <div className="rounded-xl p-4 w-[320px]" style={{ background: ELEV, border: `1px solid ${AMBER}33` }}>
              <div className="text-white text-[13px] mb-3">Delete “{active.name}”?</div>
              <div className="flex justify-end gap-2">
                <button className="text-[12px] px-3 py-1.5 rounded-md text-white/70 hover:text-white" onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button className="text-[12px] px-3 py-1.5 rounded-md font-semibold bg-red-500 text-white" onClick={() => { store.remove(active.id); setConfirmDelete(false); }}>Delete</button>
              </div>
            </div>
          </div>
        )}
        {/* Header + profile bar */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b" style={{ borderColor: "#ffffff14" }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold text-sm mr-2">Projection Zone</span>
            <select
              value={active.id}
              onChange={(e) => store.setActive(e.target.value)}
              className="bg-[#17171b] text-white text-[13px] rounded-md px-2 py-1.5 border" style={{ borderColor: "#ffffff1a" }}
            >
              {store.profiles.map((p) => <option key={p.id} value={p.id}>{p.isDefault ? "★ " : ""}{p.name}</option>)}
            </select>
            <button className="text-[12px] px-2 py-1.5 rounded-md" style={{ color: AMBER, border: `1px solid ${AMBER}55` }}
              onClick={() => setNameModal({ mode: "new", value: "New profile" })}>+ New</button>
            <button className="text-[12px] px-2 py-1.5 rounded-md text-white/70 hover:text-white" style={{ border: "1px solid #ffffff1a" }}
              onClick={() => setNameModal({ mode: "rename", value: active.name })}>Rename</button>
            <button className="text-[12px] px-2 py-1.5 rounded-md text-white/70 hover:text-white" style={{ border: "1px solid #ffffff1a" }}
              onClick={() => store.setDefault(active.id)} title="Make default">{active.isDefault ? "★ Default" : "☆ Set default"}</button>
            <button className="text-[12px] px-2 py-1.5 rounded-md text-red-300/80 hover:text-red-300" style={{ border: "1px solid #ffffff1a" }}
              disabled={store.profiles.length <= 1}
              onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>
          <button className="text-[13px] font-semibold px-4 py-1.5 rounded-lg" style={{ background: AMBER, color: "#0b0b0e" }} onClick={onClose}>Done</button>
        </div>

        {/* Preview canvas */}
        <div className="p-5">
          <div
            ref={canvasRef}
            className="relative w-full rounded-lg overflow-hidden select-none"
            style={{
              aspectRatio: canvasAspect,
              backgroundColor: "#0d0d10",
              backgroundImage: "repeating-conic-gradient(#141418 0% 25%, #0d0d10 0% 50%)",
              backgroundSize: "28px 28px",
              touchAction: "none",
            }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            {/* red boundary at canvas edges while interacting */}
            {interacting && <div className="absolute inset-0 pointer-events-none" style={{ border: `2px solid ${RED}`, opacity: 0.45 }} />}
            {/* safe-zone (5% overscan) amber dashed guide */}
            <div className="absolute pointer-events-none" style={{ left: "5%", top: "5%", right: "5%", bottom: "5%", border: `1px dashed ${AMBER}66` }} />

            {/* The content zone */}
            <div
              className="absolute"
              style={{
                left: pct(z.x), top: pct(z.y), width: pct(z.w), height: pct(z.h),
                border: `2px dashed ${interacting ? "#ffffff" : AMBER}`,
                cursor: "move", touchAction: "none",
              }}
              onPointerDown={onPointerDown("move")}
            >
              {/* margins (inner content area) */}
              <div className="absolute flex items-center justify-center overflow-hidden" style={{
                left: pct(z.marginLeft / Math.max(z.w, 0.0001)), top: pct(z.marginTop / Math.max(z.h, 0.0001)),
                right: pct(z.marginRight / Math.max(z.w, 0.0001)), bottom: pct(z.marginBottom / Math.max(z.h, 0.0001)),
              }}>
                <div className="text-center text-white font-semibold uppercase leading-snug px-1" style={{ fontSize: `calc(${1.4 * z.fontScale}vw)`, textShadow: "0 2px 8px rgba(0,0,0,0.6)", whiteSpace: "pre-wrap" }}>{SAMPLE}</div>
              </div>
              {/* resize handles */}
              <div onPointerDown={onPointerDown("nw")} style={{ ...handleStyle("nwse-resize"), left: -6, top: -6 }} />
              <div onPointerDown={onPointerDown("n")} style={{ ...handleStyle("ns-resize"), left: "calc(50% - 6px)", top: -6 }} />
              <div onPointerDown={onPointerDown("ne")} style={{ ...handleStyle("nesw-resize"), right: -6, top: -6 }} />
              <div onPointerDown={onPointerDown("e")} style={{ ...handleStyle("ew-resize"), right: -6, top: "calc(50% - 6px)" }} />
              <div onPointerDown={onPointerDown("se")} style={{ ...handleStyle("nwse-resize"), right: -6, bottom: -6 }} />
              <div onPointerDown={onPointerDown("s")} style={{ ...handleStyle("ns-resize"), left: "calc(50% - 6px)", bottom: -6 }} />
              <div onPointerDown={onPointerDown("sw")} style={{ ...handleStyle("nesw-resize"), left: -6, bottom: -6 }} />
              <div onPointerDown={onPointerDown("w")} style={{ ...handleStyle("ew-resize"), left: -6, top: "calc(50% - 6px)" }} />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[11px] text-white/45">
              Drag the box (or the text) to move · drag a handle to resize · changes are live.
              {Math.min(z.w, z.h) > 0.98 && <span style={{ color: AMBER }}> Reduce Size below 100% first to reposition it up/down.</span>}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/50">
              {displays.length > 0 ? (
                <select value={active.targetScreenName ?? ""} onChange={(e) => pickDisplay(e.target.value)}
                  className="bg-[#17171b] text-white rounded px-2 py-1 border" style={{ borderColor: "#ffffff1a" }}>
                  <option value="">Screen…</option>
                  {displays.map((d) => <option key={d.id} value={d.label}>{d.label}{d.isPrimary ? " (primary)" : ""} — {d.width}×{d.height}</option>)}
                </select>
              ) : null}
              <span className="tabular-nums">{res.width}×{res.height}</span>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-[12px] text-white/80">
          <label className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-white/50">Size</span>
            <input type="range" min={0.25} max={1} step={0.01} value={Math.min(z.w, z.h)}
              onChange={(e) => { const s = Number(e.target.value); const cx = z.x + z.w / 2, cy = z.y + z.h / 2; const nw = s, nh = s; patch({ w: nw, h: nh, x: Math.max(0, Math.min(1 - nw, cx - nw / 2)), y: Math.max(0, Math.min(1 - nh, cy - nh / 2)) }, false); }}
              className="flex-1 accent-[#E8A838]" />
            <span className="w-10 text-right tabular-nums">{Math.round(Math.min(z.w, z.h) * 100)}%</span>
          </label>
          <label className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-white/50">Font</span>
            <input type="range" min={0.5} max={2} step={0.05} value={z.fontScale}
              onChange={(e) => patch({ fontScale: Number(e.target.value) }, false)} className="flex-1 accent-[#E8A838]" />
            <span className="w-10 text-right tabular-nums">{z.fontScale.toFixed(2)}×</span>
          </label>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-white/50">Margins</span>
            {(["marginTop", "marginBottom", "marginLeft", "marginRight"] as const).map((m, i) => (
              <label key={m} className="flex items-center gap-1">
                <span className="text-white/40">{["T", "B", "L", "R"][i]}</span>
                <input type="number" min={0} max={40} value={Math.round(z[m] * (m.includes("Left") || m.includes("Right") ? 1920 : 1080))}
                  onChange={(e) => { const px = Number(e.target.value) || 0; const denom = (m === "marginLeft" || m === "marginRight") ? 1920 : 1080; patch({ [m]: Math.max(0, px) / denom } as Partial<ProjectionZone>, false); }}
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
    </div>
  );
}
