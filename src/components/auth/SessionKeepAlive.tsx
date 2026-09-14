"use client";
import { useEffect } from "react";
import { logAuthEvent } from "@/lib/auth-telemetry";

// Rolling-session keepalive. GET /api/auth/session re-signs the JWT cookie with
// a fresh 90-day expiry (see session.maxAge in src/lib/auth.ts), so any church
// that opens the app at least once per 90 days is never signed out. Pings on
// mount + hourly + on focus/visibility (throttled to once per 5 min).
// Module-level throttle so a double mount (AppShell + operate page) pings once.
// Network failures (offline service) are silent — the cookie is still valid.
const HOUR_MS = 60 * 60 * 1000;
const MIN_GAP_MS = 5 * 60 * 1000;
let lastPing = 0;
let reportedMissing = false;

async function ping(force: boolean) {
  const now = Date.now();
  if (!force && now - lastPing < MIN_GAP_MS) return;
  lastPing = now;
  try {
    const r = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json().catch(() => null)) as { user?: unknown } | null;
    if (!j?.user && !reportedMissing) {
      reportedMissing = true;
      logAuthEvent("signed_out:keepalive_no_session", { path: window.location.pathname });
    }
  } catch { /* offline — ignore */ }
}

export function SessionKeepAlive() {
  useEffect(() => {
    void ping(false);
    const id = window.setInterval(() => void ping(true), HOUR_MS);
    const onFocus = () => void ping(false);
    const onVis = () => { if (document.visibilityState === "visible") void ping(false); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return null;
}
