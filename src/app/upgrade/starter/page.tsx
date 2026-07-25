import { Check } from "lucide-react";
import { Reveal } from "../Reveal";
import { UpgradeCta } from "../UpgradeCta";

export const metadata = {
  title: "PresentFlow Starter — Full AI stack for a single-service church",
};

const FEATURES = [
  "AI auto-advance on lyrics + scripture",
  "1 campus · 1 output",
  "SongSelect integration",
  "50 songs in library",
  "5 themes",
  "Email support",
];

export default function StarterUpgradePage() {
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: "#E8A838" }}>
            PresentFlow Starter
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl" style={{ color: "#FFFFFF" }}>
            Full AI stack for a single-service church.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7" style={{ color: "#8B8B92" }}>
            The essential PresentFlow experience — one campus, one output, everything you need to run Sunday cleanly. No feature clutter, no upsell noise.
          </p>
        </Reveal>

        <Reveal delay={200} className="mt-12">
          <div
            className="rounded-2xl p-8 text-left"
            style={{ background: "#111115", border: "1px solid #2A2A2E" }}
          >
            <div className="mb-2 flex items-baseline gap-1 justify-center">
              <span className="text-5xl font-semibold" style={{ color: "#FFFFFF" }}>$14</span>
              <span className="text-sm" style={{ color: "#8B8B92" }}>/mo</span>
            </div>
            <div className="mb-8 text-center text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#5A5A62" }}>
              Placeholder pricing · Stripe test mode
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
              <UpgradeCta tier="starter" label="Start free trial" />
              <div className="mt-3 text-[11px]" style={{ color: "#5A5A62" }}>
                No card required · Cancel anytime
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={300} className="mt-10">
          <p className="text-sm" style={{ color: "#8B8B92" }}>
            Growing? Compare with{" "}
            <a href="/upgrade/pro" className="font-semibold hover:underline" style={{ color: "#E8A838" }}>Pro</a>
            {" "}for unlimited songs, multi-output, and Planning Center import.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
