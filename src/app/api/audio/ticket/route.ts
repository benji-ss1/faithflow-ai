import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { apiUser } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });

  const { planId } = await req.json().catch(() => ({}));
  if (!planId || typeof planId !== "string") return NextResponse.json({ error: "planId required" }, { status: 400 });

  const exp = Date.now() + 5 * 60 * 1000; // 5 min
  const sig = crypto.createHmac("sha256", process.env.AUTH_SECRET!)
    .update(`${planId}|${user.churchId}|${exp}`)
    .digest("hex");

  const wsBase = process.env.NEXT_PUBLIC_AUDIO_WS_URL || "ws://localhost:3001";
  const url = `${wsBase}?planId=${planId}&churchId=${user.churchId}&exp=${exp}&sig=${sig}`;
  return NextResponse.json({ url });
}
