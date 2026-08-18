"use client";

/**
 * "Our Story" (renamed from Why we're building) — the founder story, told in the
 * light parchment / editorial voice (Fraunces + Cormorant serif, oxblood accent,
 * handwritten caption) with a pencil line-drawing that draws itself in beside each
 * beat as it scrolls into view. Copy follows a pain → founders → villain → belief
 * → mission arc (Hormozi / Jeremy Haynes) aimed at church tech, media volunteers,
 * and preachers.
 */
import { useEffect, useRef, useState } from "react";

// Pencil line-art motifs (viewBox 0 0 120 100), drawn on reveal.
const ART = {
  booth:
    "M20 34 L84 34 L84 70 L20 70 Z M44 70 L44 80 M32 80 L56 80 M100 60 a7 7 0 1 0 .1 0 M86 96 a15 15 0 0 1 30 0",
  two:
    "M34 42 a10 10 0 1 0 .1 0 M18 84 a17 17 0 0 1 34 0 M86 42 a10 10 0 1 0 .1 0 M70 84 a17 17 0 0 1 34 0 M52 62 L70 62 M60 56 L60 68",
  broken:
    "M18 20 L102 20 L102 62 L18 62 Z M46 32 L66 46 L56 50 L74 62 M18 72 L102 72 M26 80 L36 80 M46 80 L56 80 M66 80 L76 80 M86 80 L96 80",
  listen:
    "M10 50 L10 44 M18 50 L18 34 M26 50 L26 40 M34 50 L34 28 M42 50 L42 38 M50 50 L50 30 M58 50 L78 50 M72 44 L80 50 L72 56 M84 30 L112 30 L112 70 L84 70 Z M90 50 L106 50",
  lift:
    "M28 96 L92 96 M42 96 L42 58 Q42 48 50 48 Q58 48 58 60 M58 96 L58 50 Q58 40 66 40 Q74 40 74 52 L74 96 M46 44 L44 34 M70 36 L72 26 M60 30 L60 20",
  church:
    "M60 8 L60 24 M20 52 L60 24 L100 52 M24 52 L24 86 M96 52 L96 86 M16 86 L104 86 M52 86 L52 64 L68 64 L68 86",
};

type Beat = {
  art: string;
  eyebrow: string;
  body: string[];
};

const OPENING = {
  kicker: "Our Story",
  head: ["The house of God was", { run: "waiting on a keyboard." }],
  caption: "And nobody thought that was strange — until we did.",
};

const BEATS: Beat[] = [
  {
    art: ART.booth,
    eyebrow: "The moment",
    body: [
      "You know the feeling. The preacher turns to a verse nobody printed. The worship leader holds the bridge one more time. And every head in the room turns to the back — to the one person on the laptop, typing as fast as they can, praying the reference lands before the moment passes.",
    ],
  },
  {
    art: ART.two,
    eyebrow: "Two of us",
    body: [
      "PresentFlow started with two people who'd stood on opposite sides of that screen. One of us builds software for a living. The other spent six years running technical operations in church — heading the media desk, driving projection Sunday after Sunday, living the gap between what's said on stage and what lands on the wall.",
      "We met over one shared conviction: this had been too hard, for too long, for no good reason.",
    ],
  },
  {
    art: ART.broken,
    eyebrow: "Why it's broken",
    body: [
      "For a decade, church presentation software has asked a human to keep up with the Holy Spirit by hand. Type the verse. Find the next slide. Advance the lyric. Do it under pressure, in front of everyone, with no room to be wrong.",
      "And when you are wrong, it isn't a typo — it's a mangled line of Scripture on the wall of the house of God. The service waits. The volunteer wears the blame. The moment slips by.",
    ],
  },
  {
    art: ART.listen,
    eyebrow: "The turn",
    body: [
      "So we asked a simple question. We trust AI to run our feeds, write our emails, cut our videos, drive whole businesses. Why is the one place it's missing the one place that matters most?",
      "If AI can keep up with the world, it can keep up with the room. It can hear the verse the second it's spoken and put it on screen — accurate, formatted, beautiful — before anyone reaches for the keyboard.",
    ],
  },
  {
    art: ART.lift,
    eyebrow: "Not to replace — to free",
    body: [
      "This was never about replacing the person at the back. It's about lifting the weight off them. No more scrambling. No more dead slides. No more holding the whole service hostage to how fast one pair of hands can type.",
      "Just the word and the worship, moving at the speed of the people God sent to preach and sing them.",
    ],
  },
];

