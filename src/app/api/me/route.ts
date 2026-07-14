import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";

/**
 * GET /api/me — returns minimal identity for client UI (email prefill etc).
 *
 * Auth-gated. Returns 401 when unauthenticated. Kept narrow on purpose —
 * anything more should go through a dedicated endpoint scoped to its use.
 */
export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ id: user.id, email: user.email, name: user.name });
}
