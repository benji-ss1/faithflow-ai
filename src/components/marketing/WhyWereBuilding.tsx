"use client";

/**
 * "Why we're building" — the full page rebuilt in the light parchment / editorial
 * vibe (cream paper, Fraunces serif, oxblood accent, handwritten caption, pencil
 * line-drawings) to match CtaSection / SiteFooter. Replaces the old dark Manifesto
 * + dark card grid. Word-by-word reveal on the manifesto line; each block draws a
 * small line-art motif in as it scrolls into view.
 */
import { useEffect, useRef, useState } from "react";

const MANIFESTO =
  "We're building automated emotion. The song swells, the verse lands, the room moves — and the screen finally moves with it.";

// Small line-art motifs (viewBox 0 0 120 100), pencil-drawn on reveal.
const ART = {
  // a little congregation of pews / people at the back
  people:
    "M22 78 L22 60 M22 60 A8 8 0 0 1 38 60 L38 78 M50 78 L50 56 M50 56 A9 9 0 0 1 68 56 L68 78 M80 78 L80 62 M80 62 A7 7 0 0 1 94 62 L94 78 M12 88 L108 88",
  // a dead/broken screen — a monitor with a crack
  screen:
    "M20 22 L100 22 L100 74 L20 74 Z M60 74 L60 86 M44 86 L76 86 M40 34 L64 52 L52 56 L74 70",
  // a wave / the room moving — a swell line the screen should follow
  wave: "M12 60 C 28 40, 44 40, 60 60 S 92 80, 108 60 M12 74 C 28 54, 44 54, 60 74 S 92 94, 108 74",
  // the church (same wordmark motif used in CtaSection/footer)
  church:
    "M60 8 L60 24 M20 52 L60 24 L100 52 M24 52 L24 86 M96 52 L96 86 M16 86 L104 86 M52 86 L52 64 L68 64 L68 86",
};

const CARDS = [
  {
    ch: "01",
    kicker: "Who it's for",
    title: "The team at the back of the room",
    body: "The volunteer handed the laptop twenty minutes before service. The tech director covering three roles. The one person everyone turns to look at when the slide is wrong. This is for them.",
    art: ART.people,
  },
  {
    ch: "02",
    kicker: "The problem",
    title: "The tools stopped keeping up",
    body: "Church presentation software has been coasting for a decade — bloated, overpriced, built for a service that never deviates from the plan. Real services deviate every single week, and the technical team pays for it.",
    art: ART.screen,
  },
  {
    ch: "03",
    kicker: "The belief",
    title: "The screen should follow the room",
    body: "Not the other way around. When the pastor jumps to an unplanned passage or the band holds the bridge, that's the service working. The software should flow with it, automatically.",
    art: ART.wave,
  },
];

