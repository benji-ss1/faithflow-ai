"use client";

/**
 * "How it works" — a WHITE, pinned scroll-scrubbed section (replaces the dark 3D
 * auditorium). Mirrors the same sticky-scrub mechanic: a 300vh scrub track with a
 * sticky 100vh stage; scroll progress drives the active step 1 → 2 → 3. Each step
 * crossfades a real product screenshot (Listen → Match → Show) beside a card with
 * the heading + description. A right-hand rail + marker scrubs with progress so the
 * RailConnector above (line + travelling square) links into it.
 *
 * Reduced-motion: un-pins and shows all three steps stacked.
 */
import { useEffect, useRef, useState } from "react";

const STEPS = [
  {
    n: "01",
    label: "Listen",
    title: "It hears the room",
    desc: "The desktop app listens through whatever mic your team already runs — every word preached and sung — and transcribes it live, on-device.",
    img: "/marketing/how-listen.jpg",
    alt: "PresentFlow operator console listening live, transcribing the service and detecting John 1:1",
    portrait: true,
  },
  {
    n: "02",
    label: "Match",
    title: "It finds the verse",
    desc: "The moment a verse or lyric is spoken, AI matches it to the exact reference and scores its confidence — Matthew 5:5, 92% — before anyone reaches for the keyboard.",
    img: "/marketing/how-match.jpg",
    alt: "PresentFlow detecting Matthew 5:5 at 92% confidence and pushing it live",
    portrait: true,
  },
  {
    n: "03",
    label: "Show",
    title: "It goes on screen",
    desc: "The right slide pushes live to the projector the instant it's confirmed — formatted, beautiful, on time. One key lets the operator override.",
    img: "/marketing/how-output.jpg",
    alt: "The projected output slide: Matthew 5:5, Blessed are the meek",
    portrait: false,
  },
];

