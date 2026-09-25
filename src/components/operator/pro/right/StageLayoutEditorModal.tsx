"use client";
/**
 * StageLayoutEditorModal — ProPresenter's "Edit Layouts" window.
 *
 * WHY A MODAL AND NOT THE PANEL (user-directed 2026-09-25): the editor used to
 * take over the ~320px right rail. A 16:9 canvas in 320px is 300x169 CSS
 * pixels — a widget box is about 40px tall and the resize handle is 40% of it.
 * No amount of control-pruning fixes that; it is simply the wrong container,
 * which is why the brief was "show the edit slide screen like ProPresenter".
 *
 * WHY NOT EXTEND DesktopSlideEditorModal: that editor already carries two
 * targets (song, theme) and the full slide feature set. Threading a third,
 * structurally different target through 1,600 lines risks two working features
 * to gain complexity the brief explicitly did not want ("much, much, much
 * simpler and less detailed as like the big edit slide"). So: a thin shell of
 * our own, and ZERO new primitives — StageCanvas, useConfirm and the Radix
 * Dialog convention are all reused as they stand.
 *
 * Three columns at Tailwind's `xl` (1280px); one column below that, because
 * three columns squeezed into a small window is worse than none. A 1366x768
 * church laptop clears it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Check, Plus, Trash2, Copy, ChevronUp, ChevronDown } from "lucide-react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { StageCanvas } from "./StageCanvas";
import { StageInspector } from "./StageInspector";
import { sampleText } from "./stageSample";
import {
  STAGE_WIDGET_KINDS, STAGE_WIDGET_LABELS, STAGE_MAX_WIDGETS, clampRect,
  type StageLayout, type StageWidget, type StageWidgetKind,
} from "@/engine/stage";
import type { TimersApi } from "../hooks";

/** Widget ids were `w${Date.now().toString(36)}`, so two made in the same
 *  millisecond collided — and a collision meant the inspector edited BOTH boxes
 *  and the delete confirm removed both. A counter makes it impossible. */
let widgetSeq = 0;
function nextWidgetId(): string {
  widgetSeq += 1;
  return `w${Date.now().toString(36)}${widgetSeq.toString(36)}`;
}

/** A row label that says what the box actually IS, not just its kind — a list
 *  reading "Text / Text / Text" tells an operator nothing. */
function rowLabel(w: StageWidget, timers: TimersApi): { text: string; muted?: string } {
  if (w.kind === "timer") {
    if (!w.timerId) return { text: "Timer", muted: "not chosen" };
    const name = timers.slots.find((s) => s.def.id === w.timerId)?.def.name;
    // A timer that was DELETED is not the same as one never picked, and the
    // stage screen shows a dash for both. Say which.
    return { text: "Timer", muted: name ?? "that timer was deleted" };
  }
  if (w.kind === "static_text") return { text: "Text", muted: w.text || "empty" };
  if (w.kind === "slide_preview") return { text: "Screen preview", muted: w.previewScreen ?? "main" };
  return { text: STAGE_WIDGET_LABELS[w.kind] };
}

