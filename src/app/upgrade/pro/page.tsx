import { Check, Music4, Sparkles, Radio, MonitorPlay, Palette } from "lucide-react";
import { Reveal } from "../Reveal";
import { UpgradeCta } from "../UpgradeCta";
import { FeatureCards } from "@/components/operator/pro/FeatureCards";

export const metadata = {
  title: "PresentFlow Pro — Everything you need, every Sunday",
  description: "The AI-native presentation platform for churches that run every service.",
};

const FEATURES = [
  {
    icon: Radio,
    headline: "AI that follows the room",
    body: "Verse detection listens to what the pastor actually says, not what the plan says. Lyrics jump to the right line even when the worship leader improvises. No operator scrambling for the click track.",
  },
  {
    icon: Sparkles,
    headline: "One-click service build",
    body: "Planning Center import pulls the entire Sunday order — songs, keys, scripture references, sermon points — into a runnable service in seconds. Reorder, add media, hit go.",
  },
  {
    icon: MonitorPlay,
    headline: "Stage display that actually helps",
    body: "Second-screen monitor shows the vocalist what's coming next, the drummer the click, and the preacher their notes. Everyone on the same rhythm without a huddle before the service.",
  },
  {
    icon: Music4,
    headline: "Your library, your way",
    body: "Unlimited songs. CCLI number tracking. Public-domain hymn library built-in. Import from ProPresenter, EasyWorship, OpenLP, or paste raw text — PresentFlow handles the format.",
  },
  {
    icon: Palette,
    headline: "Themes that look designed",
    body: "Real 2-panel theme editor with live 16:9 preview. Typography, backgrounds, lower-thirds, transitions — save a look, apply to any song with one click. No PowerPoint reset every Christmas.",
  },
];

const PRO_FEATURES = [
  "Everything in Starter",
  "Unlimited songs + themes",
  "Multi-output + stage display",
  "Phone remote (iOS + Android)",
  "Planning Center import",
  "Priority support",
];

