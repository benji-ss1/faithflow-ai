"use client";
/**
 * StageLayoutPanel — the Stage Layout editor (ProPresenter's Screens > Edit
 * Layouts, Ctrl+4), 2026-09-21.
 *
 * Built as its OWN editor rather than folded into Scenes (user-directed: copy
 * ProPresenter's separate editor 1:1 — see docs/PP7_TIMERS_PLAN.md).
 *
 * Three sections, top to bottom, matching how an operator actually thinks:
 *   1. Stage screens  — which layout each confidence monitor is showing
 *   2. Layouts        — the named, thumbnailed preset list (built-ins + yours)
 *   3. Editor         — what the selected layout is built from
 *
 * Built-ins are code, never rows: picking Edit on one DUPLICATES it into an
 * editable copy, so "restore defaults" always works. ProPresenter gives you no
 * way back once you have edited a starter layout.
 */
import { useState } from "react";
import { Plus, Copy, Trash2, Pencil, Check, X, Monitor, ChevronLeft, MonitorPlay } from "lucide-react";
import { StageCanvas } from "./StageCanvas";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { StageLayoutsApi, StageLayoutEntry } from "./useStageLayouts";
import type { TimersApi } from "../hooks";
import {
  STAGE_WIDGET_KINDS, STAGE_WIDGET_LABELS, STAGE_MAX_WIDGETS, clampRect, stageTextCss,
  type StageLayout, type StageWidget, type StageWidgetKind,
} from "@/engine/stage";

const field = "h-7 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded text-[12px] w-full";
const label = "text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]";

/** Placement presets — the "where do we want it" question as one click each,
 *  rather than making an operator type coordinates. Free x/y stays available
 *  underneath for anyone who wants it. */
const PLACEMENTS: Array<{ id: string; label: string; rect: { x: number; y: number; w: number; h: number } }> = [
  { id: "full", label: "Full screen", rect: { x: 0.05, y: 0.2, w: 0.9, h: 0.6 } },
  { id: "upper", label: "Upper third", rect: { x: 0.05, y: 0.04, w: 0.9, h: 0.28 } },
  { id: "middle", label: "Middle", rect: { x: 0.05, y: 0.36, w: 0.9, h: 0.28 } },
  { id: "lower", label: "Lower third", rect: { x: 0.05, y: 0.68, w: 0.9, h: 0.28 } },
  { id: "tl", label: "Top left", rect: { x: 0.04, y: 0.04, w: 0.42, h: 0.2 } },
  { id: "tr", label: "Top right", rect: { x: 0.54, y: 0.04, w: 0.42, h: 0.2 } },
  { id: "bl", label: "Bottom left", rect: { x: 0.04, y: 0.76, w: 0.42, h: 0.2 } },
  { id: "br", label: "Bottom right", rect: { x: 0.54, y: 0.76, w: 0.42, h: 0.2 } },
];

/** What a widget SHOWS while designing. One function, used by both the
 *  thumbnails and the drag canvas, so the small picture and the thing you edit
 *  can never disagree about what a box is. */
function sampleText(w: StageWidget): string {
  switch (w.kind) {
    case "timer": return "0:00";
    case "clock": return "12:00";
    case "current_text": return "Words";
    case "next_text": return "Next";
    case "static_text": return w.text || "Text";
    default: return STAGE_WIDGET_LABELS[w.kind];
  }
}

/** A miniature of a layout — ProPresenter's list is thumbnailed, and a name
 *  alone ("Current + Timers 2") tells an operator nothing. */
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

