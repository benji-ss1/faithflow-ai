"use client";

/**
 * "How it works" — pinned, scroll-scrubbed 3D auditorium section.
 * Sits directly below BetaScroll and mirrors its framing (art box + step copy +
 * progress rail) so the two sections read as one flow.
 *
 * DESKTOP: the real three.js scene (auditoriumScene.js, lifted verbatim from the
 * design export) renders live into the box and scrubs LISTEN → MATCH → SHOW with
 * page scroll. MOBILE / reduced-motion: a static poster (how-show.jpg) + the same
 * step copy — no WebGL, so phones stay fast and clean (mobile-first).
 */
import { useEffect, useRef, useState } from "react";

const STEPS = [
  { n: "01", label: "LISTEN", desc: "The desktop app hears the room through whatever mic your media team already runs. On-device transcription. Nothing leaves the machine." },
  { n: "02", label: "MATCH", desc: "Every scripture reference, song title, and voice command is detected with a confidence score. Below your threshold it waits; above it, it queues." },
  { n: "03", label: "SHOW", desc: "The verse pushes to projector, stage monitor, and livestream at the same instant. The operator can override with one key." },
];

const CSS = `
.aud{position:relative}
.aud .au-scrub{position:relative;height:340vh;background:var(--bg)}
.aud .au-sticky{position:sticky;top:0;height:100vh;display:grid;grid-template-columns:44px 1fr;padding:8vh 6vw 8vh 3vw;gap:24px;overflow:hidden}
.aud .au-rail{position:relative;width:2px;margin-left:16px}
.aud .au-rail::before{content:"";position:absolute;left:0;top:0;bottom:0;width:1px;background:var(--ink);opacity:.28}
.aud .au-marker{position:absolute;left:-5px;width:12px;height:12px;border-radius:2px;background:var(--ink);top:calc(var(--p,0) * 100% - 6px);transition:top 140ms linear}
.aud .au-tick{position:absolute;left:2px;height:1px;background:var(--ink);width:20px;top:calc(var(--p,0) * 100%);transition:top 140ms linear}
.aud .au-card{display:grid;grid-template-columns:1.25fr 1fr;gap:48px;height:100%;padding:36px;background:var(--panel);border:1px solid var(--line);border-radius:24px;overflow:hidden}
.aud .au-art{position:relative;background:#050405;border:1px solid var(--line);border-radius:18px;overflow:hidden;min-height:0}
.aud .au-art canvas,.aud .au-poster{width:100%;height:100%;display:block;object-fit:cover}
.aud .au-copy{display:flex;flex-direction:column;justify-content:center;gap:22px;min-width:0;padding:6px 4px}
.aud .au-eyebrow{font-family:var(--pf-mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ember)}
.aud .au-h2{font-family:'Fraunces',var(--pf-sans),serif;font-weight:300;font-size:clamp(28px,3vw,44px);line-height:1.06;margin:0;letter-spacing:-.02em;color:var(--ink)}
.aud .au-h2 em{font-style:italic;color:var(--gold)}
.aud .au-steps{display:flex;flex-direction:column;gap:2px;margin-top:4px}
.aud .au-step{display:grid;grid-template-columns:34px 1fr;gap:12px;align-items:baseline;padding:10px 0 10px 14px;margin-left:-16px;border-left:2px solid transparent;transition:border-color .5s,opacity .5s}
.aud .au-step.on{border-left-color:var(--ember)}
.aud .au-step.off{opacity:.34}
.aud .au-step .sn{font-family:var(--pf-mono);font-size:13px;letter-spacing:.14em;color:var(--brass)}
.aud .au-step.on .sn{color:var(--ember)}
.aud .au-step .sl{font-family:'Fraunces',serif;font-size:18px;color:var(--ink)}
.aud .au-step.on .sl{color:var(--ember)}
.aud .au-step .sd{grid-column:2;color:var(--muted);font-size:12.5px;line-height:1.55;margin-top:4px;max-height:0;overflow:hidden;opacity:0;transition:max-height .5s,opacity .4s}
.aud .au-step.on .sd{max-height:200px;opacity:1}
.aud .au-hud{position:absolute;top:22px;right:24px;font-family:var(--pf-mono);font-size:11px;letter-spacing:.14em;color:var(--ink);display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border:1px solid rgba(255,255,255,.14);border-radius:99px;background:rgba(0,0,0,.5)}
@media (max-width:960px){
  .aud .au-scrub{height:auto;background:transparent}
  .aud .au-sticky{position:relative;height:auto;grid-template-columns:1fr;padding:0;overflow:visible}
  .aud .au-rail{display:none}
  .aud .au-card{grid-template-columns:1fr;height:auto;gap:22px;padding:22px}
  .aud .au-art{aspect-ratio:16/11}
  .aud .au-copy{justify-content:flex-start}
  .aud .au-step .sd{max-height:200px;opacity:1}
  .aud .au-hud{display:none}
}
@media (prefers-reduced-motion:reduce){
  .aud .au-scrub{height:auto}
  .aud .au-sticky{position:relative;height:auto;grid-template-columns:1fr;padding:0}
  .aud .au-rail{display:none}
  .aud .au-card{grid-template-columns:1fr;height:auto}
  .aud .au-step .sd{max-height:200px;opacity:1}
}
`;

