"use client";

/**
 * "What's in the beta" — pinned, scroll-scrubbed 3-card section.
 * Ported from the design export (Beta Cards.html). SVG art is injected raw so
 * the original animation JS ports verbatim (it drives elements by id). The
 * card-2 "light" flip is scoped to THIS section's root — never the whole page.
 * Fully responsive + reduced-motion aware (falls back to a stacked static list).
 *
 * The "Everything you need. Nothing you don't." header from the export is
 * intentionally dropped per the brief.
 */
import { useEffect, useRef } from "react";

// ── raw SVG art (kept as HTML strings; the tick loop queries them by id) ──────
const ART1 = `
<svg viewBox="0 0 800 560" preserveAspectRatio="xMidYMid meet" id="art1">
  <defs><style>
    .ink{stroke:#F4EFE6;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
    .brass{stroke:#C6912F;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
    .orange{stroke:#ff7a2c;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
    .label{font-family:'JetBrains Mono',monospace;font-size:13px;fill:#ffb861;letter-spacing:.06em}
    .label-pf{font-family:'JetBrains Mono',monospace;font-size:14px;fill:#ff7a2c;font-weight:600;letter-spacing:.08em}
    .floor{stroke:#3a2f24;stroke-width:1;fill:none}
  </style></defs>
  <line x1="40" y1="470" x2="760" y2="470" class="floor"/>
  <g id="sources">
    <g class="source-box" data-key="ProPresenter"><rect x="60" y="380" width="140" height="42" rx="6" class="brass"/><text x="130" y="406" text-anchor="middle" class="label">ProPresenter</text></g>
    <g class="source-box" data-key="EasyWorship"><rect x="60" y="320" width="140" height="42" rx="6" class="brass"/><text x="130" y="346" text-anchor="middle" class="label">EasyWorship</text></g>
    <g class="source-box" data-key="Proclaim"><rect x="60" y="260" width="140" height="42" rx="6" class="brass"/><text x="130" y="286" text-anchor="middle" class="label">Proclaim</text></g>
    <g class="source-box" data-key="CCLI"><rect x="60" y="200" width="140" height="42" rx="6" class="brass"/><text x="130" y="226" text-anchor="middle" class="label">CCLI</text></g>
  </g>
  <g id="op1" transform="translate(240 0)">
    <circle cx="80" cy="310" r="18" class="ink"/>
    <circle cx="74" cy="308" r="1.6" fill="#F4EFE6"/>
    <circle cx="86" cy="308" r="1.6" fill="#F4EFE6"/>
    <line x1="80" y1="328" x2="80" y2="410" class="ink"/>
    <line x1="80" y1="352" x2="120" y2="360" class="ink" id="op1-arm"/>
    <line x1="80" y1="352" x2="52" y2="380" class="ink"/>
    <line x1="80" y1="410" x2="60" y2="460" class="ink"/>
    <line x1="80" y1="410" x2="100" y2="460" class="ink"/>
    <g id="op1-box" transform="translate(120 340)">
      <rect x="0" y="0" width="70" height="26" rx="5" class="orange"/>
      <text x="35" y="17" text-anchor="middle" class="label" id="op1-boxlabel">ProPresenter</text>
    </g>
  </g>
  <g id="pfbox" transform="translate(540 300)">
    <rect x="0" y="0" width="170" height="120" rx="10" class="orange" id="pfrect"/>
    <text x="85" y="52" text-anchor="middle" class="label-pf">PRESENT</text>
    <text x="85" y="76" text-anchor="middle" class="label-pf">FLOW</text>
    <g id="pf-innards"></g>
  </g>
</svg>`;

