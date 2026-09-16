"use client";
/**
 * SceneRail (2026-09-16) — ProPresenter "Looks", one tap.
 *
 * Always-visible strip of scenes (spec §22.2 "Scene Rail"). Picking one
 * publishes ONE atomic OutputState post, so all four screens switch on the same
 * frame; "None" clears the scene and is a provable no-op (the field is omitted
 * from the wire entirely).
 *
 * Rendered only when ctx.scenesUiOn (env kill-switch AND per-church opt-in), so
 * a church that hasn't enabled Scenes sees ZERO new DOM here.
 *
 * Live-service safety (review findings, 2026-09-16):
 *  - "None" is PINNED outside the scrollable strip, so the escape hatch is
 *    always reachable no matter how many scenes a church has.
 *  - Arrow keys MOVE FOCUS ONLY; committing needs Enter/Space or a click, and
 *    key-repeat is ignored — holding a key used to fire ~30 output switches/s.
 *  - Re-picking the live scene is a no-op (no republish, no rev churn).
 *  - Every switch offers Undo back to the previous scene.
 *  - Load failures are VISIBLE: a silent catch made it look like a church's
 *    scenes had been deleted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { listScenes } from "@/lib/actions";
import { themeConfigToAppearance } from "@/lib/theme-appearance";
import {
  BUILT_IN_SCENES, SCENE_SCREEN_LABELS, SCENE_LAYER_LABELS, sceneToWire, sanitizeSceneConfig,
  SCENE_SCREENS, SCENE_LAYER_IDS, type SceneRecord, type SceneWire,
} from "@/lib/scenes";
import type { OperatorShellCtx } from "../../shell/types";

export const SCENES_OPENED_KEY = "presentflow.scenes.opened.v1";
export const SCENE_BUILDER_EVENT = "presentflow:open-scenes-settings";

type ThemeRow = { id: string; name: string; config: Record<string, unknown> };

/** Plain-words summary of what a scene changes, for the chip tooltip. */
export function sceneSummary(s: SceneRecord): string {
  const cfg = sanitizeSceneConfig(s.config);
  const parts: string[] = [];
  for (const screen of SCENE_SCREENS) {
    const hidden = SCENE_LAYER_IDS.filter((l) => cfg.screens[screen]?.layers?.[l] === false)
      .map((l) => SCENE_LAYER_LABELS[l].toLowerCase());
    const theme = cfg.screens[screen]?.themeId ? "own theme" : null;
    const bits = [hidden.length ? `hides ${hidden.join(", ")}` : null, theme].filter(Boolean);
    if (bits.length) parts.push(`${SCENE_SCREEN_LABELS[screen]}: ${bits.join(" + ")}`);
  }
  return parts.length ? `${s.name} — ${parts.join(". ")}.` : `${s.name} — every screen as usual.`;
}

/** Church scenes + the 5 built-ins, and a themeId → appearance resolver. */
export function useSceneLibrary() {
  const [custom, setCustom] = useState<SceneRecord[]>([]);
  const [themes, setThemes] = useState<ThemeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [themesReady, setThemesReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await listScenes();
      if (res.ok && res.data) {
        setCustom(res.data.map((r) => ({ id: r.id, name: r.name, config: r.config as SceneRecord["config"], isBuiltIn: r.isBuiltIn, sortOrder: r.sortOrder })));
        setError(null);
      } else {
        // Never fail silently: without this the operator sees only the built-ins
        // and concludes their church's scenes were deleted.
        setError(res.ok ? null : res.error);
      }
    } catch {
      setError("Couldn't load your scenes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    let alive = true;
    fetch("/api/themes")
      .then((r) => r.json())
      .then((d: { themes?: ThemeRow[] }) => { if (alive) setThemes(d.themes ?? []); })
      .catch(() => {
        if (alive) toast.warning("Couldn't load themes — scenes will use your normal look.");
      })
      .finally(() => { if (alive) setThemesReady(true); });
    return () => { alive = false; };
  }, []);

  const resolveAppearance = useCallback((themeId: string) => {
    const t = themes.find((x) => x.id === themeId);
    if (!t) return null;
    try { return themeConfigToAppearance(t.config); } catch { return null; }
  }, [themes]);

  const scenes = useMemo(() => [...BUILT_IN_SCENES, ...custom], [custom]);
  return { scenes, custom, themes, themesReady, loading, error, resolveAppearance, refresh };
}

