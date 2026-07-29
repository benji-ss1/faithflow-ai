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

// onRequestError re-export omitted — Sentry's public export surface for this
// hook varies between minor versions. When DSN is set, Sentry's own auto-
// instrumentation still captures unhandled request errors via the runtime
// init above, so skipping this manual re-export is safe.
