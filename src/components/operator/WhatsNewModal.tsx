"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Sparkles, X } from "lucide-react";
import { CHANGELOG, type ChangelogEntry, type Highlight } from "@/lib/changelog";

const LAST_SEEN_KEY = "presentflow.whatsNew.lastSeenVersion";

function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * "What's New" modal — shows highlights the moment the app loads if any
 * changelog entries are newer than the operator's last-seen version.
 *
 * On very first launch (no lastSeenVersion) we DON'T pop the modal —
 * first-time testers get the guided tour instead. Only true update-arrivals
 * see this. Dismissing marks the current version as seen.
 *
 * Version source: electronAPI.app.version() when running inside the shell
 * (authoritative — matches what auto-updater installed). Falls back to the
 * top-of-changelog for pure-web sessions.
 */
export function WhatsNewModal() {
  const [newEntries, setNewEntries] = useState<ChangelogEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    let popTimer: ReturnType<typeof setTimeout> | null = null;

    const evaluate = (currentVersion: string) => {
      if (cancelled) return;
      let lastSeen: string | null = null;
      try { lastSeen = window.localStorage.getItem(LAST_SEEN_KEY); } catch { /* noop */ }

      // First-ever visit: don't pop (the guided tour handles fresh testers).
      // Just record so the next update actually shows the modal.
      if (!lastSeen) {
        try { window.localStorage.setItem(LAST_SEEN_KEY, currentVersion); } catch { /* noop */ }
        return;
      }
      // R1: this used to also require cmpVersion(entry, currentVersion) <= 0
      // — fine for entries about the shell binary itself (auto-updater,
      // signing), but wrong for this app's thin-client architecture: the
      // web bundle a tester's browser/Electron shell loads is ALWAYS the
      // latest deploy regardless of the installed shell version, since the
      // shell has no code of its own beyond a thin loader. That upper-bound
      // cap meant any purely web/backend changelog entry silently never
      // showed for testers already on the current shell build (i.e. most
      // testers, most of the time) — under-notifying, which is worse than
      // occasionally over-notifying. Dropped; only the lower bound (newer
      // than last-seen) still applies.
      const newer = CHANGELOG.filter((e) => cmpVersion(e.version, lastSeen!) > 0);
      if (newer.length === 0) {
        try { window.localStorage.setItem(LAST_SEEN_KEY, currentVersion); } catch { /* noop */ }
        return;
      }
      setNewEntries(newer);
      // Small delay so the modal doesn't fight the guided-tour effect on
      // mount and doesn't feel like a startup blocker.
      popTimer = setTimeout(() => { if (!cancelled) setOpen(true); }, 600);
    };

    const w = window as Window & { electronAPI?: { app?: { version?: () => Promise<string> } } };
    const versionApi = w.electronAPI?.app?.version;
    if (versionApi) {
      versionApi()
        .then((v) => evaluate(v || CHANGELOG[0]?.version || "0.0.0"))
        .catch(() => evaluate(CHANGELOG[0]?.version || "0.0.0"));
    } else {
      evaluate(CHANGELOG[0]?.version || "0.0.0");
    }

    return () => {
      cancelled = true;
      if (popTimer) clearTimeout(popTimer);
    };
  }, []);

  const dismiss = () => {
    setOpen(false);
    const top = newEntries[0]?.version;
    if (top) {
      try { window.localStorage.setItem(LAST_SEEN_KEY, top); } catch { /* noop */ }
    }
  };

  if (newEntries.length === 0) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) dismiss(); else setOpen(v); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[520px] max-w-[92vw] max-h-[85vh] overflow-hidden flex flex-col bg-[var(--color-panel)] border border-[var(--color-border)] rounded-xl shadow-2xl"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[var(--color-brand)]" />
              <Dialog.Title className="text-base font-semibold">What&apos;s new</Dialog.Title>
            </div>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {newEntries.map((entry) => (
              <div key={entry.version}>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="text-sm font-semibold">v{entry.version} — {entry.headline}</div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">{entry.date}</div>
                </div>
                <ul className="text-[12px] leading-relaxed text-[var(--color-muted-foreground)] space-y-1 pl-4">
                  {entry.highlights.map((h: Highlight, i) => {
                    const text = typeof h === "string" ? h : h.text;
                    const tryItHref = typeof h === "string" ? undefined : h.tryItHref;
                    const tryItLabel = typeof h === "string" ? undefined : h.tryItLabel;
                    const highlightParam = typeof h === "string" ? undefined : h.highlightParam;
                    const href = tryItHref && highlightParam ? `${tryItHref}?highlight=${encodeURIComponent(highlightParam)}` : tryItHref;
                    return (
                      <li key={i} className="list-disc">
                        {text}
                        {href && (
                          // next/link — a plain <a> here would force a full
                          // page reload of the whole bundle just to jump to
                          // another in-app route, a real cost in this
                          // thin-client Electron shell (review finding).
                          <Link
                            href={href}
                            onClick={dismiss}
                            className="ml-2 inline-flex items-center text-[var(--color-brand)] hover:underline font-semibold not-italic"
                          >
                            {tryItLabel || "Try it"} →
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-[var(--color-border)] flex justify-between items-center gap-2">
            <button
              onClick={async () => {
                // "Reset & re-sync" — nuclear option for stale caches:
                //  1. Clear all Cache Storage entries (service-worker caches)
                //  2. Unregister service workers
                //  3. Preserve auth-related localStorage (session cookie is HttpOnly
                //     so a reload keeps you signed in) but wipe app-state keys so
                //     the fresh bundle starts clean
                //  4. location.reload(true) — hard reload bypassing memory cache
                try {
                  if (typeof caches !== "undefined") {
                    const keys = await caches.keys();
                    await Promise.all(keys.map((k) => caches.delete(k)));
                  }
                } catch { /* noop */ }
                try {
                  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(regs.map((r) => r.unregister()));
                  }
                } catch { /* noop */ }
                try {
                  // Keep only keys that would be inconvenient to lose (theme, tour flag).
                  const keep = new Set([
                    "presentflow.pro.autoApprove.v1",
                    "presentflow.operator.safeMode",
                    "presentflow.tour.seen",
                  ]);
                  const toRemove: string[] = [];
                  for (let i = 0; i < window.localStorage.length; i++) {
                    const k = window.localStorage.key(i);
                    if (k && !keep.has(k)) toRemove.push(k);
                  }
                  for (const k of toRemove) window.localStorage.removeItem(k);
                } catch { /* noop */ }
                try {
                  window.location.reload();
                } catch { /* noop */ }
              }}
              className="h-9 px-3 rounded-md border border-[var(--color-border)] text-[12px] font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-elevated)]"
              title="Clear all caches + service workers + reload with a fresh bundle from the server"
            >
              Reset & re-sync
            </button>
            <button
              onClick={dismiss}
              className="h-9 px-4 rounded-md bg-[var(--color-brand)] text-black text-sm font-semibold"
            >
              Got it
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