const ART2 = `
<svg viewBox="0 0 800 560" preserveAspectRatio="xMidYMid meet" id="art2">
  <line x1="40" y1="470" x2="760" y2="470" style="stroke:#3a2f24;stroke-width:1;fill:none"/>
  <g id="slots">
    <rect x="440" y="140" width="300" height="56" rx="10" style="stroke:#C6912F;stroke-dasharray:6 4;stroke-width:1.5;fill:none" opacity=".55"/>
    <rect x="440" y="210" width="300" height="56" rx="10" style="stroke:#C6912F;stroke-dasharray:6 4;stroke-width:1.5;fill:none" opacity=".55"/>
    <rect x="440" y="280" width="300" height="56" rx="10" style="stroke:#C6912F;stroke-dasharray:6 4;stroke-width:1.5;fill:none" opacity=".55"/>
  </g>
  <g id="row0"><rect x="120" y="140" width="300" height="56" rx="10" style="stroke:#17130c;stroke-width:1.5;fill:#faf6ef"/><text x="140" y="174" style="font-family:'JetBrains Mono',monospace;font-size:13px;fill:#17130c;letter-spacing:.06em">01 · WELCOME &amp; OPENER</text></g>
  <g id="row1"><rect x="120" y="210" width="300" height="56" rx="10" style="stroke:#ff7a2c;stroke-width:1.5;fill:rgba(255,122,44,.14)"/><text x="140" y="244" style="font-family:'JetBrains Mono',monospace;font-size:13px;fill:#a24818;letter-spacing:.06em">02 · WORSHIP SET × 4</text></g>
  <g id="row2"><rect x="120" y="280" width="300" height="56" rx="10" style="stroke:#17130c;stroke-width:1.5;fill:#faf6ef"/><text x="140" y="314" style="font-family:'JetBrains Mono',monospace;font-size:13px;fill:#17130c;letter-spacing:.06em">03 · MESSAGE · ROMANS 8</text></g>
  <g id="op2" transform="translate(30 0)" style="stroke:#17130c">
    <circle cx="80" cy="310" r="18" fill="none" stroke-width="2"/>
    <circle cx="74" cy="308" r="1.6" fill="#17130c"/>
    <circle cx="86" cy="308" r="1.6" fill="#17130c"/>
    <line x1="80" y1="328" x2="80" y2="410" stroke-width="2"/>
    <line x1="80" y1="352" x2="120" y2="345" stroke-width="2" id="op2-arm"/>
    <line x1="80" y1="352" x2="52" y2="380" stroke-width="2"/>
    <line x1="80" y1="410" x2="60" y2="460" stroke-width="2"/>
    <line x1="80" y1="410" x2="100" y2="460" stroke-width="2"/>
  </g>
  <g id="drag-tag" transform="translate(120 335)">
    <rect x="0" y="0" width="52" height="22" rx="4" class="orange" style="stroke:#ff7a2c;stroke-width:2;fill:none"/>
    <text x="26" y="15" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;fill:#ff7a2c;font-size:11px;letter-spacing:.06em">DRAG</text>
  </g>
</svg>`;

const ART3 = `
<svg viewBox="0 0 800 560" preserveAspectRatio="xMidYMid meet" id="art3">
  <line x1="40" y1="470" x2="760" y2="470" style="stroke:#3a2f24;stroke-width:1;fill:none"/>
  <g id="uglySlide">
    <rect x="360" y="170" width="360" height="220" rx="10" style="stroke:#c8bfb2;fill:#e8e2d6" stroke-width="1.5"/>
    <path d="M 400 220 Q 500 210, 620 240" style="stroke:#a8a094;fill:none" stroke-width="2" opacity=".7"/>
    <path d="M 400 260 Q 520 250, 660 280" style="stroke:#a8a094;fill:none" stroke-width="2" opacity=".6"/>
    <path d="M 400 300 Q 500 290, 600 320" style="stroke:#a8a094;fill:none" stroke-width="2" opacity=".5"/>
    <text x="380" y="370" style="font-family:'JetBrains Mono',monospace;fill:#6a635a;font-size:14px">untitled slide</text>
  </g>
  <g id="niceSlide">
    <defs>
      <clipPath id="reveal3"><rect id="reveal3rect" x="360" y="170" width="0" height="220"/></clipPath>
      <linearGradient id="paper" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f2e6cf"/><stop offset="1" stop-color="#c88c5e"/></linearGradient>
    </defs>
    <g clip-path="url(#reveal3)">
      <rect x="360" y="170" width="360" height="220" rx="10" fill="url(#paper)"/>
      <text x="540" y="220" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;fill:#8F2C10;font-size:12px;letter-spacing:.14em">PSALM 23:3  ·  KJV</text>
      <text x="540" y="270" text-anchor="middle" style="font-family:'Fraunces',serif;font-size:22px;fill:#1a0f0a;font-style:italic;font-weight:400">He restoreth my soul:</text>
      <text x="540" y="302" text-anchor="middle" style="font-family:'Fraunces',serif;font-size:22px;fill:#1a0f0a;font-style:italic;font-weight:400"><tspan fill="#8F2C10">He leadeth me</tspan> in the paths</text>
      <text x="540" y="334" text-anchor="middle" style="font-family:'Fraunces',serif;font-size:22px;fill:#1a0f0a;font-style:italic;font-weight:400">of righteousness.</text>
    </g>
  </g>
  <line id="wand" x1="360" y1="160" x2="360" y2="400" stroke="#ff7a2c" stroke-width="3" stroke-linecap="round"/>
  <circle id="wandDot" cx="360" cy="150" r="6" fill="#ff7a2c"/>
  <g transform="translate(30 0)" style="stroke:#F4EFE6">
    <circle cx="120" cy="310" r="18" fill="none" stroke-width="2"/>
    <circle cx="114" cy="308" r="1.6" fill="#F4EFE6"/>
    <circle cx="126" cy="308" r="1.6" fill="#F4EFE6"/>
    <line x1="120" y1="328" x2="120" y2="410" stroke-width="2"/>
    <line x1="120" y1="352" x2="170" y2="330" stroke-width="2"/>
    <line x1="120" y1="352" x2="92" y2="380" stroke-width="2"/>
    <line x1="120" y1="410" x2="100" y2="460" stroke-width="2"/>
    <line x1="120" y1="410" x2="140" y2="460" stroke-width="2"/>
    <rect x="165" y="322" width="14" height="14" rx="2" style="fill:#ff7a2c;stroke:none"/>
  </g>
</svg>`;

