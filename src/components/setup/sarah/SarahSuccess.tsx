"use client";

import { useEffect, useMemo } from "react";
import s from "./sarah.module.css";
import { SarahAvatar } from "./SarahAvatar";

const COLORS = ["#e8501a", "#ff8a52", "#f0b34a", "#7fdca0", "#ece7e0"];

export function SarahSuccess({ deviceLabel, onClose }: { deviceLabel: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 5200); return () => clearTimeout(t); }, [onClose]);
  const sparks = useMemo(() => Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2; const d = 140 + (i % 5) * 45;
    return { dx: `${Math.cos(a) * d}px`, dy: `${Math.sin(a) * d}px`, c: COLORS[i % COLORS.length], delay: `${(i % 6) * 40}ms` };
  }), []);

  return (
    <div className={s.success} role="dialog" aria-live="polite" aria-label="Audio connected">
      <div className={s.successInner}>
        <div style={{ position: "relative", width: "min(260px, 60vw)" }}>
          {sparks.map((p, i) => (
            <span key={i} className={s.spark} style={{ left: "50%", top: "50%", background: p.c, animationDelay: p.delay, ["--dx" as string]: p.dx, ["--dy" as string]: p.dy }} />
          ))}
          <SarahAvatar mood="celebrate" level={0.6} />
        </div>
        <div className={s.successTitle}>Audio connected — let&apos;s get PresentFlow going</div>
        <p style={{ margin: 0, color: "var(--color-muted-foreground)" }}>Saved <b>{deviceLabel}</b> as this computer&apos;s audio. Sarah will remember it.</p>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onClose}>Let&apos;s go</button>
      </div>
    </div>
  );
}
