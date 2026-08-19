"use client";
// Extracted from src/app/(app)/settings/screens/page.tsx so the desktop shell
// can present the Screens/Outputs assignment UI inside a modal (the /settings/*
// routes are middleware-blocked on desktop).
//
// The web-shell page still uses the standalone route; this component is the
// shared core of both. Renders nothing when not in the Electron shell.
//
// 2026-07-31 layout change: replaced the wide 6-column table (which required
// horizontal scrolling to see the Spawn button) with a compact card-per-display
// layout. All information is now visible without scrolling.

import { useEffect, useState, useCallback } from "react";
import type { DisplayInfo } from "@/types/electron";
import { DropdownDisclosure } from "../pro/DropdownDisclosure";

type Role = "None" | "Projector" | "Stage" | "Livestream";
type Preset = "720p" | "1080p30" | "1080p60" | "4K";

type ObsMode = "full" | "lowerthird";

interface Assignment {
  role: Role;
  preset: Preset;
  spawned: boolean;
  obsMode?: ObsMode;
}

const STORAGE_KEY = "presentflow.screenAssignments.v1";
const AUTO_RESTORE_KEY = "presentflow.screenAssignments.autoRestore";

const VALID_ROLES = new Set<Role>(["None", "Projector", "Stage", "Livestream"]);
const VALID_PRESETS = new Set<Preset>(["720p", "1080p30", "1080p60", "4K"]);
const VALID_OBS_MODES = new Set<ObsMode>(["full", "lowerthird"]);

/**
 * Y7: Validate the shape of the persisted assignments blob before writing
 * it back into state. A tampered / cross-version localStorage value should
 * not crash the panel or (worse) let arbitrary strings reach the IPC layer.
 * Exported for unit testing.
 */
export function parseStoredAssignments(raw: string | null): Record<number, Assignment> {
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<number, Assignment> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const dispId = Number(k);
    if (!Number.isFinite(dispId)) continue;
    if (!v || typeof v !== "object") continue;
    const rec = v as Record<string, unknown>;
    if (typeof rec.role !== "string" || !VALID_ROLES.has(rec.role as Role)) continue;
    const preset: Preset = typeof rec.preset === "string" && VALID_PRESETS.has(rec.preset as Preset)
      ? (rec.preset as Preset)
      : "1080p30";
    const a: Assignment = {
      role: rec.role as Role,
      preset,
      spawned: rec.spawned === true,
    };
    if (typeof rec.obsMode === "string" && VALID_OBS_MODES.has(rec.obsMode as ObsMode)) {
      a.obsMode = rec.obsMode as ObsMode;
    }
    out[dispId] = a;
  }
  return out;
}

const selectCls = "rounded border border-[#2a3232] bg-[#1a2020] text-zinc-100 px-2 py-1 text-xs";

