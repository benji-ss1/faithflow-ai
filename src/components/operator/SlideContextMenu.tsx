"use client";
// Right-click context menu wrapping a slide preview. Uses
// @radix-ui/react-context-menu. Menu items: Edit, Disable, Themes ▶,
// Transitions ▶, Delete. Edit/Delete get wired via callbacks; Themes and
// Transitions render a "No presets configured" placeholder unless the
// caller supplies presets (they don't today — logged in DECISIONS.md).

import * as ContextMenu from "@radix-ui/react-context-menu";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useState } from "react";
import { Edit3, EyeOff, Palette, Sparkles, Trash2, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export type SlideContextMenuPresets = {
  themes?: { id: string; name: string }[];
  transitions?: { id: string; name: string }[];
};

export function SlideContextMenu({
  children,
  onEdit,
  onDisable,
  onDelete,
  onApplyTheme,
  onApplyTransition,
  presets,
}: {
  children: React.ReactNode;
  onEdit?: () => void;
  onDisable?: () => void;
  onDelete?: () => void;
  onApplyTheme?: (id: string) => void;
  onApplyTransition?: (id: string) => void;
  presets?: SlideContextMenuPresets;
}) {
  const themes = presets?.themes ?? [];
  const transitions = presets?.transitions ?? [];

  // Y3: destructive Delete is now behind a confirm dialog. Also fires from
  // Delete/Backspace when the trigger element (or any descendant) has focus.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && onDelete) {
      e.preventDefault();
      setConfirmOpen(true);
    }
  };

  return (
    <>
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div tabIndex={0} onKeyDown={handleTriggerKeyDown} className="outline-none">
          {children}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="min-w-[180px] rounded-md border p-1 shadow-xl text-[12px] z-50"
          style={{ background: "#1e2525", borderColor: "#2a3232", color: "#e4e4e7" }}
        >
          <Item icon={<Edit3 className="w-3.5 h-3.5" />} onSelect={() => (onEdit ? onEdit() : toast.info("Edit not wired"))}>Edit</Item>
          <Item icon={<EyeOff className="w-3.5 h-3.5" />} onSelect={() => (onDisable ? onDisable() : toast.info("Disable not wired"))}>Disable</Item>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="flex items-center gap-2 px-2 h-7 rounded-sm hover:bg-white/5 outline-none cursor-default">
              <Palette className="w-3.5 h-3.5" /> Themes <ChevronRight className="w-3 h-3 ml-auto" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent
                className="min-w-[160px] rounded-md border p-1 shadow-xl text-[12px] z-50"
                style={{ background: "#1e2525", borderColor: "#2a3232", color: "#e4e4e7" }}
              >
                {themes.length === 0 ? (
                  <div className="px-2 py-1 text-[11px] italic text-zinc-500">No themes configured</div>
                ) : themes.map((t) => (
                  <Item key={t.id} onSelect={() => onApplyTheme?.(t.id)}>{t.name}</Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="flex items-center gap-2 px-2 h-7 rounded-sm hover:bg-white/5 outline-none cursor-default">
              <Sparkles className="w-3.5 h-3.5" /> Transitions <ChevronRight className="w-3 h-3 ml-auto" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent
                className="min-w-[160px] rounded-md border p-1 shadow-xl text-[12px] z-50"
                style={{ background: "#1e2525", borderColor: "#2a3232", color: "#e4e4e7" }}
              >
                {transitions.length === 0 ? (
                  <div className="px-2 py-1 text-[11px] italic text-zinc-500">No transitions configured</div>
                ) : transitions.map((t) => (
                  <Item key={t.id} onSelect={() => onApplyTransition?.(t.id)}>{t.name}</Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Separator className="my-1 h-px bg-[#2a3232]" />
          <Item icon={<Trash2 className="w-3.5 h-3.5 text-red-300" />} danger onSelect={() => (onDelete ? setConfirmOpen(true) : toast.info("Delete not wired"))}>Delete</Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>

    <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[70]" style={{ background: "rgba(0,0,0,0.7)" }} />
        <AlertDialog.Content
          className="fixed left-1/2 top-1/2 z-[71] w-full max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-lg border p-4 shadow-2xl focus:outline-none"
          style={{ borderColor: "#2a3232", background: "#1e2525", color: "#e4e4e7" }}
        >
          <AlertDialog.Title className="text-[13px] font-semibold text-zinc-100">
            Delete this slide?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[11px] text-zinc-400 leading-relaxed">
            This cannot be undone.
          </AlertDialog.Description>
          <div className="mt-4 flex items-center justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button className="h-8 px-3 rounded-md border text-[11px] font-semibold text-zinc-200 hover:bg-white/5"
                style={{ borderColor: "#2a3232", background: "#1a2020" }}>
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                onClick={() => onDelete?.()}
                className="h-8 px-3 rounded-md text-[11px] font-semibold text-white bg-red-600 hover:bg-red-500"
              >
                Delete
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
    </>
  );
}

function Item({
  children, icon, onSelect, danger,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onSelect?: () => void;
  danger?: boolean;
}) {
  return (
    <ContextMenu.Item
      onSelect={(e) => { e.preventDefault(); onSelect?.(); }}
      className={`flex items-center gap-2 px-2 h-7 rounded-sm hover:bg-white/5 outline-none cursor-default ${danger ? "text-red-300" : ""}`}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
    </ContextMenu.Item>
  );
}
