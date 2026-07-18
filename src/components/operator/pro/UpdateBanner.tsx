"use client";
/**
 * UpdateBanner — surfaces electron-updater lifecycle events at the top of the
 * ProOperatorShell. Only mounts when running inside Electron (window.electronAPI
 * present with an `update` surface). The web build is a no-op.
 *
 * States:
 *   idle        → nothing rendered
 *   downloading → blue banner "Downloading update <v>…" (with 60s hang watchdog)
 *   ready       → green banner "Update <v> ready. Click to restart & install."
 *                 (blocks installNow mid-service; confirms before killing projection)
 *   error       → dismissible orange banner "Update check failed: <reason>"
 *
 * Live-service guard: if AI is listening OR the live slide is anything other
 * than empty/blank, we refuse installNow without an explicit confirm. Auto
 * install-on-quit is fine because quit itself is user-initiated.
 */
import { useEffect, useRef, useState } from "react";
import type { SlidePayload } from "@/lib/broadcast";

type State =
  | { kind: "idle" }
  | { kind: "downloading"; version: string }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

export function UpdateBanner({ liveSlide, listening }: { liveSlide?: SlidePayload; listening?: boolean } = {}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (!api || !api.update) return;

    const clearStall = () => {
      if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
    };

    const offAvail = api.update.onAvailable((info) => {
      setState({ kind: "downloading", version: info.version });
      // Stall watchdog: if the .zip never lands within 5 min, surface an error
      // banner so the operator isn't staring at a permanent "Downloading…"
      // (partial CDN, aborted TCP, GitHub outage all trigger this path).
      clearStall();
      stallTimerRef.current = setTimeout(() => {
        setState({ kind: "error", message: "Download stalled — restart the app to retry." });
      }, 5 * 60 * 1000);
    });
    const offDone = api.update.onDownloaded((info) => {
      clearStall();
      setState({ kind: "ready", version: info.version });
    });
    const offErr = api.update.onError((info) => {
      clearStall();
      setState({ kind: "error", message: info.message });
    });

    return () => {
      clearStall();
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
    const inService = (liveSlide && liveSlide.kind !== "empty" && liveSlide.kind !== "blank") || !!listening;
    return (
      <button
        onClick={async () => {
          const api = window.electronAPI;
          if (!api?.update) return;
          if (inService) {
            // Never silently kill a running service. Confirm intent — the
            // dialog is intentionally blocking, this is a big deal (the app
            // quits + relaunches + Deepgram session ends + BroadcastChannel
            // to all output windows drops).
            const ok = window.confirm(
              "A service is currently live.\n\nInstalling the update will quit and restart Present Flow — the projector will go blank for a few seconds and the AI listening session will end.\n\nInstall now anyway?",
            );
            if (!ok) return;
          }
          try {
            await api.update.installNow();
          } catch (err) {
            console.error("[UpdateBanner] installNow failed", err);
          }
        }}
        className={`w-full px-4 py-2 text-sm font-medium text-white flex items-center justify-center gap-2 cursor-pointer ${inService ? "bg-amber-600 hover:bg-amber-500" : "bg-emerald-600 hover:bg-emerald-500"}`}
        title={inService ? "A service is live — confirm before installing" : "Install and relaunch"}
      >
        <span>
          {inService ? "⚠ " : "✓ "}
          Update {state.version} ready. {inService ? "Confirm to restart mid-service." : "Click here to restart & install."}
        </span>
      </button>
    );
  }

  // error
  if (dismissedError === state.message) return null;
  return (
    <div className="w-full px-4 py-2 text-sm font-medium bg-orange-500 text-white flex items-center justify-between gap-2">
      <span>⚠ Update check failed: {state.message}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={async () => {
            const api = window.electronAPI;
            const retry = api?.update && "retryDownload" in api.update ? (api.update as { retryDownload?: () => Promise<unknown> }).retryDownload : undefined;
            if (!retry) {
              // Older shells (pre-v0.1.6) don't have retryDownload IPC.
              // Surface a clear message instead of a dead click.
              setState({ kind: "error", message: "Retry not supported in this shell version — quit and relaunch Present Flow to trigger a fresh update check." });
              return;
            }
            const prev = state;
            setState({ kind: "downloading", version: "…" });
            try {
              await retry();
              // updater will fire update-downloaded on success → onDownloaded resets state
            } catch (err) {
              // Restore an error state rather than leaving 'downloading…' stuck forever.
              setState({
                kind: "error",
                message: err instanceof Error ? err.message : (prev.kind === "error" ? prev.message : "Retry failed"),
              });
            }
          }}
          className="ml-1 px-2 py-0.5 rounded bg-orange-700 hover:bg-orange-800 text-xs"
        >
          Retry
        </button>
        <button
          onClick={() => setDismissedError(state.message)}
          className="ml-1 px-2 py-0.5 rounded hover:bg-orange-600 text-xs"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
