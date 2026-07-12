"use client";
// Extracted from src/app/(app)/settings/screens/page.tsx so the desktop shell
// can present the Screens/Outputs assignment UI inside a modal (the /settings/*
// routes are middleware-blocked on desktop).
//
// The web-shell page still uses the standalone route; this component is the
// shared core of both. Renders nothing when not in the Electron shell.

import { useEffect, useState, useCallback } from "react";
import type { DisplayInfo } from "@/types/electron";

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

export function ScreensPanel() {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [assignments, setAssignments] = useState<Record<number, Assignment>>({});
  const [autoRestore, setAutoRestore] = useState(false);
  const [inElectron, setInElectron] = useState<boolean | null>(null);

  useEffect(() => {
    const hasApi = typeof window !== "undefined" && !!window.electronAPI;
    setInElectron(hasApi);
    if (!hasApi) return;

    void window.electronAPI!.screens.list().then(setDisplays);

    try {
      // Y7: validate shape before trusting persisted state.
      setAssignments(parseStoredAssignments(localStorage.getItem(STORAGE_KEY)));
      setAutoRestore(localStorage.getItem(AUTO_RESTORE_KEY) === "1");
    } catch {}
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
    if (!a || a.role === "None") return;
    // P5: pass obsMode through to the main process so Livestream can pick
    // up the OBS-friendly lower-third capture surface.
    await window.electronAPI!.screens.assign(dispId, a.role, a.preset, a.obsMode);
    await window.electronAPI!.screens.spawn(a.role);
    updateAssignment(dispId, { spawned: true });
  };

  const handleClose = async (dispId: number) => {
    const a = assignments[dispId];
    if (!a || a.role === "None") return;
    await window.electronAPI!.screens.close(a.role);
    updateAssignment(dispId, { spawned: false });
  };

  return (
    <div className="p-4">
      <label className="flex items-center gap-2 mb-4 text-sm text-zinc-200">
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

      <div className="overflow-x-auto rounded-md border border-[#2a3232]">
        <table className="w-full text-xs">
          <thead className="bg-[#1a2020] text-zinc-400 uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2 text-left">Display</th>
              <th className="px-3 py-2 text-left">Resolution</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-left">Preset</th>
              <th className="px-3 py-2 text-left">OBS mode</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody className="text-zinc-200">
            {displays.map((d) => {
              const a = assignments[d.id] ?? { role: "None" as Role, preset: "1080p30" as Preset, spawned: false };
              return (
                <tr key={d.id} className="border-t border-[#2a3232]">
                  <td className="px-3 py-2">{d.label} {d.isPrimary && <span className="text-[10px] text-zinc-500">(Primary)</span>}</td>
                  <td className="px-3 py-2">{d.size.width} × {d.size.height} @ {d.scaleFactor}x</td>
                  <td className="px-3 py-2">
                    <select
                      value={a.role}
                      onChange={(e) => updateAssignment(d.id, { role: e.target.value as Role })}
                      className="rounded border border-[#2a3232] bg-[#1a2020] text-zinc-100 px-2 py-1"
                    >
                      <option>None</option>
                      <option>Projector</option>
                      <option>Stage</option>
                      <option>Livestream</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={a.preset}
                      onChange={(e) => updateAssignment(d.id, { preset: e.target.value as Preset })}
                      className="rounded border border-[#2a3232] bg-[#1a2020] text-zinc-100 px-2 py-1"
                    >
                      <option value="720p">720p</option>
                      <option value="1080p30">1080p30</option>
                      <option value="1080p60">1080p60</option>
                      <option value="4K">4K</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {a.role === "Livestream" ? (
                      <select
                        value={a.obsMode ?? "full"}
                        onChange={(e) => updateAssignment(d.id, { obsMode: e.target.value as ObsMode })}
                        className="rounded border border-[#2a3232] bg-[#1a2020] text-zinc-100 px-2 py-1"
                      >
                        <option value="full">Full slide</option>
                        <option value="lowerthird">Lower-third (OBS key)</option>
                      </select>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {a.spawned ? (
                      <button className="rounded bg-red-600 text-white px-3 py-1 text-xs" onClick={() => handleClose(d.id)}>Close</button>
                    ) : (
                      <button
                        className="rounded bg-teal-500/20 border border-teal-500/60 text-teal-200 px-3 py-1 text-xs disabled:opacity-40"
                        disabled={a.role === "None"}
                        onClick={() => handleSpawn(d.id)}
                      >Spawn</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">
        Assignments are stored locally and restored on the next launch when auto-restore is enabled.
      </p>
    </div>
  );
}
