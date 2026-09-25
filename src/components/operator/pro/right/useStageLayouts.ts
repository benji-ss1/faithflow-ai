"use client";
/**
 * useStageLayouts — the operator session for Stage Layouts (2026-09-21).
 *
 * ProPresenter's Screens > Edit Layouts: a flat, named, thumbnailed list of
 * layout presets, each assignable to a stage screen. Built-ins live in CODE
 * (src/engine/stage/presets.ts) and are never rows — a church customises by
 * DUPLICATING one, so "restore defaults" always works.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** A brand-new empty layout; returns its id. */
  createBlank: (name?: string) => Promise<string | null>;
  save: (id: string, layout: StageLayout) => Promise<boolean>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addScreen: (name: string) => Promise<string | null>;
  /** ONE CLICK: put this layout on the stage, creating the screen if this
   *  church has never set one up. `null` goes back to the default display. */
  use: (layoutId: string | null) => Promise<void>;
  /** What the (first) stage screen is showing right now — drives the "On
   *  stage" badge, so the operator can always see which one is live. */
  activeLayoutId: string | null;
  assign: (screenId: string, layoutId: string | null) => Promise<boolean>;
  renameScreen: (screenId: string, name: string) => Promise<void>;
  removeScreen: (screenId: string) => Promise<void>;
};

export function useStageLayouts(): StageLayoutsApi {
  const [rows, setRows] = useState<StageLayoutEntry[]>([]);
  const [screens, setScreens] = useState<StageScreenEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // Mirror, so `use` can read the CURRENT screens without taking them as a
  // dependency (which would re-create the callback on every refresh).
  const screensRef = useRef<StageScreenEntry[]>([]);
  useEffect(() => { screensRef.current = screens; }, [screens]);
  const activeLayoutId = screens[0]?.layoutId ?? null;

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

  /** A brand-new, EMPTY layout. Until now the only route to your own design
   *  was copying a built-in, so "create one" was never actually on offer. */
  const createBlank = useCallback(async (name = "My layout"): Promise<string | null> => {
    const blank: StageLayout = { id: "pending", name, background: "#000000", widgets: [] };
    const res = await callAction("create the layout",
      () => createStageLayout({ name, config: blank }), toast.error);
    if (res.ok && res.data) { await refresh(); return res.data.id; }
    return null;
  }, [refresh]);

  /** Reports whether it saved. The editor MUST NOT close on a false — that is
   *  how an operator loses a whole layout to a rejected name. */
  const save = useCallback(async (id: string, layout: StageLayout): Promise<boolean> => {
    if (isBuiltInStageLayout(id)) return false; // built-ins are code, not editable
    const res = await callAction("save the layout", () => updateStageLayout(id, { name: layout.name, config: layout }), toast.error);
    if (res.ok) await refresh();
    return res.ok;
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

  const addScreen = useCallback(async (name: string): Promise<string | null> => {
    const res = await callAction("add the stage screen", () => createStageScreen({ name }), toast.error);
    if (res.ok) { await refresh(); return res.data?.id ?? null; }
    return null;
  }, [refresh]);

  /**
   * ONE CLICK: put this layout on the stage.
   *
   * Assigning used to require the operator to first understand that a "stage
   * screen" is a separate object, add one, and only then find the layout in a
   * dropdown. Nobody picking a design thinks in those steps — they think "I
   * want that one". So if no screen exists yet we create the obvious one and
   * assign in the same gesture; the multi-screen UI is still there underneath
   * for churches that genuinely run two confidence monitors.
   */
  const use = useCallback(async (layoutId: string | null): Promise<void> => {
    const target = screensRef.current[0];
    if (target) {
      const res = await callAction("put that layout on the stage",
        () => setStageScreenLayout(target.id, layoutId), toast.error);
      if (res.ok) await refresh();
      return;
    }
    const created = await callAction("set up the stage screen",
      () => createStageScreen({ name: "Stage", layoutId }), toast.error);
    if (created.ok) await refresh();
  }, [refresh]);
  /** Returns whether it actually stuck. Callers that open an editor MUST check
   *  it — editing a layout the screen is not pointing at means the operator
   *  saves and the monitor does not change, which reads as total failure. */
  const assign = useCallback(async (screenId: string, layoutId: string | null): Promise<boolean> => {
    const res = await callAction("assign the layout", () => setStageScreenLayout(screenId, layoutId), toast.error);
    if (res.ok) await refresh();
    return res.ok;
  }, [refresh]);
  const renameScreen = useCallback(async (screenId: string, name: string) => {
    const res = await callAction("rename the stage screen", () => renameStageScreen(screenId, name), toast.error);
    if (res.ok) await refresh();
  }, [refresh]);
  const removeScreen = useCallback(async (screenId: string) => {
    const res = await callAction("remove the stage screen", () => deleteStageScreen(screenId), toast.error);
    if (res.ok) await refresh();
  }, [refresh]);

  return { layouts, screens, loading, refresh, byId, duplicate, createBlank, save, rename, remove, addScreen, use, activeLayoutId, assign, renameScreen, removeScreen };
}
