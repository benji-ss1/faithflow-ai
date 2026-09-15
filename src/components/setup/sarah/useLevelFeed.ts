"use client";

/**
 * Live level feed for the Sarah wizard. READ-ONLY probing:
 *   • Desktop app: the native per-channel probe (startChannelProbe) — the same
 *     meter path the Mic Board uses. Never calls startCapture, so it can't touch
 *     the live Deepgram pipeline.
 *   • Browser: a throwaway getUserMedia analyser with all voice processing OFF.
 * If the native probe is refused (e.g. AI listening already holds the input) the
 * error is surfaced so Sarah can ask the operator to stop listening first.
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
    const fn = stopRef.current; stopRef.current = null;
    if (fn) { try { fn(); } catch { /* noop */ } }
    setRunning(false);
  }, []);

  const start = useCallback(async (device: SetupDevice) => {
    await stop();
    setError(null);
    historyRef.current = new Map(); framesRef.current = [];
    if (device.source === "native") {
      const n = nativeApi();
      if (!n || device.index == null) { setError("This input isn't available in this window."); return false; }
      const off = n.onChannelLevels(push);
      const res = await n.startChannelProbe({ deviceIndex: device.index, channelCount: Math.min(64, device.channelCount) });
      if (!res.ok) {
        off();
        setError(res.error || "PresentFlow couldn't open this input. If AI listening is on, stop it first, then try again.");
        return false;
      }
      stopRef.current = () => { off(); void n.stopChannelProbe(); };
      setRunning(true);
      return true;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: device.deviceId ? { exact: device.deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const iv = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let sum = 0, peak = 0;
        for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); sum += v * v; if (v > peak) peak = v; }
        const rms = Math.sqrt(sum / buf.length);
        push([{ channel: 0, db: rms > 0 ? 20 * Math.log10(rms) : -120, peak }]);
      }, 100);
      stopRef.current = () => { clearInterval(iv); stream.getTracks().forEach((t) => t.stop()); void ctx.close(); };
      setRunning(true);
      return true;
    } catch {
      setError("Microphone access was blocked. Allow microphone access for PresentFlow, then try again.");
      return false;
    }
  }, [push, stop]);

  const setChannels = useCallback((chs: number[] | null) => { channelsRef.current = chs; framesRef.current = []; }, []);
  const resetFrames = useCallback(() => { framesRef.current = []; }, []);
  const snapshotFrames = useCallback(() => [...framesRef.current], []);
  const snapshotHistory = useCallback(() => new Map(historyRef.current), []);

  useEffect(() => () => { void stop(); }, [stop]);

  return { levels, error, running, start, stop, setChannels, resetFrames, snapshotFrames, snapshotHistory };
}
