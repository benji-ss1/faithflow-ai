import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { listSuggestionHistory } from "@/lib/server/services";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const planId = url.searchParams.get("planId");
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 });
  const rows = await listSuggestionHistory(planId, user.churchId);
  return NextResponse.json({ rows });
}
