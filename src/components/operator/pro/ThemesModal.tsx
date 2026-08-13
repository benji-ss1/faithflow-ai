"use client";
import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Palette, X } from "lucide-react";
import { ThemesManager } from "@/components/library/ThemesManager";

type ThemeRow = { id: string; name: string; config: Record<string, unknown>; isDefault?: boolean };

/**
 * Full theme DESIGN studio for the desktop operator shell.
 *
 * Opened from the "Themes" button in the top nav bar (which dispatches
 * `presentflow:open-themes-settings`; RightIconBar owns that listener and
 * controls `open` here). Hosts the same `ThemesManager` used on the web
 * /library/themes page — the real editor: typography, background
 * (solid/gradient/image/video + animation), logo overlay, live 16:9 preview,
 * and create / edit / duplicate / delete / set-default. Themes are fetched
 * client-side from /api/themes when the modal opens.
 *
 * Live apply: `onThemeActivated` fires when a theme becomes the active look
 * (set-as-default, or saving edits to the current default). We map its config
 * to a wire ThemeAppearance and dispatch `presentflow:theme-changed` so the
 * projector/stage/livestream update immediately — same path the old apply
 * button used.
 */
export function ThemesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<ThemeRow[] | null>(null);
  const [error, setError] = useState(false);
  // Bumped each open so ThemesManager re-seeds from fresh server state.
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRows(null);
    setError(false);
    fetch("/api/themes")
      .then((r) => r.json())
      .then((data: { themes?: ThemeRow[] }) => {
        if (!alive) return;
        setRows(
          (data.themes ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            config: (t.config as Record<string, unknown>) ?? {},
            isDefault: t.isDefault ?? false,
          })),
        );
        setEpoch((e) => e + 1);
      })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [open]);

  const onThemeActivated = useCallback(async (config: Record<string, unknown>) => {
    try {
      const { themeConfigToAppearance } = await import("@/lib/theme-appearance");
      window.dispatchEvent(new CustomEvent("presentflow:theme-changed", {
        detail: { appearance: themeConfigToAppearance(config) },
      }));
    } catch { /* mapping unavailable — DB default still applies on next load */ }
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70]" style={{ background: "rgba(0,0,0,0.6)" }} />
        <Dialog.Content
          aria-describedby={undefined}
          // Centre with `inset-0 m-auto` + fixed size — NOT a translate
          // transform. A transform would make this box the containing block for
          // the theme editor's `position: fixed` overlay (and clip it via
          // overflow-hidden), trapping the "full-screen" editor inside the modal.
          className="fixed inset-0 m-auto z-[71] w-[94vw] max-w-[1280px] h-[88vh] flex flex-col rounded-xl overflow-hidden border shadow-2xl outline-none"
          style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}
        >
          <header className="h-12 shrink-0 flex items-center gap-2 px-4 border-b" style={{ borderColor: "var(--color-border)", background: "var(--color-elevated)" }}>
            <Palette className="w-4 h-4 text-[var(--color-brand)]" />
            <Dialog.Title className="text-[13px] font-semibold text-[var(--color-foreground)]">Themes</Dialog.Title>
            <span className="text-[11px] text-[var(--color-muted-foreground)]">— design the projector, stage &amp; livestream look</span>
            <button
              onClick={onClose}
              className="ml-auto grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted-foreground)] hover:bg-white/[0.06] hover:text-[var(--color-foreground)]"
              aria-label="Close themes"
            >
              <X className="w-4 h-4" />
            </button>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto p-5 pf-transcript-scroll">
            {error ? (
              <div className="text-[12px] text-[var(--color-destructive)]">Could not load themes — check your connection and reopen.</div>
            ) : rows === null ? (
              <div className="text-[12px] text-[var(--color-muted-foreground)]">Loading themes…</div>
            ) : (
              <ThemesManager key={epoch} themes={rows} churchLogoUrl={null} onThemeActivated={onThemeActivated} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
