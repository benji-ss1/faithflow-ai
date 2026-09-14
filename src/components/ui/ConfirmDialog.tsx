"use client";
import * as React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";

/**
 * Electron-safe confirmation dialog.
 *
 * The desktop shell runs the operator UI inside an Electron BrowserWindow where
 * native `window.confirm()` blocks the renderer's event loop and can freeze the
 * app (see the alerts/dialogs constraint in the desktop build). This hook gives
 * an in-app, promise-based replacement so any `if (!confirm(...)) return` call
 * becomes `if (!(await confirm({...}))) return` with identical control flow.
 *
 * Usage:
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   async function onDelete() {
 *     if (!(await confirm({ title: "Delete?", danger: true }))) return;
 *     // proceed
 *   }
 *   return (<>{dialog}...</>);
 */
export type ConfirmOptions = {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export function useConfirm() {
  const [opts, setOpts] = React.useState<ConfirmOptions | null>(null);
  const resolverRef = React.useRef<((v: boolean) => void) | null>(null);

  const confirm = React.useCallback((options: ConfirmOptions): Promise<boolean> => {
    // If a prior dialog is somehow still pending, cancel it so its awaiter
    // never hangs forever.
    resolverRef.current?.(false);
    resolverRef.current = null;
    setOpts(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = React.useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOpts(null);
  }, []);

  // If the host unmounts (panel closed / route change) while a dialog is open,
  // resolve the pending promise as a cancel so the awaiting caller never hangs.
  React.useEffect(() => () => { resolverRef.current?.(false); resolverRef.current = null; }, []);

  const dialog = (
    <AlertDialog.Root
      open={opts != null}
      onOpenChange={(open) => {
        // Closing via overlay/Esc counts as a cancel.
        if (!open) settle(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[80]" style={{ background: "rgba(0,0,0,0.7)" }} />
        <AlertDialog.Content
          className="fixed left-1/2 top-1/2 z-[81] w-full max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-lg border p-4 shadow-2xl focus:outline-none"
          style={{ borderColor: "var(--color-border)", background: "var(--color-elevated)", color: "var(--color-foreground)" }}
        >
          <AlertDialog.Title className="text-[13px] font-semibold">
            {opts?.title}
          </AlertDialog.Title>
          {opts?.description != null && (
            <AlertDialog.Description className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted-foreground)]">
              {opts.description}
            </AlertDialog.Description>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button
                className="h-8 px-3 rounded-md border text-[11px] font-semibold hover:bg-white/5"
                style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}
              >
                {opts?.cancelLabel ?? "Cancel"}
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                onClick={() => settle(true)}
                className={
                  opts?.danger
                    ? "h-8 px-3 rounded-md text-[11px] font-semibold text-white bg-red-600 hover:bg-red-500"
                    : "h-8 px-3 rounded-md text-[11px] font-semibold text-[var(--color-primary-foreground)] bg-[var(--color-brand)] hover:opacity-90"
                }
              >
                {opts?.confirmLabel ?? "Confirm"}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );

  return { confirm, dialog };
}
