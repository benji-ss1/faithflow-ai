"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { Palette, X } from "lucide-react";
import { ThemesTab } from "./right/tabs/ThemesTab";

/**
 * Full-screen Themes manager for the desktop operator shell.
 *
 * Replaces the cramped right-sidebar Themes popover. Opened from the "Themes"
 * button in the top nav bar (which dispatches `presentflow:open-themes-settings`
 * — RightIconBar owns that listener and controls `open` here). Mirrors the
 * DesktopSlideEditorModal chrome (Radix Dialog, big centred panel, header +
 * close) so Themes feels like a first-class operator surface, not a widget.
 *
 * The body is the existing `ThemesTab` rendered in its spacious `modal` layout,
 * so all the proven fetch/apply/import/swatch logic stays single-sourced.
 */
export function ThemesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70]" style={{ background: "rgba(0,0,0,0.6)" }} />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[71] -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-[1100px] h-[86vh] flex flex-col rounded-xl overflow-hidden border shadow-2xl outline-none"
          style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}
        >
          <header className="h-12 shrink-0 flex items-center gap-2 px-4 border-b" style={{ borderColor: "var(--color-border)", background: "var(--color-elevated)" }}>
            <Palette className="w-4 h-4 text-[var(--color-brand)]" />
            <Dialog.Title className="text-[13px] font-semibold text-[var(--color-foreground)]">Themes</Dialog.Title>
            <span className="text-[11px] text-[var(--color-muted-foreground)]">— projector, stage &amp; livestream look</span>
            <button
              onClick={onClose}
              className="ml-auto grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted-foreground)] hover:bg-white/[0.06] hover:text-[var(--color-foreground)]"
              aria-label="Close themes"
            >
              <X className="w-4 h-4" />
            </button>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto p-5 pf-transcript-scroll">
            <ThemesTab layout="modal" />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
