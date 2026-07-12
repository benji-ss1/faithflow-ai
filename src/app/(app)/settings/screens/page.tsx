"use client";

import { useEffect, useState, useCallback } from "react";
import type { DisplayInfo } from "@/types/electron";

type Role = "None" | "Projector" | "Stage" | "Livestream";
type Preset = "720p" | "1080p30" | "1080p60" | "4K";

interface Assignment {
  role: Role;
  preset: Preset;
  spawned: boolean;
}

const STORAGE_KEY = "presentflow.screenAssignments.v1";
const AUTO_RESTORE_KEY = "presentflow.screenAssignments.autoRestore";

export default function ScreenConfigPage() {
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
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setAssignments(JSON.parse(stored));
      setAutoRestore(localStorage.getItem(AUTO_RESTORE_KEY) === "1");
    } catch {}
  }, []);

  const persist = useCallback((next: Record<number, Assignment>) => {
    setAssignments(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  // Auto-restore on mount if enabled
  useEffect(() => {
    if (!autoRestore || !inElectron || displays.length === 0) return;
    Object.entries(assignments).forEach(async ([dispIdStr, a]) => {
      const dispId = Number(dispIdStr);
      if (a.role !== "None" && a.spawned) {
        await window.electronAPI!.screens.assign(dispId, a.role, a.preset);
        await window.electronAPI!.screens.spawn(a.role);
      }
    });
    // Intentionally run once when both settings + displays load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRestore, inElectron, displays.length]);

  if (inElectron === null) return <div className="p-8">Loading…</div>;

  if (!inElectron) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold mb-2">Screen Configuration</h1>
        <p className="text-neutral-500">
          Screen configuration is available only in the Present Flow desktop app.
          Please open Present Flow from your applications folder to configure
          multi-display output.
        </p>
      </div>
    );
  }

  const updateAssignment = (dispId: number, patch: Partial<Assignment>) => {
    const current = assignments[dispId] ?? { role: "None" as Role, preset: "1080p30" as Preset, spawned: false };
    const next = { ...assignments, [dispId]: { ...current, ...patch } };
    persist(next);
  };

  const handleSpawn = async (dispId: number) => {
    const a = assignments[dispId];
    if (!a || a.role === "None") return;
    await window.electronAPI!.screens.assign(dispId, a.role, a.preset);
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
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold mb-6">Screen Configuration</h1>

      <label className="flex items-center gap-2 mb-6">
        <input
          type="checkbox"
          checked={autoRestore}
          onChange={(e) => {
            setAutoRestore(e.target.checked);
            try { localStorage.setItem(AUTO_RESTORE_KEY, e.target.checked ? "1" : "0"); } catch {}
          }}
        />
        <span>Auto-restore last session on launch</span>
      </label>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 dark:bg-neutral-900">
            <tr>
              <th className="px-4 py-2 text-left">Display</th>
              <th className="px-4 py-2 text-left">Resolution</th>
              <th className="px-4 py-2 text-left">Bounds</th>
              <th className="px-4 py-2 text-left">Role</th>
              <th className="px-4 py-2 text-left">Preset</th>
              <th className="px-4 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {displays.map((d) => {
              const a = assignments[d.id] ?? { role: "None" as Role, preset: "1080p30" as Preset, spawned: false };
              return (
                <tr key={d.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-4 py-3">
                    {d.label} {d.isPrimary && <span className="text-xs text-neutral-500">(Primary)</span>}
                  </td>
                  <td className="px-4 py-3">
                    {d.size.width} × {d.size.height} @ {d.scaleFactor}x
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">
                    ({d.bounds.x}, {d.bounds.y})
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={a.role}
                      onChange={(e) => updateAssignment(d.id, { role: e.target.value as Role })}
                      className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1"
                    >
                      <option>None</option>
                      <option>Projector</option>
                      <option>Stage</option>
                      <option>Livestream</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={a.preset}
                      onChange={(e) => updateAssignment(d.id, { preset: e.target.value as Preset })}
                      className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1"
                    >
                      <option value="720p">720p</option>
                      <option value="1080p30">1080p30</option>
                      <option value="1080p60">1080p60</option>
                      <option value="4K">4K</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {a.spawned ? (
                      <button
                        className="rounded bg-red-600 text-white px-3 py-1"
                        onClick={() => handleClose(d.id)}
                      >
                        Close
                      </button>
                    ) : (
                      <button
                        className="rounded bg-black text-white dark:bg-white dark:text-black px-3 py-1 disabled:opacity-50"
                        disabled={a.role === "None"}
                        onClick={() => handleSpawn(d.id)}
                      >
                        Spawn
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-xs text-neutral-500">
        Assignments are stored locally and restored on the next launch when auto-restore is enabled.
      </p>
    </div>
  );
}
