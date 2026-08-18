// Next.js instrumentation hook — loads the correct Sentry runtime config
// per environment. When SENTRY_DSN is not set the init calls no-op, so this
// is safe to leave in place indefinitely.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// App Router server error capture (RSC / route handlers / server actions).
// @sentry/nextjs v10 exposes captureRequestError for this hook; it no-ops when
// no DSN is configured, so it's safe to always export.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
