"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { createCheckoutSession, openBillingPortal } from "@/lib/billing-actions";

// Section 6 (visual-overhaul brief): the billing page is one of the
// "marketing surfaces" that intentionally goes dark + amber, distinct from
// the light admin dashboard palette. The whole panel below sits inside a
// dark island (bg #08080C, amber accent #E8A838) so pricing feels
// premium/aspirational, not utility. The rest of the admin stays light.
//
// No framer-motion dep: the aurora shapes drift via existing @keyframes
// (pfDrift1/2/3 in globals.css) — CSS-only, zero JS cost.

type Cycle = "monthly" | "yearly";

const TIER_LABELS: Record<string, string> = {
  pilot: "Pilot / Early access",
  starter: "Starter",
  pro: "Pro",
  enterprise: "Church",
};
const STATUS_LABELS: Record<string, string> = {
  pilot: "No card on file · free during pilot",
  trialing: "Trial in progress",
  active: "Active",
  past_due: "Past due — update payment",
  canceled: "Canceled",
};

type PlanTier = {
  key: "starter" | "pro" | "enterprise";
  label: string;
  tagline: string;
  monthly: number;      // placeholder until pilot prices land
  yearly: number;       // per-month equivalent when paid annually
  features: string[];
  featured?: boolean;
  cta: string;
};

const TIERS: PlanTier[] = [
  {
    key: "starter",
    label: "Starter",
    tagline: "Full AI stack for a single-service church.",
    monthly: 14,
    yearly: 11,
    features: [
      "AI auto-advance on lyrics + scripture",
      "1 campus, 1 output",
      "SongSelect integration",
      "50 songs in library",
      "5 themes",
      "Email support",
    ],
    cta: "Start free trial",
  },
  {
    key: "pro",
    label: "Pro",
    tagline: "Everything you need, every Sunday.",
    monthly: 29,
    yearly: 23,
    featured: true,
    features: [
      "Everything in Starter",
      "Unlimited songs + themes",
      "Multi-output + stage display",
      "Phone remote",
      "Planning Center import",
      "Priority support",
    ],
    cta: "Start free trial",
  },
  {
    key: "enterprise",
    label: "Church",
    tagline: "Multi-campus, full archive, white-glove.",
    monthly: 49,
    yearly: 39,
    features: [
      "Everything in Pro",
      "Multi-campus sync",
      "Sermon archive + AI notes",
      "Historical analytics",
      "Dedicated onboarding",
      "API access",
    ],
    cta: "Contact us",
  },
];

