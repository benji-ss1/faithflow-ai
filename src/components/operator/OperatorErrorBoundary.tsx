"use client";
import { Component, type ReactNode } from "react";

/**
 * Class-based error boundary — React still requires a class for
 * componentDidCatch / getDerivedStateFromError. Wraps the operator shell
 * so a rendering exception inside any panel (Bible mode, Songs browser,
 * AI detections, output preview) doesn't nuke the entire operator UI
 * mid-service. Instead: the shell keeps rendering, the crashed subtree
 * gets a recovery card with a "Reload panel" action.
 *
 * Also reports the error to console (and would report to a telemetry
 * sink in prod if one existed).
 */

type Props = { children: ReactNode; fallbackLabel?: string };
type State = { error: Error | null };

export class OperatorErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Prefix so it's grep-able in Vercel logs / desktop devtools.
    console.error("[operator-error-boundary]", error.message, {
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-4 bg-[var(--color-panel)]">
        <div className="text-4xl" aria-hidden>⚠️</div>
        <div className="text-sm font-semibold">
          {this.props.fallbackLabel ?? "This panel hit an error"}
        </div>
        <div className="text-[11px] text-[var(--color-muted-foreground)] max-w-md leading-relaxed">
          The rest of the operator is still running. Click below to reload
          this panel — the service isn&apos;t interrupted.
        </div>
        <details className="text-[10px] text-[var(--color-muted-foreground)] max-w-md w-full">
          <summary className="cursor-pointer opacity-70 hover:opacity-100">Show error</summary>
          <pre className="mt-2 text-left overflow-auto p-2 bg-[var(--color-elevated)] rounded border border-[var(--color-border)] max-h-[200px]">
            {error.message}
            {error.stack ? "\n\n" + error.stack.split("\n").slice(0, 8).join("\n") : ""}
          </pre>
        </details>
        <div className="flex gap-2">
          <button
            onClick={this.reset}
            className="h-9 px-4 rounded-md bg-[var(--color-brand)] text-black text-sm font-semibold"
          >
            Reload panel
          </button>
          <button
            onClick={() => window.location.reload()}
            className="h-9 px-4 rounded-md border border-[var(--color-border)] text-sm font-semibold"
          >
            Reload whole app
          </button>
        </div>
      </div>
    );
  }
}
