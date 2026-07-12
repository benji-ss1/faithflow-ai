import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { servicePlans } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });

  const { planId } = await req.json().catch(() => ({}));
  if (!planId || typeof planId !== "string") return NextResponse.json({ error: "planId required" }, { status: 400 });

  // Y5: verify plan ownership at mint. Prevents cross-church ticket forging
  // by an authenticated user targeting another church's planId.
  const db = getDb();
  const [plan] = await db
    .select({ id: servicePlans.id })
    .from(servicePlans)
    .where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId)))
    .limit(1);
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 403 });

  const exp = Date.now() + 5 * 60 * 1000; // 5 min
  // Y5: bind userId into the HMAC payload so a leaked ticket can't be
  // replayed under a different session.
  const sig = crypto.createHmac("sha256", process.env.AUTH_SECRET!)
    .update(`${planId}|${user.churchId}|${user.id}|${exp}`)
    .digest("hex");

  const wsBase = process.env.NEXT_PUBLIC_AUDIO_WS_URL || "ws://localhost:3001";
  const url = `${wsBase}?planId=${planId}&churchId=${user.churchId}&userId=${user.id}&exp=${exp}&sig=${sig}`;
  return NextResponse.json({ url });
}
