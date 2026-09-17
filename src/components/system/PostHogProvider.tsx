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

type PostHog = typeof import("posthog-js").default;
let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;

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
  if (!accepted) {
    // Consent can be withdrawn after the SDK has loaded. Tell the client to
    // stop both capture and its persistence immediately, not merely our own
    // wrapper functions.
    try { client?.opt_out_capturing(); } catch { /* no-op */ }
    return;
  }

  // Re-accepting after a withdrawal resumes an already-loaded SDK without
  // fetching a second copy. Skip PostHog's automatic opt-in event; the page
  // view below remains our single, explicit first event.
  try { client?.opt_in_capturing({ captureEventName: false }); } catch { /* no-op */ }
  if (accepted) {
    const url = window.location.href;
    void ensureInit().then((posthog) => {
      if (getCookieConsent() !== "accepted") return;
      try { posthog?.capture("$pageview", { $current_url: url }); } catch { /* no-op */ }
    });
  }
}

function ensureInit(): Promise<PostHog | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  // Analytics cookies require explicit consent.
  if (getCookieConsent() !== "accepted") return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return Promise.resolve(null);
  if (!loading) {
    // The large analytics SDK belongs to a separate chunk. It is requested
    // only after consent, without delaying the app's first interaction.
    loading = import("posthog-js").then(({ default: posthog }) => {
      if (getCookieConsent() !== "accepted") {
        loading = null;
        return null;
      }
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
        capture_pageview: false,
        capture_pageleave: true,
        person_profiles: "identified_only",
        // When consent is withdrawn, opt_out_capturing() disables and removes
        // this SDK's cookie/localStorage persistence as well as future capture.
        opt_out_persistence_by_default: true,
      });
      client = posthog;
      return posthog;
    }).catch(() => {
      loading = null;
      return null;
    });
  }
  return loading;
}

export function track(event: string, props?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  void ensureInit().then((posthog) => {
    if (getCookieConsent() !== "accepted") return;
    try { posthog?.capture(event, props); } catch { /* analytics must never break the UI */ }
  });
}

/** Turn an anonymous visitor into a known lead (fired the moment we have an email). */
export function identifyLead(email: string, props?: Record<string, unknown>) {
  if (typeof window === "undefined" || !email) return;
  void ensureInit().then((posthog) => {
    if (getCookieConsent() !== "accepted") return;
    try { posthog?.identify(email, props); } catch { /* analytics must never break the UI */ }
  });
}

export function PostHogProvider() {
  const pathname = usePathname();

  useEffect(() => {
    void ensureInit();
  }, []);

  // Manual pageview capture for App Router client navigations.
  useEffect(() => {
    const url = window.location.href;
    void ensureInit().then((posthog) => {
      if (getCookieConsent() !== "accepted") return;
      try { posthog?.capture("$pageview", { $current_url: url }); } catch { /* no-op */ }
    });
  }, [pathname]);

  return null;
}