const CSS = `
.pfwhy{--cream:#F5F1EA;--cream-hi:#faf7f0;--ink:#1a140d;--muted:#6a635a;--faint:#8c8478;
  --oxblood:#8F2C10;--line:#e3ddd2;
  position:relative;background:var(--cream);color:var(--ink);overflow:hidden;
  font-family:var(--pf-sans)}

/* shared reveal */
.pfwhy .rv{opacity:0;transform:translateY(26px);
  transition:opacity .8s cubic-bezier(.22,1,.36,1),transform .8s cubic-bezier(.22,1,.36,1)}
.pfwhy .rv.in{opacity:1;transform:none}
.pfwhy .rv.d1.in{transition-delay:.1s}.pfwhy .rv.d2.in{transition-delay:.22s}

/* pencil-drawn art */
.pfwhy .art path{fill:none;stroke:var(--oxblood);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;
  stroke-dasharray:var(--len,700);stroke-dashoffset:var(--len,700);transition:stroke-dashoffset 1.5s ease .15s}
.pfwhy .art.in path{stroke-dashoffset:0}

/* HERO / manifesto */
.pfwhy .hero{max-width:1120px;margin:0 auto;padding:clamp(120px,17vw,208px) clamp(30px,6vw,96px) clamp(40px,7vw,80px);position:relative}
.pfwhy .kicker{font-family:var(--pf-mono);font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--oxblood)}
.pfwhy .manifesto{margin:26px 0 0;max-width:20ch;
  font-family:var(--pf-serif),"Iowan Old Style",Georgia,serif;font-weight:300;
  font-size:clamp(34px,6.4vw,78px);line-height:1.08;letter-spacing:-.02em;text-wrap:balance}
.pfwhy .manifesto .w{display:inline-block;margin-right:.24em;
  color:rgba(26,20,13,.12);transition:color .55s ease}
.pfwhy .manifesto .w.on{color:var(--ink)}
.pfwhy .manifesto .w.accent.on{color:var(--oxblood);font-style:italic}
.pfwhy .hero .church{position:absolute;top:clamp(64px,10vw,140px);right:clamp(30px,6vw,96px);
  width:clamp(88px,12vw,150px);height:auto}
.pfwhy .cap{font-family:var(--pf-hand),"Segoe Script",cursive;font-size:clamp(20px,2.5vw,30px);
  color:#4a4036;margin:34px 0 0;max-width:30ch;line-height:1.3}

/* CARDS */
.pfwhy .cards{max-width:1120px;margin:0 auto;padding:clamp(24px,4vw,44px) clamp(30px,6vw,96px) clamp(48px,8vw,96px);
  display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:clamp(20px,3vw,34px)}
.pfwhy .card{position:relative;background:var(--cream-hi);border:1px solid var(--line);border-radius:4px;
  padding:clamp(28px,3.4vw,40px);box-shadow:0 1px 0 rgba(26,20,13,.03)}
.pfwhy .card .top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.pfwhy .card .ch{font-family:var(--pf-mono);font-size:12px;letter-spacing:.18em;color:var(--faint)}
.pfwhy .card .art{width:74px;height:62px;flex:none;margin-top:-4px}
.pfwhy .card .ck{font-family:var(--pf-mono);font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--oxblood);margin:22px 0 0}
.pfwhy .card h3{font-family:var(--pf-serif),Georgia,serif;font-weight:400;font-size:clamp(23px,2.6vw,30px);
  line-height:1.12;letter-spacing:-.01em;margin:12px 0 0;max-width:16ch}
.pfwhy .card p{margin:16px 0 0;font-size:15.5px;line-height:1.66;color:var(--muted);text-wrap:pretty}

/* WHERE THIS GOES */
.pfwhy .goes{max-width:820px;margin:0 auto;padding:clamp(28px,5vw,56px) clamp(30px,6vw,96px) clamp(96px,14vw,168px);position:relative}
.pfwhy .goes .rail{position:absolute;left:clamp(30px,6vw,96px);top:clamp(40px,6vw,68px);bottom:clamp(96px,14vw,168px);width:1px;background:var(--ink);opacity:.16}
.pfwhy .goes .inner{padding-left:clamp(22px,3vw,40px)}
.pfwhy .goes h2{font-family:var(--pf-serif),Georgia,serif;font-weight:300;font-size:clamp(30px,4.6vw,52px);
  line-height:1.06;letter-spacing:-.02em;margin:0;max-width:16ch}
.pfwhy .goes h2 .run{font-style:italic;color:var(--oxblood)}
.pfwhy .goes p{margin:24px 0 0;font-size:clamp(17px,1.5vw,19px);line-height:1.72;color:#3f382f;max-width:60ch;text-wrap:pretty}
.pfwhy .goes p .em{color:var(--oxblood);font-style:italic}

@media (max-width:720px){
  .pfwhy .hero .church{position:relative;top:auto;right:auto;display:block;margin:0 0 20px;width:80px}
  .pfwhy .manifesto{max-width:none}
  .pfwhy .card .art{width:60px;height:50px}
}
`;

