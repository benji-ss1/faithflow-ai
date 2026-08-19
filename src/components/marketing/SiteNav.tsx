"use client";

/**
 * SiteNav — a resize-on-scroll bar (shrinks to a centered blurred pill past
 * ~80px) + a PARCHMENT overlay menu ported from the design pack:
 * ivory scroll, hamburger→X, veil + scale-in, quill/inkwell + open-Bible corner
 * drawings, bullet items, Cormorant Garamond labels + Lora body. Keeps the real
 * PresentFlow logo. Resize behaviour is native CSS/JS (no framer-motion dep).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type LinkDef = { label: string; href: string; apply?: boolean };
const LINKS: LinkDef[] = [
  { label: "Home", href: "/" },
  { label: "Our Story", href: "/our-story" },
  { label: "Apply for the beta", href: "/apply", apply: true },
];

const QUILL = (
  <svg width="120" height="120" viewBox="0 0 120 120" fill="none" stroke="#8a2410" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 96h34l-3 12h-28z" fill="#8a2410" fillOpacity=".12" />
    <path d="M22 96V84h26v12" />
    <ellipse cx="35" cy="84" rx="13" ry="3" />
    <path d="M28 108q7 3 14 0" stroke="#5a1206" />
    <path d="M35 84 L82 22" strokeWidth="1.6" />
    <path d="M76 28 q6 -2 10 -8 M72 32 q8 -2 12 -8 M68 36 q10 -2 14 -8 M64 40 q10 -2 14 -8 M60 44 q10 -2 12 -6" />
    <path d="M82 22 q4 -6 10 -8 q0 6 -4 12 z" fill="#8a2410" fillOpacity=".2" />
    <path d="M35 84 l-3 -2 l3 -3 l3 3 z" fill="#5a1206" />
    <circle cx="38" cy="90" r="1.4" fill="#5a1206" />
  </svg>
);

const BIBLE = (
  <svg width="130" height="110" viewBox="0 0 130 110" fill="none" stroke="#8a2410" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 84 q55 -8 110 0 v10 q-55 -8 -110 0 z" fill="#8a2410" fillOpacity=".1" />
    <path d="M10 78 q30 -22 55 -8 v-56 q-25 -14 -55 8 z" fill="#f5f0e5" fillOpacity=".6" />
    <path d="M65 70 q30 -22 55 -8 v-56 q-25 -14 -55 8 z" fill="#f5f0e5" fillOpacity=".6" />
    <path d="M65 14 v56" />
    <path d="M65 14 v-8 M60 6 h10" stroke="#8a2410" />
    <path d="M18 22 q22 -10 42 -4 M18 32 q22 -10 42 -4 M18 42 q22 -10 42 -4 M18 52 q22 -10 42 -4 M18 62 q22 -10 42 -4" strokeDasharray="2 3" />
    <path d="M72 18 q20 -8 40 -2 M72 28 q20 -8 40 -2 M72 38 q20 -8 40 -2 M72 48 q20 -8 40 -2 M72 58 q20 -8 40 -2" strokeDasharray="2 3" />
    <path d="M92 66 v10 M87 71 h10" stroke="#8a2410" />
  </svg>
);

const CSS = `
.pfnav{--ivory:#efeae0;--ivory-hi:#f5f0e5;--ivory-lo:#dcd4c2;--scorch:#1a1410;--ash:#5c534a;--oxblood:#8a2410}
/* resize-on-scroll bar */
.pfnav-wrap{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;justify-content:center;pointer-events:none;
  transition:padding .4s cubic-bezier(.2,.7,.2,1)}
.pfnav-wrap.scrolled{padding-top:16px}
.pfnav-bar{pointer-events:auto;display:flex;align-items:center;justify-content:space-between;gap:18px;width:100%;
  padding:16px clamp(18px,4vw,40px);border-radius:0;background:transparent;box-shadow:none;backdrop-filter:none;
  transition:width .45s cubic-bezier(.2,.7,.2,1),background .45s ease,box-shadow .45s ease,border-radius .45s ease,padding .45s ease,backdrop-filter .45s ease}
.pfnav-wrap.scrolled .pfnav-bar{width:min(760px,94%);padding:10px 14px 10px 20px;border-radius:999px;
  background:rgba(20,18,16,.62);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  box-shadow:0 10px 40px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.06)}
/* Crisp vector-style lockup: the mark PNG (downscaled, never upscaled) + real
   text wordmark. Replaces the old 370px raster that softened on retina. */
