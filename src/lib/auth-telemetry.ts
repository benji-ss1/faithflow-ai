"use client";
import * as Sentry from "@sentry/nextjs";

/** Records WHY a user landed signed-out (middleware ?reason=…, keepalive miss) so real causes are measurable. */
export function logAuthEvent(event: string, data: Record<string, unknown> = {}): void {
  try {
    console.info(`[auth] ${event}`, data);
    Sentry.addBreadcrumb({ category: "auth", message: event, level: "info", data });
    if (event.startsWith("signed_out")) Sentry.captureMessage(`auth:${event}`, { level: "info", extra: data });
  } catch { /* telemetry must never break auth UI */ }
}
