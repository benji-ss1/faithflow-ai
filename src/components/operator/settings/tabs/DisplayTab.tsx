"use client";
import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";

const DEFAULT_OUT_KEY = "presentflow.pro.defaultOutput.v1";
const ASPECT_KEY = "presentflow.pro.defaultAspect.v1";
const SAFE_AREA_KEY = "presentflow.pro.safeArea.v1";

export function DisplayTab() {
  const [defaultOut, setDefaultOut] = useState<string>("main");
  const [aspect, setAspect] = useState<string>("16:9");
  const [safeArea, setSafeArea] = useState(false);
  const [hasElectron, setHasElectron] = useState<boolean>(false);

  useEffect(() => {
    try {
      setDefaultOut(localStorage.getItem(DEFAULT_OUT_KEY) || "main");
      setAspect(localStorage.getItem(ASPECT_KEY) || "16:9");
      setSafeArea(localStorage.getItem(SAFE_AREA_KEY) === "1");
    } catch {}
    setHasElectron(typeof window !== "undefined" && !!window.electronAPI);
  }, []);

  function openScreens() {
    // ScreensPanel is a full modal owned by the shell — dispatch a window event
    // it can listen for. Fallback: no-op documented.
    try { window.dispatchEvent(new CustomEvent("presentflow:open-screens")); } catch {}
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Display" description="Screen assignment, default output, and aspect ratio." />

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

      <Row label="Default output">
        <select
          value={defaultOut}
          onChange={(e) => { setDefaultOut(e.target.value); try { localStorage.setItem(DEFAULT_OUT_KEY, e.target.value); } catch {} }}
          className="h-8 px-2 rounded-md border text-[11px] text-zinc-100"
          style={{ borderColor: "#2a3232", background: "#1a2020" }}
        >
          <option value="main">Main channel</option>
          <option value="stage">Stage display</option>
          <option value="ndi">NDI (Multi-channel)</option>
        </select>
      </Row>

      <Row label="Default aspect ratio">
        <select
          value={aspect}
          onChange={(e) => { setAspect(e.target.value); try { localStorage.setItem(ASPECT_KEY, e.target.value); } catch {} }}
          className="h-8 px-2 rounded-md border text-[11px] text-zinc-100"
          style={{ borderColor: "#2a3232", background: "#1a2020" }}
        >
          <option>16:9</option>
          <option>4:3</option>
          <option>21:9</option>
          <option>1:1</option>
        </select>
      </Row>

      <Row label="Show safe-area guides">
        <Toggle
          on={safeArea}
          onChange={(v) => { setSafeArea(v); try { localStorage.setItem(SAFE_AREA_KEY, v ? "1" : "0"); } catch {} }}
        />
      </Row>
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
