"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Home, RotateCcw } from "lucide-react";

// Route-level error boundary. Same blueprint-grid, brand-orange language as the
// 404, so an unexpected crash still looks like PresentFlow rather than a raw
// Next.js stack trace. `reset()` re-renders the failed segment.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface to the console (and Sentry via the global handler) for triage.
    console.error("[app-error]", error);
  }, [error]);

  return (
    <main className="relative min-h-screen w-full overflow-hidden flex flex-col items-center justify-center px-6 text-center"
      style={{ background: "#0a0a0c" }}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(#ffffff08 1px, transparent 1px), linear-gradient(90deg, #ffffff08 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 90% 70% at 50% 45%, #000 55%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 70% at 50% 45%, #000 55%, transparent 100%)",
        }}
      />
      <div className="relative flex flex-col items-center">
        <h1
          className="font-black leading-none select-none"
          style={{
            fontSize: "clamp(90px, 20vw, 220px)",
            color: "#e8501a14",
            WebkitTextStroke: "2px #e8501a",
            letterSpacing: "0.02em",
          }}
        >
          Oops
        </h1>
        <p className="mt-4 text-2xl sm:text-3xl font-bold text-white">Something went sideways.</p>
        <p className="mt-3 max-w-md text-[15px] sm:text-base leading-relaxed text-white/55">
          An unexpected error stopped this page from loading. Try again — if it keeps happening, restart PresentFlow.
        </p>
        {error?.digest && (
          <p className="mt-2 text-[11px] font-mono text-white/30">ref: {error.digest}</p>
        )}
        <div className="mt-8 flex items-center gap-2.5">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 h-12 px-6 rounded-xl text-[15px] font-bold transition-[filter] hover:brightness-110"
            style={{ background: "#e8501a", color: "#0b0b0e" }}
          >
            Try again <RotateCcw className="w-4 h-4" />
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 h-12 px-5 rounded-xl text-[15px] font-semibold text-white/85 hover:bg-white/[0.06]"
            style={{ border: "1px solid #ffffff1a" }}
          >
            <Home className="w-4 h-4" /> Home
          </Link>
        </div>
      </div>
    </main>
  );
}
