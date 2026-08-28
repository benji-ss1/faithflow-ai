"use client";
import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";

export function DisplayTab() {
  const [hasElectron, setHasElectron] = useState<boolean>(false);

  useEffect(() => {
    setHasElectron(typeof window !== "undefined" && !!window.electronAPI);
  }, []);

  function openScreens() {
    // Opens the shell's Screens modal (TopToolbar listens for this window event).
    try { window.dispatchEvent(new CustomEvent("presentflow:open-screens")); } catch {}
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Display" description="Assign your projector, stage and livestream outputs to physical screens." />

      <Row label="Screen assignment">
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={openScreens}
            disabled={!hasElectron}
            className="h-8 px-3 rounded-md border text-[11px] font-semibold inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/5"
            style={{ borderColor: "#2a3232", background: "#1a2020", color: hasElectron ? "#f5f5f4" : "#a3a3a3" }}
          >
            <Monitor className="w-3.5 h-3.5" /> Open Screens panel…
          </button>
          {!hasElectron && (
            <div className="text-[10px] text-zinc-500">Only available in the Present Flow desktop app.</div>
          )}
        </div>
      </Row>

      {/* Removed 2026-08-28: "Default output", "Default aspect ratio" and
          "Show safe-area guides" wrote to localStorage keys nothing read — they
          looked like settings but changed nothing. Aspect ratio is set live in
          the operator toolbar, safe-area guides in the live inspector, and output
          routing via Screens above — so these duplicates were removed rather than
          left misleading. Re-add here only if wired to real runtime state. */}
      <p className="text-[11px] text-zinc-500 leading-relaxed">
        Aspect ratio and safe-area guides are set live from the operator toolbar and the
        output inspector, so they always match what’s on the projector.
      </p>
    </div>
  );
}

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-zinc-100">{title}</div>
      {description && <div className="text-[11px] text-zinc-500 mt-0.5">{description}</div>}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b" style={{ borderColor: "#232929" }}>
      <div className="text-[12px] text-zinc-300">{label}</div>
      <div>{children}</div>
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="relative h-5 w-9 rounded-full transition-colors"
      style={{ background: on ? "#f97316" : "#2a3232" }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
        style={{ left: on ? "18px" : "2px" }}
      />
    </button>
  );
}
