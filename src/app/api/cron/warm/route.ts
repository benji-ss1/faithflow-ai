import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/warm — keep a warm serverless instance in dub1.
 *
 * Fluid Compute is already enabled on this project, so instances are reused
 * across concurrent requests and most traffic is warm (~0.1-0.5s). But after a
 * deploy, or after a quiet overnight gap, the FIRST request still pays a full
 * cold start — measured at ~24s on a freshly deployed instance. At 20 churches
 * that cost lands on whichever church opens the app first on a Sunday morning,
 * which is exactly when nobody has time for it.
 *
 * Deliberately trivial: no DB, no auth, no imports. It exists to keep an
 * instance alive, not to check anything — /api/health is the liveness probe.
 *
 * HONEST LIMITATION: this warms the region's instance pool, it does NOT
 * guarantee the specific instance that serves a given page is warm, and it
 * cannot help the first request after a deploy (a deploy invalidates every
 * warm instance). The real mitigations for that remain: don't deploy shortly
 * before a service, and put an external uptime monitor on /api/health every
 * few minutes (which would also close the "no uptime monitoring" gap).
 *
 * Unauthenticated on purpose — it does nothing and touches nothing, so a
 * CRON_SECRET would add failure modes without protecting anything. It is
 * rate-limit-free for the same reason: the response is a constant.
 */
export async function GET() {
  return NextResponse.json({ ok: true, warm: true, ts: Date.now() });
}
