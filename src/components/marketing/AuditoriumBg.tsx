"use client";

import { useEffect, useState, type CSSProperties } from "react";

/**
 * AuditoriumBg — a faithful port of the "Auditorium" cinematic hero scene:
 * a dark church media booth with a projector screen (Psalm 23:3), warm
 * brass/oxblood/wine stage lighting, drifting haze, floating dust, a desk
 * with four iMac-style displays (Logic Pro, Audio/NDI, PresentFlow live
 * transcript, OBS Studio), an operator silhouette, film grain + vignettes.
 *
 * Self-contained, absolutely positioned to fill its parent, never captures
 * pointer events, and sits behind the hero content. Keyframes live in
 * site.css; reduced-motion is respected there.
 */

const SERIF = '"Fraunces","Iowan Old Style",Palatino,Georgia,serif';
const MONO = "var(--pf-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

type Dust = {
  x: string;
  y: string;
  o: string;
  dur: string;
  delay: string;
  blur: string;
};

type Track = { i: number; name: string; c: string; c2: string };
type Input = {
  tag: string;
  tagC: string;
  tagBg: string;
  name: string;
  led: string;
};

const TRACKS: Track[] = [
  { i: 0, name: "Kick", c: "#7a5cff", c2: "#4a2fbf" },
  { i: 1, name: "Snare", c: "#5c9cff", c2: "#2f5fbf" },
  { i: 2, name: "Hi-Hat", c: "#3fd6c7", c2: "#1f8f83" },
  { i: 3, name: "Bass", c: "#c67aff", c2: "#8f47c6" },
  { i: 4, name: "Keys", c: "#7ac6ff", c2: "#478fc6" },
  { i: 5, name: "Vocals", c: "#ff7ac6", c2: "#c6478f" },
];

const INPUTS: Input[] = [
  { tag: "MIXER", tagC: "#C6912F", tagBg: "rgba(198,145,47,.14)", name: "Yamaha TF5", led: "#4FD18B" },
  { tag: "NDI", tagC: "#12595E", tagBg: "rgba(18,89,94,.2)", name: "CAM-01 · Pulpit", led: "#4FD18B" },
  { tag: "VIRT", tagC: "#B8ADA0", tagBg: "rgba(184,173,160,.1)", name: "BlackHole 2ch", led: "#C6912F" },
  { tag: "BT", tagC: "#8F2C10", tagBg: "rgba(143,44,16,.16)", name: "Pastor · Lav", led: "#8F2C10" },
];

const WAVE_CLIP =
  "polygon(0 40%, 5% 20%, 10% 60%, 15% 10%, 20% 70%, 25% 30%, 30% 50%, 35% 15%, 40% 65%, 45% 25%, 50% 55%, 55% 20%, 60% 60%, 65% 35%, 70% 50%, 75% 15%, 80% 70%, 85% 30%, 90% 55%, 95% 25%, 100% 45%, 100% 60%, 95% 75%, 90% 45%, 85% 70%, 80% 30%, 75% 85%, 70% 50%, 65% 65%, 60% 40%, 55% 80%, 50% 45%, 45% 75%, 40% 35%, 35% 85%, 30% 50%, 25% 70%, 20% 30%, 15% 90%, 10% 40%, 5% 80%, 0 60%)";

const GRAIN_URI =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";

const monoFace = (size: string, color: string, extra?: CSSProperties): CSSProperties => ({
  fontFamily: MONO,
  fontSize: size,
  color,
  ...extra,
});

function generateDust(): Dust[] {
  const dust: Dust[] = [];
  for (let i = 0; i < 30; i++) {
    dust.push({
      x: (Math.random() * 90 + 5).toFixed(1),
      y: (Math.random() * 80 + 10).toFixed(1),
      o: (Math.random() * 0.45 + 0.3).toFixed(2),
      dur: (Math.random() * 16 + 20).toFixed(1),
      delay: (Math.random() * -30).toFixed(1),
      blur: (Math.random() * 1.1).toFixed(2),
    });
  }
  return dust;
}

