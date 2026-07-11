"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { CheckCircle2, PlayCircle } from "lucide-react";

/**
 * PresentFlow split-panel shell used by /login, /signup, /forgot-password,
 * and /verify-email. Brand panel (left, 52%) shows animated "flow mesh"
 * SVG under the pitch copy; form panel (right, 48%) is `children`.
 *
 * Design source: PresentFlow Auth.dc.html. Mobile (<900px) collapses to
 * the form panel + a small logo header.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full flex overflow-hidden" style={{ background: "radial-gradient(1100px 780px at 18% 0%, #0c0c0c 0%, #000 62%)" }}>
      <BrandPanel />
      <div className="relative flex-1 min-w-0 flex items-center justify-center px-8 py-10">
        <div className="w-full max-w-[400px]" style={{ animation: "pfRise 0.45s ease both" }}>
          <MobileLogo />
          {children}
        </div>
      </div>
    </div>
  );
}

function MobileLogo() {
  return (
    <div className="flex md:hidden items-center gap-2.5 mb-7">
      <Image src="/brand/pf-logo-mark.png" alt="PresentFlow" width={40} height={40} className="object-contain" />
      <div className="font-display font-bold text-[22px] text-[#f1ede6]">
        Present<span className="pf-brand-text">Flow</span>
      </div>
    </div>
  );
}

const ROTATING_WORDS = ["worship teams", "churches", "speakers", "conferences", "creative teams", "live events"];
const PROOF_POINTS = ["Free to get started", "Easy to use", "Cancel anytime"];

function BrandPanel() {
  const [wordIdx, setWordIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setWordIdx((i) => i + 1), 2600);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="hidden md:flex relative flex-[1_1_52%] min-w-0 flex-col justify-between p-12 overflow-hidden"
      style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}
    >
      {/* Animated flow mesh SVG — the "wallpaper" beneath the pitch */}
      <FlowMesh />

      {/* Logo */}
      <div className="relative z-[2] flex items-center gap-3">
        <Image
          src="/brand/pf-logo-mark.png"
          alt="PresentFlow"
          width={52}
          height={52}
          className="object-contain"
          style={{ filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.5))", animation: "pfFloatMark 5s ease-in-out infinite" }}
          priority
        />
        <div className="font-display font-bold text-[27px] tracking-[-0.02em] text-[#f1ede6]">
          Present<span className="pf-brand-text">Flow</span>
        </div>
      </div>

      {/* Centre pitch */}
      <div className="relative z-[2] max-w-[540px]">
        <div className="text-[12.5px] font-bold tracking-[0.22em] uppercase mb-4" style={{ color: "#ff9048" }}>
          The AI-Native Presentation Platform
        </div>
        <h1
          className="font-display font-extrabold leading-[1.04] tracking-[-0.03em] m-0"
          style={{ color: "#f4f1ea", fontSize: "clamp(34px, 4.3vw, 56px)" }}
        >
          Powerful presentations.
          <br />
          Created <span className="pf-brand-text">effortlessly.</span>
        </h1>
        <p className="text-[16.5px] leading-[1.6] mt-[22px] max-w-[452px]" style={{ color: "#a7a096" }}>
          PresentFlow is AI-native — it listens, understands, and helps you deliver powerful presentations in real time.
        </p>
        <p className="text-[16.5px] leading-[1.6] mt-[14px] max-w-[452px]" style={{ color: "#a7a096" }}>
          Create slides, show lyrics, display verses, and engage your audience — all from one intuitive platform.
        </p>

        {/* Rotating "Trusted for" tag */}
        <div className="flex items-center gap-2.5 mt-8 min-h-[26px]">
          <span className="text-sm" style={{ color: "#847d72" }}>
            Trusted for
          </span>
          <div
            key={wordIdx}
            className="font-display font-semibold text-[15px]"
            style={{ color: "#ff7a2c", animation: "pfSlideWord 0.55s ease both" }}
          >
            {ROTATING_WORDS[wordIdx % ROTATING_WORDS.length]}
          </div>
        </div>
      </div>

      {/* Footer proof points */}
      <div className="relative z-[2] flex gap-[26px] text-[13px]" style={{ color: "#847d72" }}>
        {PROOF_POINTS.map((p) => (
          <div key={p} className="flex items-center gap-2.5">
            <CheckCircle2 className="w-[18px] h-[18px]" style={{ color: "#ff9048" }} strokeWidth={1.8} />
            {p}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Flow mesh — two intertwining SVG sweeps painted by a moving
 * gold→orange→purple gradient. Screen-blend for a glowing feel.
 * Same math as the design source (PresentFlow Auth.dc.html:295-303).
 */
function FlowMesh() {
  const paths: { d: string; w: number; opacity: number }[] = [];
  for (const p of [1, -1] as const) {
    for (let i = 0; i < 30; i++) {
      const gi = p === 1 ? 0 : 1;
      const w1 = Math.sin(i * 0.7 + gi * 1.3) * 22;
      const w2 = Math.cos(i * 0.5 + gi * 0.8) * 18;
      const A = 380 - i * 5 * p;
      const B = 189 + i * 6;
      const C = 312 - i * 5 * p;
      const D = 216 - i * 6;
      const E = 152 - i * 5 * p;
      const F = 343 - i * 6;
      const G = 616 - i * 5 * p;
      const H = 470 - i * 6;
      const I2 = 684 - i * 5 * p;
      const J = 875 - i * 6;
      const d = `M-${A} -${B}C-${A} -${B} -${C} ${D + w2} ${E + w1} ${F}C${G} ${H + w2} ${I2 + w1} ${J} ${I2} ${J}`;
      paths.push({ d, w: 0.8 + i * 0.05, opacity: 0.18 + i * 0.015 });
    }
  }
  return (
    <div className="absolute inset-0 pointer-events-none">
      <svg viewBox="0 0 696 316" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient id="pfMesh" x1="0" y1="0" x2="300" y2="80" gradientUnits="userSpaceOnUse" spreadMethod="repeat">
            <stop offset="0" stopColor="#ffb861" />
            <stop offset="0.24" stopColor="#ff6a1f" />
            <stop offset="0.5" stopColor="#a874d6" />
            <stop offset="0.76" stopColor="#ff6a1f" />
            <stop offset="1" stopColor="#ffb861" />
            <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="300 80" dur="7s" repeatCount="indefinite" />
          </linearGradient>
        </defs>
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill="none"
            stroke="url(#pfMesh)"
            strokeWidth={p.w.toFixed(2)}
            strokeLinecap="round"
            style={{ opacity: p.opacity.toFixed(2), mixBlendMode: "screen", filter: "drop-shadow(0 0 3px rgba(255,140,60,0.5))" }}
          />
        ))}
      </svg>
    </div>
  );
}

