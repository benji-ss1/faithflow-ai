"use client";
/**
 * useStageLayouts — the operator session for Stage Layouts (2026-09-21).
 *
 * ProPresenter's Screens > Edit Layouts: a flat, named, thumbnailed list of
 * layout presets, each assignable to a stage screen. Built-ins live in CODE
 * (src/engine/stage/presets.ts) and are never rows — a church customises by
 * DUPLICATING one, so "restore defaults" always works.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { callAction } from "@/lib/action-call";
import { toast } from "sonner";
import {
  listStageLayouts, createStageLayout, updateStageLayout, deleteStageLayout,
  listStageScreens, createStageScreen, setStageScreenLayout, renameStageScreen, deleteStageScreen,
} from "@/lib/actions";
import { sanitizeStageLayout, type StageLayout } from "@/engine/stage";
import { BUILT_IN_STAGE_LAYOUTS, isBuiltInStageLayout, duplicateStageLayout } from "@/engine/stage/presets";

export type StageLayoutEntry = StageLayout & { builtIn: boolean };
export type StageScreenEntry = { id: string; name: string; layoutId: string | null };

export type StageLayoutsApi = {
  layouts: StageLayoutEntry[];
  screens: StageScreenEntry[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Resolve an id (built-in or church row) to a layout. */
  byId: (id: string | null) => StageLayoutEntry | null;
  duplicate: (id: string) => Promise<string | null>;
  save: (id: string, layout: StageLayout) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addScreen: (name: string) => Promise<void>;
  assign: (screenId: string, layoutId: string | null) => Promise<void>;
  renameScreen: (screenId: string, name: string) => Promise<void>;
  removeScreen: (screenId: string) => Promise<void>;
};

export function useStageLayouts(): StageLayoutsApi {
  const [rows, setRows] = useState<StageLayoutEntry[]>([]);
  const [screens, setScreens] = useState<StageScreenEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([listStageLayouts(), listStageScreens()]);
      if (l.ok && l.data) {
        setRows(l.data.map((r) => ({
          // Sanitised on READ as well as write: a row could predate a field.
          ...sanitizeStageLayout({ ...(r.config as object), id: r.id, name: r.name }, r.id),
          builtIn: false,
        })));
      }
      if (s.ok && s.data) setScreens(s.data.map((r) => ({ id: r.id, name: r.name, layoutId: r.layoutId })));
    } catch { /* offline / no session */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Built-ins first, then the church's own — matching ProPresenter's list.
  const layouts = useMemo<StageLayoutEntry[]>(() => [
    ...BUILT_IN_STAGE_LAYOUTS.map((l) => ({ ...l, builtIn: true })),
    ...rows,
  ], [rows]);

  const byId = useCallback((id: string | null) => id ? layouts.find((l) => l.id === id) ?? null : null, [layouts]);

  const duplicate = useCallback(async (id: string) => {
    const src = layouts.find((l) => l.id === id);
    if (!src) return null;
    // A built-in is never edited in place; it is copied into an editable row.
    const copy = duplicateStageLayout(src, "pending", isBuiltInStageLayout(id) ? src.name : `${src.name} copy`);
    const res = await callAction("duplicate the layout", () => createStageLayout({ name: copy.name, config: copy }), toast.error);
    if (res.ok && res.data) { await refresh(); return res.data.id; }
    return null;
  }, [layouts, refresh]);

  const save = useCallback(async (id: string, layout: StageLayout) => {
    if (isBuiltInStageLayout(id)) return; // built-ins are code, not editable
    const res = await callAction("save the layout", () => updateStageLayout(id, { name: layout.name, config: layout }), toast.error);
    if (res.ok) await refresh();
  }, [refresh]);

  const rename = useCallback(async (id: string, name: string) => {
    if (isBuiltInStageLayout(id)) return;
    const res = await callAction("rename the layout", () => updateStageLayout(id, { name }), toast.error);
    if (res.ok) await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    if (isBuiltInStageLayout(id)) return;
    const res = await callAction("delete the layout", () => deleteStageLayout(id), toast.error);
    if (res.ok) await refresh();
  }, [refresh]);

  const addScreen = useCallback(async (name: string) => {
    const res = await callAction("add the stage screen", () => createStageScreen({ name }), toast.error);
    if (res.ok) await refresh();
  }, [refresh]);
  const assign = useCallback(async (screenId: string, layoutId: string | null) => {
    const res = await callAction("assign the layout", () => setStageScreenLayout(screenId, layoutId), toast.error);
    if (res.ok) await refresh();
  }, [refresh]);
  const renameScreen = useCallback(async (screenId: string, name: string) => {
    const res = await callAction("rename the stage screen", () => renameStageScreen(screenId, name), toast.error);
    if (res.ok) await refresh();
  }, [refresh]);
  const removeScreen = useCallback(async (screenId: string) => {
    const res = await callAction("remove the stage screen", () => deleteStageScreen(screenId), toast.error);
    if (res.ok) await refresh();
  }, [refresh]);

  return { layouts, screens, loading, refresh, byId, duplicate, save, rename, remove, addScreen, assign, renameScreen, removeScreen };
}
