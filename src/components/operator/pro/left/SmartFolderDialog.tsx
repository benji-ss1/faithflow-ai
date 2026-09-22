"use client";

/**
 * Smart Folder rule editor (ProPresenter parity).
 *
 * Creates a new rule-based folder or edits an existing one's rules. The
 * editor is deliberately thin: it assembles a `SmartRules` object and hands
 * it to the server, which re-validates everything (src/lib/smart-folders.ts).
 * Nothing here is a security boundary — a hand-crafted request gets the same
 * whitelist treatment.
 */

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  SMART_FIELDS, opsForField, MAX_RULES,
  type SmartRules, type SmartRule, type SmartTarget, type SmartOp,
} from "@/lib/smart-folders";
import { createSmartFolder, updateSmartFolderRules, createSmartPlaylist, updateSmartPlaylistRules } from "@/lib/actions";
import { validateRules } from "@/lib/smart-folders";

/** Operators that take no value — the value input is hidden for these. */
const VALUELESS = new Set<SmartOp>(["isSet", "isNotSet"]);

const OP_LABELS: Partial<Record<SmartOp, string>> = {
  contains: "contains", notContains: "does not contain",
  is: "is", isNot: "is not", startsWith: "starts with", endsWith: "ends with",
  isSet: "is set", isNotSet: "is empty",
  gt: "is greater than", lt: "is less than",
  inLastDays: "in the last (days)", before: "before", after: "after",
};

