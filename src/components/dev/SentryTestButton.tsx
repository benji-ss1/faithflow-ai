"use client";

// TEMPORARY — 2026-07-29. Verifies Sentry is receiving errors from prod.
// Remove this component and its Settings-page import once one click has
// landed in the Sentry dashboard.
export function SentryTestButton() {
  function trigger() {
    // Sentry's canonical smoke test: call an undefined function so the
    // browser throws a ReferenceError that Sentry's global handler captures.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-expressions
    (window as any).myUndefinedFunction();
  }

  return (
    <div className="mt-6 rounded-md border border-dashed border-red-500/40 bg-red-500/[0.03] p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-red-500">
        Sentry smoke test — temporary
      </div>
      <p className="mt-1 mb-3 text-xs text-muted-foreground">
        Click once to fire a test error. Confirm it appears in Sentry, then this
        button gets removed.
      </p>
      <button
        type="button"
        onClick={trigger}
        className="inline-flex h-8 items-center rounded-md bg-red-500 px-3 text-xs font-semibold text-white hover:bg-red-600"
      >
        Throw test error
      </button>
    </div>
  );
}
