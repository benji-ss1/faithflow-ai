"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, ExternalLink, Shield } from "lucide-react";

const SAFE_MODE_KEY = "presentflow.safeMode";

/**
 * PropPresenter-style operator settings modal. This is a MINIMAL first-cut
 * that surfaces the operator-critical toggles inline (Safe Mode is the only
 * per-shell behavior toggle right now). All other settings still live on the
 * web portal and open there via `shell:openExternal`.
 *
 * Follow-ups (see DECISIONS.md): inline Audio Input picker, inline Screen
 * Assignment editor (extract from `/settings/screens`), AI Listening default,
 * Default Bible Translation, Transition Defaults. Each is a section-sized
 * addition and can land independently without changing this shell.
 */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [safeMode, setSafeMode] = useState(false); // default OFF — user directive: single-click sends live
  useEffect(() => {
    if (!open) return;
    try {
      const v = window.localStorage.getItem(SAFE_MODE_KEY);
      // Missing key → default OFF. Only "1" flips on.
      setSafeMode(v === "1");
    } catch { /* noop */ }
  }, [open]);

  function toggleSafeMode() {
    setSafeMode((v) => {
      const nv = !v;
      try { window.localStorage.setItem(SAFE_MODE_KEY, nv ? "1" : "0"); } catch { /* noop */ }
      return nv;
    });
  }

  function openWebPortal() {
    const url = process.env.NEXT_PUBLIC_APP_URL || "https://presentflow.app";
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (api?.shell?.openExternal) {
      api.shell.openExternal(url);
    } else {
      window.open(url, "_blank", "noopener");
    }
  }

  // Y7: switched to Radix Dialog — provides role="dialog", aria-modal, focus
  // trap, ESC-to-close, backdrop-click-to-close, and portal by default.
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60]" style={{ background: "rgba(0,0,0,0.7)" }} />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[61] w-full max-w-[560px] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border shadow-2xl focus:outline-none"
          style={{ borderColor: "#2a3232", background: "#1e2525" }}
        >
        <div className="flex items-center justify-between h-11 px-4 border-b" style={{ borderColor: "#2a3232" }}>
          <Dialog.Title className="text-[12px] font-semibold uppercase tracking-[0.16em] text-zinc-200">Settings</Dialog.Title>
          <Dialog.Close asChild>
            <button className="h-7 w-7 rounded-md inline-flex items-center justify-center text-zinc-400 hover:bg-white/5 hover:text-zinc-100" aria-label="Close settings">
              <X className="w-4 h-4" />
            </button>
          </Dialog.Close>
        </div>

        <div className="p-4 space-y-4">
          <section className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Operator behavior</div>
            <button onClick={toggleSafeMode}
              className="w-full flex items-start gap-3 p-3 rounded-md border text-left hover:bg-white/5"
              style={{ borderColor: "#2a3232", background: "#1a2020" }}>
              <div className="mt-0.5">
                <Shield className={safeMode ? "w-4 h-4 text-teal-300" : "w-4 h-4 text-zinc-500"} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-zinc-100 flex items-center gap-2">
                  Safe Mode
                  <span className={"text-[9px] font-mono px-1.5 py-0.5 rounded " + (safeMode ? "bg-teal-500/20 text-teal-200" : "bg-zinc-700/50 text-zinc-400")}>
                    {safeMode ? "ON" : "OFF"}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                  {safeMode
                    ? "Safe Mode ON — click to preview, double-click to send live."
                    : "Safe Mode OFF (default) — single click sends live. Turn on for a preview step before broadcasting."}
                </p>
              </div>
            </button>
          </section>

          <section className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">More</div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Screens, audio input, AI defaults, Bible translation, transition defaults,
              and church-wide preferences live on the web portal.
            </p>
            <button onClick={openWebPortal}
              className="w-full h-9 px-3 rounded-md border text-[11px] font-semibold text-zinc-100 hover:bg-white/5 inline-flex items-center gap-2"
              style={{ borderColor: "#2a3232", background: "#1a2020" }}>
              <ExternalLink className="w-3.5 h-3.5" />
              Manage your church account online
            </button>
          </section>
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
