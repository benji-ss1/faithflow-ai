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
 *
 * A new automation is only persisted on Save (Cancel leaves nothing behind);
 * unsaved edits ask before being discarded.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Plus, Play, Trash2, X, ChevronDown } from "lucide-react";
import type { OperatorShellCtx } from "../../../shell/types";
import type { ActionSpec } from "@/engine/actions/spec";
import { isGuardedSpec } from "@/engine/actions/spec";
import { ACTION_PALETTE } from "@/engine/actions/palette";
import { describeSpec } from "@/engine/actions/describe";
import { executeMacro, macroHasGuardedAction, MAX_ACTIONS_PER_MACRO, type MacroDefinition } from "@/engine/macros";
import { useConfirm } from "@/components/ui/ConfirmDialog";

type MacroRow = { id: string; name: string; actions: ActionSpec[]; enabled: boolean };
/** Editor draft. `id === ""` means not yet saved (created on Save). */
type Draft = MacroRow & { baseline: string };

// The palette shown when adding an action to an Automation is the ONE shared
// palette (src/engine/actions/palette). Automations offer every entry, guarded
// included (fired behind the in-panel confirm); SlideGrid offers only the
// `slideSafe` subset. Single source → the two can't drift.
const PALETTE = ACTION_PALETTE;

const draftSnapshot = (r: MacroRow) => JSON.stringify({ n: r.name, a: r.actions, e: r.enabled });