export default function AuditoriumScroll() {
  const rootRef = useRef<HTMLElement | null>(null);
  const scrubRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const [chapter, setChapter] = useState(1);
  const [use3d, setUse3d] = useState(false);

  useEffect(() => {
    const smallOrReduced =
      window.matchMedia("(max-width: 960px)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (smallOrReduced) return; // mobile / reduced-motion → static poster, no WebGL

    setUse3d(true);
    let disposed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let scene: any = null;
    let onScroll: (() => void) | null = null;

    (async () => {
      try {
        const THREE = await import("three");
        if (disposed) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).THREE = THREE;
        const mod = await import("./auditoriumScene.js");
        if (disposed || !canvasRef.current || !scrubRef.current) return;
        scene = new mod.AuditoriumScene(canvasRef.current, scrubRef.current, (p: number) => {
          railRef.current?.style.setProperty("--p", String(p));
          setChapter(p < 0.33 ? 1 : p < 0.66 ? 2 : 3);
        });
        scene.start();
        onScroll = () => scene && scene.onScrollHandler({ clientHeight: window.innerHeight });
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        onScroll();
      } catch {
        setUse3d(false); // any failure → fall back to the poster
      }
    })();

    return () => {
      disposed = true;
      if (onScroll) {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      }
      try { scene?.dispose(); } catch { /* ignore */ }
    };
  }, []);

  return (
    <section className="aud" ref={rootRef} aria-label="How it works">
      <style>{CSS}</style>
      <div className="au-scrub" ref={scrubRef}>
        <div className="au-sticky">
          <div className="au-rail" ref={railRef}>
            <div className="au-tick" />
            <div className="au-marker" />
          </div>
          <div className="au-card">
            <div className="au-art">
              {use3d ? (
                <canvas ref={canvasRef} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="au-poster" src="/marketing/how-show.jpg" alt="PresentFlow listening live during a church service" />
              )}
              <div className="au-hud">
                <span style={{ color: "var(--ember)" }}>●</span> 0{chapter} / 03 · {STEPS[chapter - 1].label}
              </div>
            </div>
            <div className="au-copy">
              <div className="au-eyebrow">§ 02 · Real time</div>
              <h2 className="au-h2">It hears the whole service — <em>live.</em></h2>
              <div className="au-steps">
                {STEPS.map((s, i) => (
                  <div key={s.n} className={`au-step ${chapter === i + 1 ? "on" : "off"}`}>
                    <span className="sn">{s.n}</span>
                    <span className="sl">{s.label}</span>
                    <span className="sd">{s.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
