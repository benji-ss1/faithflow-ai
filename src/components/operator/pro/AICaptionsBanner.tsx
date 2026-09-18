"use client";
/**
 * Task 5 — reconnect-failed banner.
 *
 * Persistent operator banner mounted at top of ProOperatorShell after the
 * audio reconnect loop has exhausted its 8-attempt budget. It uses the same
 * PresentFlow surface, token and button treatment as the rest of the shell.
 */
import type { OperatorShellCtx } from "../shell/types";

export function AICaptionsBanner({ ctx }: { ctx: OperatorShellCtx }) {
  const failed = ctx.audio.reconnectFailed;
  if (!failed) return null;
  const onRetry = () => {
    if (ctx.onRestartAudio) ctx.onRestartAudio();
    else if (ctx.onResumeAudio) ctx.onResumeAudio();
    else ctx.onListenToggle();
  };
  return (
    <div
      role="alert"
      data-testid="ai-captions-banner"
      className="shrink-0 w-full flex items-center gap-3 border-b border-[var(--color-warning)]/45 bg-[var(--color-elevated)] px-4 py-2 text-[12px] text-[var(--color-foreground)] shadow-[var(--edge-top),var(--shadow-sm)]"
    >
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-warning)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-warning)_20%,transparent)]" />
      <span className="min-w-0 flex-1">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-warning)]">AI unavailable</span>
        <span className="ml-2 text-[var(--color-muted-foreground)]">Manual mode is active — Preview and Send Live still work.</span>
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="h-[26px] shrink-0 rounded-md bg-[var(--color-brand)] px-2.5 text-[11px] font-bold text-white transition hover:bg-[var(--color-brand-hi)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
      >
        Retry AI
      </button>
    </div>
  );
}
