"use client";
/**
 * StageLayoutPanel — SCREENS FIRST (user-directed 2026-09-25).
 *
 * The brief: "first choose the stage screen they want to edit, then an Edit
 * Layout button or pencil — it will then show the edit slide screen."
 *
 * That is also ProPresenter's own order, confirmed by a ten-angle audit:
 * Renewed Vision teaches screens/hardware first, layout second, and their
 * Stage list row is screen name over assigned layout name with a thumbnail and
 * a pencil that opens Edit Layouts. It is also the answer to the most-reported
 * ProPresenter failure in the wild — the wrong thing on the wrong screen —
 * because the assignment is now the thing you look at, not a dropdown you have
 * to go find.
 *
 * WHAT DID NOT CHANGE, deliberately (CLAUDE.md rule 0):
 *  - one-tap "use this design", INCLUDING the zero-screen auto-create, so an
 *    operator who has never heard of a "stage screen" is still one tap away;
 *  - "Default (as it is today)" — the only route back to the legacy hardcoded
 *    stage screen, and the promise made to churches who never open this panel;
 *  - built-ins stay CODE and copy-on-edit, so restore-defaults always works;
 *  - every api capability stays reachable; the designs grid is demoted to a
 *    sub-view, not removed.
 */
import { useState } from "react";
import { Plus, Copy, Trash2, Pencil, X, Monitor, ChevronLeft, MonitorPlay } from "lucide-react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { StageLayoutsApi, StageLayoutEntry } from "./useStageLayouts";
import type { TimersApi } from "../hooks";
import { StageLayoutEditorModal } from "./StageLayoutEditorModal";
import { sampleText } from "./stageSample";
import { stageTextCss, type StageLayout } from "@/engine/stage";

const field = "h-7 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded text-[12px] w-full";

/** A miniature of a layout — a name alone ("Current + Timers 2") tells an
 *  operator nothing about what their monitor will show. */