const CSS = `
.pfb{position:relative}
.pfb .bs-scrub{position:relative;height:400vh;background:var(--bg)}
.pfb .bs-sticky{position:sticky;top:0;height:100vh;display:grid;grid-template-columns:44px 1fr;padding:8vh 6vw 8vh 3vw;gap:24px;overflow:hidden}
.pfb .bs-rail{position:relative;width:2px;margin-left:16px}
.pfb .bs-rail::before{content:"";position:absolute;left:0;top:0;bottom:0;width:1px;background:var(--ink);opacity:.28}
.pfb .bs-marker{position:absolute;left:-5px;width:12px;height:12px;border-radius:2px;background:var(--ink);top:calc(var(--p,0) * 100% - 6px);transition:top 140ms linear}
.pfb .bs-tick{position:absolute;left:2px;height:1px;background:var(--ink);width:20px;top:calc(var(--p,0) * 100%);transition:top 140ms linear}
.pfb .bs-deck{position:relative;height:100%;overflow:hidden;border-radius:24px}
.pfb .bs-card{position:absolute;inset:0;display:grid;grid-template-columns:1.15fr 1fr;gap:48px;padding:44px;background:var(--panel);border:1px solid var(--line);border-radius:24px;opacity:0;transform:translateY(28px) scale(.985);transition:opacity 650ms cubic-bezier(.2,0,.2,1),transform 650ms cubic-bezier(.2,0,.2,1),background 600ms,border-color 600ms;pointer-events:none;overflow:hidden}
.pfb .bs-card.on{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}
.pfb .bs-card.out{opacity:0;transform:translateY(-24px) scale(.985)}
.pfb .bs-art{position:relative;background:var(--panel-2);border:1px solid var(--line);border-radius:18px;overflow:hidden;min-height:0}
.pfb .bs-art svg{width:100%;height:100%;display:block}
.pfb .bs-art-video{background:#0b0b0b;padding:0}
.pfb .bs-video{width:100%;height:100%;object-fit:cover;display:block}
.pfb .bs-copy{display:flex;flex-direction:column;position:relative;padding:6px 4px 0;min-width:0}
.pfb .bs-top{display:flex;flex-direction:column;gap:14px;flex:1}
.pfb .bs-num{font-family:var(--pf-mono);font-size:11px;color:var(--muted);letter-spacing:.16em;text-transform:uppercase}
.pfb .bs-card h3{font-weight:700;font-size:clamp(24px,2.4vw,32px);line-height:1.15;margin:0;letter-spacing:-.02em;color:var(--ink)}
.pfb .bs-card p{margin:0;font-size:16px;line-height:1.55;color:var(--muted);max-width:44ch}
.pfb .bs-card ol{margin:6px 0 0;padding:0;list-style:none;counter-reset:it;display:flex;flex-direction:column;gap:10px}
.pfb .bs-card ol li{counter-increment:it;display:grid;grid-template-columns:26px 1fr;gap:6px;font-size:15px;line-height:1.5;color:var(--ink)}
.pfb .bs-card ol li::before{content:counter(it) ".";color:var(--ember);font-weight:600}
/* footer removed per request */
.pfb .bs-foot{display:none}
.pfb .bs-foot-x{border-top:1px solid var(--line);margin-top:22px;padding-top:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:var(--muted);flex-wrap:wrap}
.pfb .bs-tags{display:flex;gap:6px}
.pfb .bs-tag{font-family:var(--pf-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;padding:5px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted)}
.pfb .bs-hint{position:absolute;bottom:20px;right:26px;font-family:var(--pf-mono);font-size:10px;letter-spacing:.16em;color:var(--faint);text-transform:uppercase}
/* card-2 light flip — scoped to this section only */
.pfb.bs-light{--bg:#F5F1EA;--panel:#ffffff;--panel-2:#faf6ef;--ink:#17130c;--muted:#6a635a;--faint:#a8a094;--line:#e3ddd2}
.pfb{transition:background 600ms cubic-bezier(.2,0,.2,1)}
/* Mobile KEEPS the sticky scrub (one continuous pinned animation) — single-
   column card (art on top, copy below), no rail. */
@media (max-width:960px){
  .pfb .bs-sticky{grid-template-columns:1fr;padding:2vh 4vw;gap:10px}
  .pfb .bs-rail{display:none}
  .pfb .bs-card{grid-template-columns:1fr;grid-template-rows:auto 1fr;gap:16px;padding:16px}
  .pfb .bs-art{aspect-ratio:16/10;max-height:46vh;min-height:0}
  .pfb .bs-copy{overflow:hidden}
  .pfb .bs-card h3{font-size:22px}
  .pfb .bs-card p{font-size:14px}
  .pfb .bs-hint{display:none}
}
@media (prefers-reduced-motion: reduce){
  .pfb .bs-scrub{height:auto}
  .pfb .bs-sticky{position:relative;height:auto;grid-template-columns:1fr;padding:0;gap:16px}
  .pfb .bs-rail{display:none}
  .pfb .bs-deck{height:auto;display:flex;flex-direction:column;gap:16px;overflow:visible}
  .pfb .bs-card{position:relative;inset:auto;opacity:1;transform:none}
  .pfb.bs-light{--bg:#0B0B0B;--panel:#121214;--panel-2:#17171A;--ink:#F4F1EA;--muted:#A29D93;--faint:#6E6A62;--line:rgba(255,255,255,.08)}
}
`;

