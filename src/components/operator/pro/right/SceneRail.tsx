"use client";
/**
 * SceneRail (2026-09-16) — ProPresenter "Looks", one tap.
 *
 * Always-visible strip of scenes (spec §22.2 "Scene Rail (always visible
 * sidebar)"). Picking one publishes ONE atomic OutputState post, so all four
 * screens switch on the same frame; "None" clears the scene and is a provable
 * no-op (the field is omitted from the wire entirely).
 *
 * Rendered only when ctx.scenesUiOn (env kill-switch AND per-church opt-in), so
 * a church that hasn't enabled Scenes sees ZERO new DOM here.
 *
 * Per-screen themes are resolved HERE (operator-side) into wire appearances —
 * the output routes are public surfaces with no church DB access, and a themeId
 * lookup there would break the same-machine zero-latency path (rule 8).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { listScenes } from "@/lib/actions";
import { themeConfigToAppearance } from "@/lib/theme-appearance";
import { BUILT_IN_SCENES, sceneToWire, type SceneRecord, type SceneWire } from "@/lib/scenes";
import type { OperatorShellCtx } from "../../shell/types";

export const SCENES_OPENED_KEY = "presentflow.scenes.opened.v1";
export const SCENE_BUILDER_EVENT = "presentflow:open-scenes-settings";

type ThemeRow = { id: string; name: string; config: Record<string, unknown> };

/** Church scenes + the 5 built-ins, and a themeId → appearance resolver. */
export function useSceneLibrary() {
  const [custom, setCustom] = useState<SceneRecord[]>([]);
  const [themes, setThemes] = useState<ThemeRow[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await listScenes();
      if (res.ok && res.data) {
        setCustom(res.data.map((r) => ({ id: r.id, name: r.name, config: r.config as SceneRecord["config"], isBuiltIn: r.isBuiltIn, sortOrder: r.sortOrder })));
      }
    } catch { /* offline / no session — built-ins still work */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    let alive = true;
    fetch("/api/themes")
      .then((r) => r.json())
      .then((d: { themes?: ThemeRow[] }) => { if (alive) setThemes(d.themes ?? []); })
      .catch(() => { /* themes optional — a scene without a theme override still routes */ });
    return () => { alive = false; };
  }, []);

  const resolveAppearance = useCallback((themeId: string) => {
    const t = themes.find((x) => x.id === themeId);
    if (!t) return null;
    try { return themeConfigToAppearance(t.config); } catch { return null; }
  }, [themes]);

  const scenes = useMemo(() => [...BUILT_IN_SCENES, ...custom], [custom]);
  return { scenes, custom, themes, resolveAppearance, refresh };
}

export function SceneRail({ ctx }: { ctx: OperatorShellCtx }) {
  const { scenes, resolveAppearance, refresh } = useSceneLibrary();
  const activeId = ctx.activeScene?.id ?? null;

  // A rebuilt scene list (or newly-loaded themes) must not strand the live
  // scene on a stale appearance — re-publish the active scene when its source
  // definition changes. No scene selected ⇒ nothing is ever posted.
  useEffect(() => {
    if (!activeId) return;
    const src = scenes.find((s) => s.id === activeId);
    if (!src) return;
    const wire = sceneToWire(src, { rev: Date.now(), resolveAppearance });
    ctx.onSetScene(wire);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, resolveAppearance]);

  // Automations / slide actions: apply a scene by id (engine SET_LOOK).
  useEffect(() => {
    const onApply = (e: Event) => {
      const id = (e as CustomEvent<{ sceneId?: string }>).detail?.sceneId;
      if (!id) return;
      if (id === "none") { ctx.onSetScene(null); return; }
      const src = scenes.find((s) => s.id === id);
      if (!src) return; // renamed/deleted scene: leave the screens exactly as they are
      ctx.onSetScene(sceneToWire(src, { rev: Date.now(), resolveAppearance }));
    };
    window.addEventListener("presentflow:apply-scene", onApply);
    return () => window.removeEventListener("presentflow:apply-scene", onApply);
  }, [scenes, resolveAppearance, ctx]);

  useEffect(() => {
    const onChanged = () => { void refresh(); };
    window.addEventListener("presentflow:scenes-changed", onChanged);
    return () => window.removeEventListener("presentflow:scenes-changed", onChanged);
  }, [refresh]);

  const pick = useCallback((s: SceneRecord | null) => {
    if (!s) { ctx.onSetScene(null); return; }
    const wire: SceneWire | null = sceneToWire(s, { rev: Date.now(), resolveAppearance });
    ctx.onSetScene(wire);
    try { window.localStorage.setItem(SCENES_OPENED_KEY, "1"); } catch { /* ignore */ }
  }, [ctx, resolveAppearance]);

  const options: (SceneRecord | null)[] = [null, ...scenes];

  return (
    <div className="px-2 pb-2 flex items-center gap-1">
      <div
        className="flex flex-1 min-w-0 rounded-md border border-[var(--color-border)] p-0.5 overflow-x-auto"
        role="radiogroup"
        aria-label="Scene"
      >
        {options.map((s) => {
          const id = s?.id ?? "none";
          const label = s?.name ?? "None";
          const selected = (s?.id ?? null) === activeId;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              data-scene-id={id}
              title={s ? `Show the ${s.name} scene on every screen` : "No scene — every screen shows everything as usual"}
              onClick={() => pick(s)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const i = options.findIndex((o) => (o?.id ?? null) === activeId);
                const n = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1) + options.length) % options.length];
                pick(n ?? null);
                const nid = n?.id ?? "none";
                (e.currentTarget.parentElement?.querySelector(`[data-scene-id="${nid}"]`) as HTMLElement | null)?.focus();
              }}
              className={`shrink-0 max-w-[110px] truncate h-7 px-2 rounded text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)] ${selected ? "bg-[var(--color-brand)] text-white" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => { try { window.dispatchEvent(new CustomEvent(SCENE_BUILDER_EVENT)); } catch { /* ignore */ } }}
        className="shrink-0 h-8 px-2 inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] text-[11px] font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]"
        title="Build and edit scenes"
        aria-label="Build and edit scenes"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden /> Edit
      </button>
    </div>
  );
}
