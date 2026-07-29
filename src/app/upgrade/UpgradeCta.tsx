"use client";
import { Suspense, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { createCheckoutSession } from "@/lib/billing-actions";

/**
 * "Start free trial" button used on the Starter + Pro upgrade pages.
 * Uses the same createCheckoutSession action as the billing page's tier
 * cards — during pilot this fires Stripe test-mode checkout with no card
 * ever charged. When real pricing lands, both surfaces pick it up
 * automatically because they share the action.
 *
 * Reads `?cycle=monthly|yearly` from the URL (default: monthly) so the
 * billing page's toggle carries through into the actual Stripe checkout.
 */
export function UpgradeCta(props: UpgradeCtaProps) {
  // useSearchParams requires a Suspense boundary at the component using
  // it — wrapping here so callers don't have to remember.
  return (
    <Suspense fallback={<UpgradeButton pending={false} {...props} onClick={() => { /* noop until suspense resolves */ }} />}>
      <UpgradeCtaInner {...props} />
    </Suspense>
  );
}

type UpgradeCtaProps = {
  tier: "starter" | "pro" | "enterprise";
  label?: string;
  variant?: "primary" | "ghost";
  className?: string;
};

function UpgradeCtaInner({ tier, label, variant = "primary", className = "" }: UpgradeCtaProps) {
  const search = useSearchParams();
  const cycle: "monthly" | "yearly" = search?.get("cycle") === "yearly" ? "yearly" : "monthly";
  const [pending, startTransition] = useTransition();

  function go() {
    startTransition(async () => {
      const res = await createCheckoutSession({ tier, cycle });
      if (!res.ok) { toast.error(res.error); return; }
      window.location.href = res.data!.url;
    });
  }

  return <UpgradeButton {...{ tier, label, variant, className }} pending={pending} onClick={go} />;
}

function UpgradeButton({
  label, variant = "primary", className = "", pending, onClick,
}: UpgradeCtaProps & { pending: boolean; onClick: () => void }) {
  const base = "inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-semibold transition-colors disabled:opacity-50";
  const styles = variant === "primary"
    ? { background: "#E8A838", color: "#08080C" }
    : { background: "transparent", border: "1px solid #2A2A2E", color: "#F1EFE8" };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`${base} ${className}`}
      style={styles}
    >
      {pending ? "Opening Stripe…" : (label || "Start free trial")}
    </button>
  );
}