export function BillingPanel({ tier, status, currentPeriodEnd, trialEnd, hasStripeCustomer }: {
  tier: string;
  status: string;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  hasStripeCustomer: boolean;
}) {
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [pending, startTransition] = useTransition();

  function upgrade(t: "starter" | "pro" | "enterprise") {
    startTransition(async () => {
      // NOTE: createCheckoutSession currently ignores `cycle` — pilot has no
      // monthly-vs-yearly Stripe price IDs yet. The toggle is a UX preview.
      // When real prices ship, plumb cycle → separate STRIPE_PRICE_*_YEARLY
      // env vars and pass through from here.
      const res = await createCheckoutSession({ tier: t });
      if (!res.ok) { toast.error(res.error); return; }
      window.location.href = res.data!.url;
    });
  }

  function portal() {
    startTransition(async () => {
      const res = await openBillingPortal();
      if (!res.ok) { toast.error(res.error); return; }
      window.location.href = res.data!.url;
    });
  }

  return (
    // Dark marketing island — spans the full billing page. Everything inside
    // uses the amber/gold palette regardless of the outer admin theme.
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{ background: "#08080C", color: "#F1EFE8", border: "1px solid #2A2A2E" }}
    >
      {/* Aurora — three drifting amber blobs behind the content */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full"
          style={{
            background: "rgba(232,168,56,0.28)",
            filter: "blur(120px)",
            animation: "pfDrift1 22s ease-in-out infinite",
          }}
        />
        <div
          className="absolute -right-16 top-1/3 h-[380px] w-[380px] rounded-full"
          style={{
            background: "rgba(244,192,88,0.22)",
            filter: "blur(120px)",
            animation: "pfDrift2 26s ease-in-out infinite",
          }}
        />
        <div
          className="absolute bottom-[-140px] left-1/3 h-[320px] w-[320px] rounded-full"
          style={{
            background: "rgba(232,168,56,0.18)",
            filter: "blur(120px)",
            animation: "pfDrift3 30s ease-in-out infinite",
          }}
        />
      </div>

      <div className="relative space-y-8 p-6 sm:p-8">
        {/* Section 1 — Current plan summary (sleek one-line banner) */}
        <SummaryBanner
          tier={tier}
          status={status}
          currentPeriodEnd={currentPeriodEnd}
          trialEnd={trialEnd}
        />

        {/* Section 2 — Upgrade plans */}
        {tier === "pilot" && (
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: "#E8A838" }}>
                  Upgrade plans
                </div>
                <h2 className="mt-1 text-2xl font-semibold sm:text-3xl" style={{ color: "#FFFFFF" }}>
                  Pricing that fits your Sunday
                </h2>
              </div>
              <CycleToggle cycle={cycle} onChange={setCycle} />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {TIERS.map((t) => (
                <PlanCard
                  key={t.key}
                  plan={t}
                  cycle={cycle}
                  pending={pending}
                  onUpgrade={() => upgrade(t.key)}
                />
              ))}
            </div>

            <div
              className="flex items-start gap-2.5 rounded-lg px-4 py-3 text-xs"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid #2A2A2E",
                color: "#8B8B92",
              }}
            >
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "#E8A838" }} />
              <span>
                Prices are placeholders until we validate them with pilot churches.
                Any &ldquo;Start free trial&rdquo; click here uses Stripe test mode — no card is ever charged.
              </span>
            </div>
          </div>
        )}

        {/* Stripe portal for churches with a real subscription */}
        {hasStripeCustomer && (
          <div
            className="flex flex-col items-start gap-3 rounded-xl px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            style={{ background: "#111115", border: "1px solid #2A2A2E" }}
          >
            <div>
              <div className="text-sm font-semibold" style={{ color: "#FFFFFF" }}>
                Payment method &amp; invoices
              </div>
              <div className="mt-0.5 text-xs" style={{ color: "#8B8B92" }}>
                Update your card, download receipts, or cancel from Stripe&rsquo;s hosted portal.
              </div>
            </div>
            <button
              type="button"
              onClick={portal}
              disabled={pending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-semibold transition-colors disabled:opacity-50"
              style={{
                background: "#E8A838",
                color: "#08080C",
              }}
            >
              Open portal <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryBanner({
  tier, status, currentPeriodEnd, trialEnd,
}: {
  tier: string; status: string; currentPeriodEnd: string | null; trialEnd: string | null;
}) {
  const isPilot = tier === "pilot";
  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl px-5 py-4"
      style={{ background: "#111115", border: "1px solid #2A2A2E" }}
    >
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-md" style={{ background: "rgba(232,168,56,0.14)" }}>
          <span className="text-xs font-bold" style={{ color: "#E8A838" }}>
            {(TIER_LABELS[tier] || tier).charAt(0)}
          </span>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: "#8B8B92" }}>
            Current plan
          </div>
          <div className="mt-0.5 text-sm font-semibold" style={{ color: "#FFFFFF" }}>
            {TIER_LABELS[tier] || tier}
          </div>
        </div>
      </div>
      <div className="text-xs" style={{ color: "#8B8B92" }}>
        <span style={{ color: "#F1EFE8" }}>Status:</span> {STATUS_LABELS[status] || status}
      </div>
      {trialEnd && (
        <div className="text-xs" style={{ color: "#8B8B92" }}>
          <span style={{ color: "#F1EFE8" }}>Trial ends:</span> {new Date(trialEnd).toLocaleDateString()}
        </div>
      )}
      {currentPeriodEnd && (
        <div className="text-xs" style={{ color: "#8B8B92" }}>
          <span style={{ color: "#F1EFE8" }}>Renews:</span> {new Date(currentPeriodEnd).toLocaleDateString()}
        </div>
      )}
      {isPilot && (
        <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ background: "rgba(52,211,153,0.14)", color: "#34D399" }}>
          Free
        </span>
      )}
    </div>
  );
}