const CLOSING = {
  eyebrow: "Why we build",
  body: [
    "We're giving the house of God the software it deserves — automated, AI-native, and held to the highest standard we can reach. Not because the old tools were fine and we wanted more. Because they weren't, and the room deserved better.",
  ],
  line: ["Let the church", { run: "go first." }],
};

const CSS = `
.pfstory{--cream:#F5F1EA;--cream-hi:#faf7f0;--ink:#1a140d;--muted:#6a635a;--faint:#8c8478;
  --oxblood:#8F2C10;--line:#e3ddd2;
  position:relative;background:var(--cream);color:var(--ink);overflow:hidden;font-family:var(--pf-sans)}

.pfstory .rv{opacity:0;transform:translateY(26px);
  transition:opacity .8s cubic-bezier(.22,1,.36,1),transform .8s cubic-bezier(.22,1,.36,1)}
.pfstory .rv.in{opacity:1;transform:none}
.pfstory .rv.d1.in{transition-delay:.1s}.pfstory .rv.d2.in{transition-delay:.22s}

.pfstory .art path{fill:none;stroke:var(--oxblood);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;
  stroke-dasharray:var(--len,900);stroke-dashoffset:var(--len,900);transition:stroke-dashoffset 1.6s ease .15s}
.pfstory .art.in path{stroke-dashoffset:0}

/* OPENING */
.pfstory .hero{max-width:1080px;margin:0 auto;padding:clamp(116px,16vw,200px) clamp(30px,6vw,96px) clamp(30px,5vw,56px);position:relative}
.pfstory .kicker{font-family:var(--pf-mono);font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--oxblood)}
.pfstory .hero h1{margin:24px 0 0;max-width:18ch;
  font-family:var(--pf-serif),"Iowan Old Style",Georgia,serif;font-weight:300;
  font-size:clamp(38px,7vw,86px);line-height:1.02;letter-spacing:-.02em;text-wrap:balance}
.pfstory .hero h1 .run{font-style:italic;color:var(--oxblood)}
.pfstory .cap{font-family:var(--pf-hand),"Segoe Script",cursive;font-size:clamp(21px,2.6vw,32px);
  color:#4a4036;margin:30px 0 0;max-width:30ch;line-height:1.3}

/* BEATS — alternating art / prose rows */
.pfstory .beats{max-width:1000px;margin:0 auto;padding:clamp(24px,4vw,44px) clamp(30px,6vw,96px) clamp(20px,4vw,48px);
  display:flex;flex-direction:column;gap:clamp(48px,8vw,104px)}
.pfstory .beat{display:grid;grid-template-columns:180px 1fr;gap:clamp(28px,5vw,68px);align-items:start}
.pfstory .beat.flip{grid-template-columns:1fr 180px}
.pfstory .beat.flip .col-art{order:2}
.pfstory .art-wrap{position:relative}
.pfstory .art-wrap .art{width:100%;height:auto;display:block}
.pfstory .art-wrap .idx{font-family:var(--pf-mono);font-size:11px;letter-spacing:.2em;color:var(--faint);margin-top:10px}
.pfstory .eyebrow{font-family:var(--pf-mono);font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--oxblood);margin:2px 0 0}
.pfstory .beat p{margin:14px 0 0;font-size:clamp(17px,1.55vw,20px);line-height:1.66;color:#3f382f;max-width:56ch;text-wrap:pretty}
.pfstory .beat p:first-of-type{font-family:var(--pf-cormorant),Georgia,serif;font-size:clamp(21px,2.1vw,27px);line-height:1.42;color:var(--ink);font-weight:500}

/* CLOSING */
.pfstory .close{max-width:1000px;margin:0 auto;padding:clamp(28px,5vw,60px) clamp(30px,6vw,96px) clamp(72px,11vw,132px);position:relative}
.pfstory .close .rail{position:absolute;left:clamp(30px,6vw,96px);top:0;bottom:clamp(72px,11vw,132px);width:1px;background:var(--ink);opacity:.16}
.pfstory .close .inner{padding-left:clamp(22px,3vw,40px)}
.pfstory .close p{margin:16px 0 0;font-family:var(--pf-cormorant),Georgia,serif;font-size:clamp(20px,1.9vw,25px);line-height:1.5;color:#3f382f;max-width:58ch}
.pfstory .close h2{margin:26px 0 0;font-family:var(--pf-serif),Georgia,serif;font-weight:300;
  font-size:clamp(34px,5.4vw,64px);line-height:1.02;letter-spacing:-.02em}
.pfstory .close h2 .run{font-style:italic;color:var(--oxblood)}
.pfstory .close .church{width:clamp(84px,11vw,132px);height:auto;margin:8px 0 0}

@media (max-width:760px){
  .pfstory .beat,.pfstory .beat.flip{grid-template-columns:1fr;gap:14px}
  .pfstory .beat.flip .col-art{order:0}
  .pfstory .art-wrap{max-width:110px}
  .pfstory .hero h1{max-width:none}
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

function Art({ d, on }: { d: string; on: boolean }) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const [len, setLen] = useState(900);
  useEffect(() => { if (pathRef.current) setLen(Math.ceil(pathRef.current.getTotalLength())); }, [d]);
  return (
    <svg className={`art${on ? " in" : ""}`} viewBox="0 0 120 100" aria-hidden="true"
      style={{ ["--len" as string]: String(len) }}>
      <path ref={pathRef} d={d} />
    </svg>
  );
}

function BeatRow({ beat, i }: { beat: Beat; i: number }) {
  const { ref, on } = useReveal<HTMLDivElement>(0.3);
  const flip = i % 2 === 1;
  return (
    <div ref={ref} className={`beat${flip ? " flip" : ""}`}>
      <div className={`col-art rv${on ? " in" : ""}`}>
        <div className="art-wrap">
          <Art d={beat.art} on={on} />
          <div className="idx">{String(i + 1).padStart(2, "0")}</div>
        </div>
      </div>
      <div className={`rv d1${on ? " in" : ""}`}>
        <div className="eyebrow">{beat.eyebrow}</div>
        {beat.body.map((para, k) => (
          <p key={k}>{para}</p>
        ))}
      </div>
    </div>
  );
}

export default function OurStory() {
  const hero = useReveal<HTMLElement>(0.2);
  const close = useReveal<HTMLElement>(0.3);
  const churchPath = useRef<SVGPathElement | null>(null);
  const [churchLen, setChurchLen] = useState(600);
  useEffect(() => { if (churchPath.current) setChurchLen(Math.ceil(churchPath.current.getTotalLength())); }, []);

  return (
    <main className="pfstory">
      <style>{CSS}</style>

      <section ref={hero.ref} className="hero">
        <div className={`kicker rv${hero.on ? " in" : ""}`}>{OPENING.kicker}</div>
        <h1 className={`rv d1${hero.on ? " in" : ""}`}>
          {OPENING.head.map((part, i) =>
            typeof part === "string" ? (
              <span key={i}>{part} </span>
            ) : (
              <span key={i} className="run">{part.run}</span>
            ),
          )}
        </h1>
        <p className={`cap rv d2${hero.on ? " in" : ""}`}>{OPENING.caption}</p>
      </section>

      <section className="beats">
        {BEATS.map((b, i) => (
          <BeatRow key={i} beat={b} i={i} />
        ))}
      </section>

      <section ref={close.ref} className="close">
        <span className="rail" aria-hidden="true" />
        <div className="inner">
          <div className={`eyebrow rv${close.on ? " in" : ""}`}>{CLOSING.eyebrow}</div>
          {CLOSING.body.map((para, k) => (
            <p key={k} className={`rv d1${close.on ? " in" : ""}`}>{para}</p>
          ))}
          <h2 className={`rv d1${close.on ? " in" : ""}`}>
            {CLOSING.line.map((part, i) =>
              typeof part === "string" ? (
                <span key={i}>{part} </span>
              ) : (
                <span key={i} className="run">{part.run}</span>
              ),
            )}
          </h2>
          <svg
            className={`art church${close.on ? " in" : ""}`}
            viewBox="0 0 120 100"
            aria-hidden="true"
            style={{ ["--len" as string]: String(churchLen) }}
          >
            <path ref={churchPath} d={ART.church} />
          </svg>
        </div>
      </section>
    </main>
  );
}
