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
import { useEffect, useState } from "react";
import { Plus, Copy, Trash2, Pencil, X, Monitor, ChevronLeft, MonitorPlay } from "lucide-react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { StageLayoutsApi, StageLayoutEntry } from "./useStageLayouts";
import type { TimersApi } from "../hooks";
import { StageLayoutEditorModal } from "./StageLayoutEditorModal";
import { sampleText } from "./stageSample";
import { stageTextCss, type StageLayout } from "@/engine/stage";
import { dispatchInternal } from "@/lib/internal-events";

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

/** A screen name that only reaches the server when the operator has finished
 *  typing. */
function ScreenNameInput({ name, onCommit }: { name: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(name);
  useEffect(() => { setV(name); }, [name]);
  const commit = () => { const t = v.trim(); if (t && t !== name) onCommit(t); else setV(name); };
  return (
    <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.stopPropagation(); setV(name); } }}
      aria-label="Screen name" className={field} />
  );
}

export function StageLayoutPanel({ api, timers }: { api: StageLayoutsApi; timers: TimersApi }) {
  const { confirm, dialog } = useConfirm();
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [subView, setSubView] = useState<SubView>(null);
  const [editing, setEditing] = useState<{
    layout: StageLayout;
    screenName: string | null;
    wasBuiltIn: boolean;
    /** Assign this layout to this screen ONLY once it has saved. Assigning up
     *  front is what blanked a live monitor the moment the pencil was tapped. */
    assignTo: string | null;
    /** Whether that screen is showing something right now, so the editor can
     *  say so — an operator cannot otherwise tell from inside the modal. */
    screenIsLive: boolean;
  } | null>(null);

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
    // NEVER read back through `api.byId` after an await. `api` is the object
    // from THIS render and `byId` closes over that render's `layouts`, so a
    // row created moments ago is not in it — `byId(newId)` returns null and
    // the pencil silently does nothing. That killed the blank and built-in
    // branches outright and made "New design" unreachable. Build the draft
    // from what we already hold instead.
    const source = sc.layoutId ? api.byId(sc.layoutId) : null;
    const blank = (id: string): StageLayout => ({ id, name: `${sc.name} layout`, background: "#000000", widgets: [] });

    if (!sc.layoutId) {
      const made = await api.createBlank(`${sc.name} layout`);
      if (!made) return;
      // DO NOT ASSIGN YET. This screen is on "Default", which is a real,
      // working stage display. An empty layout renders black, and /stage
      // REPLACES the default screen the instant one is assigned — so
      // assigning here turned the monitor black the moment the operator
      // tapped the pencil to look, and discarding did not put it back.
      setEditing({ layout: blank(made), screenName: sc.name, wasBuiltIn: false, assignTo: sc.id, screenIsLive: false });
      return;
    }

    if (source?.builtIn) {
      const copy = await api.duplicate(sc.layoutId);
      if (!copy) return;
      // The copy is the built-in's content under a new id. Naming it "X (yours)"
      // matters: without it the screen row and the design grid both read
      // "Current + Next" and the operator cannot tell which one is theirs.
      setEditing({
        layout: {
          id: copy, name: `${source.name} (yours)`, background: source.background,
          widgets: source.widgets.map((w) => ({ ...w, rect: { ...w.rect } })),
        },
        screenName: sc.name,
        wasBuiltIn: true,
        assignTo: sc.id,
        screenIsLive: true,
      });
      return;
    }

    if (!source) return;
    setEditing({
      layout: { id: source.id, name: source.name, background: source.background, widgets: source.widgets.map((w) => ({ ...w, rect: { ...w.rect } })) },
      screenName: sc.name,
      wasBuiltIn: false,
      assignTo: null, // already assigned; nothing to do on save
      screenIsLive: true,
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
      screenIsLive={editing.screenIsLive}
      onClose={() => setEditing(null)}
      // Only close when it actually saved. Closing regardless threw away every
      // widget the operator had just placed whenever the action refused. The
      // screen is pointed at the layout HERE, after a successful save, so a
      // discarded design never reaches a monitor.
      onSave={async (l) => {
        if (!(await api.save(l.id, l))) return;
        if (editing.assignTo) await api.assign(editing.assignTo, l.id);
        // Saving a layout that is ALREADY on its screen takes the assign
        // branch above, so without this an operator who cleared everything and
        // then simply edited and saved stayed latched with no visible cause.
        // Saving IS an intent to show it.
        else dispatchInternal("presentflow:stage-layout-assigned");
        setEditing(null);
      }}
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
              // Same stale-closure trap as openEditor — build the draft from
              // the id we just got, never by reading back through `api`.
              const id = await api.createBlank();
              if (!id) return;
              setEditing({
                layout: { id, name: "My layout", background: "#000000", widgets: [] },
                screenName: screen?.name ?? null, wasBuiltIn: false,
                assignTo: null, screenIsLive: false,
              });
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
            {/* Straight to the designs. The old CTA made a screen with NO
                layout, which dropped a first-time operator into a blank canvas
                — the opposite of fast for the exact person this copy is for. */}
            <button onClick={() => setSubView("choose")}
              className="h-8 rounded bg-[var(--color-brand)] text-black font-semibold text-[11px]">
              Set up a stage screen
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {api.screens.map((sc) => {
              const l = sc.layoutId ? api.byId(sc.layoutId) : null;
              const isSel = sc.id === screenId;
              // A screen with a layout IS showing it. Comparing against
              // activeLayoutId (= screens[0]) made the badge mean "same layout
              // as screen 1", so screen 2 never lit up.
              const live = !!sc.layoutId;
              return (
                <div key={sc.id}
                  className={`rounded border p-2 flex flex-col gap-2 ${isSel ? "border-[var(--color-brand)]" : "border-[var(--color-border)]"}`}>
                  {/* A DIV, not a button. This row used to be a <button> with
                      the pencil <button> INSIDE it — invalid HTML, and its
                      activation depended on React's synthetic bubbling rather
                      than the DOM. Safari's accessibility tree also collapses
                      nested interactive elements. */}
                  <div className="flex items-center gap-2 text-left">
                    <div className="w-16 shrink-0">
                      {l ? <Thumb layout={l} /> : (
                        <div className="rounded border border-dashed border-[var(--color-border)] aspect-video flex items-center justify-center">
                          <Monitor className="w-3 h-3 text-[var(--color-muted-foreground)]" />
                        </div>
                      )}
                    </div>
                    <button onClick={() => setSelectedScreenId(sc.id)}
                      aria-pressed={isSel} aria-label={`Select ${sc.name}`}
                      className="min-w-0 flex-1 text-left">
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
                    </button>
                    <button onClick={() => { void openEditor({ id: sc.id, name: sc.name, layoutId: sc.layoutId }); }}
                      aria-label={`Edit the layout on ${sc.name}`} title="Edit layout"
                      className="w-9 h-9 rounded border border-[var(--color-border)] flex items-center justify-center shrink-0">
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>

                  {isSel && (
                    <div className="flex items-center gap-1">
                      {/* Local buffer, written on blur/Enter. This used to fire
                          a server action AND a full refresh on every keystroke
                          — 15 mutations and 30 fetches to type "Drummer
                          monitor", with out-of-order responses able to rewrite
                          the field mid-typing. */}
                      <ScreenNameInput name={sc.name} onCommit={(v) => api.renameScreen(sc.id, v)} />
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
          {api.screens.some((s2) => s2.layoutId) ? "Choose a different design ▸" : "Choose a design ▸"}
        </button>
      </div>
    </>
  );
}
