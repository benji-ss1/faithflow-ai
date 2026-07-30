"use client";
/**
 * UpdateBanner — surfaces electron-updater lifecycle events at the top of the
 * ProOperatorShell. Only mounts when running inside Electron (window.electronAPI
 * present with an `update` surface). The web build is a no-op.
 *
 * States:
 *   idle              → nothing rendered
 *   manual-available  → violet banner "Update <v> available. Click to download."
 *                       Only surfaces on unsigned builds where the Squirrel
 *                       auto-update gate in electron/main.ts:641 is closed.
 *                       Polls the GitHub release API instead of relying on
 *                       electron-updater. Click opens the release page in the
 *                       default browser so the operator can install manually.
 *   downloading       → blue banner "Downloading update <v>…" (auto-updater path)
 *   ready             → green banner "Update <v> ready. Click to restart & install."
 *                       (blocks installNow mid-service; confirms before killing projection)
 *   error             → dismissible orange banner "Update check failed: <reason>"
 *
 * Live-service guard: if AI is listening OR the live slide is anything other
 * than empty/blank, we refuse installNow without an explicit confirm. Auto
 * install-on-quit is fine because quit itself is user-initiated.
 */
import { useEffect, useRef, useState } from "react";
import type { SlidePayload } from "@/lib/broadcast";

const GITHUB_LATEST_URL = "https://api.github.com/repos/benji-ss1/faithflow-ai/releases/latest";
const GITHUB_RELEASE_PAGE = "https://github.com/benji-ss1/faithflow-ai/releases/latest";
const MANUAL_POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const MANUAL_POLL_INITIAL_DELAY_MS = 15 * 1000; // 15s after mount
// Per-version dismissal — once the user X's the banner for 0.1.102, don't
// re-show it until 0.1.103+ ships as a tagged DMG release. Avoids the
// old-and-stale banner spam when the web app has moved past the last
// tagged DMG but no new DMG has actually been cut.
const DISMISSED_MANUAL_KEY = "presentflow.updateBanner.dismissedVersion";

// Compare two semver-ish strings ("0.1.71" vs "0.1.36"). Returns >0 if a>b.
// Ignores pre-release tags. Missing components treated as 0.
function compareSemver(a: string, b: string): number {
  const parse = (s: string) => s.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  return (a1 - b1) || (a2 - b2) || (a3 - b3);
}

