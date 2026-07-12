"use client";
/**
 * Keyboard Shortcuts overlay. Radix Dialog — Escape / click-outside dismiss
 * for free. Opened from either "?" hotkey, the "?" button in BottomBar, or
 * the Electron Help menu item.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

type Row = { keys: string; label: string };

const NAV_ROWS: Row[] = [
  { keys: "Space / →", label: "Next slide" },
  { keys: "←", label: "Previous slide" },
  { keys: "Enter", label: "Send preview to live (respects Safe Mode)" },
  { keys: "Escape", label: "Kill live output (blank)" },
  { keys: "1 – 9", label: "Jump to slide N in current item" },
  { keys: "?", label: "Open this help overlay" },
];

const ACTION_ROWS: Row[] = [
  { keys: "B", label: "Blank screen" },
  { keys: "L", label: "Church logo screen" },
  { keys: "⌘/Ctrl + K", label: "Open search palette" },
  { keys: "⌘/Ctrl + B", label: "Switch center to Bible mode" },
  { keys: "⌘/Ctrl + M", label: "Switch center to Media mode" },
  { keys: "⌘/Ctrl + S", label: "Switch center to Songs mode" },
  { keys: "⌘/Ctrl + P", label: "Switch center to Playlist mode" },
];

function KeyLabel({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-panel)] text-[11px] font-mono text-[var(--color-foreground)] whitespace-nowrap">
      {children}
    </kbd>
  );
}

function Column({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="eyebrow">{title}</div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.keys} className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[var(--color-muted-foreground)]">
              {r.label}
            </span>
            <KeyLabel>{r.keys}</KeyLabel>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ShortcutsHelpOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-6 shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <Dialog.Title className="text-[15px] font-semibold text-[var(--color-foreground)]">
                Keyboard Shortcuts
              </Dialog.Title>
              <p className="text-[11px] text-[var(--color-muted-foreground)] mt-1">
                Global shortcuts work anywhere in the operator window (except while typing in a text field).
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Column title="Navigation" rows={NAV_ROWS} />
            <Column title="Actions" rows={ACTION_ROWS} />
          </div>

          <div className="mt-5 pt-4 border-t border-[var(--color-border)] text-[11px] text-[var(--color-muted-foreground)]">
            Press <KeyLabel>Esc</KeyLabel> or click outside to close.
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
