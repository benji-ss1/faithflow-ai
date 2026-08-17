import type { Metadata } from "next";
import Manifesto from "@/components/marketing/Manifesto";
import BetaCta from "@/components/marketing/BetaCta";

const MONO = "var(--pf-mono)";

export const metadata: Metadata = {
  title: "Why we're building — PresentFlow",
  description: "The screen should follow the room. We're building automated emotion, starting small with fifteen churches on real Sundays.",
};

const CARDS = [
  {
    kicker: "WHO IT'S FOR",
    title: "The team at the back of the room",
    body: "The volunteer who got handed the laptop twenty minutes before service. The tech director covering three roles. The one person everyone turns around to look at when the slide is wrong. This is for them.",
  },
  {
    kicker: "THE PROBLEM",
    title: "The tools stopped keeping up",
    body: "Church presentation software has been coasting for a decade. Bloated, overpriced, and built for a service that never deviates from the plan. Real services deviate every single week, and technical teams pay for it.",
  },
  {
    kicker: "THE BELIEF",
    title: "The screen should follow the room",
    body: "Not the other way around. When the pastor jumps to an unplanned passage or the band holds the bridge, that's the service working. The software should flow with it, automatically.",
  },
];

export default function Page() {
  return (
    <main style={{ overflow: "hidden" }}>
      <Manifesto />

      <section style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px 60px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
            gap: 18,
          }}
        >
          {CARDS.map((c) => (
            <div
              key={c.kicker}
              style={{
                background: "var(--panel)",
                border: "1px solid rgba(255,255,255,.08)",
                borderRadius: 16,
                padding: "34px 30px",
              }}
            >
              <div style={{ font: `600 12px ${MONO}`, letterSpacing: "0.16em", color: "var(--ember)" }}>
                {c.kicker}
              </div>
              <h3
                style={{
                  margin: "16px 0 10px",
                  fontWeight: 700,
                  fontSize: 21,
                  letterSpacing: "-.01em",
                }}
              >
                {c.title}
              </h3>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "var(--muted)" }}>
                {c.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 760, margin: "0 auto", padding: "60px 24px 80px" }}>
        <div
          style={{
            font: `500 12px ${MONO}`,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ember)",
          }}
        >
          Where this goes
        </div>
        <p
          style={{
            margin: "22px 0 0",
            fontSize: 18,
            lineHeight: 1.75,
            color: "var(--muted)",
            textWrap: "pretty",
          }}
        >
          We call it <span style={{ color: "var(--ink)", fontWeight: 600 }}>automated emotion</span>:
          the song swells, the verse lands, the room moves, and the screen moves with it, every time,
          without anyone at the back holding their breath. The beta is where we get there: fifteen
          churches, real Sundays, honest feedback, and a product shaped by the people who actually run
          the desk.
        </p>
        <p
          style={{
            margin: "18px 0 0",
            fontSize: 18,
            lineHeight: 1.75,
            color: "var(--muted)",
            textWrap: "pretty",
          }}
        >
          We&apos;re not opening the doors to everyone. We&apos;re starting small, on purpose, with
          churches who want to help define what this software should be in 2026 and beyond.
        </p>
      </section>

      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "20px 0 0" }} />
      <BetaCta heading="Help us build it." sub="Wave one is 15 churches. Free throughout the beta." />
    </main>
  );
}