/* Reusable iMac stand (two feet under each display) */
function Stand() {
  return (
    <>
      <div
        style={{
          width: "22%",
          height: 8,
          background: "linear-gradient(180deg,#1a1a22 0%,#0a0a0f 100%)",
          borderRadius: "0 0 4px 4px",
          boxShadow: "0 4px 10px rgba(0,0,0,.7)",
        }}
      />
      <div
        style={{
          width: "34%",
          height: 3,
          background: "linear-gradient(180deg,#1a1a22 0%,#050508 100%)",
          borderRadius: 2,
          boxShadow: "0 3px 10px rgba(0,0,0,.7)",
        }}
      />
    </>
  );
}

const screenDim: CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "radial-gradient(ellipse 80% 80% at 50% 40%, transparent 40%, rgba(0,0,0,.45) 100%)",
  pointerEvents: "none",
};
const screenGloss: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(160deg, rgba(255,255,255,.04) 0%, transparent 30%)",
  pointerEvents: "none",
};

export default function AuditoriumBg() {
  // Generate dust on the client only — Math.random() differs between server
  // and client, which would cause a hydration mismatch if seeded in useState.
  // The particles are purely decorative, so appearing a frame after mount is fine.
  const [dust, setDust] = useState<Dust[]>([]);
  useEffect(() => {
    setDust(generateDust());
  }, []);

  return (
    <div
      className="pf-aud"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", filter: "brightness(1.28)" }}
    >
      {/* Aspect-locked stage that fills (covers) the parent */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          /* Cover behaviour: an aspect-locked 2.39:1 stage that is always at
             least as wide AND as tall as the hero, centred and clipped by the
             parent's overflow:hidden. On mobile (portrait) it scales up so the
             booth still fills the frame instead of letterboxing. */
          minWidth: "100%",
          minHeight: "100%",
          aspectRatio: "2.39 / 1",
          background: "#050307",
          overflow: "hidden",
        }}
      >
        <div
          className="pf-aud-scene"
          style={{ position: "absolute", inset: 0, transformOrigin: "50% 50%" }}
        >
          {/* radial ground */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse 80% 60% at 50% 32%, #1a1014 0%, #100a0d 45%, #080508 75%, #050307 100%)",
            }}
          />

          {/* Church projector screen with Psalm 23:3 slide */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "5%",
              transform: "translateX(-50%)",
              width: "44%",
              aspectRatio: "16/9",
              background: "#0a0508",
              border: "5px solid #1a100a",
              borderRadius: 2,
              boxShadow:
                "0 18px 50px rgba(0,0,0,.9),0 0 60px rgba(198,145,47,.05),inset 0 0 0 1px rgba(198,145,47,.14)",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(180deg,#f5ecd8 0%,#ebe0c6 50%,#d8c9a4 100%)",
                boxShadow:
                  "inset 0 0 90px rgba(143,44,16,.14),inset 0 0 40px rgba(0,0,0,.15)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(ellipse 70% 90% at 50% 50%, transparent 30%, rgba(0,0,0,.35) 100%)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: "5%",
              }}
            >
              <div
                style={{
                  fontFamily: SERIF,
                  fontStyle: "italic",
                  fontWeight: 600,
                  fontSize: "clamp(8px,.95vw,14px)",
                  color: "#8a2410",
                  letterSpacing: ".01em",
                  opacity: 0.92,
                  marginBottom: "4%",
                }}
              >
                Psalm 23:3 · KJV
              </div>
              <div
                style={{
                  fontFamily: SERIF,
                  fontWeight: 500,
                  fontSize: "clamp(12px,1.7vw,26px)",
                  color: "#1a0f0a",
                  lineHeight: 1.2,
                  letterSpacing: "-.01em",
                  textWrap: "balance",
                }}
              >
                He restoreth my soul:
                <br />
                <span style={{ color: "#8F2C10" }}>He leadeth me</span> in the paths
                <br />
                of righteousness for
                <br />
                His name&apos;s sake.
              </div>
            </div>
          </div>

          {/* Screen glow / pulse */}
          <div
            className="pf-aud-screen"
            style={{
              position: "absolute",
              left: "50%",
              top: "5%",
              transform: "translateX(-50%)",
              width: "62%",
              aspectRatio: "16/9",
              background:
                "radial-gradient(ellipse 55% 70% at 50% 50%, rgba(255,220,170,.18) 0%, transparent 70%)",
              filter: "blur(50px)",
              mixBlendMode: "screen",
              pointerEvents: "none",
            }}
          />

          {/* Stage floor glow band */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "36%",
              height: "22%",
              background:
                "radial-gradient(ellipse 45% 70% at 18% 100%, rgba(143,44,16,.5) 0%, rgba(143,44,16,.1) 55%, transparent 82%),radial-gradient(ellipse 45% 65% at 82% 100%, rgba(122,30,68,.5) 0%, rgba(122,30,68,0) 70%),radial-gradient(ellipse 30% 50% at 50% 100%, rgba(198,145,47,.14) 0%, transparent 75%)",
              filter: "blur(28px)",
              mixBlendMode: "screen",
            }}
          />

          {/* Stage lip */}
          <div
            style={{
              position: "absolute",
              left: "25%",
              right: "25%",
              top: "56%",
              height: "3%",
              background: "linear-gradient(180deg,#1a0f08 0%,#050303 100%)",
              transform: "perspective(700px) rotateX(20deg)",
              boxShadow: "inset 0 -2px 6px rgba(0,0,0,.7),0 -6px 24px rgba(198,145,47,.08)",
            }}
          />

          {/* Pews */}
          <div
            style={{
              position: "absolute",
              left: "-8%",
              right: "-8%",
              top: "58%",
              height: "14%",
              background:
                "repeating-linear-gradient(180deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 9px, rgba(198,145,47,.05) 10px, rgba(0,0,0,.55) 12px, rgba(0,0,0,0) 16px),repeating-linear-gradient(180deg, rgba(122,30,68,.05) 0px, rgba(122,30,68,.05) 9px, rgba(0,0,0,.55) 10px, rgba(0,0,0,.55) 12px)",
              transform: "perspective(1000px) rotateX(68deg)",
              transformOrigin: "50% 100%",
              maskImage: "linear-gradient(180deg, transparent 0%, black 40%, black 100%)",
              WebkitMaskImage: "linear-gradient(180deg, transparent 0%, black 40%, black 100%)",
              filter: "blur(1.4px)",
            }}
          />

          {/* Brass keylight (flicker) */}
          <div
            className="pf-aud-keylight"
            style={{
              position: "absolute",
              left: "32%",
              top: "-6%",
              width: "38%",
              height: "60%",
              background:
                "linear-gradient(195deg, rgba(198,145,47,.18) 0%, rgba(198,145,47,.08) 40%, rgba(198,145,47,.02) 70%, transparent 92%)",
              transform: "skewX(-4deg) rotate(2deg)",
              transformOrigin: "top center",
              filter: "blur(34px)",
              mixBlendMode: "screen",
              zIndex: 2,
            }}
          />

          {/* Haze (drift) */}
          <div
            className="pf-aud-haze"
            style={{
              position: "absolute",
              inset: "-10%",
              background:
                "radial-gradient(ellipse 40% 30% at 45% 35%, rgba(255,200,140,.08) 0%, transparent 70%),radial-gradient(ellipse 50% 40% at 55% 50%, rgba(122,30,68,.06) 0%, transparent 70%),radial-gradient(ellipse 35% 25% at 30% 55%, rgba(143,44,16,.06) 0%, transparent 70%)",
              filter: "blur(40px)",
              mixBlendMode: "screen",
              zIndex: 2,
            }}
          />

          {/* Dust particles */}
          <div
            style={{
              position: "absolute",
              left: "15%",
              right: "15%",
              top: "5%",
              height: "50%",
              pointerEvents: "none",
              zIndex: 3,
            }}
          >
            {dust.map((d, i) => (
              <span
                key={i}
                className="pf-aud-dust"
                style={
                  {
                    position: "absolute",
                    width: 2,
                    height: 2,
                    borderRadius: "50%",
                    left: `${d.x}%`,
                    top: `${d.y}%`,
                    background: "#C6912F",
                    boxShadow: "0 0 5px rgba(198,145,47,.95)",
                    "--o": d.o,
                    opacity: 0,
                    animation: `pfDustFloat ${d.dur}s linear ${d.delay}s infinite`,
                    filter: `blur(${d.blur}px)`,
                  } as CSSProperties
                }
              />
            ))}
          </div>

          {/* Booth darkening under desk */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "52%",
              background:
                "linear-gradient(180deg, rgba(3,1,4,0) 0%, rgba(3,1,4,.14) 54%, rgba(3,1,4,.42) 86%, #050308 100%)",
              zIndex: 4,
            }}
          />

          {/* Full-width desk with 4 iMac displays */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "44%",
              zIndex: 5,
              transform: "perspective(2000px) rotateX(22deg)",
              transformOrigin: "50% 100%",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(180deg, #0e0a12 0%, #080610 50%, #030106 100%)",
                borderTop: "1px solid rgba(198,145,47,.24)",
                boxShadow:
                  "0 -18px 50px rgba(0,0,0,.95),0 0 80px rgba(143,44,16,.1),inset 0 1px 0 rgba(255,220,180,.08),inset 0 -30px 60px rgba(0,0,0,.6)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "4%",
                height: 1,
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(198,145,47,.2) 20%, rgba(198,145,47,.35) 50%, rgba(198,145,47,.2) 80%, transparent 100%)",
              }}
            />

            {/* LOGIC PRO iMac */}
            <div
              style={{
                position: "absolute",
                left: "2.5%",
                top: "11%",
                width: "26%",
                height: "84%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  flex: 1,
                  background: "#0a0a0f",
                  borderRadius: 8,
                  padding: 5,
                  boxShadow:
                    "0 6px 20px rgba(0,0,0,.9),inset 0 0 0 1px rgba(198,145,47,.14),inset 0 1px 0 rgba(255,255,255,.06)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: 2,
                    transform: "translateX(-50%)",
                    width: 5,
                    height: 2,
                    borderRadius: 1,
                    background: "#1a1a22",
                  }}
                />
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    background: "#0a0a0f",
                    borderRadius: 4,
                    overflow: "hidden",
                    border: "1px solid rgba(198,145,47,.1)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: 0,
                      height: "11%",
                      background: "linear-gradient(180deg,#1a1a22 0%,#0d0d13 100%)",
                      borderBottom: "1px solid rgba(255,255,255,.06)",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 8px",
                      gap: 6,
                    }}
                  >
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff5f57" }} />
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#febc2e" }} />
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#28c840" }} />
                    <div
                      style={monoFace("clamp(5px,.5vw,8px)", "#aaa", {
                        flex: 1,
                        textAlign: "center",
                        letterSpacing: ".06em",
                      })}
                    >
                      Logic Pro · Sunday Service.logicx
                    </div>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: "11%",
                      height: "12%",
                      background: "#050508",
                      borderBottom: "1px solid rgba(255,255,255,.05)",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 10px",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", gap: 4 }}>
                      <div
                        style={{
                          width: 0,
                          height: 0,
                          borderLeft: "6px solid #4FD18B",
                          borderTop: "4px solid transparent",
                          borderBottom: "4px solid transparent",
                        }}
                      />
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ff3b30" }} />
                    </div>
                    <div style={monoFace("clamp(5px,.55vw,9px)", "#eee", { letterSpacing: ".06em" })}>
                      2 · 3 · 1 · 115
                    </div>
                    <div style={{ flex: 1 }} />
                    <div style={monoFace("clamp(5px,.5vw,8px)", "#8a8", { letterSpacing: ".08em" })}>
                      Cmaj · 4/4
                    </div>
                  </div>
                  {TRACKS.map((t) => (
                    <div
                      key={t.i}
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: `calc(23% + ${t.i} * 12%)`,
                        height: "11%",
                        display: "flex",
                        borderBottom: "1px solid rgba(255,255,255,.04)",
                      }}
                    >
                      <div
                        style={{
                          width: "32%",
                          padding: "0 8px",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          background: "#0d0d13",
                        }}
                      >
                        <div style={{ width: 5, height: "60%", background: t.c, borderRadius: 1 }} />
                        <div style={monoFace("clamp(4px,.5vw,8px)", "#ddd")}>{t.name}</div>
                      </div>
                      <div style={{ flex: 1, position: "relative", background: "#050508", overflow: "hidden" }}>
                        <div
                          style={{
                            position: "absolute",
                            left: "4%",
                            top: "20%",
                            width: "88%",
                            height: "60%",
                            background: `linear-gradient(90deg, ${t.c} 0%, ${t.c2} 100%)`,
                            borderRadius: 2,
                            opacity: 0.6,
                            clipPath: WAVE_CLIP,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "linear-gradient(180deg, rgba(122,30,68,.1) 0%, transparent 40%, rgba(0,0,0,.28) 100%),radial-gradient(ellipse 80% 80% at 50% 40%, transparent 40%, rgba(0,0,0,.45) 100%)",
                      pointerEvents: "none",
                    }}
                  />
                  <div style={screenGloss} />
                </div>
              </div>
              <Stand />
            </div>

            {/* AUDIO / NDI iMac */}
            <div
              style={{
                position: "absolute",
                left: "30%",
                top: "11%",
                width: "19%",
                height: "84%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  flex: 1,
                  background: "#0a0a0f",
                  borderRadius: 8,
                  padding: 5,
                  boxShadow:
                    "0 6px 20px rgba(0,0,0,.9),inset 0 0 0 1px rgba(198,145,47,.14),inset 0 1px 0 rgba(255,255,255,.06)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: 2,
                    transform: "translateX(-50%)",
                    width: 5,
                    height: 2,
                    borderRadius: 1,
                    background: "#1a1a22",
                  }}
                />
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    background: "linear-gradient(180deg,#060310 0%,#030108 100%)",
                    border: "1px solid rgba(198,145,47,.14)",
                    borderRadius: 4,
                    overflow: "hidden",
                    padding: "6%",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div
                      className="pf-aud-led"
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#4FD18B",
                        boxShadow: "0 0 8px #4FD18B",
                        animation: "pfLedBlink 3.4s ease-in-out infinite",
                      }}
                    />
                    <div
                      style={monoFace("clamp(5px,.6vw,9px)", "#C6912F", {
                        letterSpacing: ".16em",
                        textTransform: "uppercase",
                      })}
                    >
                      Audio · NDI
                    </div>
                    <div style={{ flex: 1 }} />
                    <div style={monoFace("clamp(4px,.5vw,7px)", "#6f685e", { letterSpacing: ".16em" })}>
                      -6dB
                    </div>
                  </div>
                  <div style={{ marginTop: "6%", display: "flex", flexDirection: "column", gap: 6 }}>
                    {INPUTS.map((ip) => (
                      <div key={ip.tag} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span
                          style={monoFace("clamp(4px,.5vw,7px)", ip.tagC, {
                            letterSpacing: ".1em",
                            background: ip.tagBg,
                            padding: "2px 4px",
                            borderRadius: 2,
                          })}
                        >
                          {ip.tag}
                        </span>
                        <span style={monoFace("clamp(4px,.5vw,8px)", "#ddd", { flex: 1 })}>
                          {ip.name}
                        </span>
                        <div
                          style={{
                            width: 4,
                            height: 4,
                            borderRadius: "50%",
                            background: ip.led,
                            boxShadow: `0 0 5px ${ip.led}`,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: "6%",
                      right: "6%",
                      bottom: "22%",
                      height: "26%",
                      display: "flex",
                      alignItems: "flex-end",
                      gap: "4%",
                      padding: "6% 8%",
                      background: "#020104",
                      border: "1px solid rgba(198,145,47,.12)",
                      borderRadius: 3,
                    }}
                  >
                    {[
                      { anim: "pfMeter .6s ease-in-out infinite" },
                      { anim: "pfMeter2 .7s ease-in-out infinite" },
                      { anim: "pfMeter .55s ease-in-out infinite .2s" },
                      { anim: "pfMeter2 .65s ease-in-out infinite .15s" },
                      { anim: "pfMeter .58s ease-in-out infinite .1s" },
                      { anim: "pfMeter2 .72s ease-in-out infinite .25s" },
                    ].map((m, i) => (
                      <div
                        key={i}
                        className="pf-aud-meter"
                        style={{
                          flex: 1,
                          background: "linear-gradient(180deg,#8F2C10 0%,#C6912F 40%,#4FD18B 100%)",
                          borderRadius: 1,
                          animation: m.anim,
                        }}
                      />
                    ))}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: "6%",
                      right: "6%",
                      bottom: "6%",
                      display: "flex",
                      justifyContent: "space-between",
                      ...monoFace("clamp(4px,.45vw,7px)", "#6f685e", { letterSpacing: ".14em" }),
                    }}
                  >
                    <span>MIXER 01</span>
                    <span>-6</span>
                    <span>-3</span>
                    <span>0</span>
                  </div>
                  <div style={screenDim} />
                  <div style={screenGloss} />
                </div>
              </div>
              <Stand />
            </div>

            {/* PRESENTFLOW iMac (transcript only) */}
            <div
              style={{
                position: "absolute",
                left: "50.5%",
                top: "11%",
                width: "26%",
                height: "84%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  flex: 1,
                  background: "#0a0a0f",
                  borderRadius: 8,
                  padding: 5,
                  boxShadow:
                    "0 6px 20px rgba(0,0,0,.9),inset 0 0 0 1px rgba(198,145,47,.22),inset 0 1px 0 rgba(255,255,255,.06)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: 2,
                    transform: "translateX(-50%)",
                    width: 5,
                    height: 2,
                    borderRadius: 1,
                    background: "#1a1a22",
                  }}
                />
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    background: "linear-gradient(180deg,#060310 0%,#030108 100%)",
                    border: "1px solid rgba(198,145,47,.18)",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: 0,
                      height: "9%",
                      background: "linear-gradient(180deg,#0a0810 0%,#050308 100%)",
                      borderBottom: "1px solid rgba(198,145,47,.16)",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 3%",
                      gap: 6,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/marketing/logo-mark.png"
                      alt=""
                      style={{
                        width: "clamp(11px,1.1vw,17px)",
                        height: "auto",
                        display: "block",
                        filter: "drop-shadow(0 0 5px rgba(255,122,44,.45))",
                      }}
                    />
                    <div
                      style={{
                        fontFamily: SERIF,
                        fontWeight: 600,
                        fontSize: "clamp(7px,.85vw,13px)",
                        letterSpacing: "-.01em",
                        color: "#ECE7E0",
                      }}
                    >
                      Present<span style={{ color: "#ff7a2c" }}>Flow</span>
                    </div>
                    <div style={{ flex: 1 }} />
                    <div
                      className="pf-aud-led"
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "#8F2C10",
                        boxShadow: "0 0 8px #8F2C10",
                        animation: "pfLedBlink 1.8s ease-in-out infinite",
                      }}
                    />
                    <span
                      style={monoFace("clamp(4px,.5vw,7px)", "#8F2C10", {
                        letterSpacing: ".2em",
                        fontWeight: 600,
                      })}
                    >
                      LIVE
                    </span>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: "4%",
                      right: "4%",
                      top: "13%",
                      bottom: "6%",
                      padding: "5%",
                      background: "#020104",
                      border: "1px solid rgba(198,145,47,.14)",
                      borderRadius: 4,
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div
                      style={monoFace("clamp(5px,.65vw,9px)", "#C6912F", {
                        letterSpacing: ".18em",
                        textTransform: "uppercase",
                      })}
                    >
                      Live Transcript
                    </div>
                    <div
                      style={{
                        marginTop: "6%",
                        fontFamily: SERIF,
                        fontSize: "clamp(8px,1.05vw,15px)",
                        color: "#ECE7E0",
                        opacity: 0.94,
                        lineHeight: 1.55,
                      }}
                    >
                      &ldquo;...and He <span style={{ color: "#C6912F" }}>restoreth</span> my
                      soul: He leadeth me in the paths of righteousness for His name&apos;s
                      sake.&rdquo;
                    </div>
                    <div style={{ flex: 1 }} />
                    <div style={{ display: "flex", gap: "5%", flexWrap: "wrap", marginTop: "6%" }}>
                      <div
                        style={{
                          padding: "4px 8px",
                          background: "rgba(143,44,16,.35)",
                          border: "1px solid rgba(143,44,16,.65)",
                          borderRadius: 3,
                          ...monoFace("clamp(4px,.55vw,8px)", "#ECE7E0"),
                        }}
                      >
                        Psalm 23:3 <span style={{ color: "#C6912F" }}>94%</span>
                      </div>
                      <div
                        style={{
                          padding: "4px 8px",
                          background: "rgba(18,89,94,.22)",
                          border: "1px solid rgba(18,89,94,.4)",
                          borderRadius: 3,
                          ...monoFace("clamp(4px,.55vw,8px)", "#B8ADA0"),
                        }}
                      >
                        KJV · 61%
                      </div>
                      <div
                        style={{
                          padding: "4px 8px",
                          background: "rgba(198,145,47,.14)",
                          border: "1px solid rgba(198,145,47,.3)",
                          borderRadius: 3,
                          ...monoFace("clamp(4px,.55vw,8px)", "#C6912F"),
                        }}
                      >
                        AI · AUTO
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "radial-gradient(ellipse 80% 80% at 50% 40%, transparent 45%, rgba(0,0,0,.4) 100%)",
                      pointerEvents: "none",
                    }}
                  />
                  <div style={screenGloss} />
                </div>
              </div>
              <Stand />
            </div>

            {/* OBS iMac */}
            <div
              style={{
                position: "absolute",
                left: "78%",
                top: "11%",
                width: "19.5%",
                height: "84%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  flex: 1,
                  background: "#0a0a0f",
                  borderRadius: 8,
                  padding: 5,
                  boxShadow:
                    "0 6px 20px rgba(0,0,0,.9),inset 0 0 0 1px rgba(198,145,47,.14),inset 0 1px 0 rgba(255,255,255,.06)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: 2,
                    transform: "translateX(-50%)",
                    width: 5,
                    height: 2,
                    borderRadius: 1,
                    background: "#1a1a22",
                  }}
                />
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    background: "linear-gradient(180deg,#0a0f14 0%,#03080b 100%)",
                    border: "1px solid rgba(198,145,47,.14)",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: 0,
                      height: "9%",
                      background: "#0d1418",
                      borderBottom: "1px solid rgba(255,255,255,.06)",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 6%",
                      gap: 4,
                    }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: 1, background: "#12595E" }} />
                    <div style={monoFace("clamp(4px,.5vw,8px)", "#B8ADA0", { letterSpacing: ".06em" })}>
                      OBS Studio · Sunday.scene
                    </div>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: "5%",
                      right: "5%",
                      top: "11%",
                      height: "32%",
                      background: "#020608",
                      border: "1px solid rgba(255,255,255,.08)",
                      borderRadius: 3,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background:
                          "radial-gradient(ellipse 60% 60% at 50% 55%, rgba(143,44,16,.5) 0%, rgba(122,30,68,.3) 50%, #050307 100%)",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: "8%",
                        top: "22%",
                        ...monoFace("clamp(4px,.5vw,7px)", "#4FD18B", { letterSpacing: ".16em" }),
                      }}
                    >
                      ● REC 00:42:18
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        left: "8%",
                        right: "8%",
                        bottom: "10%",
                        fontFamily: SERIF,
                        fontSize: "clamp(5px,.7vw,10px)",
                        color: "#f5ecd8",
                      }}
                    >
                      Livestream · 1080p60
                    </div>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: "5%",
                      right: "5%",
                      top: "46%",
                      height: "28%",
                      background: "#03080b",
                      border: "1px solid rgba(255,255,255,.06)",
                      borderRadius: 3,
                      padding: "3% 5%",
                    }}
                  >
                    <div
                      style={monoFace("clamp(4px,.5vw,7px)", "#C6912F", {
                        letterSpacing: ".16em",
                        textTransform: "uppercase",
                      })}
                    >
                      Scenes
                    </div>
                    <div
                      style={{
                        marginTop: "5%",
                        ...monoFace("clamp(4px,.55vw,8px)", "#ECE7E0", { lineHeight: 1.7 }),
                      }}
                    >
                      <div style={{ color: "#4FD18B" }}>▶ Worship — Wide</div>
                      <div style={{ color: "#ECE7E0", opacity: 0.7 }}>&nbsp;&nbsp;Pulpit — MCU</div>
                      <div style={{ color: "#ECE7E0", opacity: 0.7 }}>&nbsp;&nbsp;Slide — Fullscreen</div>
                      <div style={{ color: "#ECE7E0", opacity: 0.7 }}>&nbsp;&nbsp;Choir — Overhead</div>
                    </div>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: "5%",
                      right: "5%",
                      top: "76%",
                      height: "20%",
                      background: "#03080b",
                      border: "1px solid rgba(255,255,255,.06)",
                      borderRadius: 3,
                      padding: "3% 5%",
                    }}
                  >
                    <div style={monoFace("clamp(4px,.5vw,7px)", "#12595E", { letterSpacing: ".16em" })}>
                      NDI SOURCES · 3
                    </div>
                    <div
                      style={{
                        marginTop: "6%",
                        ...monoFace("clamp(4px,.5vw,7px)", "#B8ADA0", { lineHeight: 1.5 }),
                      }}
                    >
                      CAM-01 · CAM-02 · PresentFlow-OUT
                    </div>
                  </div>
                  <div style={screenDim} />
                  <div style={screenGloss} />
                </div>
              </div>
              <Stand />
            </div>

            {/* desk warm bloom */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(ellipse 60% 45% at 50% 40%, rgba(198,145,47,.09) 0%, transparent 70%)",
                mixBlendMode: "screen",
                pointerEvents: "none",
              }}
            />
          </div>

          {/* Operator silhouette */}
          <div
            style={{
              position: "absolute",
              left: "22%",
              bottom: "2%",
              width: "15%",
              height: "36%",
              zIndex: 6,
              pointerEvents: "none",
            }}
          >
            <svg
              viewBox="0 0 200 300"
              preserveAspectRatio="xMidYMax meet"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
            >
              <defs>
                <radialGradient id="pfBodyGrad" cx="60%" cy="30%" r="70%">
                  <stop offset="0%" stopColor="#0f0a10" />
                  <stop offset="60%" stopColor="#050306" />
                  <stop offset="100%" stopColor="#010001" />
                </radialGradient>
                <linearGradient id="pfRimBrass" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="rgba(198,145,47,0)" />
                  <stop offset="50%" stopColor="rgba(198,145,47,.55)" />
                  <stop offset="100%" stopColor="rgba(255,220,160,.85)" />
                </linearGradient>
                <filter id="pfRimBlur" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="1.4" />
                </filter>
              </defs>
              <path
                d="M 20 300 C 20 240, 30 200, 55 175 C 68 162, 78 156, 88 152 C 92 140, 92 130, 92 120 C 92 96, 108 82, 128 82 C 148 82, 164 96, 164 120 C 164 132, 162 142, 168 152 C 180 156, 192 164, 210 178 L 210 300 Z"
                fill="url(#pfBodyGrad)"
              />
              <path
                d="M 108 152 C 112 158, 120 160, 128 160 C 136 160, 144 158, 148 152 L 148 168 L 108 168 Z"
                fill="#020102"
                opacity=".9"
              />
              <ellipse cx="97" cy="118" rx="3" ry="6" fill="#020102" />
              <path
                d="M 96 96 C 100 78, 118 74, 128 74 C 138 74, 158 80, 160 100 C 156 92, 148 88, 128 88 C 108 88, 100 92, 96 96 Z"
                fill="#010001"
              />
              <path
                d="M 155 90 C 162 96, 166 106, 166 120 C 166 138, 168 150, 174 156 C 186 162, 198 172, 210 186"
                stroke="url(#pfRimBrass)"
                strokeWidth="2.2"
                fill="none"
                filter="url(#pfRimBlur)"
                opacity=".9"
              />
              <path
                d="M 155 90 C 162 96, 166 106, 166 120 C 166 138, 168 150, 174 156 C 186 162, 198 172, 210 186"
                stroke="rgba(255,220,160,.35)"
                strokeWidth="0.8"
                fill="none"
              />
              <ellipse cx="195" cy="180" rx="24" ry="10" fill="rgba(198,145,47,.16)" filter="url(#pfRimBlur)" />
            </svg>
          </div>

          {/* Inner vignette */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse 92% 78% at 50% 45%, transparent 42%, rgba(3,1,5,.82) 100%)",
              pointerEvents: "none",
              zIndex: 8,
            }}
          />
        </div>

        {/* Film grain */}
        <div
          className="pf-aud-grain"
          style={{
            position: "absolute",
            inset: "-10%",
            pointerEvents: "none",
            opacity: 0.09,
            mixBlendMode: "overlay",
            zIndex: 9,
            backgroundImage: GRAIN_URI,
          }}
        />

        {/* Outer vignettes */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 10,
            boxShadow: "inset 0 0 320px 70px rgba(0,0,0,.9)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 10,
            background:
              "linear-gradient(180deg, rgba(0,0,0,.5) 0%, transparent 15%, transparent 85%, rgba(0,0,0,.7) 100%),linear-gradient(90deg, rgba(0,0,0,.4) 0%, transparent 10%, transparent 90%, rgba(0,0,0,.4) 100%)",
          }}
        />
      </div>
    </div>
  );
}
