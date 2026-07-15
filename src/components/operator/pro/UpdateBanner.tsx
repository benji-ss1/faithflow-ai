"use client";
/**
 * UpdateBanner — surfaces electron-updater lifecycle events at the top of the
 * ProOperatorShell. Only mounts when running inside Electron (window.electronAPI
 * present with an `update` surface). The web build is a no-op.
 *
 * States:
 *   idle        → nothing rendered
 *   downloading → blue banner "Downloading update <v>…" (fires on update-available)
 *   ready       → green banner "Update <v> ready. Click to restart & install."
 *   error       → dismissible orange banner "Update check failed: <reason>"
 *
 * User clicks the ready banner → we invoke update.installNow(), electron-updater
 * quits the app, replaces the .app bundle from the downloaded zip, and relaunches.
 */
import { useEffect, useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "downloading"; version: string }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

export function UpdateBanner() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (!api || !api.update) return;

    const offAvail = api.update.onAvailable((info) => {
      setState({ kind: "downloading", version: info.version });
    });
    const offDone = api.update.onDownloaded((info) => {
      setState({ kind: "ready", version: info.version });
    });
    const offErr = api.update.onError((info) => {
      setState({ kind: "error", message: info.message });
    });

    return () => {
      try { offAvail?.(); } catch { /* noop */ }
      try { offDone?.(); } catch { /* noop */ }
      try { offErr?.(); } catch { /* noop */ }
    };
  }, []);

  if (state.kind === "idle") return null;

  if (state.kind === "downloading") {
    return (
      <div className="w-full px-4 py-2 text-sm font-medium bg-blue-600 text-white flex items-center gap-2">
        <span>⬇ Downloading update {state.version}…</span>
      </div>
    );
  }

  if (state.kind === "ready") {
    return (
      <button
        onClick={async () => {
          const api = window.electronAPI;
          if (!api?.update) return;
          try {
            await api.update.installNow();
          } catch (err) {
            console.error("[UpdateBanner] installNow failed", err);
          }
        }}
        className="w-full px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-2 cursor-pointer"
      >
        <span>✓ Update {state.version} ready. Click here to restart &amp; install.</span>
      </button>
    );
  }

  // error
  if (dismissedError === state.message) return null;
  return (
    <div className="w-full px-4 py-2 text-sm font-medium bg-orange-500 text-white flex items-center justify-between gap-2">
      <span>⚠ Update check failed: {state.message}</span>
      <button
        onClick={() => setDismissedError(state.message)}
        className="ml-2 px-2 py-0.5 rounded hover:bg-orange-600 text-xs"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
