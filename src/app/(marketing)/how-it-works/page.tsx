import type { Metadata } from "next";
import ImageSlot from "@/components/marketing/ImageSlot";
import BetaCta from "@/components/marketing/BetaCta";

const MONO = "var(--pf-mono)";

export const metadata: Metadata = {
  title: "How it works — PresentFlow",
  description: "From spoken word to on-screen in 1.6 seconds. PresentFlow follows the service as it actually happens.",
};

type Step = {
  num: string;
  title: string;
  paras: string[];
  slot: string;
  reversed: boolean;
};

const STEPS: Step[] = [
  {
    num: "01 · LISTEN",
    title: "It hears the whole service, live",
    paras: [
      "PresentFlow listens to the room in real time: the sermon and the worship set. A reference to Romans 8 dropped mid-sentence. A chorus the band starts early. A passage the pastor jumps to on the fly.",
      "Audio is processed on the machine in the booth. Nothing depends on the venue Wi-Fi holding up.",
    ],
    slot: "Live transcript view screenshot",
    reversed: false,
  },
  {
    num: "02 · MATCH",
    title: "It finds the right slide",
    paras: [
      "“…turn with me to Romans 8, verse 28” becomes the verse, in your preferred translation, formatted to your theme. A sung line becomes the exact lyric from your own song library.",
      "It matches against your setlist first, so a repeated bridge or a cut chorus never throws it off.",
    ],
    slot: "Verse match screenshot",
    reversed: true,
  },
  {
    num: "03 · SHOW",
    title: "On screen before anyone reaches for a clicker",
    paras: [
      "Average time from spoken word to audience screen: 1.6 seconds. The room sees the verse while the pastor is still finishing the sentence.",
      "Your operator stays in charge the whole time: every suggestion is one key to approve, hold, or dismiss. Full manual mode is always one tap away.",
    ],
    slot: "Operator approve/override screenshot",
    reversed: false,
  },
];

const TIMELINE = [
  {
    time: "9:40 AM",
    text: "Operator opens the plan the worship leader built during the week. One click: both outputs live.",
  },
  {
    time: "10:07 AM",
    text: "Band repeats the bridge a third time. Lyrics follow the room, not the plan. Nobody touches anything.",
  },
  {
    time: "10:42 AM",
    text: "Pastor jumps to an unplanned passage. The verse is on screen in 1.4s. The operator just taps approve.",
  },
  {
    time: "11:15 AM",
    text: "Service ends. Zero dead slides, zero scrambling. The operator watched the service instead of chasing it.",
  },
];

function StepBlock({ step }: { step: Step }) {
  const text = (
    <div>
      <div style={{ font: `600 12px ${MONO}`, letterSpacing: "0.16em", color: "var(--ember)" }}>
        {step.num}
      </div>
      <h2
        style={{
          margin: "16px 0 12px",
          fontWeight: 800,
          fontSize: "clamp(26px,3.4vw,38px)",
          letterSpacing: "-.02em",
          lineHeight: 1.1,
        }}
      >
        {step.title}
      </h2>
      {step.paras.map((p, i) => (
        <p
          key={i}
          style={{
            margin: i === step.paras.length - 1 ? 0 : "0 0 14px",
            fontSize: 16,
            lineHeight: 1.65,
            color: "var(--muted)",
          }}
        >
          {p}
        </p>
      ))}
    </div>
  );
  const media = (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16/10",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,.08)",
      }}
    >
      <ImageSlot placeholder={step.slot} />
    </div>
  );
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
        gap: 40,
        alignItems: "center",
        background: "var(--panel)",
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 18,
        padding: "44px 40px",
      }}
    >
      {step.reversed ? (
        <>
          {media}
          {text}
        </>
      ) : (
        <>
          {text}
          {media}
        </>
      )}
    </div>
  );
}

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
            background: "radial-gradient(ellipse at center,rgba(247,148,29,.12),transparent 70%)",
            filter: "blur(40px)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "relative",
            animation: "pfFadeUp .8s cubic-bezier(.22,1,.36,1) both",
          }}
        >
          <div
            style={{
              font: `500 12px ${MONO}`,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--ember)",
            }}
          >
            How it works
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
            From spoken word to on-screen in{" "}
            <span
              style={{
                background: "linear-gradient(100deg,#F7941D,#FDB748)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                color: "var(--ember)",
              }}
            >
              1.6 seconds.
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
            No pre-programming every possible verse. No hoping the pastor sticks to the plan.
            PresentFlow follows the service as it actually happens.
          </p>
        </div>
      </section>

      <section
        style={{
          maxWidth: 1160,
          margin: "0 auto",
          padding: "20px 24px 40px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {STEPS.map((s) => (
          <StepBlock key={s.num} step={s} />
        ))}
      </section>

      <section style={{ maxWidth: 1160, margin: "0 auto", padding: "80px 24px 60px" }}>
        <div
          style={{
            font: `500 12px ${MONO}`,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ember)",
          }}
        >
          A Sunday with PresentFlow
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))",
            gap: 18,
            marginTop: 34,
          }}
        >
          {TIMELINE.map((t) => (
            <div key={t.time} style={{ borderTop: "2px solid rgba(247,148,29,.5)", paddingTop: 18 }}>
              <div style={{ font: `600 12px ${MONO}`, letterSpacing: "0.12em", color: "var(--gold)" }}>
                {t.time}
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 15, lineHeight: 1.6, color: "var(--muted)" }}>
                {t.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      <BetaCta
        heading="See it on your own screens."
        sub="Wave one is 15 churches. Free throughout the beta, macOS today."
      />
    </main>
  );
}
