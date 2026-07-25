"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { createCheckoutSession } from "@/lib/billing-actions";

/**
 * "Start free trial" button used on the Starter + Pro upgrade pages.
 * Uses the same createCheckoutSession action as the billing page's tier
 * cards — during pilot this fires Stripe test-mode checkout with no card
 * ever charged. When real pricing lands, both surfaces pick it up
 * automatically because they share the action.
 */
export function UpgradeCta({
  tier,
  label,
  variant = "primary",
  className = "",
}: {
  tier: "starter" | "pro" | "enterprise";
  label?: string;
  variant?: "primary" | "ghost";
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  function go() {
    startTransition(async () => {
      const res = await createCheckoutSession({ tier });
      if (!res.ok) { toast.error(res.error); return; }
      window.location.href = res.data!.url;
    });
  }

  const base = "inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-semibold transition-colors disabled:opacity-50";
  const styles = variant === "primary"
    ? { background: "#E8A838", color: "#08080C" }
    : { background: "transparent", border: "1px solid #2A2A2E", color: "#F1EFE8" };

  return (
    <button
      type="button"
      onClick={go}
      disabled={pending}
      className={`${base} ${className}`}
      style={styles}
    >
      {pending ? "Opening Stripe…" : (label || "Start free trial")}
    </button>
  );
}
