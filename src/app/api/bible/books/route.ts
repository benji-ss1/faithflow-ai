import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listBooks } from "@/lib/server/bible";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const translationId = url.searchParams.get("translationId");
  if (!translationId) return NextResponse.json({ error: "translationId required" }, { status: 400 });
  const books = await listBooks(translationId);
  return NextResponse.json({ books });
}