export default function BetaScroll() {
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scrub = root.querySelector<HTMLElement>(".bs-scrub");
    const cards = [...root.querySelectorAll<HTMLElement>(".bs-card")];
    const rail = root.querySelector<HTMLElement>(".bs-rail");
    const q = (sel: string) => root.querySelector<SVGElement>(sel);

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
    const smooth = (x: number) => {
      x = clamp01(x);
      return x * x * (3 - 2 * x);
    };
    const chapterP = (pp: number, i: number) => clamp01((pp - i / 3) / (1 / 3));

    const sourceLabels = ["ProPresenter", "EasyWorship", "Proclaim", "CCLI"];

    const updateCard1 = (cp: number) => {
      const op1 = q("#op1"), op1Arm = q("#op1-arm"), op1Box = q("#op1-box");
      const op1Label = q("#op1-boxlabel"), pfInnards = q("#pf-innards"), pfRect = q("#pfrect");
      if (!op1 || !op1Box || !op1Label || !pfInnards || !pfRect || !op1Arm) return;
      const startWalk = 0.05, windows = 4, winLen = 0.85 / windows;
      const opX = 240 + smooth(cp) * 40;
      op1.setAttribute("transform", `translate(${opX} 0)`);
      const active = Math.min(windows - 1, Math.max(0, Math.floor((cp - startWalk) / winLen)));
      const localP = clamp01((cp - startWalk - active * winLen) / winLen);
      root.querySelectorAll<HTMLElement>("#sources .source-box").forEach((el, i) => {
        const consumed = i < active, carrying = i === active;
        el.style.opacity = String(consumed ? 0 : carrying && localP > 0.15 ? 0.2 : 1);
      });
      if (cp < startWalk) {
        (op1Box as unknown as HTMLElement).style.opacity = "1";
        op1Box.setAttribute("transform", "translate(120 340)");
        op1Label.textContent = sourceLabels[0];
      } else {
        op1Label.textContent = sourceLabels[Math.min(active, sourceLabels.length - 1)];
        const startX = 120, startY = 340;
        const endLocalX = 625 - opX - 35, endLocalY = 360 - 13;
        const t = smooth(localP);
        const midY = Math.min(startY, endLocalY) - 90;
        const bx = lerp(startX, endLocalX, t);
        const by = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * midY + t * t * endLocalY;
        op1Box.setAttribute("transform", `translate(${bx} ${by})`);
        const settle = localP > 0.9 ? Math.sin((localP - 0.9) * 40) * 3 * (1 - (localP - 0.9) / 0.1) : 0;
        if (localP > 0.95) op1Box.setAttribute("transform", `translate(${endLocalX} ${endLocalY + settle})`);
        op1Arm.setAttribute("x2", "120");
        op1Arm.setAttribute("y2", localP < 0.2 ? "360" : "320");
      }
      const glow = clamp01(active / windows + localP / windows);
      pfRect.setAttribute("stroke-width", String(2 + glow * 2));
      pfRect.setAttribute("filter", `drop-shadow(0 0 ${8 + glow * 20}px rgba(255,122,44,${0.3 + glow * 0.5}))`);
      let inner = "";
      for (let i = 0; i < active; i++) {
        const y = 96 - i * 14;
        inner += `<text x="85" y="${y}" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:9px;fill:#ffb861;opacity:.6">${sourceLabels[i]}</text>`;
      }
      pfInnards.innerHTML = inner;
    };

    const updateCard2 = (cp: number) => {
      const rows = [q("#row0"), q("#row1"), q("#row2")];
      const dragTag = q("#drag-tag"), op2Arm = q("#op2-arm");
      if (rows.some((r) => !r) || !dragTag || !op2Arm) return;
      const wins = 3, start = 0.05, winLen = 0.9 / wins;
      const active = Math.min(wins - 1, Math.max(0, Math.floor((cp - start) / winLen)));
      const localP = clamp01((cp - start - active * winLen) / winLen);
      rows.forEach((r, i) => {
        if (!r) return;
        if (i < active) {
          r.setAttribute("transform", "translate(320 0)");
          (r as unknown as HTMLElement).style.opacity = "1";
        } else if (i === active) {
          const t = smooth(localP);
          const x = lerp(0, 320, t);
          const y = Math.sin(t * Math.PI) * -24;
          r.setAttribute("transform", `translate(${x} ${y})`);
          (r as unknown as HTMLElement).style.opacity = "1";
        } else {
          r.setAttribute("transform", `translate(0 ${i * 4})`);
          (r as unknown as HTMLElement).style.opacity = "0.5";
        }
      });
      (dragTag as unknown as HTMLElement).style.opacity = active >= 1 ? "0" : "1";
      op2Arm.setAttribute("x2", String(120 + smooth(localP) * 8));
    };

    const updateCard3 = (cp: number) => {
      const wand = q("#wand"), wandDot = q("#wandDot"), rr = q("#reveal3rect");
      if (!wand || !wandDot || !rr) return;
      const t = smooth(cp);
      const x = lerp(360, 720, t);
      wand.setAttribute("x1", String(x));
      wand.setAttribute("x2", String(x));
      wandDot.setAttribute("cx", String(x));
      rr.setAttribute("width", String(x - 360));
    };

    if (reduce) {
      updateCard1(1); updateCard2(1); updateCard3(1);
      cards.forEach((c) => c.classList.add("on"));
      return;
    }

    let p = 0, target = 0, raf = 0;
    const onScroll = () => {
      if (!scrub) return;
      const r = scrub.getBoundingClientRect();
      const total = scrub.offsetHeight - window.innerHeight;
      target = clamp01(-r.top / Math.max(1, total));
    };
    const tick = () => {
      p += (target - p) * 0.12;
      rail?.style.setProperty("--p", String(p));
      const idx = p < 1 / 3 ? 0 : p < 2 / 3 ? 1 : 2;
      cards.forEach((c, i) => {
        c.classList.toggle("on", i === idx);
        c.classList.toggle("out", i < idx);
      });
      root.classList.toggle("bs-light", idx === 1);
      updateCard1(chapterP(p, 0));
      updateCard2(chapterP(p, 1));
      updateCard3(chapterP(p, 2));
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    tick();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="pfb" ref={rootRef} id="beta" aria-label="What's in the beta">
      <style>{CSS}</style>
      <div className="bs-scrub">
        <div className="bs-sticky">
          <div className="bs-rail">
            <div className="bs-tick" />
            <div className="bs-marker" />
          </div>
          <div className="bs-deck">
            {/* CARD 1 — MIGRATE */}
            <article className="bs-card on">
              <div className="bs-art bs-art-video">
                <video
                  className="bs-video"
                  src="/marketing/bring-library.mp4"
                  poster="/marketing/bring-library-poster.jpg"
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="auto"
                  aria-hidden="true"
                />
              </div>
              <div className="bs-copy">
                <div className="bs-top">
                  <div className="bs-num">01 · Migrate</div>
                  <h3>Bring your library with you</h3>
                  <p>Migrate songs and scripture from wherever you&apos;re coming from. Connect CCLI and your verses come too. No starting from scratch.</p>
                  <ol>
                    <li>Import from ProPresenter, EasyWorship, Proclaim.</li>
                    <li>Connect CCLI — your verses come across too.</li>
                    <li>Unverified titles are flagged, never guessed.</li>
                  </ol>
                </div>
                <div className="bs-foot">
                  <span>One-time import · ~4 minutes</span>
                  <span className="bs-tags"><span className="bs-tag">Songs</span><span className="bs-tag">Verses</span></span>
                </div>
              </div>
              <div className="bs-hint">Scroll ↓</div>
            </article>

            {/* CARD 2 — PLAN */}
            <article className="bs-card">
              <div className="bs-art" dangerouslySetInnerHTML={{ __html: ART2 }} />
              <div className="bs-copy">
                <div className="bs-top">
                  <div className="bs-num">02 · Plan</div>
                  <h3>Plan your service in minutes</h3>
                  <p>A simple schedule builder. Lay out the whole order, drag it into shape, and hand it off to whoever&apos;s on tech. No clutter, no learning curve.</p>
                  <ol>
                    <li>Drag Welcome, Worship, Message into a running order.</li>
                    <li>Reorder or reassign without breaking cues.</li>
                    <li>Share the plan with the whole tech team.</li>
                  </ol>
                </div>
                <div className="bs-foot">
                  <span>Sunday order · ready by Saturday night</span>
                  <span className="bs-tags"><span className="bs-tag">Setlist</span><span className="bs-tag">Handoff</span></span>
                </div>
              </div>
              <div className="bs-hint">Scroll ↓</div>
            </article>

            {/* CARD 3 — THEME */}
            <article className="bs-card">
              <div className="bs-art" dangerouslySetInnerHTML={{ __html: ART3 }} />
              <div className="bs-copy">
                <div className="bs-top">
                  <div className="bs-num">03 · Theme</div>
                  <h3>Themes that actually look good</h3>
                  <p>Clean, modern visuals out of the box. Lyrics and scripture look sharp on screen, no design degree, no templates from 2012.</p>
                  <ol>
                    <li>Editorial serif verse cards, sized for the room.</li>
                    <li>Consistent lockups across lyrics and scripture.</li>
                    <li>Swap the whole look in a click for a new series.</li>
                  </ol>
                </div>
                <div className="bs-foot">
                  <span>Themes · ship-ready for Sunday</span>
                  <span className="bs-tags"><span className="bs-tag">Verse</span><span className="bs-tag">Lyrics</span></span>
                </div>
              </div>
              <div className="bs-hint">End ✓</div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