function CycleToggle({ cycle, onChange }: { cycle: Cycle; onChange: (next: Cycle) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn("text-xs font-medium transition-colors", cycle === "monthly" ? "text-white" : "text-white/50")}>
        Monthly
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={cycle === "yearly"}
        onClick={() => onChange(cycle === "monthly" ? "yearly" : "monthly")}
        className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
        style={{ background: "#2A2A2E" }}
      >
        <span
          className="inline-block h-5 w-5 transform rounded-full transition-transform"
          style={{
            background: "#E8A838",
            transform: cycle === "yearly" ? "translateX(22px)" : "translateX(2px)",
          }}
        />
      </button>
      <div className="flex items-center gap-1.5">
        <span className={cn("text-xs font-medium transition-colors", cycle === "yearly" ? "text-white" : "text-white/50")}>
          Yearly
        </span>
        <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]" style={{ background: "rgba(232,168,56,0.14)", color: "#E8A838" }}>
          Save 20%
        </span>
      </div>
    </div>
  );
}

function PlanCard({
  plan, cycle, pending, onUpgrade,
}: {
  plan: PlanTier;
  cycle: Cycle;
  pending: boolean;
  onUpgrade: () => void;
}) {
  const price = cycle === "monthly" ? plan.monthly : plan.yearly;
  const featured = !!plan.featured;

  return (
    <div
      className={cn("relative flex flex-col rounded-xl p-6 transition-transform hover:-translate-y-1")}
      style={{
        background: featured ? "#141418" : "#111115",
        border: featured ? "1px solid rgba(232,168,56,0.35)" : "1px solid #2A2A2E",
        boxShadow: featured ? "0 0 40px rgba(232,168,56,0.15)" : "none",
      }}
    >
      {featured && (
        <span
          className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em]"
          style={{ background: "#E8A838", color: "#08080C" }}
        >
          Recommended
        </span>
      )}

      <div className="mb-2 text-lg font-semibold" style={{ color: "#FFFFFF" }}>
        {plan.label}
      </div>
      <p className="mb-5 text-xs leading-5" style={{ color: "#8B8B92" }}>
        {plan.tagline}
      </p>

      <div className="mb-1 flex items-baseline gap-1">
        <span className="text-4xl font-semibold" style={{ color: "#FFFFFF" }}>
          ${price}
        </span>
        <span className="text-xs" style={{ color: "#8B8B92" }}>
          /mo{cycle === "yearly" ? " · billed yearly" : ""}
        </span>
      </div>
      <div className="mb-6 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#5A5A62" }}>
        Placeholder pricing · Stripe test mode
      </div>

      <ul className="mb-6 flex-1 space-y-2.5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs leading-5" style={{ color: "#F1EFE8" }}>
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "#E8A838" }} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onUpgrade}
        disabled={pending}
        className={cn(
          "h-10 rounded-md text-sm font-semibold transition-colors disabled:opacity-50",
          featured ? "" : "hover:brightness-110",
        )}
        style={featured ? {
          background: "#E8A838",
          color: "#08080C",
        } : {
          background: "transparent",
          border: "1px solid #2A2A2E",
          color: "#F1EFE8",
        }}
      >
        {pending ? "Opening Stripe…" : plan.cta}
      </button>
    </div>
  );
}
