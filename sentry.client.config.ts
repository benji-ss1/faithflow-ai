// Sentry (client) — no-op unless NEXT_PUBLIC_SENTRY_DSN is set at build time.
// Wire it up by setting NEXT_PUBLIC_SENTRY_DSN in Vercel envs; no other
// changes needed.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    // Skip noisy hydration-mismatch reports; they're almost always benign
    // (extension-injected DOM), and drowning the real errors when they hit.
    ignoreErrors: [
      /Hydration failed/i,
      /There was an error while hydrating/i,
      /Text content did not match/i,
      // Browser-extension noise (not our code) — Safari/Grammarly/translation
      // inject these into the page and they surface via window.onerror.
      /EmptyRanges/i,
      /Can't find variable: EmptyRanges/i,
      /webkit-masked-url/i,
      /ResizeObserver loop/i,
      /Non-Error promise rejection captured/i,
    ],
    // Drop anything whose stack is a browser extension, not our bundle.
    denyUrls: [/^safari-(web-)?extension:\/\//i, /^chrome-extension:\/\//i, /^moz-extension:\/\//i, /webkit-masked-url/i],
  });
}