type State =
  | { kind: "idle" }
  | { kind: "manual-available"; version: string; url: string }
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

  // Manual poll — for unsigned builds where the Squirrel auto-updater gate
  // (electron/main.ts:641) refuses to initialize. This is the reality for every
  // tester today; without this poll they'd never learn a new DMG exists. Skips
  // when the auto-updater path is already active (downloading/ready/error) so
  // signed builds don't get a duplicate surface.
  useEffect(() => {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (!api?.app?.version) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      try {
        const current = await api.app.version();
        if (cancelled || typeof current !== "string") return;
        const res = await fetch(GITHUB_LATEST_URL, {
          headers: { Accept: "application/vnd.github+json" },
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json() as { tag_name?: string; html_url?: string };
        const latest = (data.tag_name || "").replace(/^v/, "");
        if (!latest) return;
        if (compareSemver(latest, current) > 0) {
          // Respect a prior dismissal for this exact tag — user X'd it out,
          // don't nag until a NEWER DMG tag actually ships.
          let dismissed: string | null = null;
          try { dismissed = window.localStorage.getItem(DISMISSED_MANUAL_KEY); } catch { /* noop */ }
          if (dismissed && compareSemver(dismissed, latest) >= 0) {
            // Also clear any stale banner state so a re-poll after dismissal
            // doesn't leave the banner up.
            setState((prev) => (prev.kind === "manual-available" ? { kind: "idle" } : prev));
            return;
          }
          // Newer release available AND not dismissed. Keep any downloading/
          // ready/error state the auto-updater path may have set; only claim
          // the banner from idle OR refresh a stale manual-available with
          // the new version.
          setState((prev) => {
            if (prev.kind === "idle") return { kind: "manual-available", version: latest, url: data.html_url || GITHUB_RELEASE_PAGE };
            if (prev.kind === "manual-available" && prev.version !== latest) return { kind: "manual-available", version: latest, url: data.html_url || GITHUB_RELEASE_PAGE };
            return prev;
          });
        } else {
          // Shell has caught up to (or passed) the latest release. Clear a
          // stale manual-available banner that was set during an earlier
          // poll when the shell was behind. Don't clobber downloading/ready/
          // error (auto-updater path).
          setState((prev) => (prev.kind === "manual-available" ? { kind: "idle" } : prev));
        }
      } catch { /* silent — offline / rate-limited / network flap */ }
    };

    const schedule = (delay: number) => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        await check();
        schedule(MANUAL_POLL_INTERVAL_MS);
      }, delay);
    };
    schedule(MANUAL_POLL_INITIAL_DELAY_MS);

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  if (state.kind === "idle") return null;

  if (state.kind === "manual-available") {
    const openDownload = async () => {
      // 2026-07-30 field-fix — three-tier open ladder. The IPC path
      // (shell:openExternal) has a strict hostname allowlist that excludes
      // github.com, so on shells older than the fix that adds it, the click
      // was silently a no-op. Fallbacks:
      //   1. IPC → shell.openExternal (works on future shells that allowlist
      //      github.com; may return {ok:false} today).
      //   2. window.open → main's setWindowOpenHandler routes to
      //      shell.openExternal DIRECTLY, bypassing the allowlist (works on
      //      current v0.1.102 shell). This is the primary path today.
      //   3. Clipboard + toast fallback — if both above fail, copy the URL
      //      so the operator can paste it into a browser manually.
      let opened = false;
      try {
        const res = await window.electronAPI?.shell?.openExternal(state.url);
        if (res && typeof res === "object" && "ok" in res && res.ok === true) opened = true;
      } catch { /* fall through */ }
      if (!opened) {
        try {
          const w = window.open(state.url, "_blank", "noopener,noreferrer");
          if (w) opened = true;
        } catch { /* fall through */ }
      }
      if (!opened) {
        try {
          await navigator.clipboard?.writeText(state.url);
          const { toast } = await import("sonner");
          toast.info(`Download URL copied — paste into your browser: ${state.url}`, { duration: 20_000, id: "update-url-copy" });
        } catch {
          console.error("[UpdateBanner] failed to open or copy URL", state.url);
        }
      }
    };
    return (
      <div
        className="w-full px-4 py-2 text-sm font-medium text-white flex items-center justify-center gap-2 bg-violet-600"
        title="Open the release page in your browser to download the latest DMG"
      >
        <button
          onClick={openDownload}
          className="flex-1 text-center hover:underline cursor-pointer"
        >
          ⬇ Update {state.version} available — click to download the new DMG (right-click → Open on first launch)
        </button>
        <button
          onClick={() => {
            try { window.localStorage.setItem(DISMISSED_MANUAL_KEY, state.version); } catch { /* noop */ }
            setState({ kind: "idle" });
          }}
          aria-label="Dismiss this update notice"
          title="Dismiss — banner will not reappear until a newer DMG is tagged"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-violet-700/60 text-white/80 hover:text-white text-lg leading-none"
        >
          ×
        </button>
      </div>
    );
  }

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
            const res = await api.update.installNow();
            // installNow resolves with {ok:false, error} on a caught failure
            // (e.g. a code-signature mismatch Squirrel refuses to swap) rather
            // than throwing — previously this was never checked, so a failed
            // install silently did nothing: no quit, no error, no feedback at
            // all. The app is still running at this point (install didn't
            // happen), so surface it as an error state instead of leaving the
            // operator staring at a button that appears to do nothing.
            if (res && typeof res === "object" && "ok" in res && res.ok === false) {
              const message = "error" in res && typeof res.error === "string" ? res.error : "Install failed";
              console.error("[UpdateBanner] installNow returned failure:", message);
              setState({ kind: "error", message: /code ?sign/i.test(message)
                ? "Install blocked — this app's original install predates code signing. Download and reinstall manually once from Settings → Desktop app; future updates will then install automatically."
                : `Install failed — ${message}` });
            }
          } catch (err) {
            console.error("[UpdateBanner] installNow failed", err);
            setState({ kind: "error", message: err instanceof Error ? err.message : "Install failed" });
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
