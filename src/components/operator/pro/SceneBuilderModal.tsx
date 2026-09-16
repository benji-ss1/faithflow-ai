"use client";
/**
 * SceneBuilderModal (2026-09-16) — the [layers × screens] matrix (spec §22.2
 * "Scene Builder"), plus a per-screen theme override.
 *
 * Rows are layers, columns are screens, each cell is on/off — exactly the shape
 * FEATURE_BIBLE §8 asks for. A cell OFF means "this screen doesn't show this
 * layer"; ON means "leave it as the operator has it" (a scene never force-shows
 * something the operator cleared — that rule lives in resolveLayeredInput).
 *
 * Built-ins are read-only and clone into an editable church scene. Saving writes
 * through the church-scoped server actions; nothing here touches live output
 * except the explicit "Make live" button.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, SlidersHorizontal, Copy, Trash2, Check, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { createScene, updateScene, deleteScene } from "@/lib/actions";
import {
  SCENE_SCREENS, SCENE_SCREEN_LABELS, SCENE_LAYER_IDS, SCENE_LAYER_LABELS,
  sanitizeSceneConfig, sceneToWire,
  type SceneConfig, type SceneLayerId, type SceneRecord, type SceneScreen,
} from "@/lib/scenes";
import type { OperatorShellCtx } from "../shell/types";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useSceneLibrary, SCENE_BUILDER_EVENT } from "./right/SceneRail";

/** Cell state: true/absent = shown (no change), false = hidden on this screen. */
function isShown(cfg: SceneConfig, screen: SceneScreen, layer: SceneLayerId): boolean {
  return cfg.screens[screen]?.layers?.[layer] !== false;
}
function toggle(cfg: SceneConfig, screen: SceneScreen, layer: SceneLayerId): SceneConfig {
  const next: SceneConfig = { screens: { ...cfg.screens } };
  const entry = { ...(next.screens[screen] ?? {}) };
  const layers = { ...(entry.layers ?? {}) };
  if (layers[layer] === false) delete layers[layer]; else layers[layer] = false;
  entry.layers = Object.keys(layers).length ? layers : undefined;
  next.screens[screen] = entry;
  return sanitizeSceneConfig(next);
}
function setThemeFor(cfg: SceneConfig, screen: SceneScreen, themeId: string | null): SceneConfig {
  const next: SceneConfig = { screens: { ...cfg.screens } };
  const entry = { ...(next.screens[screen] ?? {}) };
  entry.themeId = themeId ?? undefined;
  next.screens[screen] = entry;
  return sanitizeSceneConfig(next);
}

