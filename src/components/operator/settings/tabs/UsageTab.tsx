"use client";
import { useEffect, useState } from "react";
import { SectionHeader } from "./DisplayTab";

type UsageData = {
  transcription: { used: number; quota: number | null; label: string };
  contextSearches: { used: number; quota: number | null; label: string };
  customThemes: { used: number; quota: number | null; label: string };
  broadcastOutputs: { label: string };
  tier: "free" | "pilot" | "max";
};

export function UsageTab({ onUpgrade }: { onUpgrade: () => void }) {
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/usage", { credentials: "include" });
        if (!r.ok) { setError("Could not load usage"); return; }
        const j = await r.json();
        setData(j);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  return (
    <div className="space-y-5">
      <SectionHeader title="Usage" description="Weekly and monthly quotas for your current plan." />

      {error && <div className="text-[11px] text-red-400">{error}</div>}
      {!data && !error && <div className="text-[11px] text-zinc-500">Loading…</div>}

      {data && (
        <div className="space-y-3">
          <QuotaTile
            title="Transcription Time"
            desc="Resets weekly"
            used={data.transcription.used}
            quota={data.transcription.quota}
            unit="min"
          />
          <QuotaTile
            title="Context Searches"
            desc="Resets monthly"
            used={data.contextSearches.used}
            quota={data.contextSearches.quota}
            unit="searches"
          />
          <QuotaTile
            title="Custom Themes"
            desc="Total"
            used={data.customThemes.used}
            quota={data.customThemes.quota}
            unit=""
          />
          <div className="p-3 rounded-md border" style={{ borderColor: "#2a3232", background: "#1a2020" }}>
            <div className="text-[12px] font-semibold text-zinc-100">Broadcast Outputs</div>
            <div className="text-[11px] text-zinc-400 mt-0.5">{data.broadcastOutputs.label}</div>
          </div>

          {data.tier !== "max" && (
            <button
              onClick={onUpgrade}
              className="w-full h-11 rounded-md text-[12px] font-semibold text-white"
              style={{ background: "#f97316" }}
            >
              Upgrade for unlimited access →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function QuotaTile({ title, desc, used, quota, unit }: { title: string; desc: string; used: number; quota: number | null; unit: string }) {
  const unlimited = quota == null;
  const pct = unlimited ? 100 : Math.min(100, Math.round((used / Math.max(1, quota)) * 100));
  return (
    <div className="p-3 rounded-md border" style={{ borderColor: "#2a3232", background: "#1a2020" }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[12px] font-semibold text-zinc-100">{title}</div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mt-0.5">{desc}</div>
        </div>
        <div className="text-[11px] font-mono text-zinc-300">
          {unlimited ? "Unlimited" : `${used} / ${quota} ${unit}`}
        </div>
      </div>
      <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "#232929" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: unlimited ? "#10b981" : pct > 80 ? "#f97316" : "#38bdf8" }} />
      </div>
    </div>
  );
}
