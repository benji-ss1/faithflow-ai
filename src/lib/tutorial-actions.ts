"use server";
import { eq } from "drizzle-orm";
import { requireUser } from "./session";
import { getDb } from "./db/client";
import { users } from "./db/schema";

export async function completeTutorial(): Promise<{ ok: true }> {
  const user = await requireUser();
  const db = getDb();
  await db.update(users).set({ tutorialCompletedAt: new Date() }).where(eq(users.id, user.id));
  return { ok: true };
}

export async function skipTutorial(): Promise<{ ok: true }> {
  return completeTutorial();
}