/**
 * Reusable primitives to match the design's input + button styles across
 * every auth/onboarding screen. Consumers get correct spacing + focus.
 */
export function AuthHeader({
  eyebrow,
  heading,
  sub,
  showBrandInHeading,
}: {
  eyebrow: string;
  heading: string;
  sub: string;
  showBrandInHeading?: boolean;
}) {
  return (
    <div>
      <div className="text-[13px] font-semibold tracking-[0.14em] uppercase" style={{ color: "#ff9048" }}>
        {eyebrow}
      </div>
      <h2 className="font-display font-bold text-[30px] tracking-[-0.02em] mt-2 mb-1.5 text-[#f4f1ea] flex flex-wrap items-center gap-2.5">
        {heading}
        {showBrandInHeading && (
          <span className="inline-flex items-center gap-1.5">
            <Image src="/brand/pf-logo-mark.png" alt="" width={30} height={30} className="object-contain" />
            Present<span style={{ color: "#ff7a2c" }}>Flow</span>
          </span>
        )}
      </h2>
      <p className="text-[15px] leading-[1.5] m-0 mb-[26px]" style={{ color: "#9c958b" }}>
        {sub}
      </p>
    </div>
  );
}

export const authInputCls =
  "w-full px-3.5 py-3.5 rounded-xl text-[15px] text-[#ece7e0] outline-none transition-[border-color,box-shadow] duration-200 focus:ring-0";
export const authInputStyle: React.CSSProperties = {
  background: "#171319",
  border: "1px solid rgba(255,255,255,0.1)",
  fontFamily: "inherit",
};

export const authLabelCls = "block text-[13px] font-semibold mb-1.5";
export const authLabelStyle: React.CSSProperties = { color: "#c4bcaf" };

export const authCtaCls =
  "flex-1 w-full py-3.5 rounded-xl border-0 cursor-pointer font-display font-bold text-[15px] text-white transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed";
export const authCtaStyle: React.CSSProperties = { background: "#cf5f1e" };
export const authCtaHoverStyle: React.CSSProperties = { background: "#b9531a" };

/** "Watch demo" secondary button — used on the marketing brand panel only. */
export function WatchDemoButton({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className="inline-flex items-center gap-2.5 px-5 py-3 rounded-xl cursor-pointer font-display font-semibold text-[15px] text-[#f1ede6] transition-colors"
      style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.16)" }}
    >
      <PlayCircle className="w-6 h-6" strokeWidth={1.5} />
      Watch Demo
    </button>
  );
}
