"use client";

import { useEffect, useRef, useState } from "react";
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
  neutral: "🙂 Ready", think: "🤔 Thinking", nod: "👍 Got it", listen: "👂 Listening",
  ooh: "😮 Ooh!", focus: "🧐 Checking", celebrate: "🎉 Yay!",
};
const ALL: SarahMood[] = ["neutral", "think", "nod", "listen", "ooh", "celebrate"];

/**
 * Sarah's portrait. All mood images are stacked and cross-faded (opacity + blur
 * + scale morph) so a mood change reads as one continuous motion, plus a pop
 * (happy moods) or tilt (focus) on the frame. `level` (0..1) drives a live halo.
 */
export function SarahAvatar({ mood, level = 0 }: { mood: SarahMood; level?: number }) {
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [anim, setAnim] = useState("");
  const prev = useRef(mood);

  useEffect(() => {
    if (prev.current === mood) return;
    prev.current = mood;
    setAnim(mood === "focus" || mood === "think" ? s.shake : s.pop);
    const t = setTimeout(() => setAnim(""), 700);
    return () => clearTimeout(t);
  }, [mood]);

  const src = IMAGE[mood];
  const allBroken = ALL.every((m) => broken[IMAGE[m]]);
  const glow = Math.max(0, Math.min(1, level));
  const boxClass = [s.avatarBox, mood === "listen" || mood === "ooh" ? s.listening : "", mood === "celebrate" ? s.celebrate : ""].join(" ");

  return (
    <div className={boxClass}>
      <div className={s.ring} />
      <div className={`${s.ring} ${s.ring2}`} />
      <div className={`${s.ring} ${s.ring3}`} />
      <div className={s.levelHalo} style={{ boxShadow: `0 0 ${20 + glow * 60}px ${glow * 18}px rgba(95, 208, 138, ${0.08 + glow * 0.35})` }} />
      <div className={`${s.portrait} ${anim}`}>
        {[...new Set(Object.values(IMAGE))].map((url) => (
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
        {(allBroken || broken[src]) && <div className={s.fallbackFace} aria-hidden>S</div>}
      </div>
      <div key={mood} className={s.moodChip}>{LABEL[mood]}</div>
    </div>
  );
}
