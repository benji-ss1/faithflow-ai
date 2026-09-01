"use client";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Shared auth backdrop + hero — the "Every service, on autopilot" design.
// Login AND signup both render this so they never visually diverge again; each
// page supplies only its aside (form) content as children.
const LoginScene = dynamic(() => import("./LoginScene"), { ssr: false });

const CSS = `
.pflogin{--ink:#0a0908;--paper:#ECE7E0;--paper-2:#c9c2b8;--paper-dim:#8a847b;--paper-faint:#4a4640;
  --orange:#ff7a2c;--orange-glow:#ffb861;--hair:rgba(236,231,224,0.12);--hair-strong:rgba(236,231,224,0.28);
  position:fixed;inset:0;overflow:hidden;background:var(--ink);color:var(--paper);
  font-family:"Plus Jakarta Sans",system-ui,sans-serif;font-weight:400;letter-spacing:-0.005em;-webkit-font-smoothing:antialiased}
.pflogin *{box-sizing:border-box}
.pflogin .scene{position:absolute;inset:0;z-index:0}
.pflogin .noise{position:absolute;inset:0;z-index:1;pointer-events:none;opacity:.35;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.93 0 0 0 0 0.90 0 0 0 0 0.86 0 0 0 0.06 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
.pflogin .vignette{position:absolute;inset:0;z-index:2;pointer-events:none;background:radial-gradient(120% 80% at 50% 55%, transparent 55%, rgba(0,0,0,0.55) 100%)}
.pflogin .projectors{position:absolute;left:0;top:0;width:57%;height:100%;z-index:4;pointer-events:none;overflow:hidden}
.pflogin .proj{position:absolute;border:1px solid rgba(236,231,224,0.55);background:#0a0908;padding:6px;border-radius:2px;
  box-shadow:0 30px 80px -30px rgba(0,0,0,0.9),0 0 0 1px rgba(236,231,224,0.08);opacity:0;
  animation-fill-mode:both;animation-iteration-count:infinite;animation-timing-function:cubic-bezier(0.33,0.05,0.2,1);animation-duration:48s;animation-delay:var(--delay,0s);will-change:transform,opacity}
.pflogin .proj-inner{overflow:hidden;background:#000;position:relative;aspect-ratio:16/9}
.pflogin .proj-inner img{display:block;width:100%;height:100%;object-fit:cover;filter:saturate(0.9) brightness(0.95)}
.pflogin .proj-tag{position:absolute;left:8px;bottom:-22px;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:9px;letter-spacing:0.22em;text-transform:uppercase;color:var(--paper-faint);white-space:nowrap}
@keyframes pflane1{0%{opacity:0;transform:translate(14vw,66vh) scale(0.82)}12%{opacity:1}38%{opacity:1}54%{opacity:0;transform:translate(14vw,30vh) scale(0.98)}100%{opacity:0}}
@keyframes pflane2{0%{opacity:0;transform:translate(30vw,70vh) scale(0.80)}12%{opacity:1}38%{opacity:1}54%{opacity:0;transform:translate(30vw,28vh) scale(0.96)}100%{opacity:0}}
@keyframes pflane3{0%{opacity:0;transform:translate(8vw,68vh) scale(0.84)}12%{opacity:1}38%{opacity:1}54%{opacity:0;transform:translate(8vw,32vh) scale(1.0)}100%{opacity:0}}
@keyframes pflane4{0%{opacity:0;transform:translate(34vw,64vh) scale(0.80)}12%{opacity:1}38%{opacity:1}54%{opacity:0;transform:translate(34vw,26vh) scale(0.96)}100%{opacity:0}}
@keyframes pflane5{0%{opacity:0;transform:translate(20vw,72vh) scale(0.82)}12%{opacity:1}38%{opacity:1}54%{opacity:0;transform:translate(20vw,30vh) scale(1.0)}100%{opacity:0}}
.pflogin .p1{--delay:0s;width:220px;animation-name:pflane1}.pflogin .p2{--delay:9.6s;width:190px;animation-name:pflane2}
.pflogin .p3{--delay:19.2s;width:240px;animation-name:pflane3}.pflogin .p4{--delay:28.8s;width:205px;animation-name:pflane4}.pflogin .p5{--delay:38.4s;width:215px;animation-name:pflane5}

.pflogin .page{position:relative;z-index:3;height:100%;display:grid;grid-template-columns:1.15fr 0.85fr}
.pflogin .hero{padding:44px 56px 44px 64px;display:flex;flex-direction:column;justify-content:space-between;position:relative}
.pflogin .brand{display:flex;align-items:center;gap:14px}
.pflogin .brand img{height:34px;width:auto;display:block}
.pflogin .wordmark{font-family:"Sora",sans-serif;font-weight:700;font-size:24px;letter-spacing:-0.03em;color:var(--paper)}
.pflogin .wordmark em{font-style:normal;font-weight:700;color:var(--orange)}
.pflogin .hero-copy{max-width:640px;margin-top:auto;margin-bottom:8vh}
.pflogin .eyebrow{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:var(--orange);margin-bottom:28px;display:flex;align-items:center;gap:12px}
.pflogin .eyebrow::before{content:"";width:22px;height:1px;background:var(--orange)}
.pflogin h1.headline{font-family:"Sora",sans-serif;font-weight:700;font-size:clamp(42px,5.4vw,86px);line-height:1.02;letter-spacing:-0.035em;color:var(--paper);text-wrap:balance}
.pflogin h1.headline em{font-style:normal;font-weight:700;color:var(--orange)}
.pflogin .lede{margin-top:28px;font-size:16px;line-height:1.55;color:var(--paper-dim);max-width:52ch}
.pflogin .heroFoot{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:var(--orange)}

.pflogin .aside{padding:44px 64px 44px 40px;display:flex;flex-direction:column;border-left:1px solid var(--hair);background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,0.35) 100%);backdrop-filter:blur(2px)}
.pflogin .aside-top{display:flex;justify-content:space-between;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:var(--paper-faint)}
.pflogin .aside-top .o{color:var(--orange)}
.pflogin .form-wrap{margin:auto 0;max-width:400px;width:100%}
.pflogin .welcome{font-family:"Sora",sans-serif;font-weight:500;font-size:15px;letter-spacing:-0.01em;color:var(--paper-2);margin-bottom:14px}
.pflogin h2.signin{font-family:"Sora",sans-serif;font-weight:700;font-size:40px;line-height:1.05;letter-spacing:-0.035em;color:var(--paper)}
.pflogin h2.signin .o,.pflogin h2.signin em{font-style:normal;font-weight:700;color:var(--orange)}
.pflogin .subtle{margin-top:14px;color:var(--paper-dim);font-size:15px;line-height:1.5}
.pflogin .banner{margin-top:18px;border-radius:10px;border:1px solid rgba(255,144,72,0.35);background:rgba(255,144,72,0.08);color:#ff9048;padding:10px 12px;font-size:12.5px;line-height:1.4}
.pflogin .field{margin-top:26px;display:flex;flex-direction:column;gap:9px}
.pflogin .field label{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:var(--paper-dim);display:flex;justify-content:space-between}
.pflogin .field label button{background:none;border:0;cursor:pointer;color:var(--paper-2);font:inherit;border-bottom:1px solid var(--hair-strong);padding:0}
.pflogin .field input{background:transparent;border:0;border-bottom:1px solid var(--hair-strong);padding:12px 2px;color:var(--paper);font-family:"Plus Jakarta Sans",sans-serif;font-size:16px;letter-spacing:-0.005em;outline:none;transition:border-color .2s}
.pflogin .field input::placeholder{color:var(--paper-faint)}
.pflogin .field input:focus{border-bottom-color:var(--paper)}
.pflogin .field .hint{font-size:11px;color:var(--paper-faint);letter-spacing:0;text-transform:none;font-family:"Plus Jakarta Sans",sans-serif}
.pflogin button.signin-btn{margin-top:36px;width:100%;background:linear-gradient(180deg,var(--orange-glow) 0%,var(--orange) 100%);color:#fff;border:0;padding:15px 20px;cursor:pointer;border-radius:10px;font-family:"Sora",sans-serif;font-weight:700;font-size:16px;letter-spacing:-0.01em;display:flex;justify-content:space-between;align-items:center;transition:filter .2s,transform .09s;box-shadow:0 8px 32px -12px rgba(255,122,44,0.55)}
.pflogin button.signin-btn:hover{filter:brightness(1.06)}
.pflogin button.signin-btn:active{transform:scale(0.99)}
.pflogin button.signin-btn:disabled{opacity:.7;cursor:default}
.pflogin button.signin-btn .arr{font-family:ui-monospace,monospace;font-size:12px;letter-spacing:0.2em}
.pflogin .note{margin-top:24px;font-size:13px;line-height:1.55;color:var(--paper-faint);max-width:42ch}
.pflogin .note .o{color:var(--orange)}
.pflogin .note a{color:var(--orange);text-decoration:none;border-bottom:1px solid var(--hair-strong)}
.pflogin .aside-foot{margin-top:auto;padding-top:32px;display:flex;justify-content:space-between;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:var(--paper-faint);border-top:1px solid var(--hair)}
.pflogin .aside-foot > div{padding-top:16px}
.pflogin .aside-foot button{background:none;border:0;cursor:pointer;color:var(--orange);font:inherit}
.pflogin .expand{max-height:0;opacity:0;overflow:hidden;transition:max-height .55s cubic-bezier(0.2,0,0.2,1),opacity .35s ease,margin .55s cubic-bezier(0.2,0,0.2,1)}
.pflogin .expand.open{max-height:260px;opacity:1;margin-top:14px}
.pflogin .reset-card,.pflogin .help-card,.pflogin .sent-card{border:1px solid var(--hair-strong);background:rgba(28,24,32,0.6);backdrop-filter:blur(8px);border-radius:12px;padding:16px 18px;color:var(--paper-2);font-size:13px;line-height:1.5}
.pflogin .rc-title{font-family:"Sora",sans-serif;font-weight:600;color:var(--paper);font-size:14px;letter-spacing:-0.01em;margin-bottom:6px}
.pflogin .reset-card input{margin-top:10px;width:100%;background:transparent;border:0;border-bottom:1px solid var(--hair-strong);padding:8px 2px;color:var(--paper);font-family:"Plus Jakarta Sans",sans-serif;font-size:14px;outline:none}
.pflogin .rc-actions{margin-top:14px;display:flex;gap:10px;justify-content:flex-end}
.pflogin .rc-actions button{background:var(--orange);color:#fff;border:0;border-radius:8px;padding:8px 14px;font-family:"Sora",sans-serif;font-weight:600;font-size:12px;cursor:pointer;transition:filter .2s}
.pflogin .rc-actions button.ghost{background:transparent;color:var(--paper-dim)}
.pflogin .help-card a{color:var(--orange);text-decoration:none;border-bottom:1px solid var(--hair-strong)}
@media (max-width:1200px){.pflogin .p2,.pflogin .p4{display:none}}
@media (max-width:900px){.pflogin .page{grid-template-columns:1fr}.pflogin .hero{display:none}.pflogin .aside{border-left:0}.pflogin .projectors{display:none}}
@media (prefers-reduced-motion:reduce){.pflogin .proj{display:none}}
`;

