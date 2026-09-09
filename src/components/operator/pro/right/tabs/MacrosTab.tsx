"use client";

/**
 * Automations tab (Phase 4 — ProPresenter "Macros", PresentFlow naming).
 *
 * A church-persisted, named list of serializable ActionSpecs fired in sequence
 * through the ONE engine dispatcher (ctx.dispatchEngineAction). Create / edit
 * (add-remove from the same palette slide actions use), test-run (dispatch
 * sequentially, showing each {handled} result), and delete. Guarded (destructive)
 * actions ARE allowed here but fire only behind an explicit in-panel confirm that
 * maps to the dispatcher's confirmed:true — the hard Phase-3 precondition.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Play, Trash2, X, ChevronDown } from "lucide-react";
import type { OperatorShellCtx } from "../../../shell/types";
import type { ActionSpec } from "@/engine/actions/spec";
import { isGuardedSpec } from "@/engine/actions/spec";
import { ACTION_PALETTE } from "@/engine/actions/palette";
import { executeMacro, macroHasGuardedAction, MAX_ACTIONS_PER_MACRO, type MacroDefinition } from "@/engine/macros";
import { useConfirm } from "@/components/ui/ConfirmDialog";

type MacroRow = { id: string; name: string; actions: ActionSpec[]; enabled: boolean };

// The palette shown when adding an action to an Automation is the ONE shared
// palette (src/engine/actions/palette). Automations offer every entry, guarded
// included (fired behind the in-panel confirm); SlideGrid offers only the
// `slideSafe` subset. Single source → the two can't drift.
const PALETTE = ACTION_PALETTE;

function describeSpec(s: ActionSpec): string {
  switch (s.type) {
    case "timer": return `Timer ${s.command} · ${s.timerId}`;
    case "show_message": return `Show message: “${s.text.slice(0, 24)}”`;
    case "clear_message": return "Clear message";
    case "clear_layer": return `Clear layer: ${s.layerId}`;
    case "set_background": return s.spec ? "Set background" : "Set background: none";
    case "set_background_media": return `Set background media: ${s.assetRef?.fileName ?? "asset"}`;
    case "send_lower_third": return "Send lower third";
    case "clear_lower_third": return "Clear lower third";
    case "set_announcement": return "Set announcement";
    case "set_transition": return "Set transition";
    case "logo": return "Show logo";
    case "blank": return "Blank";
    case "kill": return "Kill / clear all";
    case "clear_all_layers": return "Clear all layers";
    case "macro": return `Run automation ${s.macroId}`;
    default: return "Action";
  }
}

export function MacrosTab({ ctx }: { ctx?: OperatorShellCtx }) {
  const [rows, setRows] = useState<MacroRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MacroRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { listMacros } = await import("@/lib/actions");
      const res = await listMacros();
      if (res.ok && res.data) setRows(res.data.map((m) => ({ id: m.id, name: m.name, actions: m.actions as ActionSpec[], enabled: m.enabled })));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const notifyChanged = () => { try { window.dispatchEvent(new Event("presentflow:macros-changed")); } catch { /* noop */ } };

  const createNew = async () => {
    const { createMacro } = await import("@/lib/actions");
    const res = await createMacro({ name: "New automation", actions: [], enabled: true });
    if (!res.ok) { toast.error(res.error || "Create failed"); return; }
    await load(); notifyChanged();
    const created = (await (await import("@/lib/actions")).listMacros());
    if (created.ok && created.data) {
      const row = created.data.find((m) => m.id === res.data?.id);
      if (row) setEditing({ id: row.id, name: row.name, actions: row.actions as ActionSpec[], enabled: row.enabled });
    }
  };

  const saveEditing = async (row: MacroRow) => {
    const { updateMacro } = await import("@/lib/actions");
    const res = await updateMacro(row.id, { name: row.name, actions: row.actions, enabled: row.enabled });
    if (!res.ok) { toast.error(res.error || "Save failed"); return; }
    setEditing(null); await load(); notifyChanged();
    toast.success("Automation saved");
  };

  const del = async (row: MacroRow) => {
    if (!(await confirm({ title: `Delete “${row.name}”?`, description: "This automation will be removed for everyone in your church.", confirmLabel: "Delete", danger: true }))) return;
    const { deleteMacro } = await import("@/lib/actions");
    const res = await deleteMacro(row.id);
    if (!res.ok) { toast.error(res.error || "Delete failed"); return; }
    await load(); notifyChanged();
  };

  const testRun = async (row: MacroRow) => {
    if (!ctx) { toast.error("Test-run needs the live operator console"); return; }
    const def: MacroDefinition = { id: row.id, churchId: "", name: row.name, actions: row.actions, enabled: true };
    const confirmed = macroHasGuardedAction(def)
      ? await confirm({ title: `Run “${row.name}” now?`, description: "This automation contains a destructive action (blank / kill / clear-all output).", confirmLabel: "Run", danger: true })
      : false;
    const outcomes = executeMacro(def, ctx.dispatchEngineAction, { confirmed });
    const fired = outcomes.filter((o) => o.result.handled).length;
    const refused = outcomes.filter((o) => o.result.reason === "refused-guard").length;
    toast(`Ran ${fired}/${outcomes.length} actions${refused ? ` · ${refused} needed confirm` : ""}`);
  };

  if (loading) return <div className="py-6 text-center text-[11px] text-[var(--color-muted-foreground)]">Loading automations…</div>;

  if (editing) {
    const guardedCount = editing.actions.filter(isGuardedSpec).length;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            className="flex-1 bg-[var(--color-panel)] border border-[var(--color-border)] rounded px-2 py-1 text-[12px]"
            placeholder="Automation name"
          />
          <button onClick={() => setEditing(null)} title="Cancel" className="p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex flex-col gap-1">
          {editing.actions.length === 0 && <div className="text-[11px] text-[var(--color-muted-foreground)] py-2">No actions yet — add from the palette below.</div>}
          {editing.actions.map((a, i) => (
            <div key={i} className="flex items-center gap-2 bg-[var(--color-panel)] border border-[var(--color-border)] rounded px-2 py-1 text-[11px]">
              <span className="text-[var(--color-muted-foreground)] w-4 text-right">{i + 1}</span>
              <span className="flex-1 truncate">{describeSpec(a)}</span>
              {isGuardedSpec(a) && <span className="text-[9px] uppercase tracking-wider text-amber-400 border border-amber-400/40 rounded px-1">confirm</span>}
              <button onClick={() => setEditing({ ...editing, actions: editing.actions.filter((_, j) => j !== i) })} className="text-[var(--color-muted-foreground)] hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="relative">
          <button
            disabled={editing.actions.length >= MAX_ACTIONS_PER_MACRO}
            onClick={() => setAddOpen((v) => !v)}
            className="w-full flex items-center justify-center gap-1 border border-dashed border-[var(--color-border)] rounded px-2 py-1.5 text-[11px] hover:bg-[var(--color-panel)] disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" /> Add action <ChevronDown className="w-3 h-3" />
          </button>
          {addOpen && (
            <div className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 shadow-xl">
              {PALETTE.map((p, i) => (
                <button
                  key={i}
                  onClick={() => { setEditing({ ...editing, actions: [...editing.actions, p.make()] }); setAddOpen(false); }}
                  className="w-full text-left px-2 py-1 rounded text-[11px] hover:bg-[var(--color-panel)]"
                >{p.label}</button>
              ))}
            </div>
          )}
        </div>
        {guardedCount > 0 && <div className="text-[10px] text-amber-400/80 px-1">Contains {guardedCount} destructive action(s) — a confirm is required at run time and this automation cannot be attached as a slide action’s auto-fire without one.</div>}
        <div className="flex gap-2 pt-1">
          <button onClick={() => saveEditing(editing)} className="flex-1 bg-[var(--color-brand)] text-white rounded px-2 py-1.5 text-[12px] font-semibold">Save</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold">Automations</div>
        <button onClick={createNew} className="flex items-center gap-1 text-[11px] border border-[var(--color-border)] rounded px-2 py-1 hover:bg-[var(--color-panel)]"><Plus className="w-3.5 h-3.5" /> New</button>
      </div>
      {confirmDialog}
      {rows.length === 0 && (
        <div className="text-[11px] text-[var(--color-muted-foreground)] py-4 text-center">
          No automations yet. Create one to chain actions (start a timer + show a message, clear layers, …) and fire them in one tap.
          <div className="mt-1.5 text-[10px] opacity-80">…or right-click a song slide → Actions to attach an action to a single slide.</div>
        </div>
      )}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 bg-[var(--color-panel)] border border-[var(--color-border)] rounded px-2 py-1.5">
          <button onClick={() => setEditing(r)} className="flex-1 text-left min-w-0">
            <div className="text-[12px] truncate">{r.name}</div>
            <div className="text-[10px] text-[var(--color-muted-foreground)]">{r.actions.length} action(s){macroHasGuardedAction({ id: r.id, churchId: "", name: r.name, actions: r.actions, enabled: true }) ? " · destructive" : ""}</div>
          </button>
          <button onClick={() => void testRun(r)} title="Test run" className="p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-brand)]"><Play className="w-4 h-4" /></button>
          <button onClick={() => void del(r)} title="Delete" className="p-1 text-[var(--color-muted-foreground)] hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );
}
