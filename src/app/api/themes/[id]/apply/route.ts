import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { themes } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * POST /api/themes/[id]/apply
 * Sets the given theme as the church's default (isDefault=true), clearing
 * isDefault on all other themes for the same church — done in a transaction
 * to prevent the race where two concurrent applies briefly show two defaults.
 * Church-scoped: 404 if the theme doesn't belong to this church.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const { id } = await params;

  const db = getDb();

  // Confirm the theme belongs to this church before touching it.
  const [theme] = await db
    .select({ id: themes.id })
    .from(themes)
    .where(and(eq(themes.id, id), eq(themes.churchId, user.churchId)))
    .limit(1);

  if (!theme) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Transaction: clear prior default, then set the new one.
  // Prevents a concurrent request from seeing two rows with isDefault=true.
  await db.transaction(async (tx) => {
    await tx
      .update(themes)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(themes.churchId, user.churchId), ne(themes.id, id)));

    await tx
      .update(themes)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(themes.id, id), eq(themes.churchId, user.churchId)));
  });

  return NextResponse.json({ ok: true });
}