export function ScreensPanel() {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [assignments, setAssignments] = useState<Record<number, Assignment>>({});
  const [autoRestore, setAutoRestore] = useState(false);
  const [inElectron, setInElectron] = useState<boolean | null>(null);
  const [spawning, setSpawning] = useState<number | null>(null); // display ID currently being spawned/closed

  useEffect(() => {
    // 2026-07-25 field bug fix: on the desktop Electron shell the preload
    // script exposes window.electronAPI synchronously, but SOMETIMES the
    // panel mounts before the preload's contextBridge.exposeInMainWorld
    // has resolved (rare race, but real — user reported the "desktop app
    // only" message showing INSIDE the desktop app). Poll up to 3 seconds
    // for the API to appear before giving up. Also re-check on
    // visibilitychange in case the panel was opened before hydration.
    let cancelled = false;
    let tries = 0;
    const MAX_TRIES = 30; // 30 × 100 ms = 3 s
    const check = () => {
      if (cancelled) return;
      const hasApi = typeof window !== "undefined" && !!window.electronAPI;
      if (hasApi) {
        setInElectron(true);
        void window.electronAPI!.screens.list().then(setDisplays);
        try {
          setAssignments(parseStoredAssignments(localStorage.getItem(STORAGE_KEY)));
          setAutoRestore(localStorage.getItem(AUTO_RESTORE_KEY) === "1");
        } catch {}
        return;
      }
      tries++;
      if (tries >= MAX_TRIES) { setInElectron(false); return; }
      setTimeout(check, 100);
    };
    check();
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const persist = useCallback((next: Record<number, Assignment>) => {
    setAssignments(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  }, []);

  if (inElectron === null) return <div className="p-4 text-sm text-zinc-400">Loading…</div>;
  if (!inElectron) {
    return (
      <div className="p-4 text-sm text-zinc-400">
        Screen configuration is available only in the PresentFlow desktop app.
      </div>
    );
  }

  const updateAssignment = (dispId: number, patch: Partial<Assignment>) => {
    const current = assignments[dispId] ?? { role: "None" as Role, preset: "1080p30" as Preset, spawned: false };
    // Y4: role changed on the same display AND we had spawned the old
    // role → close the old window first so we don't end up stacking two
    // output windows (e.g. Stage + Livestream) on the same display.
    if (patch.role !== undefined && patch.role !== current.role && current.role !== "None" && current.spawned) {
      const prev = current.role;
      void window.electronAPI?.screens.close(prev).catch(() => { /* noop */ });
    }
    const merged = { ...current, ...patch };
    // If role changed to None or a different role, the "spawned" flag no
    // longer refers to the current role's window.
    if (patch.role !== undefined && patch.role !== current.role) merged.spawned = false;
    persist({ ...assignments, [dispId]: merged });
  };

  const handleSpawn = async (dispId: number) => {
    const a = assignments[dispId];
    if (!a || a.role === "None" || spawning !== null) return;
    setSpawning(dispId);
    try {
      // P5: pass obsMode through to the main process so Livestream can pick
      // up the OBS-friendly lower-third capture surface.
      await window.electronAPI!.screens.assign(dispId, a.role, a.preset, a.obsMode);
      await window.electronAPI!.screens.spawn(a.role);
      updateAssignment(dispId, { spawned: true });
    } catch (e) {
      const { toast } = await import("sonner");
      toast.error(e instanceof Error ? e.message : "Could not spawn window");
    } finally {
      setSpawning(null);
    }
  };

  const handleClose = async (dispId: number) => {
    const a = assignments[dispId];
    if (!a || a.role === "None" || spawning !== null) return;
    setSpawning(dispId);
    try {
      await window.electronAPI!.screens.close(a.role);
      updateAssignment(dispId, { spawned: false });
    } catch (e) {
      const { toast } = await import("sonner");
      toast.error(e instanceof Error ? e.message : "Could not close window");
    } finally {
      setSpawning(null);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <label className="flex items-center gap-2 text-sm text-zinc-200">
        <input
          type="checkbox"
          checked={autoRestore}
          onChange={(e) => {
            setAutoRestore(e.target.checked);
            try { localStorage.setItem(AUTO_RESTORE_KEY, e.target.checked ? "1" : "0"); } catch {}
          }}
        />
        Auto-restore last session on launch
      </label>

      {displays.length === 0 && (
        <div className="text-xs text-zinc-500 py-4 text-center">No displays detected.</div>
      )}

      <div className="space-y-3">
        {displays.map((d) => {
          const a = assignments[d.id] ?? { role: "None" as Role, preset: "1080p30" as Preset, spawned: false };
          const isSpawned = a.spawned;
          return (
            <div key={d.id} className="rounded-lg border border-[#2a3232] bg-[#1a2020] overflow-hidden">
              {/* Card header: label + spawn/close */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a3232] bg-[#141c1c]">
                <div>
                  <span className="text-sm font-medium text-zinc-100">{d.label}</span>
                  {d.isPrimary && <span className="ml-2 text-[10px] text-zinc-500">(Primary)</span>}
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    {d.size.width} × {d.size.height} @ {d.scaleFactor}x
                  </div>
                </div>
                {isSpawned ? (
                  <button
                    className="rounded bg-red-600/80 hover:bg-red-600 text-white px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={spawning !== null}
                    onClick={() => handleClose(d.id)}
                  >
                    {spawning === d.id ? "Closing…" : "Close"}
                  </button>
                ) : (
                  <button
                    className="rounded bg-teal-500/20 hover:bg-teal-500/30 border border-teal-500/60 text-teal-200 px-4 py-1.5 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    disabled={a.role === "None" || spawning !== null}
                    onClick={() => handleSpawn(d.id)}
                  >
                    {spawning === d.id ? "Spawning…" : "Spawn"}
                  </button>
                )}
              </div>

              {/* Card body: role + preset + obs mode */}
              <div className="flex items-end gap-4 px-3 py-3 flex-wrap">
                <div>
                  <div className="text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">Role</div>
                  <DropdownDisclosure
                    selectedId={a.role}
                    onSelect={(v) => updateAssignment(d.id, { role: v as Role })}
                    panelWidth={180}
                    items={[{ id: "None", name: "None" }, { id: "Projector", name: "Projector" }, { id: "Stage", name: "Stage" }, { id: "Livestream", name: "Livestream" }]}
                  />
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">Preset</div>
                  <DropdownDisclosure
                    selectedId={a.preset}
                    onSelect={(v) => updateAssignment(d.id, { preset: v as Preset })}
                    panelWidth={160}
                    items={[{ id: "720p", name: "720p" }, { id: "1080p30", name: "1080p30" }, { id: "1080p60", name: "1080p60" }, { id: "4K", name: "4K" }]}
                  />
                </div>
                {a.role === "Livestream" && (
                  <div>
                    <div className="text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">OBS mode</div>
                    <select
                      value={a.obsMode ?? "full"}
                      onChange={(e) => updateAssignment(d.id, { obsMode: e.target.value as ObsMode })}
                      className={selectCls}
                    >
                      <option value="full">Full slide</option>
                      <option value="lowerthird">Lower-third (OBS key)</option>
                    </select>
                  </div>
                )}
                {isSpawned && (
                  <div className="ml-auto flex items-center gap-1.5 text-[11px] text-teal-400">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                    Live
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-zinc-500">
        Assignments are stored locally and restored on the next launch when auto-restore is enabled.
      </p>
    </div>
  );
}