export function StageLayoutEditorModal({
  open, layout, timers, screenName, isCopyOfBuiltIn, screenIsLive, onClose, onSave,
}: {
  open: boolean;
  layout: StageLayout;
  timers: TimersApi;
  /** Which stage screen this layout is being edited FOR. */
  screenName: string | null;
  /** True when the operator pressed edit on a built-in and we copied it. */
  isCopyOfBuiltIn: boolean;
  /** Is that screen showing this right now? From inside a full-screen modal
   *  the operator cannot see the panel's "On stage" badge, so Save could push
   *  a change to a live confidence monitor with nothing having said so. */
  screenIsLive: boolean;
  onClose: () => void;
  onSave: (l: StageLayout) => Promise<void> | void;
}) {
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = useState<StageLayout>(layout);
  const [sel, setSel] = useState<string | null>(layout.widgets[0]?.id ?? null);
  const [dirty, setDirty] = useState(false);

  // Re-seed when the modal is opened on a different layout.
  useEffect(() => {
    if (!open) return;
    setDraft(layout);
    setSel(layout.widgets[0]?.id ?? null);
    setDirty(false);
  }, [open, layout]);

  const widget = draft.widgets.find((w) => w.id === sel) ?? null;

  const edit = useCallback((next: StageLayout) => { setDraft(next); setDirty(true); }, []);
  /** Functional form, for anything derived from the CURRENT draft — a fast
   *  double-tap on Duplicate would otherwise drop one of the two. */
  const editFrom = useCallback((fn: (d: StageLayout) => StageLayout) => {
    setDraft((d) => fn(d));
    setDirty(true);
  }, []);
  const patch = useCallback((id: string, p: Partial<StageWidget>) => {
    setDraft((d) => ({ ...d, widgets: d.widgets.map((w) => (w.id === id ? { ...w, ...p } : w)) }));
    setDirty(true);
  }, []);

  const add = (kind: StageWidgetKind) => {
    if (draft.widgets.length >= STAGE_MAX_WIDGETS) {
      // Used to be a silent return: the operator picked a kind, the dropdown
      // reset, and nothing happened. They try again, and again.
      toast.info(`That is the limit of ${STAGE_MAX_WIDGETS} things on one layout.`);
      return;
    }
    const id = nextWidgetId();
    editFrom((d) => ({
      ...d,
      widgets: [...d.widgets, {
        id, kind, rect: clampRect({ x: 0.05, y: 0.4, w: 0.9, h: 0.2 }),
        scale: 1, align: "center", zIndex: draft.widgets.length,
        timerId: kind === "timer" ? (timers.slots[0]?.def.id ?? null) : null,
        text: kind === "static_text" ? "Text" : undefined,
      }],
    }));
    setSel(id);
  };

  const duplicate = (id: string) => {
    const src = draft.widgets.find((w) => w.id === id);
    if (!src) return;
    if (draft.widgets.length >= STAGE_MAX_WIDGETS) {
      toast.info(`That is the limit of ${STAGE_MAX_WIDGETS} things on one layout.`);
      return;
    }
    const newId = nextWidgetId();
    editFrom((d) => ({
      ...d,
      widgets: [...d.widgets, {
        ...src, id: newId,
        rect: clampRect({ ...src.rect, x: src.rect.x + 0.03, y: src.rect.y + 0.03 }),
        zIndex: d.widgets.length,
      }],
    }));
    setSel(newId);
  };

  /** Move one widget through the stack. zIndex was write-once, so an
   *  overlapped box could never be brought back to the front. */
  const order = (id: string, dir: 1 | -1) => {
    editFrom((d) => {
      const sorted = [...d.widgets].sort((a, b) => a.zIndex - b.zIndex);
      const i = sorted.findIndex((w) => w.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= sorted.length) return d;
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      return { ...d, widgets: sorted.map((w, k) => ({ ...w, zIndex: k })) };
    });
  };

  const remove = async (id: string) => {
    const w = draft.widgets.find((x) => x.id === id);
    if (!w) return;
    // A bare X used to delete a configured timer box instantly on a mis-tap.
    if (!(await confirm({ title: `Remove ${STAGE_WIDGET_LABELS[w.kind]}?`, confirmLabel: "Remove", danger: true }))) return;
    editFrom((d) => ({ ...d, widgets: d.widgets.filter((x) => x.id !== id) }));
    if (sel === id) setSel(null);
  };

  const requestClose = async () => {
    // A modal is far easier to dismiss by accident than the old back arrow.
    if (dirty && !(await confirm({ title: "Discard your changes?", confirmLabel: "Discard", danger: true }))) return;
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) void requestClose(); }}>
      <Dialog.Portal>
        {dialog}
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[70]" />
        <Dialog.Content
          onEscapeKeyDown={(e) => { e.preventDefault(); void requestClose(); }}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed inset-0 z-[71] flex flex-col bg-[var(--color-panel)]">
          <Dialog.Title className="sr-only">Edit stage layout</Dialog.Title>

          {/* ── header ─────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 px-3 h-12 border-b border-[var(--color-border)] shrink-0">
            <input value={draft.name} onChange={(e) => edit({ ...draft, name: e.target.value })}
              aria-label="Layout name"
              className="bg-transparent text-[14px] font-semibold outline-none min-w-0 flex-1" />
            {screenName && (
              <span className="text-[11px] text-[var(--color-muted-foreground)] truncate">
                on {screenName}
              </span>
            )}
            {screenIsLive && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-brand)] text-black font-bold uppercase tracking-wider">
                on stage now
              </span>
            )}
            {isCopyOfBuiltIn && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]">
                your copy
              </span>
            )}
            <button onClick={() => { setDirty(false); void onSave(draft); }}
              className="h-8 px-3 rounded bg-[var(--color-brand)] text-black font-semibold text-[12px] flex items-center gap-1">
              <Check className="w-4 h-4" /> Save
            </button>
            <button onClick={() => { void requestClose(); }} aria-label="Close"
              className="w-8 h-8 rounded border border-[var(--color-border)] flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── body ───────────────────────────────────────────────────── */}
          <div className="flex-1 min-h-0 flex flex-col xl:flex-row overflow-auto xl:overflow-hidden">
            {/* Objects */}
            <div className="xl:w-[220px] shrink-0 border-b xl:border-b-0 xl:border-r border-[var(--color-border)] p-2 flex flex-col gap-2 xl:overflow-auto">
              <div className="flex items-center justify-between">
                <div className="eyebrow">Objects</div>
                <select onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); }} value="" onChange={(e) => e.target.value && add(e.target.value as StageWidgetKind)}
                  aria-label="Add to this layout"
                  className="h-7 px-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded text-[11px]">
                  <option value="">+ Add…</option>
                  {STAGE_WIDGET_KINDS.map((k) => <option key={k} value={k}>{STAGE_WIDGET_LABELS[k]}</option>)}
                </select>
              </div>
              {draft.widgets.length === 0 && (
                <div className="text-[11px] text-[var(--color-muted-foreground)]">
                  Nothing on this screen yet — add the words, a timer or a clock.
                </div>
              )}
              {/* Front-most first, matching what the eye sees on the canvas. */}
              {[...draft.widgets].sort((a, b) => b.zIndex - a.zIndex).map((w) => {
                const l = rowLabel(w, timers);
                return (
                  <div key={w.id}
                    className={`flex items-center gap-1 px-2 h-8 rounded border text-[11px] ${sel === w.id ? "border-[var(--color-brand)]" : "border-[var(--color-border)]"}`}>
                    <button onClick={() => setSel(w.id)} className="flex-1 text-left truncate min-w-0">
                      {l.text}
                      {l.muted && <span className="text-[var(--color-muted-foreground)]"> — {l.muted}</span>}
                    </button>
                    <button onClick={() => order(w.id, 1)} aria-label="Bring forward" className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)]">
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button onClick={() => order(w.id, -1)} aria-label="Send back" className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)]">
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    <button onClick={() => duplicate(w.id)} aria-label="Duplicate" className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)]">
                      <Copy className="w-3 h-3" />
                    </button>
                    <button onClick={() => { void remove(w.id); }} aria-label="Remove"
                      className="w-7 h-7 flex items-center justify-center rounded text-[var(--color-destructive)] hover:bg-[var(--color-elevated)]">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Canvas — the SAME StageCanvas the panel used; only its container changed. */}
            <div className="flex-1 min-w-0 p-4 flex flex-col items-center justify-center gap-2 bg-black/20">
              <div className="w-full max-w-[900px]">
                <StageCanvas layout={draft} selectedId={sel} onSelect={setSel}
                  onChange={(id, rect) => patch(id, { rect })} preview={sampleText} />
              </div>
              <div className="text-[10px] text-[var(--color-muted-foreground)]">
                Drag to move · drag the orange corner to resize · arrow keys nudge
              </div>
              {draft.widgets.some((w) => w.kind === "timer" && (!w.timerId || !timers.slots.some((s) => s.def.id === w.timerId))) && (
                <div className="text-[11px] text-[var(--color-destructive)] max-w-[600px] text-center">
                  {timers.slots.length === 0
                    ? "This layout shows a timer, but you have not made any timers yet. Close this, open Timers (the stopwatch icon) and add one."
                    : "A timer box has no timer chosen — or the one it used was deleted — so the stage screen will show a dash. Pick one on the right."}
                </div>
              )}
            </div>

            {/* Inspector */}
            <div className="xl:w-[280px] shrink-0 border-t xl:border-t-0 xl:border-l border-[var(--color-border)] p-3 xl:overflow-auto">
              {widget ? (
                <StageInspector widget={widget} timers={timers}
                  onPatch={(p) => patch(widget.id, p)} onOrder={(d) => order(widget.id, d)} />
              ) : (
                <div className="text-[11px] text-[var(--color-muted-foreground)]">
                  Tap something on the screen to change it.
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