export function SceneRail({ ctx }: { ctx: OperatorShellCtx }) {
  const { scenes, themesReady, loading, error, resolveAppearance, refresh } = useSceneLibrary();
  const activeId = ctx.activeScene?.id ?? null;
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;
  const [focusId, setFocusId] = useState<string>("none");
  // Keep the single tab stop on the LIVE scene, so Tab lands where the operator
  // expects even when a scene was applied by an automation or the builder.
  useEffect(() => { setFocusId(activeIdRef.current ?? "none"); }, [ctx.activeScene?.id]);
  // ctx changes identity several times a second (audio state), so listeners read
  // it through a ref instead of re-subscribing at transcript rate.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const publish = useCallback((s: SceneRecord | null, opts?: { silent?: boolean }) => {
    const c = ctxRef.current;
    if (!s) { c.onSetScene(null); return; }
    const wire: SceneWire | null = sceneToWire(s, { rev: Date.now(), resolveAppearance });
    c.onSetScene(wire);
    if (!opts?.silent) try { window.localStorage.setItem(SCENES_OPENED_KEY, "1"); } catch { /* ignore */ }
  }, [resolveAppearance]);

  // Keep the live scene in step with its saved definition / newly-loaded themes,
  // WITHOUT churning the wire: only republish when the rebuilt wire differs.
  useEffect(() => {
    if (!activeId) return;
    const src = scenes.find((s) => s.id === activeId);
    if (!src) return;
    const next = sceneToWire(src, { rev: ctxRef.current.activeScene?.rev, resolveAppearance });
    const cur = ctxRef.current.activeScene;
    const same = JSON.stringify({ ...next, rev: 0 }) === JSON.stringify({ ...cur, rev: 0 });
    if (!same) ctxRef.current.onSetScene(next);
  }, [scenes, resolveAppearance, activeId]);

  useEffect(() => {
    const onChanged = () => { void refresh(); };
    window.addEventListener("presentflow:scenes-changed", onChanged);
    return () => window.removeEventListener("presentflow:scenes-changed", onChanged);
  }, [refresh]);

  // Automations / slide actions: apply a scene by id (engine SET_LOOK).
  useEffect(() => {
    const onApply = (e: Event) => {
      const id = (e as CustomEvent<{ sceneId?: string }>).detail?.sceneId;
      if (!id) return;
      if (id === "none") { ctxRef.current.onSetScene(null); return; }
      const src = scenes.find((s) => s.id === id);
      if (!src) { toast.error(`That automation points at a scene that no longer exists.`); return; }
      publish(src, { silent: true });
    };
    window.addEventListener("presentflow:apply-scene", onApply);
    return () => window.removeEventListener("presentflow:apply-scene", onApply);
  }, [scenes, publish]);

  /** Commit a scene to every screen, with an Undo back to the previous one. */
  const pick = useCallback((s: SceneRecord | null) => {
    const prev = ctxRef.current.activeScene;
    // Re-picking what is already live would republish (new rev) for no visible
    // change — and at key-repeat speed that floods every remote surface.
    if ((s?.id ?? null) === (prev?.id ?? null)) return;
    publish(s);
    toast.success(s ? `${s.name} is live on every screen` : "Scene cleared — every screen back to normal", {
      action: { label: "Undo", onClick: () => ctxRef.current.onSetScene(prev) },
    });
  }, [publish]);

  const options: (SceneRecord | null)[] = useMemo(() => [null, ...scenes], [scenes]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    // Enter/Space COMMIT the focused scene. Without stopPropagation the operator's
    // global hotkeys (window keydown: Enter = send preview LIVE, Space = next,
    // arrows = move the preview cursor) swallow these — pressing Enter on a chip
    // pushed the PREVIEW to the projector instead of switching scene.
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      // Read the LIVE focus, not just our roving state: a direct .focus() from
      // assistive tech / automation would otherwise commit the previous chip.
      const domId = (document.activeElement as HTMLElement | null)?.dataset?.sceneId;
      const id = domId ?? focusId;
      const target = id === "none" ? null : (options.find((o) => o?.id === id) ?? null);
      pick(target);
      return;
    }
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    e.stopPropagation(); // arrows must not also walk the operator's preview cursor
    if (e.repeat) return; // holding a key must never fire a burst of switches
    const i = options.findIndex((o) => (o?.id ?? "none") === focusId);
    const n = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1) + options.length) % options.length];
    const nid = n?.id ?? "none";
    setFocusId(nid);
    // Arrows MOVE FOCUS ONLY — committing is Enter/Space (the button's own
    // activation) or a click. Arrow-to-commit changed the projector on a stray
    // keypress.
    (document.querySelector(`[data-scene-id="${nid}"]`) as HTMLElement | null)?.focus();
  }, [options, focusId, pick]);

  const chipClass = (selected: boolean) =>
    `shrink-0 max-w-[120px] truncate h-9 px-2.5 rounded-full text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)] ${selected ? "bg-[var(--color-brand)] text-white font-semibold ring-1 ring-inset ring-white/40" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`;

  return (
    <div className="shrink-0 px-2 pb-2 space-y-1" data-tour="scene-rail">
      <div className="flex items-center gap-1">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Scene</span>
        <div className="flex flex-1 min-w-0 items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5" role="radiogroup" aria-label="Scene" onKeyDown={onKeyDown}>
          {/* None is PINNED (never scrolls away): the always-available way back. */}
          <button
            type="button"
            role="radio"
            aria-checked={activeId === null}
            tabIndex={focusId === "none" ? 0 : -1}
            data-scene-id="none"
            title="No scene — every screen shows everything as usual"
            onClick={() => { setFocusId("none"); pick(null); }}
            className={chipClass(activeId === null)}
          >
            None
          </button>
          <div className="flex flex-1 min-w-0 items-center gap-1 overflow-x-auto pf-transcript-scroll">
            {loading ? (
              <>
                <span className="shrink-0 h-9 w-16 rounded-full bg-[var(--color-elevated)] animate-pulse" aria-hidden />
                <span className="shrink-0 h-9 w-16 rounded-full bg-[var(--color-elevated)] animate-pulse" aria-hidden />
                <span className="sr-only">Loading scenes…</span>
              </>
            ) : (
              scenes.map((s) => {
                const selected = s.id === activeId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={focusId === s.id ? 0 : -1}
                    data-scene-id={s.id}
                    title={sceneSummary(s)}
                    onClick={() => { setFocusId(s.id); pick(s); }}
                    className={chipClass(selected)}
                  >
                    {s.name}
                  </button>
                );
              })
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => { try { window.dispatchEvent(new CustomEvent(SCENE_BUILDER_EVENT)); } catch { /* ignore */ } }}
          className="shrink-0 h-9 px-2 inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] text-[11px] font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]"
          title="See and edit what each scene shows"
          aria-label="See and edit what each scene shows"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden /> Edit
        </button>
      </div>
      {error && (
        <div className="flex items-center gap-2 text-[10px] text-[var(--color-destructive)]" role="status">
          <span className="truncate">Couldn&apos;t load your church&apos;s scenes.</span>
          <button type="button" onClick={() => { void refresh(); }} className="underline font-medium rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]">Retry</button>
        </div>
      )}
      {!themesReady && activeId && (
        <p className="text-[10px] text-[var(--color-muted-foreground)]">Loading your themes…</p>
      )}
    </div>
  );
}