const SLIDES = [
  { src: "/login/slide-1.png", tag: "Scripture · Exodus 4:7" },
  { src: "/login/slide-2.png", tag: "Scripture · Psalms 23:4" },
  { src: "/login/slide-3.png", tag: "Song · Revelation Song" },
  { src: "/login/slide-4.png", tag: "Song · Worthy Is Your Name" },
  { src: "/login/slide-5.png", tag: "Song · Alleluia" },
];

/**
 * The shared PresentFlow auth scene. Renders the full-bleed backdrop + hero; the
 * page's aside (form) is passed as children so login and signup share one look.
 */
export function PfAuthScene({ children }: { children: ReactNode }) {
  return (
    <div className="pflogin">
      <style>{CSS}</style>
      <div className="scene"><LoginScene /></div>
      <div className="noise" />
      <div className="projectors" aria-hidden="true">
        {SLIDES.map((s, i) => (
          <div key={i} className={`proj p${i + 1}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div className="proj-inner"><img src={s.src} alt="" /></div>
            <div className="proj-tag">{s.tag}</div>
          </div>
        ))}
      </div>
      <div className="vignette" />

      <div className="page">
        <section className="hero">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/pf-logo-mark.png" alt="PresentFlow" />
            <span className="wordmark">Present<em>Flow</em></span>
          </div>
          <div className="hero-copy">
            <div className="eyebrow">AI presentation &amp; operations for churches</div>
            <h1 className="headline">Every service, <em>on autopilot.</em></h1>
            <p className="lede">
              <span style={{ color: "var(--orange)" }}>PresentFlow listens to the room,</span>{" "}
              <span style={{ color: "var(--paper)" }}>detects the scripture, cues the song, and runs the operations of your service — so your team can keep their eyes on the congregation.</span>
            </p>
          </div>
          <div className="heroFoot">Wave I · Invite only</div>
        </section>

        <aside className="aside">{children}</aside>
      </div>
    </div>
  );
}
