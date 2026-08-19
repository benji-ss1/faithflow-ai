"use client";

/**
 * Closing CTA — a warm, light-mode editorial panel (cream paper, Fraunces serif,
 * oxblood accent, a handwritten caption) that deliberately breaks out of the
 * dark scroll sections above it. A church line-drawing "draws itself" in with a
 * pencil-stroke animation as the section reveals. Replaces the old dark
 * "This is a closed beta" block.
 */
import { useEffect, useRef } from "react";
import Link from "next/link";

const CHURCH =
  "M60 8 L60 24 M20 52 L60 24 L100 52 M24 52 L24 86 M96 52 L96 86 M16 86 L104 86 M52 86 L52 64 L68 64 L68 86";

const CSS = `
/* Inverted to dark (paper -> ink). */
.pfcta{--cream:#17130c;--ink:#F5F1EA;--muted:#b3aa9c;--oxblood:#d0653a;--line:#38301f;
  position:relative;background:var(--cream);color:var(--ink);overflow:hidden}
.pfcta .in{max-width:1160px;margin:0 auto;padding:clamp(84px,13vw,168px) clamp(30px,6vw,96px);position:relative}
.pfcta .rail{position:absolute;left:0;top:0;bottom:0;width:1px;background:var(--ink);opacity:.16}
.pfcta .chapter{position:absolute;top:clamp(30px,5vw,58px);right:clamp(30px,6vw,96px);font-family:var(--pf-mono);font-size:12px;letter-spacing:.2em;color:var(--muted);text-transform:uppercase}
.pfcta .church{position:absolute;top:clamp(64px,10vw,132px);right:clamp(44px,8vw,128px);width:clamp(96px,13vw,168px);height:auto}
.pfcta .church path{fill:none;stroke:var(--oxblood);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;
  stroke-dasharray:var(--len,600);stroke-dashoffset:var(--len,600);transition:stroke-dashoffset 1.6s ease .2s}
.pfcta.in .church path{stroke-dashoffset:0}
.pfcta h2{font-family:var(--pf-serif),"Iowan Old Style",Georgia,serif;font-weight:300;
  font-size:clamp(42px,7.4vw,92px);line-height:1;letter-spacing:-.02em;margin:0;max-width:15ch}
.pfcta h2 .run{font-style:italic;color:var(--oxblood)}
.pfcta .cap{font-family:var(--pf-hand),"Segoe Script",cursive;font-size:clamp(21px,2.6vw,32px);
  color:#cabfae;margin:26px 0 0;max-width:26ch;line-height:1.28}
.pfcta .cta{margin-top:clamp(34px,5vw,52px)}
.pfcta .btn{display:inline-flex;align-items:center;gap:10px;font-weight:700;font-size:16px;
  padding:17px 32px;border-radius:11px;background:#F5F1EA;color:#1a140d;
  transition:transform .25s ease,box-shadow .25s ease}
.pfcta .btn:hover{transform:translateY(-2px);box-shadow:0 16px 44px rgba(0,0,0,.45)}
.pfcta .reveal{opacity:0;transform:translateY(28px);transition:opacity .8s cubic-bezier(.22,1,.36,1),transform .8s cubic-bezier(.22,1,.36,1)}
.pfcta.in .reveal{opacity:1;transform:none}
.pfcta.in .reveal.d1{transition-delay:.1s}
.pfcta.in .reveal.d2{transition-delay:.22s}
.pfcta.in .reveal.d3{transition-delay:.34s}
@media (max-width:720px){
  .pfcta .church{position:relative;top:auto;right:auto;margin:0 0 16px;width:82px;display:block}
  .pfcta .chapter{display:none}
  .pfcta h2{max-width:none}
}
`;

export default function CtaSection() {
  const rootRef = useRef<HTMLElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    const root = rootRef.current, path = pathRef.current;
    if (!root) return;
    if (path) root.style.setProperty("--len", String(Math.ceil(path.getTotalLength())));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { root.classList.add("in"); return; }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { root.classList.add("in"); io.disconnect(); } }),
      { threshold: 0.25 },
    );
    io.observe(root);
    return () => io.disconnect();
  }, []);

  return (
    <section className="pfcta" ref={rootRef} aria-label="Apply for the beta">
      <style>{CSS}</style>
      <div className="in">
        <span className="rail" aria-hidden="true" />
        <div className="chapter reveal">Wave one · pilot cohort</div>
        <svg className="church" viewBox="0 0 120 100" aria-hidden="true">
          <path ref={pathRef} d={CHURCH} />
        </svg>
        <h2>
          <span className="reveal">Let us run your</span>{" "}
          <span className="reveal d1">next service.</span>{" "}
          <span className="reveal run d2">Apply here.</span>
        </h2>
        <p className="cap reveal d2">
          Wave one is small. If you run a booth on Sunday, we&apos;d love to have you in early.
        </p>
        <div className="cta reveal d3">
          <Link href="/apply" className="btn">Apply for the beta&nbsp;→</Link>
        </div>
      </div>
    </section>
  );
}
