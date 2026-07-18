"use client";

/**
 * Macros tab is intentionally a placeholder — the storage-format is defined
 * (`presentflow.pro.macros.v1`) but no runtime executes them. Rather than
 * let operators build muscle memory around a dead feature, gate the entire
 * tab behind a coming-soon panel until we wire hotkey + slide-show hooks.
 */
export function MacrosTab() {
  return (
    <div className="flex flex-col gap-3 py-6 text-center">
      <div className="text-sm font-semibold">Macros — coming soon</div>
      <div className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed px-3">
        Hotkey and slide-show triggers aren&apos;t wired up yet. This tab will be
        enabled in a future release. Use keyboard shortcuts (see <kbd>?</kbd>)
        in the meantime.
      </div>
    </div>
  );
}