function useReveal<T extends HTMLElement>(threshold = 0.25) {
  const ref = useRef<T | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) { setOn(true); return; }
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }),
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, on };
}

/** A pencil-drawn motif that measures its own path length and draws on reveal. */
function Art({ d, on }: { d: string; on: boolean }) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const [len, setLen] = useState(700);
  useEffect(() => { if (pathRef.current) setLen(Math.ceil(pathRef.current.getTotalLength())); }, [d]);
  return (
    <svg className={`art${on ? " in" : ""}`} viewBox="0 0 120 100" aria-hidden="true"
      style={{ ["--len" as string]: String(len) }}>
      <path ref={pathRef} d={d} />
    </svg>
  );
}

function Card({ c, i }: { c: (typeof CARDS)[number]; i: number }) {
  const { ref, on } = useReveal<HTMLDivElement>(0.3);
  return (
    <div ref={ref} className={`card rv${i === 1 ? " d1" : i === 2 ? " d2" : ""}${on ? " in" : ""}`}>
      <div className="top">
        <span className="ch">{c.ch}</span>
        <Art d={c.art} on={on} />
      </div>
      <div className="ck">{c.kicker}</div>
      <h3>{c.title}</h3>
      <p>{c.body}</p>
    </div>
  );
}

export default function WhyWereBuilding() {
  const hero = useReveal<HTMLElement>(0.2);
  const churchPath = useRef<SVGPathElement | null>(null);
  const [churchLen, setChurchLen] = useState(600);
  useEffect(() => { if (churchPath.current) setChurchLen(Math.ceil(churchPath.current.getTotalLength())); }, []);

  const goes = useReveal<HTMLElement>(0.3);

  const words = MANIFESTO.split(" ");
  const accentFrom = words.length - 3; // last three words swell in oxblood italic

  return (
    <main className="pfwhy">
      <style>{CSS}</style>

      {/* HERO / manifesto */}
      <section ref={hero.ref} className="hero">
        <svg
          className={`art church${hero.on ? " in" : ""}`}
          viewBox="0 0 120 100"
          aria-hidden="true"
          style={{ ["--len" as string]: String(churchLen) }}
        >
          <path ref={churchPath} d={ART.church} />
        </svg>
        <div className="kicker">Why we&apos;re building this</div>
        <p className="manifesto">
          {words.map((w, i) => (
            <span
              key={i}
              className={`w${i >= accentFrom ? " accent" : ""}${hero.on ? " on" : ""}`}
              style={{ transitionDelay: hero.on ? `${i * 42}ms` : "0ms" }}
            >
              {w}
            </span>
          ))}
        </p>
        <p className={`cap rv d1${hero.on ? " in" : ""}`}>No scramble at the back. No dead slide. Just flow.</p>
      </section>

      {/* THREE CARDS */}
      <section className="cards">
        {CARDS.map((c, i) => (
          <Card key={c.ch} c={c} i={i} />
        ))}
      </section>

      {/* WHERE THIS GOES */}
      <section ref={goes.ref} className="goes">
        <span className="rail" aria-hidden="true" />
        <div className="inner">
          <h2 className={`rv${goes.on ? " in" : ""}`}>
            Where this <span className="run">goes.</span>
          </h2>
          <p className={`rv d1${goes.on ? " in" : ""}`}>
            We call it <span className="em">automated emotion</span> — the song swells, the verse lands,
            the room moves, and the screen moves with it, every time, without anyone at the back holding
            their breath. The beta is where we get there: fifteen churches, real Sundays, honest feedback,
            and a product shaped by the people who actually run the desk.
          </p>
          <p className={`rv d2${goes.on ? " in" : ""}`}>
            We&apos;re not opening the doors to everyone. We&apos;re starting small, on purpose, with
            churches who want to help define what this software should be in 2026 and beyond.
          </p>
        </div>
      </section>
    </main>
  );
}