/* Serif editorial wordmark (matches the footer lockup) — Present bold, Flow light. */
.pfnav-logo{display:flex;align-items:center;text-decoration:none}
.pfnav-word{font-family:var(--pf-serif),"Iowan Old Style",Georgia,serif;font-size:29px;
  letter-spacing:-.02em;color:#f5f0e5;line-height:1;transition:font-size .4s ease;white-space:nowrap}
.pfnav-wrap.scrolled .pfnav-word{font-size:23px}
.pfnav-pre{font-weight:600}
.pfnav-flow{font-weight:300}
.pfnav-right{display:flex;align-items:center;gap:12px}
.pfnav-apply{font-weight:700;font-size:14px;padding:10px 18px;border-radius:10px;
  background:linear-gradient(100deg,#ff7a2c,#ffb861);color:#1A1005;transition:filter .2s}
.pfnav-apply:hover{filter:brightness(1.08)}
/* ivory hamburger */
.pfnav-burger{pointer-events:auto;cursor:pointer;width:52px;height:52px;padding:0;position:relative;flex:none;
  background:radial-gradient(ellipse at 30% 20%,rgba(220,212,194,.4),transparent 60%),linear-gradient(180deg,var(--ivory-hi),var(--ivory) 60%,var(--ivory-lo));
  border:1.5px solid var(--scorch);border-radius:8px;box-shadow:0 2px 6px rgba(120,100,72,.15);transition:transform .2s ease}
.pfnav-burger:hover{transform:translateY(-1px)}
.pfnav-burger .l{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:24px;height:16px}
.pfnav-burger .l span{position:absolute;left:0;right:0;height:2px;background:var(--scorch);
  transition:transform 240ms cubic-bezier(.2,0,.2,1),opacity 200ms,top 240ms cubic-bezier(.2,0,.2,1),width 240ms}
.pfnav-burger .l span:nth-child(1){top:0}
.pfnav-burger .l span:nth-child(2){top:7px}
.pfnav-burger .l span:nth-child(3){top:14px;width:60%}
.pfnav-burger.open .l span:nth-child(1){top:7px;transform:rotate(45deg)}
.pfnav-burger.open .l span:nth-child(2){opacity:0}
.pfnav-burger.open .l span:nth-child(3){top:7px;width:100%;transform:rotate(-45deg)}
/* parchment overlay */
.pfnav-veil{position:fixed;inset:0;z-index:60;background:radial-gradient(ellipse at 50% 50%,rgba(220,212,194,.65),rgba(180,164,132,.9));
  opacity:0;pointer-events:none;transition:opacity 300ms ease}
.pfnav-veil.open{opacity:1;pointer-events:auto}
.pfnav-scroll{position:fixed;z-index:70;top:50%;left:50%;transform:translate(-50%,-50%) scale(.94);opacity:0;pointer-events:none;
  transition:transform 520ms cubic-bezier(.2,0,.2,1),opacity 320ms ease;width:min(940px,92vw);max-height:92vh;overflow:auto;padding:80px 84px;
  background:radial-gradient(ellipse at 12% 18%,rgba(220,212,194,.5),transparent 24%),radial-gradient(ellipse at 88% 14%,rgba(138,36,16,.06),transparent 22%),radial-gradient(ellipse at 78% 82%,rgba(220,212,194,.4),transparent 22%),repeating-linear-gradient(92deg,transparent 0 5px,rgba(120,105,80,.05) 5px 6px),repeating-linear-gradient(1deg,transparent 0 9px,rgba(120,105,80,.04) 9px 10px),linear-gradient(180deg,var(--ivory-hi),var(--ivory) 40%,var(--ivory-lo) 100%);
  box-shadow:0 20px 40px rgba(120,100,72,.2);
  clip-path:polygon(0% 3%,3% 1%,8% 2%,14% 0%,20% 2%,28% 1%,36% 3%,44% 1%,52% 2%,60% 0%,68% 2%,76% 1%,84% 3%,92% 1%,97% 2%,100% 3%,99% 10%,100% 20%,98% 32%,100% 44%,99% 56%,100% 68%,98% 80%,100% 92%,97% 99%,90% 100%,82% 98%,72% 100%,62% 99%,52% 100%,42% 98%,32% 100%,22% 99%,14% 100%,6% 98%,2% 100%,0% 96%,1% 84%,0% 72%,2% 60%,0% 48%,1% 36%,0% 24%,1% 12%)}
.pfnav-scroll.open{transform:translate(-50%,-50%) scale(1);opacity:1;pointer-events:auto}
.pfnav-x{position:absolute;top:22px;right:26px;z-index:3;width:44px;height:44px;border-radius:8px;background:var(--scorch);color:var(--ivory-hi);
  font-family:var(--pf-cormorant),serif;font-size:22px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .12s,background .2s}
.pfnav-x:hover{transform:translateY(-1px);background:#000}
.pfnav-list{position:relative;z-index:2;list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:2px}
.pfnav-list li{opacity:0;transform:translateY(8px);transition:opacity 300ms ease,transform 300ms cubic-bezier(.2,0,.2,1)}
.pfnav-scroll.open .pfnav-list li{opacity:1;transform:none}
.pfnav-list a{display:grid;grid-template-columns:26px 1fr;align-items:baseline;gap:16px;padding:18px 8px;color:var(--scorch);text-decoration:none;border-bottom:1px solid rgba(22,19,16,.15);transition:background .18s,transform .18s}
.pfnav-list a:hover{background:rgba(22,19,16,.04);transform:translateX(4px)}
.pfnav-list .b{font-family:var(--pf-lora),serif;font-size:22px;color:var(--oxblood);line-height:1}
.pfnav-list .lb{font-family:var(--pf-cormorant),serif;font-weight:700;font-size:clamp(30px,4.6vw,46px);color:var(--scorch);line-height:1.1;letter-spacing:-.005em}
.pfnav-list a.apply .lb{color:var(--oxblood);font-style:italic}
.pfnav-corner{position:absolute;z-index:1;opacity:.7;pointer-events:none}
.pfnav-corner.bible{right:36px;top:88px;transform:rotate(6deg)}
.pfnav-corner.quill{left:36px;top:88px;transform:rotate(-8deg)}
@media (max-width:820px){
  /* On mobile the nav is ALWAYS a clean floating pill (never the full-width
     bar that hugs the top and looks clipped) — matches the desired look. */
  .pfnav-wrap{padding-top:10px}
  .pfnav-bar{width:min(680px,92%);padding:9px 12px 9px 18px;border-radius:999px;
    background:rgba(20,18,16,.72);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
    box-shadow:0 10px 40px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.06)}
  .pfnav-scroll{padding:64px 24px 60px;width:94vw}
  .pfnav-list .lb{font-size:30px}
  .pfnav-corner{transform:scale(.55)!important;opacity:.5}
  .pfnav-word{font-size:25px}
  .pfnav-apply{display:none}
}
@media (prefers-reduced-motion:reduce){
  .pfnav-scroll,.pfnav-veil,.pfnav-list li,.pfnav-burger .l span,.pfnav-bar{transition:none!important}
}
`;

export default function SiteNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const setMenu = useCallback((v: boolean) => {
    setOpen(v);
    document.body.style.overflow = v ? "hidden" : "";
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMenu]);

  return (
    <div className="pfnav">
      <style>{CSS}</style>

      <div className={`pfnav-wrap ${scrolled ? "scrolled" : ""}`}>
        <div className="pfnav-bar">
          <Link href="/" aria-label="PresentFlow home" className="pfnav-logo">
            <span className="pfnav-word"><span className="pfnav-pre">Present</span><span className="pfnav-flow">Flow</span></span>
          </Link>
          <div className="pfnav-right">
            <Link href="/apply" className="pfnav-apply">Apply for the beta</Link>
            <button
              className={`pfnav-burger ${open ? "open" : ""}`}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setMenu(!open)}
            >
              <span className="l"><span /><span /><span /></span>
            </button>
          </div>
        </div>
      </div>

      <div className={`pfnav-veil ${open ? "open" : ""}`} onClick={() => setMenu(false)} aria-hidden="true" />
      <div className={`pfnav-scroll ${open ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="Main menu">
        <button className="pfnav-x" aria-label="Close menu" onClick={() => setMenu(false)}>×</button>
        <div className="pfnav-corner quill">{QUILL}</div>
        <div className="pfnav-corner bible">{BIBLE}</div>
        <ul className="pfnav-list">
          {LINKS.map((l, i) => (
            <li key={l.href} style={{ transitionDelay: open ? `${120 + i * 70}ms` : "0ms" }}>
              <Link href={l.href} className={l.apply ? "apply" : ""} onClick={() => setMenu(false)}>
                <span className="b">•</span>
                <span className="lb">{l.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
