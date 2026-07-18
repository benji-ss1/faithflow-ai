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
  // NOTE: semantically a skip ≠ a completion for onboarding-funnel analytics.
  // We currently reuse `tutorial_completed_at` to keep the UI gate (any
  // non-null value = don't show the tour again), but any analytics query
  // over that column will over-report completions. When the schema gains a
  // dedicated `tutorial_skipped_at` column, split the branches. Until then
  // callers that need to distinguish should track their own event stream.
  return completeTutorial();
}
