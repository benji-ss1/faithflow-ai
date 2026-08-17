import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { getFullPublicDomainTranslation } from "@/lib/server/bible";
import { createLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Whole-translation dump for OFFLINE hydration (public-domain only). One request
// pulls an entire translation (~31k verses) so the client can store every
// chapter locally in a single round trip instead of ~1,189 per-chapter fetches.
// Bounded so a client can't spin the DB scan: a full hydration is a handful of
// codes, run once, in the background.
const fullLimiter = createLimiter("bible-full", 20, 60 * 1000);

export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ok = await fullLimiter(user.id);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!/^[A-Za-z0-9]{1,16}$/.test(code)) {
    return NextResponse.json({ error: "invalid code" }, { status: 400 });
  }

  // Returns null for licensed OR unknown codes — a licensed translation must
  // NEVER be bulk-dumped (it would hammer the shared API.Bible quota).
  const full = await getFullPublicDomainTranslation(code);
  if (!full) {
    return NextResponse.json({ error: "not available for offline (public-domain only)" }, { status: 404 });
  }
  // Auth-gated per-user route, so it won't be shared-CDN cached — mark it
  // private (browser cache only). The real throttles are the 20/60s limiter and
  // the client's 30-day per-translation hydration manifest; the client fetches
  // with `no-store` anyway, so this mainly helps an incidental re-request.
  return NextResponse.json(full, {
    headers: { "Cache-Control": "private, max-age=604800, immutable" },
  });
}