export function MacrosTab({ ctx }: { ctx?: OperatorShellCtx }) {
  const [rows, setRows] = useState<MacroRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { listMacros } = await import("@/lib/actions");
      const res = await listMacros();
      if (res.ok && res.data) {
        setRows(res.data.map((m) => ({ id: m.id, name: m.name, actions: m.actions as ActionSpec[], enabled: m.enabled })));
        setLoadError(null);
      } else {
        setLoadError((!res.ok && res.error) || "Couldn't load automations");
      }
    } catch {
      setLoadError("Couldn't load automations");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const notifyChanged = () => { try { window.dispatchEvent(new Event("presentflow:macros-changed")); } catch { /* noop */ } };

  const openEditor = (row: MacroRow) => setEditing({ ...row, baseline: draftSnapshot(row) });
  const createNew = () => {
    const blank: MacroRow = { id: "", name: "", actions: [], enabled: true };
    setEditing({ ...blank, baseline: draftSnapshot(blank) });
  };

  const cancelEditing = async () => {
    if (!editing) return;
    const dirty = draftSnapshot(editing) !== editing.baseline;
    if (dirty && !(await confirm({ title: "Discard unsaved changes?", description: "Your edits to this automation will be lost.", confirmLabel: "Discard", danger: true }))) return;
    setEditing(null);
  };

  const saveEditing = async (draft: Draft) => {
    const name = draft.name.trim();
    if (!name) { toast.error("Give the automation a name"); return; }
    setSaving(true);
    try {
      const { createMacro, updateMacro } = await import("@/lib/actions");
      const res = draft.id
        ? await updateMacro(draft.id, { name, actions: draft.actions, enabled: draft.enabled })
        : await createMacro({ name, actions: draft.actions, enabled: draft.enabled });
      if (!res.ok) { toast.error(res.error || "Save failed"); return; }
      setEditing(null); await load(); notifyChanged();
      toast.success("Automation saved");
    } finally { setSaving(false); }
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
    const guarded = macroHasGuardedAction(def);
    const ok = await confirm({
      title: `Run “${row.name}” now?`,
      description: guarded
        ? "This goes LIVE on the projector right now, and it contains a destructive action (blank / kill / clear-all output)."
        : "This goes LIVE on the projector right now.",
      confirmLabel: "Run live",
      danger: guarded,
    });
    if (!ok) return;
    const outcomes = executeMacro(def, ctx.dispatchEngineAction, { confirmed: guarded });
    const fired = outcomes.filter((o) => o.result.handled).length;
    const refused = outcomes.filter((o) => o.result.reason === "refused-guard").length;
    toast(`Ran ${fired}/${outcomes.length} actions${refused ? ` · ${refused} needed confirm` : ""}`);
  };

  if (loading) return <div className="py-6 text-center text-[11px] text-[var(--color-muted-foreground)]">Loading automations…</div>;

  if (editing) {
    const guardedCount = editing.actions.filter(isGuardedSpec).length;
    const nameInvalid = editing.name.trim().length === 0;
    return (
      <div className="flex flex-col gap-2">
        {confirmDialog}
        <div className="flex items-center gap-2">
          <input
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            className="flex-1 min-w-0 bg-[var(--color-panel)] border border-[var(--color-border)] rounded px-2 py-1 text-[12px]"
            placeholder="Automation name"
            aria-label="Automation name"
            aria-invalid={nameInvalid}
            autoFocus={!editing.id}
          />
          <button type="button" onClick={() => void cancelEditing()} title="Cancel" aria-label="Cancel editing" className="p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"><X className="w-4 h-4" /></button>
        </div>
        <label className="flex items-center gap-2 text-[11px] px-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={editing.enabled}
            onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
            className="accent-[var(--color-brand)]"
          />
          Enabled
          <span className="text-[10px] text-[var(--color-muted-foreground)]">(disabled automations don’t run from slides)</span>
        </label>
        <div className="flex flex-col gap-1">
          {editing.actions.length === 0 && <div className="text-[11px] text-[var(--color-muted-foreground)] py-2">No actions yet — add from the palette below.</div>}
          {editing.actions.map((a, i) => (
            <div key={i} className="flex items-center gap-2 bg-[var(--color-panel)] border border-[var(--color-border)] rounded px-2 py-1 text-[11px]">
              <span className="text-[var(--color-muted-foreground)] w-4 text-right">{i + 1}</span>
              <span className="flex-1 min-w-0 truncate">{describeSpec(a)}</span>
              {isGuardedSpec(a) && <span className="text-[9px] uppercase tracking-wider text-[var(--color-warning)] border border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] rounded px-1">confirm</span>}
              <button
                type="button"
                onClick={() => setEditing({ ...editing, actions: editing.actions.filter((_, j) => j !== i) })}
                aria-label={`Remove ${describeSpec(a)}`}
                title="Remove action"
                className="text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
              ><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              disabled={editing.actions.length >= MAX_ACTIONS_PER_MACRO}
              className="w-full flex items-center justify-center gap-1 border border-dashed border-[var(--color-border)] rounded px-2 py-1.5 text-[11px] hover:bg-[var(--color-panel)] disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" /> Add action <ChevronDown className="w-3 h-3" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={4}
              className="z-50 w-[var(--radix-dropdown-menu-trigger-width)] max-w-[90vw] max-h-56 overflow-y-auto rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 shadow-xl"
            >
              {PALETTE.map((p, i) => (
                <DropdownMenu.Item
                  key={i}
                  onSelect={() => setEditing((cur) => cur ? { ...cur, actions: [...cur.actions, p.make()] } : cur)}
                  className="px-2 py-1 rounded text-[11px] outline-none cursor-pointer truncate data-[highlighted]:bg-[var(--color-panel)]"
                  title={p.label}
                >{p.label}</DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {guardedCount > 0 && <div className="text-[10px] text-[var(--color-warning)] px-1">Contains {guardedCount} destructive action(s) — a confirm is required at run time, so this automation isn’t offered under a slide’s Actions → Run automation.</div>}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={saving || nameInvalid}
            onClick={() => void saveEditing(editing)}
            className="flex-1 bg-[var(--color-brand)] text-[var(--color-primary-foreground)] rounded px-2 py-1.5 text-[12px] font-semibold disabled:opacity-50"
          >{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold">Automations</div>
        <button type="button" onClick={createNew} className="flex items-center gap-1 text-[11px] border border-[var(--color-border)] rounded px-2 py-1 hover:bg-[var(--color-panel)]"><Plus className="w-3.5 h-3.5" /> New</button>
      </div>
      {confirmDialog}
      {loadError && (
        <div role="alert" className="text-[11px] text-[var(--color-destructive)] py-3 text-center">
          {loadError}
          <div className="mt-1.5">
            <button type="button" onClick={() => void load()} className="text-[11px] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-foreground)] hover:bg-[var(--color-panel)]">Retry</button>
          </div>
        </div>
      )}
      {!loadError && rows.length === 0 && (
        <div className="text-[11px] text-[var(--color-muted-foreground)] py-4 text-center">
          No automations yet. Create one to chain actions (start a timer + show a message, clear layers, …) and fire them in one tap.
          <div className="mt-1.5 text-[10px] opacity-80">…then right-click a song slide → Actions → Run automation to fire it when that slide goes live.</div>
        </div>
      )}
      {!loadError && rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 bg-[var(--color-panel)] border border-[var(--color-border)] rounded px-2 py-1.5">
          <button type="button" onClick={() => openEditor(r)} className="flex-1 text-left min-w-0" aria-label={`Edit ${r.name}`}>
            <div className="text-[12px] truncate">{r.name}</div>
            <div className="text-[10px] text-[var(--color-muted-foreground)]">{r.actions.length} action(s){macroHasGuardedAction({ id: r.id, churchId: "", name: r.name, actions: r.actions, enabled: true }) ? " · destructive" : ""}{r.enabled ? "" : " · disabled"}</div>
          </button>
          <button type="button" onClick={() => void testRun(r)} title="Test run (goes live)" aria-label={`Test run ${r.name} on the live output`} className="p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-brand)]"><Play className="w-4 h-4" /></button>
          <button type="button" onClick={() => void del(r)} title="Delete" aria-label={`Delete ${r.name}`} className="p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      {!loadError && rows.length > 0 && (
        <div className="text-[10px] text-[var(--color-muted-foreground)] px-1">Test run fires on the live projector.</div>
      )}
    </div>
  );
}
