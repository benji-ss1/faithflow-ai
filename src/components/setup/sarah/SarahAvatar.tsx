"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Ear, Lightbulb, PartyPopper, Search, Smile, Sparkles } from "lucide-react";
import s from "./sarah.module.css";

export type SarahMood = "neutral" | "think" | "nod" | "listen" | "ooh" | "focus" | "celebrate";

// focus has no dedicated portrait — it reuses neutral with a tilt animation.
const IMAGE: Record<SarahMood, string> = {
  neutral: "/sarah/sarah-neutral.png",
  think: "/sarah/sarah-think.png",
  nod: "/sarah/sarah-nod.png",
  listen: "/sarah/sarah-listen.png",
  ooh: "/sarah/sarah-ooh.png",
  focus: "/sarah/sarah-neutral.png",
  celebrate: "/sarah/sarah-celebrate.png",
};
const LABEL: Record<SarahMood, string> = {
  neutral: "Ready", think: "Thinking", nod: "Got it", listen: "Listening",
  ooh: "I can hear you", focus: "Checking", celebrate: "All set",
};
const ICON: Record<SarahMood, React.ComponentType<{ className?: string }>> = {
  neutral: Smile, think: Lightbulb, nod: Check, listen: Ear, ooh: Sparkles, focus: Search, celebrate: PartyPopper,
};

/**
 * Sarah's portrait. Only the current and previous images are mounted, cross-faded
 * (opacity + slight scale/blur morph) so a mood change reads as one motion, plus a
 * pop (happy moods) or tilt (thinking/checking) on the frame. `level` (0..1) drives
 * a live halo via opacity/transform only (no per-frame box-shadow repaint).
 */
export function SarahAvatar({ mood, level = 0 }: { mood: SarahMood; level?: number }) {
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [anim, setAnim] = useState("");
  const [prevMood, setPrevMood] = useState<SarahMood | null>(null);
  const prev = useRef(mood);

  useEffect(() => {
    if (prev.current === mood) return;
    setPrevMood(prev.current);
    prev.current = mood;
    setAnim(mood === "focus" || mood === "think" ? s.shake : s.pop);
    const t = setTimeout(() => setAnim(""), 700);
    const t2 = setTimeout(() => setPrevMood(null), 800);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [mood]);

  const src = IMAGE[mood];
  const glow = Math.max(0, Math.min(1, level));
  const mounted = [...new Set([src, prevMood ? IMAGE[prevMood] : null].filter(Boolean) as string[])];
  const boxClass = [s.avatarBox, mood === "listen" || mood === "ooh" ? s.listening : "", mood === "celebrate" ? s.celebrate : ""].join(" ");

  return (
    <div className={boxClass}>
      <div className={s.ring} />
      <div className={`${s.ring} ${s.ring2}`} />
      <div className={`${s.ring} ${s.ring3}`} />
      <div className={s.levelHalo} style={{ opacity: 0.15 + glow * 0.85, transform: `scale(${1 + glow * 0.06})` }} aria-hidden />
      <div className={`${s.portrait} ${anim}`}>
        {mounted.map((url) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={url}
            src={url}
            alt={url === src ? `Sarah, your audio setup assistant — ${LABEL[mood]}` : ""}
            aria-hidden={url === src ? undefined : true}
            className={`${s.face} ${url === src && !broken[url] ? s.faceOn : ""}`}
            onError={() => setBroken((b) => ({ ...b, [url]: true }))}
            draggable={false}
          />
        ))}
        {broken[src] && (
          <svg className={s.fallbackFace} viewBox="0 0 100 100" aria-hidden focusable="false">
            <circle cx="50" cy="36" r="18" fill="currentColor" opacity="0.85" />
            <path d="M12 100c0-22 17-34 38-34s38 12 38 34z" fill="currentColor" opacity="0.85" />
          </svg>
        )}
      </div>
      <div key={mood} className={s.moodChip} aria-hidden>
        {(() => { const Icon = ICON[mood]; return <Icon className="w-3.5 h-3.5" />; })()}
        <span>{LABEL[mood]}</span>
      </div>
    </div>
  );
}
