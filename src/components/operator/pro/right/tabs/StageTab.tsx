"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ScreensPanel } from "../../../screens/ScreensPanel";
import type { OperatorShellCtx } from "../../../shell/types";
import type { DisplayInfo } from "@/types/electron";

const RESOLUTIONS = [
  "720p59.94", "1080p30", "1080i50", "1080i59.94",
  "1080p50", "1080p59.94", "1080p60",
  "4Kp25", "4Kp30", "4Kp50", "4Kp60", "Custom Size…",
];

export function StageTab({ ctx: _ctx }: { ctx: OperatorShellCtx }) {
  const [displays, setDisplays] = useState<DisplayInfo[] | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) return;
    void window.electronAPI.screens.list().then(setDisplays);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="eyebrow mb-1">Resolution</div>
        <select className="w-full h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded">
          {RESOLUTIONS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </div>

      <div>
        <div className="eyebrow mb-1">Displays</div>
        {displays === null ? (
          <div className="text-[var(--color-muted-foreground)] py-2">Detecting displays…</div>
        ) : displays.length === 0 ? (
          <div className="text-[var(--color-muted-foreground)] py-2">No displays detected.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {displays.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-2 py-1 rounded bg-[var(--color-elevated)]">
                <span>Display {d.id}</span>
                <span className="text-[10px] font-mono text-[var(--color-muted-foreground)]">{d.bounds?.width}×{d.bounds?.height}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog.Root>
        <Dialog.Trigger asChild>
          <button className="w-full h-9 rounded-md bg-[var(--color-brand)] text-black font-semibold">
            Configure Screens…
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] max-h-[80vh] bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg z-50 flex flex-col overflow-hidden">
            <Dialog.Title className="px-4 h-11 flex items-center border-b border-[var(--color-border)] font-semibold">
              Screens
            </Dialog.Title>
            <div className="overflow-y-auto"><ScreensPanel /></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