export function SceneBuilderModal({ ctx, open, onClose }: { ctx: OperatorShellCtx; open: boolean; onClose: () => void }) {
  const { scenes, custom, themes, resolveAppearance, refresh } = useSceneLibrary();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; config: SceneConfig } | null>(null);
  const [busy, setBusy] = useState(false);
  // Unsaved-work guards (review 🔴): "Make live" used to publish a draft that was
  // never saved — it then silently reverted when the rail re-derived the wire
  // from the SAVED record. Now the draft is tracked, Save is the primary action,
  // and switching scene / closing warns before discarding.
  const { confirm, dialog } = useConfirm();

  const selected = useMemo(() => scenes.find((s) => s.id === selectedId) ?? null, [scenes, selectedId]);
  const dirty = useMemo(() => {
    if (!selected || !draft || selected.isBuiltIn) return false;
    return draft.name !== selected.name
      || JSON.stringify(draft.config) !== JSON.stringify(sanitizeSceneConfig(selected.config));
  }, [selected, draft]);
  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return confirm({
      title: "Discard your changes?",
      description: "This scene has changes you haven't saved yet.",
      confirmLabel: "Discard",
      cancelLabel: "Keep editing",
      danger: true,
    });
  }, [dirty, confirm]);

  useEffect(() => {
    if (!open) return;
    setSelectedId((cur) => cur ?? ctx.activeScene?.id ?? scenes[0]?.id ?? null);
  }, [open, ctx.activeScene, scenes]);

  useEffect(() => {
    if (!selected) { setDraft(null); return; }
    setDraft({ name: selected.name, config: sanitizeSceneConfig(selected.config) });
  }, [selected]);

  const announce = () => { try { window.dispatchEvent(new CustomEvent("presentflow:scenes-changed")); } catch { /* ignore */ } };

  const save = useCallback(async () => {
    if (!selected || !draft || selected.isBuiltIn) return;
    setBusy(true);
    const res = await updateScene(selected.id, { name: draft.name, config: draft.config as unknown as Record<string, unknown> });
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success("Scene saved");
    announce(); void refresh();
  }, [selected, draft, refresh]);

  const clone = useCallback(async () => {
    if (!draft) return;
    setBusy(true);
    const res = await createScene({ name: `${draft.name} copy`, config: draft.config as unknown as Record<string, unknown> });
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success("Scene created");
    announce(); await refresh();
    if (res.data?.id) setSelectedId(res.data.id);
  }, [draft, refresh]);

  const remove = useCallback(async () => {
    if (!selected || selected.isBuiltIn) return;
    const ok = await confirm({
      title: `Delete "${selected.name}"?`,
      description: "This removes it for everyone in your church. It can't be undone.",
      confirmLabel: "Delete scene",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await deleteScene(selected.id);
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return; }
    // Never leave the projector on a scene that no longer exists.
    if (ctx.activeScene?.id === selected.id) ctx.onSetScene(null);
    toast.success("Scene deleted");
    setSelectedId(null);
    announce(); void refresh();
  }, [selected, ctx, refresh, confirm]);

  const makeLive = useCallback(async () => {
    if (!selected || !draft) return;
    // Save first when there are unsaved edits, so what goes live is what is
    // stored — otherwise the rail would quietly revert it moments later.
    if (dirty) {
      setBusy(true);
      const res = await updateScene(selected.id, { name: draft.name, config: draft.config as unknown as Record<string, unknown> });
      setBusy(false);
      if (!res.ok) { toast.error(res.error); return; }
      announce(); void refresh();
    }
    ctx.onSetScene(sceneToWire({ id: selected.id, name: draft.name, config: draft.config }, { rev: Date.now(), resolveAppearance }));
    toast.success(`${draft.name} is live on every screen`);
  }, [selected, draft, ctx, resolveAppearance, dirty, refresh]);

  const createNew = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    setBusy(true);
    const res = await createScene({ name: "New scene", config: { screens: {} } });
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return; }
    announce(); await refresh();
    if (res.data?.id) setSelectedId(res.data.id);
    toast.success("New scene created — tick or hide what each screen shows");
  }, [confirmDiscard, refresh]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (next) return; void (async () => { if (await confirmDiscard()) onClose(); })(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70]" style={{ background: "rgba(0,0,0,0.6)" }} />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 m-auto z-[71] h-fit max-h-[82vh] w-[94vw] max-w-[920px] flex flex-col rounded-xl overflow-hidden border shadow-2xl outline-none"
          style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}
        >
          <header className="h-12 shrink-0 flex items-center gap-2 px-4 border-b" style={{ borderColor: "var(--color-border)", background: "var(--color-elevated)" }}>
            <SlidersHorizontal className="w-4 h-4 text-[var(--color-brand)]" />
            <Dialog.Title className="text-[13px] font-semibold text-[var(--color-foreground)]">Scenes</Dialog.Title>
            <span className="text-[11px] text-[var(--color-muted-foreground)]">— choose what each screen shows</span>
            <button
              onClick={() => { void (async () => { if (await confirmDiscard()) onClose(); })(); }}
              className="ml-auto grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted-foreground)] hover:bg-white/[0.06] hover:text-[var(--color-foreground)]"
              aria-label="Close scenes"
            >
              <X className="w-4 h-4" />
            </button>
          </header>

          <div className="flex-1 min-h-0 flex">
            {/* Scene list */}
            <aside className="w-[200px] shrink-0 border-r overflow-y-auto pf-transcript-scroll" style={{ borderColor: "var(--color-border)" }}>
              {scenes.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { void (async () => { if (await confirmDiscard()) setSelectedId(s.id); })(); }}
                  className={`w-full text-left px-3 py-2 text-[12px] border-b truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)] ${selectedId === s.id ? "bg-[var(--color-brand)]/15 text-[var(--color-foreground)] font-semibold" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
                  style={{ borderColor: "var(--color-border)" }}
                >
                  {s.name}
                  {s.isBuiltIn && <span className="ml-1 text-[10px] text-[var(--color-muted-foreground)]">built-in</span>}
                  {ctx.activeScene?.id === s.id && <span className="ml-1 text-[10px] text-[var(--color-brand)]">live</span>}
                </button>
              ))}
              <button
                type="button"
                onClick={createNew}
                disabled={busy}
                className="w-full text-left px-3 py-2 text-[12px] font-medium text-[var(--color-brand)] hover:bg-[var(--color-brand)]/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]"
              >
                + New scene
              </button>
              {custom.length === 0 && (
                <p className="p-3 text-[11px] text-[var(--color-muted-foreground)]">
                  Your church hasn&apos;t made any scenes yet. Press New scene above, or pick a built-in and press Duplicate.
                </p>
              )}
            </aside>

            {/* Matrix */}
            <div className="flex-1 min-w-0 overflow-auto p-4 pf-transcript-scroll">
              {!draft || !selected ? (
                <p className="text-[12px] text-[var(--color-muted-foreground)]">Pick a scene on the left to see what it shows on each screen.</p>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 120) })}
                      disabled={selected.isBuiltIn}
                      aria-label="Scene name"
                      className="h-8 px-2 rounded-md border bg-transparent text-[13px] font-semibold text-[var(--color-foreground)] disabled:opacity-60"
                      style={{ borderColor: "var(--color-border)" }}
                    />
                    {selected.isBuiltIn && <span className="text-[11px] text-[var(--color-muted-foreground)]">Built-in scenes can&apos;t be changed — use Duplicate.</span>}
                  </div>

                  <p className="mb-2 flex items-center gap-3 text-[11px] text-[var(--color-muted-foreground)]">
                    <span className="inline-flex items-center gap-1"><Check className="w-3.5 h-3.5 text-[var(--color-brand)]" aria-hidden /> shown as usual</span>
                    <span className="inline-flex items-center gap-1"><EyeOff className="w-3.5 h-3.5" aria-hidden /> hidden on that screen</span>
                    {dirty && <span className="ml-auto rounded px-1.5 py-0.5 bg-amber-500/15 text-amber-200 [html.light_&]:bg-amber-100 [html.light_&]:text-amber-900">Unsaved</span>}
                  </p>
                  <table className="w-full text-[12px] border-collapse">
                    <caption className="sr-only">Which layers each screen shows</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="text-left font-medium text-[var(--color-muted-foreground)] p-2">Shows on…</th>
                        {SCENE_SCREENS.map((sc) => (
                          <th key={sc} scope="col" className="font-medium text-[var(--color-muted-foreground)] p-2">{SCENE_SCREEN_LABELS[sc]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {SCENE_LAYER_IDS.map((layer) => (
                        <tr key={layer} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                          <th scope="row" className="text-left font-normal text-[var(--color-foreground)] p-2">{SCENE_LAYER_LABELS[layer]}</th>
                          {SCENE_SCREENS.map((sc) => {
                            const shown = isShown(draft.config, sc, layer);
                            return (
                              <td key={sc} className="p-1 text-center">
                                <button
                                  type="button"
                                  aria-pressed={shown}
                                  aria-label={`${SCENE_LAYER_LABELS[layer]} on ${SCENE_SCREEN_LABELS[sc]}: ${shown ? "shown" : "hidden"}`}
                                  disabled={selected.isBuiltIn}
                                  onClick={() => setDraft({ ...draft, config: toggle(draft.config, sc, layer) })}
                                  className={`h-10 w-10 grid place-items-center rounded-md border disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)] ${shown ? "bg-[var(--color-brand)]/20 border-[var(--color-brand)] text-[var(--color-foreground)]" : "bg-[var(--color-destructive)]/10 border-[var(--color-destructive)]/40 text-[var(--color-muted-foreground)]"}`}
                                >
                                  {shown ? <Check className="w-4 h-4" aria-hidden /> : <EyeOff className="w-4 h-4" aria-hidden />}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      <tr className="border-t" style={{ borderColor: "var(--color-border)" }}>
                        <th scope="row" className="text-left font-normal text-[var(--color-foreground)] p-2">Theme</th>
                        {SCENE_SCREENS.map((sc) => (
                          <td key={sc} className="p-1 text-center">
                            <select
                              aria-label={`Theme for ${SCENE_SCREEN_LABELS[sc]}`}
                              disabled={selected.isBuiltIn}
                              value={draft.config.screens[sc]?.themeId ?? ""}
                              onChange={(e) => setDraft({ ...draft, config: setThemeFor(draft.config, sc, e.target.value || null) })}
                              className="h-8 max-w-[120px] rounded-md border bg-transparent text-[11px] px-1 text-[var(--color-foreground)] disabled:opacity-50"
                              style={{ borderColor: "var(--color-border)" }}
                            >
                              <option value="">Same as usual</option>
                              {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>

                  <p className="mt-3 text-[11px] text-[var(--color-muted-foreground)]">
                    A tick means that screen shows the layer as usual. A dash hides it on that screen only.
                    Scenes never change what is playing, and they never override a layer you have cleared yourself.
                  </p>
                </>
              )}
            </div>
          </div>

          <footer className="h-12 shrink-0 flex items-center gap-2 px-4 border-t" style={{ borderColor: "var(--color-border)", background: "var(--color-elevated)" }}>
            <button
              type="button"
              onClick={save}
              disabled={!selected || selected.isBuiltIn || busy || !dirty}
              className="h-9 px-3 rounded-md text-[12px] font-semibold bg-[var(--color-brand)] text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { void makeLive(); }}
              disabled={!selected || busy}
              className="h-9 px-3 rounded-md border text-[12px] font-medium text-[var(--color-foreground)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
              style={{ borderColor: "var(--color-border)" }}
              title="Show this scene on every screen now"
            >
              Make live
            </button>
            <button
              type="button"
              onClick={clone}
              disabled={!draft || busy}
              className="h-9 px-3 inline-flex items-center gap-1 rounded-md border text-[12px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
              style={{ borderColor: "var(--color-border)" }}
            >
              <Copy className="w-3.5 h-3.5" aria-hidden /> Duplicate
            </button>

            <button
              type="button"
              onClick={remove}
              disabled={!selected || selected.isBuiltIn || busy}
              className="ml-auto h-9 px-3 inline-flex items-center gap-1 rounded-md border text-[12px] text-[var(--color-destructive)] [html.light_&]:text-[#c62828] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-destructive)]"
              style={{ borderColor: "var(--color-border)" }}
              title="Deleting removes this scene for everyone in your church"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden /> Delete
            </button>
          </footer>
          {dialog}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Mounts the builder and opens it on the Scene Rail's event. */
export function SceneBuilderHost({ ctx }: { ctx: OperatorShellCtx }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(SCENE_BUILDER_EVENT, on);
    return () => window.removeEventListener(SCENE_BUILDER_EVENT, on);
  }, []);
  if (!ctx.scenesUiOn || !open) return null; // lazy: no duplicate scene/theme fetches while closed
  return <SceneBuilderModal ctx={ctx} open onClose={() => setOpen(false)} />;
}
