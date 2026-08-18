"use client";

/**
 * PostHog analytics — US Cloud, env-gated on NEXT_PUBLIC_POSTHOG_KEY (host
 * defaults to us.i.posthog.com). Mounted app-wide from the root layout; safe
 * no-op when the key is absent (local/dev without the Vercel env). Also captures
 * SPA pageviews on route change.
 *
 * Helpers `track()` / `identifyLead()` are safe to call anywhere — they check
 * that PostHog actually loaded before doing anything, so the beta form can fire
 * events without worrying about init order or missing keys.
 *
 * COOKIE CONSENT: analytics cookies only fire AFTER the visitor accepts (GDPR /
 * ePrivacy). Until `pf.cookie.consent.v1 === "accepted"`, `ensureInit()` no-ops,
 * so every track/identify call is silently dropped. The CookieConsent banner
 * calls `setCookieConsent(true)` to opt in (and boots PostHog immediately).
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";

let inited = false;

const CONSENT_KEY = "pf.cookie.consent.v1";

export function getCookieConsent(): "accepted" | "declined" | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "accepted" || v === "declined" ? v : null;
  } catch {
    return null;
  }
}

/** Record the visitor's choice. Accepting boots PostHog + captures the first view. */
export function setCookieConsent(accepted: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONSENT_KEY, accepted ? "accepted" : "declined");
  } catch {
    /* ignore */
  }
  if (accepted) {
    ensureInit();
    if (inited) {
      try {
        posthog.capture("$pageview", { $current_url: window.location.href });
      } catch {
        /* no-op */
      }
    }
  }
}

function ensureInit() {
  if (inited || typeof window === "undefined") return;
  // Analytics cookies require explicit consent.
  if (getCookieConsent() !== "accepted") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    capture_pageview: false, // we capture manually on route change (App Router)
    capture_pageleave: true, // needed for form abandonment / drop-off funnels
    person_profiles: "identified_only",
  });
  inited = true;
}

export function track(event: string, props?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    ensureInit();
    if (inited) posthog.capture(event, props);
  } catch {
    /* analytics must never break the UI */
  }
}

/** Turn an anonymous visitor into a known lead (fired the moment we have an email). */
export function identifyLead(email: string, props?: Record<string, unknown>) {
  if (typeof window === "undefined" || !email) return;
  try {
    ensureInit();
    if (inited) posthog.identify(email, props);
  } catch {
    /* no-op */
  }
}

export function PostHogProvider() {
  const pathname = usePathname();

  useEffect(() => {
    ensureInit();
  }, []);

  // Manual pageview capture for App Router client navigations.
  useEffect(() => {
    if (!inited) return;
    posthog.capture("$pageview", { $current_url: window.location.href });
  }, [pathname]);

  return null;
}
