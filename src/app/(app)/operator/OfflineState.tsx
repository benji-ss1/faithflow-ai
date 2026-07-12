"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw, Stethoscope } from "lucide-react";

export function OfflineState() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-10 shadow-[0_28px_80px_rgba(0,0,0,0.28)]">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[rgba(255,144,72,0.28)] bg-[rgba(255,144,72,0.08)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#ff9048]">
          <AlertTriangle className="h-3 w-3" /> Offline
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Temporarily unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          We couldn't reach your service plans right now. This is usually a network hiccup or a
          brief database blip. Retry in a moment, or open Diagnostics to check what's happening.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            onClick={() => router.refresh()}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-foreground hover:bg-white/[0.08]"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
          <Link
            href="/setup/diagnostics"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-foreground hover:bg-white/[0.06]"
          >
            <Stethoscope className="h-4 w-4" /> Diagnostics
          </Link>
        </div>
      </div>
    </div>
  );
}
