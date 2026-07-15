"use client";
/**
 * Task 5 — reconnect-failed banner.
 *
 * Persistent orange banner mounted at top of ProOperatorShell that appears
 * only when the audio reconnect loop has exhausted its 8-attempt budget.
 * Provides a "Retry now" button that calls the manual restart handler.
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
      className="shrink-0 w-full flex items-center gap-3 px-3 py-1.5 bg-amber-500/90 text-amber-950 border-b border-amber-700 text-[12px] font-semibold"
    >
      <span aria-hidden>⚠</span>
      <span className="flex-1 truncate">Live captions paused, reconnecting…</span>
      <button
        type="button"
        onClick={onRetry}
        className="h-[24px] px-2 rounded-md text-[11px] font-bold bg-amber-950 text-amber-100 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-900"
      >
        Retry now
      </button>
    </div>
  );
}
