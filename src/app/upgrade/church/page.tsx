import { Check, Mail } from "lucide-react";
import { Reveal } from "../Reveal";

export const metadata = {
  title: "PresentFlow Church — Multi-campus, full archive, white-glove",
};

const FEATURES = [
  "Everything in Pro",
  "Multi-campus sync (up to 10)",
  "Sermon archive + AI-generated notes",
  "Historical analytics + attendance",
  "Dedicated onboarding session",
  "API access",
];

export default function ChurchUpgradePage() {
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: "#E8A838" }}>
            PresentFlow Church
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl" style={{ color: "#FFFFFF" }}>
            Multi-campus, full archive, white-glove.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7" style={{ color: "#8B8B92" }}>
            Built for multi-site churches that need sermon archives, historical analytics, API access, and a real onboarding partner — not a support ticket queue.
          </p>
        </Reveal>

        <Reveal delay={200} className="mt-12">
          <div
            className="rounded-2xl p-8 text-left"
            style={{ background: "#111115", border: "1px solid #2A2A2E" }}
          >
            <div className="mb-2 flex items-baseline gap-1 justify-center">
              <span className="text-5xl font-semibold" style={{ color: "#FFFFFF" }}>$49</span>
              <span className="text-sm" style={{ color: "#8B8B92" }}>/mo</span>
            </div>
            <div className="mb-8 text-center text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#5A5A62" }}>
              Placeholder pricing · Custom quotes for 10+ campuses
            </div>
            <ul className="space-y-3">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm" style={{ color: "#F1EFE8" }}>
                  <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#E8A838" }} />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-8 text-center">
              <a
                href="mailto:sales@presentflow.app?subject=PresentFlow Church interest"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md px-6 text-sm font-semibold transition-colors"
                style={{ background: "#E8A838", color: "#08080C" }}
              >
                <Mail className="h-4 w-4" />
                Contact us
              </a>
              <div className="mt-3 text-[11px]" style={{ color: "#5A5A62" }}>
                We&rsquo;ll book a 30-min discovery call within 24 hours.
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={300} className="mt-10">
          <p className="text-sm" style={{ color: "#8B8B92" }}>
            Single campus? Start with{" "}
            <a href="/upgrade/pro" className="font-semibold hover:underline" style={{ color: "#E8A838" }}>Pro</a>
            {" "}— you can upgrade to Church any time without losing your library or themes.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
