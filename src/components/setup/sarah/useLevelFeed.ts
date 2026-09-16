"use client";

/**
 * Live level feed for the Sarah wizard. READ-ONLY probing:
 *   • Desktop app: the native per-channel probe (startChannelProbe) — the same
 *     meter path the Mic Board uses. Never calls startCapture, so it can't touch
 *     the live Deepgram pipeline.
 *   • Browser: a throwaway getUserMedia analyser with all voice processing OFF.
 *
 * Every start bumps a generation counter: a late-resolving probe from a device the
 * operator has already moved on from is torn down instead of feeding stale levels.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { classifyInput, type InputClassification } from "@/lib/audio/deviceClassifier";

export type ChannelLevel = { channel: number; db: number; peak: number };
export interface SetupDevice {
  key: string;
  name: string;
  source: "native" | "browser";
  index?: number;
  deviceId?: string;
  uid?: string;
  transport?: string;
  channelCount: number;
  kind: InputClassification;
}

type NativeApi = {
  listDevices: () => Promise<Array<{ index: number; name: string; channelCount?: number; uid?: string; transport?: string }>>;
  startChannelProbe: (o: { deviceIndex: number; channelCount: number }) => Promise<{ ok: boolean; error?: string }>;
  stopChannelProbe: () => Promise<void>;
  onChannelLevels: (cb: (levels: ChannelLevel[]) => void) => () => void;
};

function nativeApi(): NativeApi | null {
  const w = globalThis as unknown as { electronAPI?: { audio?: { native?: NativeApi } } };
  const n = w.electronAPI?.audio?.native;
  return n && typeof n.startChannelProbe === "function" ? n : null;
}

/** Turn a raw probe/permission error into something a volunteer can act on. */
export function friendlyProbeError(raw?: string): string {
  const e = (raw ?? "").toLowerCase();
  if (/busy|in use|already|unavailable|-10851|exclusive/.test(e)) return "Something else is already using this input. If AI listening is on in the operator screen, stop it and try again.";
  if (/permission|denied|notallowed/.test(e)) return "PresentFlow isn't allowed to use the microphone yet. On a Mac: System Settings → Privacy & Security → Microphone, switch PresentFlow on, then try again.";
  if (/not ?found|no such|missing|notfound/.test(e)) return "That input has disappeared — check the cable, then tap “Look again”.";
  return "I couldn't open that input. Check it's plugged in and not in use by another app, then try again.";
}

export async function listSetupDevices(): Promise<SetupDevice[]> {
  const n = nativeApi();
  if (n) {
    try {
      const list = await n.listDevices();
      return list.map((d) => ({
        key: `n:${d.uid ?? d.index}`, name: d.name, source: "native" as const, index: d.index, uid: d.uid, transport: d.transport,
        channelCount: Math.max(1, d.channelCount ?? 2), kind: classifyInput({ name: d.name, transport: d.transport, channelCount: d.channelCount }),
      }));
    } catch { /* fall through to browser */ }
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
  } catch { /* labels may be blank without permission */ }
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audioinput" && d.deviceId !== "default").map((d) => ({
    key: `b:${d.deviceId}`, name: d.label || "Audio input", source: "browser" as const, deviceId: d.deviceId,
    channelCount: 1, kind: classifyInput({ name: d.label }),
  }));
}

const HISTORY = 120; // ~12 s at 10 Hz

export function useLevelFeed() {
  const [levels, setLevels] = useState<ChannelLevel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const historyRef = useRef<Map<number, number[]>>(new Map());
  const framesRef = useRef<{ db: number; peak: number }[]>([]);
  const stopRef = useRef<(() => void) | null>(null);
  const channelsRef = useRef<number[] | null>(null);
  const genRef = useRef(0);

  const push = useCallback((ls: ChannelLevel[]) => {
    for (const l of ls) {
      const h = historyRef.current.get(l.channel) ?? [];
      h.push(l.peak); if (h.length > HISTORY) h.shift();
      historyRef.current.set(l.channel, h);
    }
    const sel = channelsRef.current;
    const pool = sel && sel.length ? ls.filter((l) => sel.includes(l.channel)) : ls;
    if (pool.length) {
      const top = pool.reduce((a, b) => (b.peak > a.peak ? b : a));
      framesRef.current.push({ db: top.db, peak: top.peak });
      if (framesRef.current.length > HISTORY) framesRef.current.shift();
    }
    setLevels(ls);
  }, []);

  const stop = useCallback(async () => {
    genRef.current += 1;
    const fn = stopRef.current; stopRef.current = null;
    if (fn) { try { fn(); } catch { /* noop */ } }
    setRunning(false);
    setLevels([]);
  }, []);

  const start = useCallback(async (device: SetupDevice): Promise<{ ok: boolean; error?: string }> => {
    await stop();
    const gen = genRef.current;
    setError(null);
    historyRef.current = new Map(); framesRef.current = [];
    if (device.source === "native") {
      const n = nativeApi();
      if (!n || device.index == null) { const m = "This input isn't available in this window."; setError(m); return { ok: false, error: m }; }
      const off = n.onChannelLevels((ls) => { if (genRef.current === gen) push(ls); });
      let res: { ok: boolean; error?: string };
      try { res = await n.startChannelProbe({ deviceIndex: device.index, channelCount: Math.min(64, device.channelCount) }); }
      catch (e) { res = { ok: false, error: (e as Error)?.message }; }
      if (genRef.current !== gen) { off(); void n.stopChannelProbe(); return { ok: false, error: "superseded" }; }
      if (!res.ok) {
        off();
        const m = friendlyProbeError(res.error);
        setError(m);
        return { ok: false, error: m };
      }
      stopRef.current = () => { off(); void n.stopChannelProbe(); };
      setRunning(true);
      return { ok: true };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: device.deviceId ? { exact: device.deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (genRef.current !== gen) { stream.getTracks().forEach((t) => t.stop()); return { ok: false, error: "superseded" }; }
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const iv = setInterval(() => {
        if (genRef.current !== gen) return;
        an.getFloatTimeDomainData(buf);
        let sum = 0, peak = 0;
        for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); sum += v * v; if (v > peak) peak = v; }
        const rms = Math.sqrt(sum / buf.length);
        push([{ channel: 0, db: rms > 0 ? 20 * Math.log10(rms) : -120, peak }]);
      }, 100);
      stopRef.current = () => { clearInterval(iv); stream.getTracks().forEach((t) => t.stop()); void ctx.close(); };
      setRunning(true);
      return { ok: true };
    } catch (e) {
      const m = friendlyProbeError((e as Error)?.name === "NotAllowedError" ? "permission" : (e as Error)?.message);
      setError(m);
      return { ok: false, error: m };
    }
  }, [push, stop]);

  const setChannels = useCallback((chs: number[] | null) => { channelsRef.current = chs; framesRef.current = []; }, []);
  const resetFrames = useCallback(() => { framesRef.current = []; }, []);
  const snapshotFrames = useCallback(() => [...framesRef.current], []);
  const snapshotHistory = useCallback(() => new Map(historyRef.current), []);

  useEffect(() => () => { void stop(); }, [stop]);

  return { levels, error, running, start, stop, setChannels, resetFrames, snapshotFrames, snapshotHistory };
}