export function SmartFolderDialog({
  open, onOpenChange, target = "songs", mode = "folder", editing, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target?: SmartTarget;
  /**
   * Which kind of smart thing this edits. Both share one rule surface on
   * purpose — a second, subtly different rule editor is how the two would
   * drift apart.
   */
  mode?: "folder" | "playlist";
  /** Provide to EDIT an existing one; omit to CREATE. */
  editing?: { id: string; name: string; rules: SmartRules };
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [match, setMatch] = useState<"all" | "any">(editing?.rules.match ?? "all");
  const [rules, setRules] = useState<SmartRule[]>(
    editing?.rules.rules.length ? editing.rules.rules : [{ field: "title", op: "contains", value: "" }],
  );
  const [saving, setSaving] = useState(false);

  const fields = SMART_FIELDS[target];
  const noun = mode === "playlist" ? "playlist" : "folder";

  const setRule = (i: number, patch: Partial<SmartRule>) => {
    setRules((prev) => prev.map((r, n) => {
      if (n !== i) return r;
      const next = { ...r, ...patch };
      // Changing the field can invalidate the operator — snap to the first
      // operator the new field actually supports rather than saving a rule
      // the server would silently drop.
      if (patch.field) {
        const ops = opsForField(target, patch.field);
        if (!ops.includes(next.op)) next.op = ops[0];
        // Clear the value too: a title value like "christmas" carried onto a
        // Date or Size field fails server validation and the rule is silently
        // dropped, quietly emptying a folder that used to work.
        next.value = "";
      }
      return next;
    }));
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!editing && !trimmed) { toast.error(`Give the ${mode === "playlist" ? "playlist" : "folder"} a name`); return; }

    // Validate with the SAME function the server uses, so the operator learns
    // here that a rule is unusable instead of getting a success toast and a
    // permanently empty folder.
    const payload: SmartRules = { match, rules };
    const usable = validateRules(payload, target);
    if (usable.rules.length === 0) {
      toast.error("Add at least one complete rule — a rule needs a value before it can match anything");
      return;
    }
    if (usable.rules.length < rules.length) {
      toast.error(`${rules.length - usable.rules.length} rule(s) are incomplete — fill in their values or remove them`);
      return;
    }
    setSaving(true);
    const isPlaylist = mode === "playlist";
    const res = editing
      ? isPlaylist
        ? await updateSmartPlaylistRules(editing.id, payload)
        : await updateSmartFolderRules(editing.id, payload)
      : isPlaylist
        ? await createSmartPlaylist(trimmed, payload)
        : await createSmartFolder(trimmed, payload);
    setSaving(false);
    if (!res.ok) { toast.error(res.error ?? `Couldn't save the ${noun}`); return; }
    toast.success(editing ? "Rules updated" : `Smart ${noun} "${trimmed}" created`);
    onOpenChange(false);
    onSaved();
  };

  const inputCls =
    "px-2 py-1 text-[12px] rounded bg-[var(--color-panel)] border border-[var(--color-border)] text-[var(--color-foreground)] outline-none focus:border-[var(--color-brand)]";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)] p-4 shadow-2xl">
          <Dialog.Title className="flex items-center gap-2 text-[14px] font-bold text-[var(--color-foreground)]">
            <Sparkles className="w-4 h-4 text-[var(--color-brand)]" />
            {editing ? `Rules for "${editing.name}"` : `New smart ${noun}`}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
            {mode === "playlist"
              ? "A smart playlist fills itself. Every song matching these rules appears in it automatically, in title order — you never drag songs in, and nothing is moved or copied."
              : "A smart folder fills itself. Anything matching these rules appears in it automatically — you never drag items in, and nothing is moved or copied."}
          </Dialog.Description>

          {!editing && (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "playlist" ? "Playlist name (e.g. All Carols)" : "Folder name (e.g. Christmas)"}
              maxLength={100}
              className={`${inputCls} mt-3 w-full`}
            />
          )}

          <div className="mt-3 flex items-center gap-2 text-[12px] text-[var(--color-muted-foreground)]">
            <span>Match</span>
            <select value={match} onChange={(e) => setMatch(e.target.value as "all" | "any")} className={inputCls}>
              <option value="all">all</option>
              <option value="any">any</option>
            </select>
            <span>of these rules:</span>
          </div>

          <div className="mt-2 space-y-2 max-h-[40vh] overflow-y-auto">
            {rules.map((r, i) => {
              const ops = opsForField(target, r.field);
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <select value={r.field} onChange={(e) => setRule(i, { field: e.target.value })} className={`${inputCls} flex-1 min-w-0`}>
                    {Object.entries(fields).map(([key, def]) => (
                      <option key={key} value={key}>{def.label}</option>
                    ))}
                  </select>
                  <select value={r.op} onChange={(e) => setRule(i, { op: e.target.value as SmartOp })} className={`${inputCls} flex-1 min-w-0`}>
                    {ops.map((op) => <option key={op} value={op}>{OP_LABELS[op] ?? op}</option>)}
                  </select>
                  {VALUELESS.has(r.op) ? (
                    <span className="flex-1 text-[11px] text-[var(--color-muted-foreground)] px-1">—</span>
                  ) : (
                    <input
                      value={r.value ?? ""}
                      onChange={(e) => setRule(i, { value: e.target.value })}
                      placeholder={fields[r.field]?.kind === "date" ? "2026-01-01 or 30" : "value"}
                      maxLength={200}
                      className={`${inputCls} flex-1 min-w-0`}
                    />
                  )}
                  <button
                    type="button"
                    aria-label="Remove rule"
                    onClick={() => setRules((prev) => prev.filter((_, n) => n !== i))}
                    disabled={rules.length === 1}
                    className="w-7 h-7 grid place-items-center rounded text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-panel)] disabled:opacity-30"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {rules.length < MAX_RULES && (
            <button
              type="button"
              onClick={() => setRules((p) => [...p, { field: "title", op: "contains", value: "" }])}
              className="mt-2 flex items-center gap-1 text-[12px] text-[var(--color-brand)] hover:underline"
            >
              <Plus className="w-3.5 h-3.5" /> Add rule
            </button>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className="px-3 py-1.5 text-[12px] rounded border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="px-3 py-1.5 text-[12px] font-bold rounded bg-[var(--color-brand)] text-black disabled:opacity-50"
            >
              {saving ? "Saving…" : editing ? "Save rules" : `Create ${noun}`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
