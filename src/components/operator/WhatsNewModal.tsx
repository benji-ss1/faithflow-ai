"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Sparkles, X } from "lucide-react";
import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";

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
      if (cmpVersion(lastSeen, currentVersion) >= 0) return;

      const newer = CHANGELOG.filter(
        (e) => cmpVersion(e.version, lastSeen!) > 0 && cmpVersion(e.version, currentVersion) <= 0,
      );
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
                  {entry.highlights.map((h, i) => (
                    <li key={i} className="list-disc">{h}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-[var(--color-border)] flex justify-end">
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