export default function ProUpgradePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden px-4 pt-16 sm:px-6 sm:pt-24">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -left-24 top-0 h-[520px] w-[520px] rounded-full"
            style={{ background: "rgba(232,168,56,0.32)", filter: "blur(140px)", animation: "pfDrift1 24s ease-in-out infinite" }}
          />
          <div
            className="absolute -right-16 top-40 h-[420px] w-[420px] rounded-full"
            style={{ background: "rgba(244,192,88,0.22)", filter: "blur(140px)", animation: "pfDrift2 28s ease-in-out infinite" }}
          />
        </div>
        <div className="relative mx-auto max-w-4xl text-center">
          <Reveal>
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: "#E8A838" }}>
              PresentFlow Pro
            </div>
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl" style={{ color: "#FFFFFF" }}>
              Everything you need,
              <br />
              <span style={{ color: "#E8A838" }}>every Sunday.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-7" style={{ color: "#8B8B92" }}>
              The AI-native presentation platform for churches that don&rsquo;t just run one service — they run every service. No missed cues. No blank projector. No hunting for the right slide mid-worship.
            </p>
          </Reveal>
          <Reveal delay={200}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <UpgradeCta tier="pro" label="Start free trial" />
              <a
                href="#features"
                className="inline-flex h-11 items-center justify-center rounded-md px-5 text-sm font-semibold transition-colors"
                style={{ background: "transparent", border: "1px solid #2A2A2E", color: "#F1EFE8" }}
              >
                See what&rsquo;s inside
              </a>
            </div>
            <div className="mt-4 text-[11px]" style={{ color: "#5A5A62" }}>
              Placeholder pricing during pilot · Stripe test mode · No card charged
            </div>
          </Reveal>
        </div>

        {/* Hero mockup — cinematic MacBook + stage display side-by-side */}
        <Reveal delay={350} className="mx-auto mt-16 max-w-5xl px-2">
          <div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
            {/* Primary MacBook mockup — lyrics on screen */}
            <div
              className="relative aspect-video overflow-hidden rounded-2xl"
              style={{ background: "#0F0B14", border: "1px solid #2A2A2E", boxShadow: "0 40px 100px rgba(0,0,0,0.55), 0 0 60px rgba(232,168,56,0.14)" }}
            >
              <div className="absolute inset-x-0 top-0 flex h-7 items-center gap-1.5 px-3" style={{ background: "#050505" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#FF5F57" }} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#FEBC2E" }} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#28C840" }} />
              </div>
              <div className="absolute inset-x-0 bottom-0 top-7 flex items-center justify-center p-8">
                <div className="text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: "#E8A838" }}>Live output · 16:9</div>
                  <div className="mt-5 text-3xl font-semibold leading-tight sm:text-4xl md:text-5xl" style={{ color: "#F1EFE8" }}>
                    Amazing grace,
                    <br />
                    how sweet the sound
                  </div>
                  <div className="mt-6 text-[10px] font-medium uppercase tracking-[0.2em]" style={{ color: "rgba(232,168,56,0.7)" }}>
                    Grace Community Church
                  </div>
                </div>
              </div>
            </div>
            {/* Secondary stage-display mockup */}
            <div
              className="relative aspect-video overflow-hidden rounded-2xl"
              style={{ background: "#0F0B14", border: "1px solid #2A2A2E", boxShadow: "0 40px 100px rgba(0,0,0,0.5)" }}
            >
              <div className="absolute inset-0 flex flex-col p-4">
                <div className="text-[9px] font-semibold uppercase tracking-[0.2em]" style={{ color: "#8B8B92" }}>Stage display</div>
                <div className="mt-2 flex-1 rounded-md p-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #2A2A2E" }}>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#E8A838" }}>Now</div>
                  <div className="mt-1 text-sm font-medium" style={{ color: "#F1EFE8" }}>Amazing grace, how sweet the sound</div>
                  <div className="mt-3 text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#5A5A62" }}>Next</div>
                  <div className="mt-1 text-xs" style={{ color: "#8B8B92" }}>That saved a wretch like me</div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[9px]" style={{ color: "#5A5A62" }}>
                  <span>♩ = 76</span>
                  <span className="text-[#34D399]">● Live</span>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* At-a-glance highlight cards */}
      <Reveal delay={200} className="mx-auto mt-20 max-w-4xl px-4 sm:px-6">
        <FeatureCards
          columns={3}
          items={[
            { icon: Sparkles, title: "AI that follows", desc: "Speak a verse or start a song and it appears on the projector — no clicking, no lag." },
            { icon: Palette, title: "Your look, everywhere", desc: "Design a theme once; songs, scripture and the stage display all match it automatically." },
            { icon: Radio, title: "One click to live", desc: "Projector, stage screen and livestream stay in sync the moment you go live." },
          ]}
        />
      </Reveal>

      {/* Feature showcase */}
      <section id="features" className="px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <div className="space-y-24">
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              const flipped = i % 2 === 1;
              return (
                <Reveal key={f.headline}>
                  <div className={`grid gap-8 md:grid-cols-2 md:items-center ${flipped ? "md:[&>div:first-child]:order-2" : ""}`}>
                    <div>
                      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: "rgba(232,168,56,0.14)" }}>
                        <Icon className="h-5 w-5" style={{ color: "#E8A838" }} />
                      </div>
                      <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl" style={{ color: "#FFFFFF" }}>
                        {f.headline}
                      </h2>
                      <p className="mt-4 text-base leading-7" style={{ color: "#8B8B92" }}>
                        {f.body}
                      </p>
                    </div>
                    <FeatureIllustration index={i} />
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="px-4 pb-24 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <Reveal>
            <div
              className="relative overflow-hidden rounded-2xl px-6 py-12 text-center sm:px-12 sm:py-16"
              style={{ background: "linear-gradient(135deg, #141418 0%, #0F0B0F 100%)", border: "1px solid rgba(232,168,56,0.28)", boxShadow: "0 0 60px rgba(232,168,56,0.16)" }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: "#E8A838" }}>PresentFlow Pro</div>
              <div className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl" style={{ color: "#FFFFFF" }}>
                $29<span className="text-2xl" style={{ color: "#8B8B92" }}>/mo</span>
              </div>
              <div className="mt-1 text-xs" style={{ color: "#5A5A62" }}>Placeholder pricing during pilot · Stripe test mode</div>

              <ul className="mx-auto mt-8 grid max-w-lg gap-2 text-left sm:grid-cols-2">
                {PRO_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm" style={{ color: "#F1EFE8" }}>
                    <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#E8A838" }} />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-10">
                <UpgradeCta tier="pro" label="Start free trial" />
              </div>
              <div className="mt-3 text-[11px]" style={{ color: "#5A5A62" }}>
                No card required · Cancel anytime
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}

// Small styled placeholders per feature — deliberately abstract mockups
// (not real screenshots) so this page doesn't rot when the app UI shifts.
function FeatureIllustration({ index }: { index: number }) {
  const glowColors = ["232,168,56", "244,192,88", "232,168,56", "244,192,88", "232,168,56"];
  const glow = glowColors[index % glowColors.length];
  return (
    <div
      className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl"
      style={{ background: "#0F0B14", border: "1px solid #2A2A2E", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(circle at 30% 30%, rgba(${glow},0.24), transparent 55%)` }}
      />
      <div className="absolute inset-0 flex flex-col justify-between p-5">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: "#8B8B92" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#E8A838" }} />
          PresentFlow · Live
        </div>
        <div className="space-y-2">
          <div className="h-2 w-4/5 rounded-full" style={{ background: "rgba(255,255,255,0.14)" }} />
          <div className="h-2 w-3/5 rounded-full" style={{ background: "rgba(255,255,255,0.10)" }} />
          <div className="h-2 w-2/3 rounded-full" style={{ background: "rgba(232,168,56,0.35)" }} />
        </div>
      </div>
    </div>
  );
}
