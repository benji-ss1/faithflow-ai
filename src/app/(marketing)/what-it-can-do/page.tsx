import type { Metadata } from "next";
import ImageSlot from "@/components/marketing/ImageSlot";
import BetaCta from "@/components/marketing/BetaCta";

const MONO = "var(--pf-mono)";

export const metadata: Metadata = {
  title: "What it can do — PresentFlow",
  description: "Built for the Sunday scramble. Every capability exists because a real operator got burned by it on a real Sunday.",
};

const FEATURES = [
  {
    title: "Scripture, caught mid-sentence",
    body: (
      <>
        “…turn with me to Romans 8, verse 28”, resolved and on the audience screen in 1.4
        seconds, in your translation, in your theme. Chapter-only references, ranges, and
        “the verse we read earlier” all work.
      </>
    ),
    last: false,
  },
  {
    title: "Lyrics that follow the band",
    body: (
      <>
        Repeat the bridge four times, cut the last chorus, go back to verse one. The lyrics
        track what the room is actually singing, not what the plan said.
      </>
    ),
    last: false,
  },
  {
    title: "An operator who's never behind",
    body: (
      <>
        Every suggestion is one key to approve or dismiss. Nothing goes live without a human
        unless you want it to. Full manual mode is always one tap away.
      </>
    ),
    last: false,
  },
  {
    title: "Your library, migrated",
    body: (
      <>
        Songs and slides come across from ProPresenter, EasyWorship, Proclaim, or wherever you
        are today. Connect CCLI and your licensing follows.{" "}
        <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
          We handle the import during the beta.
        </strong>
      </>
    ),
    last: true,
  },
];

export default function Page() {
  return (
    <main style={{ overflow: "hidden" }}>
      <section
        style={{
          position: "relative",
          padding: "170px 24px 80px",
          maxWidth: 1160,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -260,
            left: "50%",
            transform: "translateX(-50%)",
            width: 900,
            height: 480,
            background:
              "radial-gradient(ellipse at center,rgba(150,70,232,.12),rgba(247,148,29,.08) 55%,transparent 72%)",
            filter: "blur(40px)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", animation: "pfFadeUp .8s cubic-bezier(.22,1,.36,1) both" }}>
          <div
            style={{
              font: `500 12px ${MONO}`,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--ember)",
            }}
          >
            What it can do
          </div>
          <h1
            style={{
              margin: "22px 0 0",
              fontWeight: 800,
              fontSize: "clamp(40px,6vw,72px)",
              letterSpacing: "-.03em",
              lineHeight: 1.05,
              maxWidth: 820,
            }}
          >
            Built for the{" "}
            <span
              style={{
                background: "linear-gradient(100deg,#F7941D,#FDB748)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                color: "var(--ember)",
              }}
            >
              Sunday scramble.
            </span>
          </h1>
          <p
            style={{
              margin: "26px 0 0",
              maxWidth: 560,
              fontSize: 18,
              lineHeight: 1.65,
              color: "var(--muted)",
              textWrap: "pretty",
            }}
          >
            Every capability below exists because a real operator got burned by it on a real
            Sunday.
          </p>
        </div>
      </section>

      <section style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px 40px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
            gap: 64,
            alignItems: "center",
          }}
        >
          <div>
            {FEATURES.map((f) => (
              <div
                key={f.title}
                style={{
                  padding: "24px 0",
                  borderTop: "1px solid rgba(255,255,255,.08)",
                  borderBottom: f.last ? "1px solid rgba(255,255,255,.08)" : undefined,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 19 }}>{f.title}</div>
                <p style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.65, color: "var(--muted)" }}>
                  {f.body}
                </p>
              </div>
            ))}
          </div>
          <div style={{ position: "relative", minHeight: 520 }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(ellipse at 60% 45%,rgba(150,70,232,.16),rgba(217,65,140,.08) 50%,transparent 72%)",
                filter: "blur(30px)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: "6%",
                left: "4%",
                width: "66%",
                aspectRatio: "16/10",
                transform: "rotate(-6deg)",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,.1)",
                boxShadow: "0 24px 70px rgba(0,0,0,.55)",
                overflow: "hidden",
              }}
            >
              <ImageSlot placeholder="Verse-detection shot" />
            </div>
            <div
              style={{
                position: "absolute",
                top: "34%",
                right: 0,
                width: "62%",
                aspectRatio: "16/10",
                transform: "rotate(4deg)",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,.1)",
                boxShadow: "0 24px 70px rgba(0,0,0,.55)",
                overflow: "hidden",
              }}
            >
              <ImageSlot placeholder="Lyric-follow shot" />
            </div>
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: "12%",
                width: "58%",
                aspectRatio: "16/10",
                transform: "rotate(-2deg)",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,.1)",
                boxShadow: "0 24px 70px rgba(0,0,0,.55)",
                overflow: "hidden",
              }}
            >
              <ImageSlot placeholder="Operator view shot" />
            </div>
          </div>
        </div>
      </section>

      <section style={{ maxWidth: 1160, margin: "0 auto", padding: "70px 24px 60px" }}>
        <div
          style={{
            background: "#0D0D0F",
            border: "1px solid rgba(255,255,255,.08)",
            borderRadius: 18,
            padding: "44px 40px",
          }}
        >
          <div style={{ font: `500 12px ${MONO}`, letterSpacing: "0.16em", color: "var(--ember)" }}>
            A REAL MOMENT, END TO END
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
              gap: 32,
              marginTop: 28,
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ font: `500 11px ${MONO}`, letterSpacing: "0.14em", color: "var(--faint)" }}>
                THE ROOM
              </div>
              <p style={{ margin: "12px 0 0", fontSize: 17, lineHeight: 1.7, color: "var(--muted)" }}>
                “…and I want you to turn with me to{" "}
                <span style={{ color: "var(--gold)", fontWeight: 600 }}>Romans 8, verse 28</span>,
                because Paul is saying something the whole room needs today…”
              </p>
            </div>
            <div>
              <div style={{ font: `500 11px ${MONO}`, letterSpacing: "0.14em", color: "var(--faint)" }}>
                THE SCREEN · ROMANS 8:28 · KJV
              </div>
              <p style={{ margin: "12px 0 10px", fontSize: 17, lineHeight: 1.7 }}>
                “And we know that all things work together for good to them that love God…”
              </p>
              <div style={{ font: `500 11px ${MONO}`, letterSpacing: "0.1em", color: "#3DD68C" }}>
                ✓ RESOLVED IN 1.4S · ON SCREEN
              </div>
            </div>
          </div>
        </div>
      </section>

      <BetaCta
        heading="Put it to work on a real Sunday."
        sub="Wave one is 15 churches. Free throughout the beta, macOS today."
      />
    </main>
  );
}