export function StageLayoutPanel({ api, timers }: { api: StageLayoutsApi; timers: TimersApi }) {
  const { confirm, dialog } = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StageLayout | null>(null);

  /** Start from blank. Previously the ONLY way to make your own was to copy a
   *  built-in, so "create one" was never actually offered. */
  const newLayout = async () => {
    const id = await api.createBlank();
    if (!id) return;
    await api.refresh();
    setEditingId(id);
    setDraft({ id, name: "My layout", background: "#000000", widgets: [] });
  };

  const openEditor = async (l: StageLayoutEntry) => {
    // Editing a built-in duplicates it first — built-ins are code, not rows.
    if (l.builtIn) {
      const id = await api.duplicate(l.id);
      if (!id) return;
      await api.refresh();
      setEditingId(id);
      setDraft({ ...l, id, name: l.name });
      return;
    }
    setEditingId(l.id);
    setDraft({ id: l.id, name: l.name, background: l.background, widgets: l.widgets.map((w) => ({ ...w, rect: { ...w.rect } })) });
  };

  if (editingId && draft) {
    return (
      <>
        {dialog}
        <LayoutEditor
          draft={draft} setDraft={setDraft} timers={timers}
          onBack={() => { setEditingId(null); setDraft(null); }}
          onSave={async () => { await api.save(editingId, draft); setEditingId(null); setDraft(null); }}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {dialog}

      {/* ── 1. Stage screens ─────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="eyebrow">Stage screens</div>
          <button onClick={() => api.addScreen(`Stage ${api.screens.length + 1}`)}
            className="flex items-center gap-1 text-[11px] text-[var(--color-brand)] hover:underline">
            <Plus className="w-3 h-3" /> Add screen
          </button>
        </div>
        {api.screens.length === 0 ? (
          <div className="text-[11px] text-[var(--color-muted-foreground)]">
            No stage screens set up. Your stage display keeps working exactly as it does now — add one only if you want to design what it shows.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {api.screens.map((sc) => (
              <div key={sc.id} className="rounded border border-[var(--color-border)] p-2 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Monitor className="w-3.5 h-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
                  <input value={sc.name} onChange={(e) => api.renameScreen(sc.id, e.target.value)}
                    aria-label="Screen name" className="flex-1 bg-transparent text-[12px] font-medium outline-none" />
                  <button onClick={async () => {
                    if (await confirm({ title: `Remove "${sc.name}"?`, confirmLabel: "Remove", danger: true })) api.removeScreen(sc.id);
                  }} aria-label={`Remove ${sc.name}`}
                    className="w-6 h-6 rounded border border-[var(--color-border)] flex items-center justify-center text-[var(--color-destructive)]">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {/* The "what does this screen show" dropdown. */}
                <select value={sc.layoutId ?? ""} onChange={(e) => api.assign(sc.id, e.target.value || null)} className={field}>
                  <option value="">Default (as it is today)</option>
                  {api.layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                {sc.layoutId && api.byId(sc.layoutId) && (
                  <Thumb layout={api.byId(sc.layoutId)!} className="w-full" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 2. Layouts ───────────────────────────────────────────────────── */}
      <div className="border-t border-[var(--color-border)] pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="eyebrow">Layouts</div>
          <button onClick={newLayout}
            className="flex items-center gap-1 text-[11px] text-[var(--color-brand)] hover:underline">
            <Plus className="w-3 h-3" /> New layout
          </button>
        </div>
        <div className="text-[10px] text-[var(--color-muted-foreground)] mb-2">
          Tap a design to put it on the stage screen.
        </div>
        {api.loading ? (
          <div className="text-[11px] text-[var(--color-muted-foreground)]">Loading layouts…</div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {api.layouts.map((l) => (
              <div key={l.id} className="flex flex-col gap-1">
                {/* THE WHOLE THUMBNAIL IS THE BUTTON. Choosing a design is the
                    single most common thing done here, and it used to be
                    impossible without first understanding that a "stage
                    screen" is a separate object you have to create. */}
                <button onClick={() => api.use(l.id)} aria-pressed={api.activeLayoutId === l.id}
                  title={api.activeLayoutId === l.id ? `${l.name} is on the stage screen` : `Put "${l.name}" on the stage screen`}
                  className={`relative rounded ${api.activeLayoutId === l.id
                    ? "outline outline-2 outline-[var(--color-brand)]" : "hover:opacity-90"}`}>
                  <Thumb layout={l} />
                  {api.activeLayoutId === l.id && (
                    <span className="absolute top-1 left-1 px-1 py-0.5 rounded bg-[var(--color-brand)] text-black text-[8px] font-bold uppercase tracking-wider flex items-center gap-0.5">
                      <MonitorPlay className="w-2.5 h-2.5" /> On stage
                    </span>
                  )}
                </button>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] truncate flex-1" title={l.name}>{l.name}</span>
                  {l.builtIn && <span className="text-[9px] uppercase tracking-wider text-[var(--color-muted-foreground)]">Built in</span>}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEditor(l)} title={l.builtIn ? "Make an editable copy" : "Edit"}
                    className="flex-1 h-6 rounded border border-[var(--color-border)] text-[10px] flex items-center justify-center gap-1">
                    <Pencil className="w-3 h-3" /> {l.builtIn ? "Copy & edit" : "Edit"}
                  </button>
                  {!l.builtIn && (
                    <>
                      <button onClick={() => api.duplicate(l.id)} aria-label={`Duplicate ${l.name}`} title="Duplicate"
                        className="w-6 h-6 rounded border border-[var(--color-border)] flex items-center justify-center">
                        <Copy className="w-3 h-3" />
                      </button>
                      <button onClick={async () => {
                        if (await confirm({ title: `Delete "${l.name}"?`, confirmLabel: "Delete", danger: true })) api.remove(l.id);
                      }} aria-label={`Delete ${l.name}`} title="Delete"
                        className="w-6 h-6 rounded border border-[var(--color-border)] flex items-center justify-center text-[var(--color-destructive)]">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The layout editor: a live preview, a widget list, and full per-widget
 *  settings. Every change updates the preview immediately. */
function LayoutEditor({
  draft, setDraft, timers, onBack, onSave,
}: {
  draft: StageLayout;
  setDraft: (l: StageLayout) => void;
  timers: TimersApi;
  onBack: () => void;
  onSave: () => void;
}) {
  const [sel, setSel] = useState<string | null>(draft.widgets[0]?.id ?? null);
  const widget = draft.widgets.find((w) => w.id === sel) ?? null;

  const patch = (id: string, p: Partial<StageWidget>) =>
    setDraft({ ...draft, widgets: draft.widgets.map((w) => (w.id === id ? { ...w, ...p } : w)) });

  const add = (kind: StageWidgetKind) => {
    if (draft.widgets.length >= STAGE_MAX_WIDGETS) return;
    const id = `w${Date.now().toString(36)}`;
    const next: StageWidget = {
      id, kind, rect: clampRect({ x: 0.05, y: 0.4, w: 0.9, h: 0.2 }),
      scale: 1, align: "center", zIndex: draft.widgets.length,
      timerId: kind === "timer" ? (timers.slots[0]?.def.id ?? null) : null,
      text: kind === "static_text" ? "Text" : undefined,
    };
    setDraft({ ...draft, widgets: [...draft.widgets, next] });
    setSel(id);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button onClick={onBack} aria-label="Back to layouts"
          className="w-7 h-7 rounded border border-[var(--color-border)] flex items-center justify-center">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          aria-label="Layout name" className="flex-1 bg-transparent text-[13px] font-semibold outline-none" />
        <button onClick={onSave}
          className="h-7 px-3 rounded bg-[var(--color-brand)] text-black font-semibold text-[11px] flex items-center gap-1">
          <Check className="w-3.5 h-3.5" /> Save
        </button>
      </div>

      {/* The screen itself — drag to move, corner to resize. This replaced a
          read-only preview with click-to-select: an operator designing a
          confidence monitor thinks by moving things, not by typing an X. */}
      <StageCanvas
        layout={draft}
        selectedId={sel}
        onSelect={setSel}
        onChange={(id, rect) => patch(id, { rect })}
        preview={sampleText}
      />
      <div className="text-[10px] text-[var(--color-muted-foreground)] -mt-1">
        Drag to move. Drag the orange corner to resize. Arrow keys nudge.
      </div>

      {/* Timers and stage layouts are ONE job, not two. A Timer box that is
          not bound to a real timer shows "—" on the stage screen and the
          operator has no way to know why, so say it here. */}
      {draft.widgets.some((w) => w.kind === "timer" && !w.timerId) && (
        <div className="text-[10px] text-[var(--color-destructive)] leading-relaxed">
          {timers.slots.length === 0
            ? "This layout shows a timer, but you have not made any timers yet. Open the Timers panel (the stopwatch icon) and add one — then choose it below."
            : "A timer box has no timer chosen, so the stage screen will show a dash. Pick one below."}
        </div>
      )}

      {/* Add anything — the "what do we want on this screen" dropdown. */}
      <div className="flex items-center gap-2">
        <select value="" onChange={(e) => e.target.value && add(e.target.value as StageWidgetKind)}
          aria-label="Add something to this layout" className={field}>
          <option value="">Add to this screen…</option>
          {STAGE_WIDGET_KINDS.map((k) => <option key={k} value={k}>{STAGE_WIDGET_LABELS[k]}</option>)}
        </select>
      </div>

      {/* Widget list */}
      <div className="flex flex-col gap-1">
        {draft.widgets.length === 0 && (
          <div className="text-[11px] text-[var(--color-muted-foreground)]">
            Nothing on this screen yet. Add the words, a timer, or a clock above.
          </div>
        )}
        {draft.widgets.map((w) => (
          <div key={w.id}
            className={`flex items-center gap-2 px-2 h-7 rounded border text-[11px] ${sel === w.id ? "border-[var(--color-brand)]" : "border-[var(--color-border)]"}`}>
            <button onClick={() => setSel(w.id)} className="flex-1 text-left truncate">
              {STAGE_WIDGET_LABELS[w.kind]}
              {w.kind === "timer" && (
                <span className="text-[var(--color-muted-foreground)]">
                  {" — "}{timers.slots.find((s) => s.def.id === w.timerId)?.def.name ?? "not chosen"}
                </span>
              )}
            </button>
            <button onClick={() => { setDraft({ ...draft, widgets: draft.widgets.filter((x) => x.id !== w.id) }); if (sel === w.id) setSel(null); }}
              aria-label={`Remove ${STAGE_WIDGET_LABELS[w.kind]}`}
              className="w-5 h-5 rounded flex items-center justify-center text-[var(--color-destructive)]">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Per-widget settings */}
      {widget && (
        <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-2">
          <div className={label}>{STAGE_WIDGET_LABELS[widget.kind]} settings</div>

          {widget.kind === "timer" && (
            <div>
              <div className={label}>Which timer</div>
              <select value={widget.timerId ?? ""} onChange={(e) => patch(widget.id, { timerId: e.target.value || null })} className={field}>
                <option value="">Choose a timer…</option>
                {timers.slots.map((s) => <option key={s.def.id} value={s.def.id}>{s.def.name}</option>)}
              </select>
            </div>
          )}

          {widget.kind === "slide_preview" && (
            <div>
              <div className={label}>Preview which screen</div>
              <select value={widget.previewScreen ?? "main"}
                onChange={(e) => patch(widget.id, { previewScreen: e.target.value as StageWidget["previewScreen"] })}
                className={field}>
                <option value="main">Projector (current words)</option>
                <option value="stage">Stage (what is coming next)</option>
              </select>
            </div>
          )}

          {widget.kind === "static_text" && (
            <div>
              <div className={label}>Text</div>
              <input value={widget.text ?? ""} onChange={(e) => patch(widget.id, { text: e.target.value })} className={field} />
            </div>
          )}

          <div>
            <div className={label}>Where</div>
            <div className="grid grid-cols-4 gap-1">
              {PLACEMENTS.map((p) => (
                <button key={p.id} onClick={() => patch(widget.id, { rect: clampRect(p.rect) })}
                  className="h-6 rounded border border-[var(--color-border)] text-[9px] px-1 truncate" title={p.label}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className={label}>Size</div>
              <input type="range" min={0.2} max={6} step={0.1} value={widget.scale}
                onChange={(e) => patch(widget.id, { scale: Number(e.target.value) })} className="w-full" />
            </div>
            <div>
              <div className={label}>Colour</div>
              <input type="color" value={widget.color ?? "#ffffff"} onChange={(e) => patch(widget.id, { color: e.target.value })}
                className="h-7 w-full bg-transparent border border-[var(--color-border)] rounded cursor-pointer" />
            </div>
          </div>

          <div>
            <div className={label}>Align</div>
            <div className="flex gap-1">
              {(["left", "center", "right"] as const).map((al) => (
                <button key={al} onClick={() => patch(widget.id, { align: al })}
                  className={`flex-1 h-6 rounded text-[10px] ${widget.align === al ? "bg-[var(--color-brand)] text-black" : "border border-[var(--color-border)]"}`}>
                  {al === "center" ? "Centre" : al[0].toUpperCase() + al.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {(widget.kind === "timer" || widget.kind === "clock") && (
            <>
              <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none">
                <input type="checkbox" checked={widget.showHours === true}
                  onChange={(e) => patch(widget.id, { showHours: e.target.checked ? true : undefined })} />
                Always show hours
              </label>
              <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none">
                <input type="checkbox" checked={widget.leadingZeros === true}
                  onChange={(e) => patch(widget.id, { leadingZeros: e.target.checked })} />
                Leading zeros
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
