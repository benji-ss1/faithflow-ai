"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import s from "./sarah.module.css";
import { SarahAvatar } from "./SarahAvatar";

const COLORS = ["#e8501a", "#ff8a52", "#f0b34a", "#7fdca0", "#ece7e0"];
const AUTO_CLOSE_MS = 10_000;

export function SarahSuccess({ deviceLabel, onClose }: { deviceLabel: string; onClose: () => void }) {
  const btn = useRef<HTMLButtonElement | null>(null);
  const [held, setHeld] = useState(false);

  useEffect(() => { btn.current?.focus(); }, []);
  useEffect(() => {
    if (held) return;
    const t = setTimeout(onClose, AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [held, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      setHeld(true); // any other key = the user is reading/interacting: cancel auto-close
      if (e.key === "Tab") { e.preventDefault(); btn.current?.focus(); } // simple focus trap (one control)
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sparks = useMemo(() => Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2; const d = 140 + (i % 5) * 45;
    return { dx: `${Math.cos(a) * d}px`, dy: `${Math.sin(a) * d}px`, c: COLORS[i % COLORS.length], delay: `${(i % 6) * 40}ms` };
  }), []);

  return (
    <div className={s.success} role="dialog" aria-modal="true" aria-live="polite" aria-label="Audio connected" onPointerDown={() => setHeld(true)}>
      <div className={s.successInner}>
        <div style={{ position: "relative", width: "min(240px, 52vw)" }}>
          {sparks.map((p, i) => (
            <span key={i} className={s.spark} style={{ left: "50%", top: "50%", background: p.c, animationDelay: p.delay, ["--dx" as string]: p.dx, ["--dy" as string]: p.dy }} />
          ))}
          <SarahAvatar mood="celebrate" level={0.6} />
        </div>
        <div className={s.successTitle}>Audio connected — let&apos;s get PresentFlow going</div>
        <p style={{ margin: 0, color: "var(--sarah-muted)" }}>Saved <b>{deviceLabel}</b> as this computer&apos;s audio. Sarah will remember it.</p>
        <button ref={btn} type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onClose}>Let&apos;s go</button>
      </div>
    </div>
  );
}