function Thumb({ layout, className = "" }: { layout: StageLayout; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded border border-[var(--color-border)] ${className}`}
      style={{ background: layout.background, aspectRatio: "16 / 9", containerType: "size" }}>
      {layout.widgets.map((w) => (
        <div key={w.id} className="absolute flex items-center justify-center overflow-hidden"
          style={{
            left: `${w.rect.x * 100}%`, top: `${w.rect.y * 100}%`,
            width: `${w.rect.w * 100}%`, height: `${w.rect.h * 100}%`,
            color: w.color ?? "#ffffff",
            fontSize: stageTextCss(w),
            justifyContent: w.align === "left" ? "flex-start" : w.align === "right" ? "flex-end" : "center",
          }}>
          <span className="font-mono truncate leading-none opacity-90">{sampleText(w)}</span>
        </div>
      ))}
    </div>
  );
}

type SubView = null | "choose" | "manage";

export function StageLayoutPanel({ api, timers }: { api: StageLayoutsApi; timers: TimersApi }) {
  const { confirm, dialog } = useConfirm();
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [subView, setSubView] = useState<SubView>(null);
  const [editing, setEditing] = useState<{ layout: StageLayout; screenName: string | null; wasBuiltIn: boolean } | null>(null);

  const screenId = selectedScreenId ?? api.screens[0]?.id ?? null;
  const screen = api.screens.find((s) => s.id === screenId) ?? null;

  /**
   * The pencil. Opens the editor on THIS screen's layout.
   *
   * Three cases, none of them a dead button:
   *  - no layout yet  → make a blank one and assign it first;
   *  - a built-in     → copy it AND re-point the screen at the copy. Without
   *                     the re-point the operator edits, saves, and the monitor
   *                     does not change, which reads as total failure;
   *  - own layout     → straight in.
   */
  const openEditor = async (sc: { id: string; name: string; layoutId: string | null }) => {
    let id = sc.layoutId;
    let wasBuiltIn = false;

    if (!id) {
      const made = await api.createBlank(`${sc.name} layout`);
      if (!made) return;
      await api.assign(sc.id, made);
      id = made;
    } else if (api.byId(id)?.builtIn) {
      const copy = await api.duplicate(id);
      if (!copy) return;
      await api.assign(sc.id, copy);
      id = copy;
      wasBuiltIn = true;
    }

    await api.refresh();
    const l = api.byId(id);
    if (!l) return;
    setEditing({
      layout: { id: l.id, name: l.name, background: l.background, widgets: l.widgets.map((w) => ({ ...w, rect: { ...w.rect } })) },
      screenName: sc.name,
      wasBuiltIn,
    });
  };

  // ── the editor is a modal, so the panel stays mounted underneath ────────
  const editorModal = editing && (
    <StageLayoutEditorModal
      open
      layout={editing.layout}
      timers={timers}
      screenName={editing.screenName}
      isCopyOfBuiltIn={editing.wasBuiltIn}
      onClose={() => setEditing(null)}
      onSave={async (l) => { await api.save(l.id, l); setEditing(null); }}
    />
  );

  /* ── sub-view: choose a design for the selected screen ─────────────────── */
  if (subView === "choose" || subView === "manage") {
    const manage = subView === "manage";
    return (
      <>
        {dialog}{editorModal}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setSubView(null)} aria-label="Back"
              className="w-7 h-7 rounded border border-[var(--color-border)] flex items-center justify-center">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="eyebrow flex-1">{manage ? "Manage designs" : `Design for ${screen?.name ?? "the stage"}`}</div>
            <button onClick={async () => {
              const id = await api.createBlank();
              if (!id) return;
              await api.refresh();
              const l = api.byId(id);
              if (l) setEditing({ layout: { id: l.id, name: l.name, background: l.background, widgets: [] }, screenName: screen?.name ?? null, wasBuiltIn: false });
            }} className="flex items-center gap-1 text-[11px] text-[var(--color-brand)] hover:underline">
              <Plus className="w-3 h-3" /> New
            </button>
          </div>

          {api.loading ? (
            <div className="text-[11px] text-[var(--color-muted-foreground)]">Loading designs…</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {/* The way back to the stage screen we shipped before any of
                  this existed. Never remove it. */}
              {!manage && (
                <button onClick={async () => { if (screenId) { await api.assign(screenId, null); } setSubView(null); }}
                  className={`flex flex-col gap-1 rounded p-1 ${!screen?.layoutId ? "outline outline-2 outline-[var(--color-brand)]" : ""}`}>
                  <div className="rounded border border-dashed border-[var(--color-border)] aspect-video flex items-center justify-center text-[10px] text-[var(--color-muted-foreground)] px-2 text-center">
                    Default — as it is today
                  </div>
                  <span className="text-[11px]">Default</span>
                </button>
              )}
              {api.layouts.map((l) => (
                <div key={l.id} className="flex flex-col gap-1">
                  <button
                    onClick={async () => {
                      if (manage) return;
                      // One tap = on the screen. `use()` keeps the
                      // zero-screen auto-create; `assign` targets a chosen one.
                      if (screenId) await api.assign(screenId, l.id); else await api.use(l.id);
                      setSubView(null);
                    }}
                    aria-pressed={screen?.layoutId === l.id}
                    className={`rounded ${screen?.layoutId === l.id ? "outline outline-2 outline-[var(--color-brand)]" : "hover:opacity-90"}`}>
                    <Thumb layout={l} />
                  </button>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] truncate flex-1" title={l.name}>{l.name}</span>
                    {l.builtIn && <span className="text-[9px] uppercase tracking-wider text-[var(--color-muted-foreground)]">Built in</span>}
                  </div>
                  {manage && !l.builtIn && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => api.duplicate(l.id)} aria-label={`Duplicate ${l.name}`} title="Duplicate"
                        className="flex-1 h-6 rounded border border-[var(--color-border)] flex items-center justify-center">
                        <Copy className="w-3 h-3" />
                      </button>
                      <button onClick={async () => {
                        const live = api.screens.some((s) => s.layoutId === l.id);
                        if (await confirm({
                          title: `Delete "${l.name}"?`,
                          description: live ? "It is on a stage screen right now — that screen will go back to the default display." : undefined,
                          confirmLabel: "Delete", danger: true,
                        })) api.remove(l.id);
                      }} aria-label={`Delete ${l.name}`} title="Delete"
                        className="flex-1 h-6 rounded border border-[var(--color-border)] flex items-center justify-center text-[var(--color-destructive)]">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!manage && (
            <button onClick={() => setSubView("manage")}
              className="text-[11px] text-[var(--color-muted-foreground)] hover:underline text-left">
              Manage designs…
            </button>
          )}
        </div>
      </>
    );
  }

  /* ── main view: the screens ────────────────────────────────────────────── */
  return (
    <>
      {dialog}{editorModal}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="eyebrow">Stage screens</div>
          <button onClick={() => api.addScreen(`Stage ${api.screens.length + 1}`)}
            className="flex items-center gap-1 text-[11px] text-[var(--color-brand)] hover:underline">
            <Plus className="w-3 h-3" /> Add screen
          </button>
        </div>

        {api.screens.length === 0 ? (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">
              No stage screens set up. Your stage display keeps working exactly as it does now — add one only if you want to design what it shows.
            </div>
            <button onClick={() => api.addScreen("Stage 1")}
              className="h-8 rounded bg-[var(--color-brand)] text-black font-semibold text-[11px]">
              Set up a stage screen
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {api.screens.map((sc) => {
              const l = sc.layoutId ? api.byId(sc.layoutId) : null;
              const isSel = sc.id === screenId;
              const live = api.activeLayoutId === sc.layoutId && !!sc.layoutId;
              return (
                <div key={sc.id}
                  className={`rounded border p-2 flex flex-col gap-2 ${isSel ? "border-[var(--color-brand)]" : "border-[var(--color-border)]"}`}>
                  <button onClick={() => setSelectedScreenId(sc.id)} className="flex items-center gap-2 text-left">
                    <div className="w-16 shrink-0">
                      {l ? <Thumb layout={l} /> : (
                        <div className="rounded border border-dashed border-[var(--color-border)] aspect-video flex items-center justify-center">
                          <Monitor className="w-3 h-3 text-[var(--color-muted-foreground)]" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium truncate flex items-center gap-1">
                        {sc.name}
                        {live && (
                          <span className="px-1 py-0.5 rounded bg-[var(--color-brand)] text-black text-[8px] font-bold uppercase tracking-wider flex items-center gap-0.5">
                            <MonitorPlay className="w-2.5 h-2.5" /> On stage
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--color-muted-foreground)] truncate">
                        {l ? l.name : "Default — as it is today"}
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); void openEditor({ id: sc.id, name: sc.name, layoutId: sc.layoutId }); }}
                      aria-label={`Edit the layout on ${sc.name}`} title="Edit layout"
                      className="w-7 h-7 rounded border border-[var(--color-border)] flex items-center justify-center shrink-0">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </button>

                  {isSel && (
                    <div className="flex items-center gap-1">
                      <input value={sc.name} onChange={(e) => api.renameScreen(sc.id, e.target.value)}
                        aria-label="Screen name" className={field} />
                      <button onClick={async () => {
                        if (await confirm({ title: `Remove "${sc.name}"?`, confirmLabel: "Remove", danger: true })) api.removeScreen(sc.id);
                      }} aria-label={`Remove ${sc.name}`}
                        className="w-7 h-7 shrink-0 rounded border border-[var(--color-border)] flex items-center justify-center text-[var(--color-destructive)]">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button onClick={() => setSubView("choose")}
          className="h-8 rounded border border-[var(--color-border)] text-[11px] font-medium">
          Choose a different design ▸
        </button>
      </div>
    </>
  );
}