const CSS = `
.hiw{--paper:#F6F3EC;--paper-hi:#fdfbf6;--ink:#17130c;--muted:#6a635a;--faint:#a8a094;--ember:#c9552b;--line:#e4ddcf;
  position:relative;color:var(--ink)}
.hiw *{box-sizing:border-box}
.hiw .hiw-scrub{position:relative;height:300vh;background:var(--paper)}
.hiw .hiw-sticky{position:sticky;top:0;height:100vh;overflow:hidden;background:var(--paper);
  display:flex;flex-direction:column;padding:6vh 6vw 5vh}

.hiw .hiw-head{max-width:820px;flex:0 0 auto}
.hiw .hiw-eyebrow{font-family:var(--pf-mono);font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ember)}
.hiw .hiw-h2{font-family:var(--pf-serif),"Iowan Old Style",Georgia,serif;font-weight:300;
  font-size:clamp(30px,5vw,60px);line-height:1.02;letter-spacing:-.02em;margin:12px 0 0}
.hiw .hiw-h2 em{font-style:italic;color:var(--ember)}

.hiw .hiw-body{flex:1;min-height:0;display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(28px,4vw,64px);align-items:center;padding-top:3vh}
.hiw .hiw-stage{position:relative;height:100%;min-height:0;display:flex;align-items:center;justify-content:center}
.hiw .hiw-shot{position:absolute;max-width:100%;max-height:70vh;width:auto;height:auto;object-fit:contain;
  border-radius:16px;border:1px solid rgba(23,19,12,.14);box-shadow:0 24px 70px rgba(60,44,24,.22);
  opacity:0;transform:translateY(14px) scale(.985);transition:opacity .6s cubic-bezier(.2,0,.2,1),transform .6s cubic-bezier(.2,0,.2,1)}
.hiw .hiw-shot.portrait{max-height:74vh}
.hiw .hiw-shot.on{opacity:1;transform:none}

.hiw .hiw-cards{display:flex;flex-direction:column;gap:14px;max-width:520px}
.hiw .hiw-card{position:relative;padding:22px 24px;border-radius:14px;border:1px solid var(--line);
  background:var(--paper-hi);opacity:.5;transform:translateX(6px);
  transition:opacity .5s,transform .5s,border-color .5s,box-shadow .5s}
.hiw .hiw-card.on{opacity:1;transform:none;border-color:rgba(201,85,43,.55);box-shadow:0 14px 40px rgba(60,44,24,.12)}
.hiw .hiw-n{font-family:var(--pf-mono);font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
.hiw .hiw-card.on .hiw-n{color:var(--ember)}
.hiw .hiw-card h3{font-family:var(--pf-serif),Georgia,serif;font-weight:500;font-size:clamp(21px,2.2vw,27px);
  line-height:1.12;letter-spacing:-.01em;margin:8px 0 0}
.hiw .hiw-card p{margin:8px 0 0;font-size:15px;line-height:1.6;color:var(--muted);max-height:0;overflow:hidden;opacity:0;
  transition:max-height .5s,opacity .45s,margin .5s}
.hiw .hiw-card.on p{max-height:200px;opacity:1;margin-top:10px}

/* right rail — the RailConnector's travelling square lands here */
.hiw .hiw-rail{position:absolute;right:calc(6vw - 20px);top:6vh;bottom:5vh;width:2px;pointer-events:none}
.hiw .hiw-rail::before{content:"";position:absolute;left:0;top:0;bottom:0;width:1px;background:var(--ink);opacity:.2}
.hiw .hiw-marker{position:absolute;left:-5px;width:12px;height:12px;border-radius:2px;background:var(--ember);
  top:calc(var(--p,0) * 100% - 6px);transition:top 140ms linear;box-shadow:0 0 0 4px rgba(201,85,43,.14)}

@media (max-width:960px){
  .hiw .hiw-sticky{padding:5vh 7vw 4vh}
  .hiw .hiw-body{grid-template-columns:1fr;grid-template-rows:1fr auto;gap:14px;padding-top:2vh}
  .hiw .hiw-shot{max-height:42vh}
  .hiw .hiw-shot.portrait{max-height:44vh}
  .hiw .hiw-rail{display:none}
  /* on mobile only the active card shows, under the shot */
  .hiw .hiw-cards{max-width:none}
  .hiw .hiw-card{opacity:0;position:absolute;left:7vw;right:7vw;pointer-events:none}
  .hiw .hiw-card.on{opacity:1;position:relative;left:auto;right:auto;pointer-events:auto}
}

@media (prefers-reduced-motion:reduce){
  .hiw .hiw-scrub{height:auto}
  .hiw .hiw-sticky{position:relative;height:auto;overflow:visible;display:block}
  .hiw .hiw-rail{display:none}
  .hiw .hiw-body{display:flex;flex-direction:column;gap:40px;padding-top:32px}
  .hiw .hiw-stage{display:none}
  .hiw .hiw-card{opacity:1;transform:none;border-color:var(--line)}
  .hiw .hiw-card p{max-height:200px;opacity:1;margin-top:10px}
}
`;

export default function HowItWorks() {
  const scrubRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const [chapter, setChapter] = useState(1);

  useEffect(() => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = scrub.getBoundingClientRect();
        const total = scrub.offsetHeight - window.innerHeight;
        const p = Math.max(0, Math.min(1, -rect.top / (total || 1)));
        railRef.current?.style.setProperty("--p", String(p));
        setChapter(p < 0.34 ? 1 : p < 0.67 ? 2 : 3);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section className="hiw" aria-label="How it works">
      <style>{CSS}</style>
      <div className="hiw-scrub" ref={scrubRef}>
        <div className="hiw-sticky">
          <div className="hiw-head">
            <div className="hiw-eyebrow">How it works</div>
            <h2 className="hiw-h2">
              Listen. Match. <em>Show.</em>
            </h2>
          </div>

          <div className="hiw-body">
            <div className="hiw-stage">
              {STEPS.map((s, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={s.n}
                  className={`hiw-shot${s.portrait ? " portrait" : ""}${chapter === i + 1 ? " on" : ""}`}
                  src={s.img}
                  alt={s.alt}
                  loading="lazy"
                />
              ))}
            </div>

            <div className="hiw-cards">
              {STEPS.map((s, i) => (
                <div key={s.n} className={`hiw-card${chapter === i + 1 ? " on" : ""}`}>
                  <div className="hiw-n">{s.n} · {s.label}</div>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="hiw-rail" ref={railRef}>
            <div className="hiw-marker" />
          </div>
        </div>
      </div>
    </section>
  );
}
