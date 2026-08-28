"use client";
// Settings → Output → NDI (spec §17, §19). Desktop-only: controls the native NDI
// sender via window.electronAPI.ndi. UNVERIFIED end-to-end — the native addon
// must be compiled and the two-computer OBS/DistroAV test run on-site (§20/§25).
import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeader, Row, Toggle } from "./DisplayTab";
import type { NdiSettingsWire, NdiStatusWire } from "@/types/electron";

const selectCls =
  "text-[12px] rounded-md bg-[var(--color-muted)] border border-[var(--color-border)] px-2 py-1 text-[var(--color-foreground)]";

export function NdiTab() {
  const [settings, setSettings] = useState<NdiSettingsWire | null>(null);
  const [status, setStatus] = useState<NdiStatusWire | null>(null);
  const [testing, setTesting] = useState(false);
  const ndi = typeof window !== "undefined" ? window.electronAPI?.ndi : undefined;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const testTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ndi) return;
    void ndi.getSettings().then(setSettings);
    void ndi.getStatus().then(setStatus);
    // Poll status (receivers/broadcasting/fps) once a second while the panel is open.
    pollRef.current = setInterval(() => { void ndi.getStatus().then(setStatus); }, 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (testTimerRef.current) clearTimeout(testTimerRef.current);
    };
  }, [ndi]);

  const patch = useCallback(async (p: Partial<NdiSettingsWire>) => {
    if (!ndi) return;
    setSettings((s) => (s ? { ...s, ...p } : s));
    const st = await ndi.setSettings(p);
    setStatus(st);
    void ndi.getSettings().then(setSettings);
  }, [ndi]);

  const runTest = useCallback(async () => {
    if (!ndi) return;
    setTesting(true);
    await ndi.test(true);
    if (testTimerRef.current) clearTimeout(testTimerRef.current);
    testTimerRef.current = setTimeout(() => setTesting(false), 15000);
  }, [ndi]);

  if (!ndi) {
    return (
      <div className="space-y-3">
        <SectionHeader title="NDI Output" description="Send PresentFlow's live output to OBS over your network as an NDI source." />
        <p className="text-[12px] text-[var(--color-muted-foreground)]">
          NDI output is only available in the PresentFlow desktop app.
        </p>
      </div>
    );
  }

  const s = settings;
  const st = status;
  return (
    <div className="space-y-4">
      <SectionHeader
        title="NDI Output"
        description="Broadcast PresentFlow's live lyrics/graphics to a broadcast computer running OBS + DistroAV — no capture card, no cables. The broadcast PC discovers your source on the network."
      />

      <Row label="NDI Output">
        <Toggle on={!!s?.enabled} onChange={(v) => patch({ enabled: v })} />
      </Row>

      <Row label="Source Name">
        <input
          className={`${selectCls} w-[220px]`}
          value={s?.sourceName ?? ""}
          onChange={(e) => setSettings((cur) => (cur ? { ...cur, sourceName: e.target.value } : cur))}
          onBlur={(e) => patch({ sourceName: e.target.value })}
          placeholder="PresentFlow - NDI 1"
        />
      </Row>

      <Row label="Output Mode">
        <select className={selectCls} value={s?.mode ?? "transparent"} onChange={(e) => patch({ mode: e.target.value as "transparent" | "full" })}>
          <option value="transparent">Transparent Graphics (camera + lyrics)</option>
          <option value="full">Full Canvas</option>
        </select>
      </Row>

      <Row label="Resolution">
        <select
          className={selectCls}
          value={`${s?.width ?? 1920}x${s?.height ?? 1080}`}
          onChange={(e) => { const [w, h] = e.target.value.split("x").map(Number); patch({ width: w, height: h }); }}
        >
          <option value="1280x720">1280 × 720</option>
          <option value="1920x1080">1920 × 1080</option>
          <option value="3840x2160">3840 × 2160</option>
        </select>
      </Row>

      <Row label="Frame Rate">
        <select className={selectCls} value={s?.fps ?? 60} onChange={(e) => patch({ fps: Number(e.target.value) })}>
          <option value={60}>60 FPS</option>
          <option value={30}>30 FPS</option>
        </select>
      </Row>

      <Row label="Audio">
        <span className="text-[12px] text-[var(--color-muted-foreground)]">Off (video only)</span>
      </Row>

      {/* Status (§19) */}
      <div className="rounded-md border border-[var(--color-border)] p-3 space-y-1 text-[12px]">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${st?.broadcasting ? "bg-emerald-400" : "bg-[var(--color-muted-foreground)]"}`} />
          <span className="text-[var(--color-foreground)] font-semibold">
            {st?.broadcasting ? "Broadcasting" : st?.error ? "Error" : "Idle"}
          </span>
        </div>
        {st?.broadcasting && (
          <>
            <div className="text-[var(--color-muted-foreground)]">Source: <span className="text-[var(--color-foreground)]">{st.sourceName}</span></div>
            <div className="text-[var(--color-muted-foreground)]">Receivers: <span className="text-[var(--color-foreground)]">{st.receivers}</span></div>
            <div className="text-[var(--color-muted-foreground)]">{st.width} × {st.height} · {st.fps} FPS · {st.mode === "transparent" ? "Transparent" : "Full canvas"}</div>
          </>
        )}
        {st?.error && <div className="text-red-400">{st.error}</div>}
        {!st?.available && !st?.error && (
          <div className="text-[var(--color-muted-foreground)]">NDI runtime not loaded on this build.</div>
        )}
      </div>

      <button
        type="button"
        onClick={runTest}
        disabled={!st?.broadcasting || testing}
        className="text-[12px] font-semibold px-3 py-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-foreground)] hover:border-[var(--color-brand)] disabled:opacity-40"
      >
        {testing ? "Sending test pattern (15s)…" : "Test NDI Output"}
      </button>
      <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">
        In OBS on the broadcast PC: Sources → add <span className="text-[var(--color-foreground)]">NDI Source</span> (DistroAV) → pick your source → set <span className="text-[var(--color-foreground)]">Latency = Normal</span> and place it above the camera.
      </p>
    </div>
  );
}
