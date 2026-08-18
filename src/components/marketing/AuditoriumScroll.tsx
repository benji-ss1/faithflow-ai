"use client";

/**
 * "How it works" — FULL-BLEED pinned, scroll-scrubbed 3D auditorium.
 * The 3D scene fills the whole viewport (like the original export) with the
 * eyebrow + headline overlaid top-left, LISTEN/MATCH/SHOW steps bottom-left,
 * a HUD top-right, and a progress rail on the far left.
 *
 * DESKTOP: the real three.js scene (auditoriumScene.js, verbatim from the export)
 * renders live and scrubs LISTEN → MATCH → SHOW with page scroll. MOBILE /
 * reduced-motion: a static full-bleed poster + the same overlaid copy — no WebGL,
 * mobile-first.
 */
import { useEffect, useRef, useState } from "react";

const STEPS = [
  { n: "01", label: "LISTEN", desc: "The desktop app hears the room through whatever mic your media team already runs. On-device transcription. Nothing leaves the machine." },
  { n: "02", label: "MATCH", desc: "Every scripture reference, song title, and voice command is detected with a confidence score. Below your threshold it waits; above it, it queues." },
  { n: "03", label: "SHOW", desc: "The verse pushes to projector, stage monitor, and livestream at the same instant. The operator can override with one key." },
];

const CSS = `
.aud{position:relative}
.aud .au-scrub{position:relative;height:360vh;background:var(--bg)}
.aud .au-sticky{position:sticky;top:0;height:100vh;width:100%;overflow:hidden;background:#050405}
.aud .au-stage{position:absolute;inset:0}
.aud .au-stage canvas,.aud .au-poster{width:100%;height:100%;display:block;object-fit:cover}
.aud .au-scrim{position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(5,4,5,.74) 0%,rgba(5,4,5,.38) 32%,rgba(5,4,5,0) 60%),linear-gradient(180deg,rgba(5,4,5,.55) 0%,rgba(5,4,5,0) 26%,rgba(5,4,5,0) 62%,rgba(5,4,5,.6) 100%)}
.aud .au-overlay{position:absolute;inset:0;pointer-events:none;padding:8vh 6vw;display:flex;flex-direction:column;justify-content:space-between}
.aud .au-top{max-width:640px}
.aud .au-eyebrow{font-family:var(--pf-mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--ember)}
.aud .au-h2{font-family:'Fraunces',var(--pf-sans),serif;font-weight:300;font-size:clamp(38px,6vw,84px);line-height:1;margin:14px 0 0;letter-spacing:-.02em;color:var(--ink)}
.aud .au-h2 em{font-style:italic;color:var(--gold)}
.aud .au-steps{max-width:620px;display:flex;flex-direction:column;gap:2px}
.aud .au-step{display:grid;grid-template-columns:44px 1fr;gap:14px;align-items:baseline;padding:12px 0 12px 16px;margin-left:-18px;border-left:2px solid transparent;transition:border-color .5s,opacity .5s}
.aud .au-step.on{border-left-color:var(--ember)}
.aud .au-step.off{opacity:.42}
.aud .au-step .sn{font-family:var(--pf-mono);font-size:15px;letter-spacing:.14em;color:var(--brass)}
.aud .au-step.on .sn{color:var(--ember)}
.aud .au-step .sl{font-family:'Fraunces',serif;font-size:clamp(20px,2.4vw,30px);color:var(--ink)}
.aud .au-step.on .sl{color:var(--ember)}
.aud .au-step .sd{grid-column:2;color:var(--muted);font-size:14px;line-height:1.55;margin-top:6px;max-width:52ch;max-height:0;overflow:hidden;opacity:0;transition:max-height .5s,opacity .4s}
.aud .au-step.on .sd{max-height:220px;opacity:1}
.aud .au-rail{position:absolute;right:calc(6vw - 20px);top:8vh;bottom:8vh;width:2px;pointer-events:none}
.aud .au-rail::before{content:"";position:absolute;left:0;top:0;bottom:0;width:1px;background:var(--ink);opacity:.28}
.aud .au-marker{position:absolute;left:-5px;width:12px;height:12px;border-radius:2px;background:var(--ink);top:calc(var(--p,0) * 100% - 6px);transition:top 140ms linear}
/* Mobile KEEPS the full-bleed pinned 3D — just shrink the overlaid copy so it
   reads over the scene; rail hidden. */
@media (max-width:960px){
  .aud .au-overlay{padding:13vh 6vw 6vh}
  .aud .au-h2{font-size:clamp(30px,9vw,54px)}
  .aud .au-step{grid-template-columns:32px 1fr;padding:8px 0 8px 12px;margin-left:-14px}
  .aud .au-step .sn{font-size:13px}
  .aud .au-step .sl{font-size:19px}
  .aud .au-steps{display:none}
  .aud .au-rail{display:none}
}
@media (prefers-reduced-motion:reduce){
  .aud .au-scrub{height:auto}
  .aud .au-sticky{position:relative;height:auto;overflow:visible}
  .aud .au-rail{display:none}
  .aud .au-step .sd{max-height:220px;opacity:1}
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
    // Run the live 3D on mobile too (the big auditorium should be full-screen
    // everywhere). Only reduced-motion falls back to the static poster.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

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
          <div className="au-stage">
            {use3d ? (
              <canvas ref={canvasRef} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="au-poster" src="/marketing/how-show.jpg" alt="PresentFlow listening live during a church service" />
            )}
          </div>
          <div className="au-scrim" />
          <div className="au-rail" ref={railRef}>
            <div className="au-marker" />
          </div>
          <div className="au-overlay">
            <div className="au-top">
              <h2 className="au-h2">It hears the whole service — <em>live.</em></h2>
            </div>
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
    </section>
  );
}
