/**
 * Per-user rate limit for /api/health/* endpoints.
 *
 * Security R2: authenticated callers could otherwise spam these routes,
 * turning /api/health/db into a per-hit `SELECT 1` on the pooler and
 * /api/health/storage into a billed S3 HeadBucket.
 *
 * Shared namespaced limiter — 10 requests per 60s per userId across all
 * health routes. Uses the in-memory backend from `rate-limit.ts` (fine for
 * per-instance limits; swap the backend for durable enforcement).
 */
import { NextResponse } from "next/server";
import { createLimiter } from "@/lib/rate-limit";

const check = createLimiter("api-health", 10, 60_000);

export async function checkHealthRateLimit(userId: string): Promise<NextResponse | null> {
  const ok = await check(userId);
  if (ok) return null;
  return NextResponse.json(
    { ok: false, error: "Too many requests" },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}
