"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { churches, users, subscriptions, churchPreferences, bibleTranslations } from "./db/schema";
import { requirePartialUser } from "./session";

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

export async function createChurchAndAttachUser(input: {
  name: string;
  city?: string;
  country?: string;
  timezone: string;
  congregationSize?: number;
  denomination?: string;
  jobTitle?: string;
  isDemo?: boolean;
}): Promise<Result<{ churchId: string }>> {
  const partial = await requirePartialUser();
  if (partial.churchId) return { ok: false, error: "You already have a church" };
  if (!input.name.trim()) return { ok: false, error: "Church name required" };

  const db = getDb();
  const [church] = await db.insert(churches).values({
    name: input.name.trim(),
    city: input.city?.trim() || null,
    country: input.country?.trim() || null,
    timezone: input.timezone || "UTC",
    congregationSize: input.congregationSize || null,
    denomination: input.denomination?.trim() || null,
    onboardingStatus: "in_progress",
    isDemo: input.isDemo === true,
  }).returning();

  // Attach user + promote to admin (first user of a church always admin).
  await db.update(users).set({
    churchId: church.id,
    role: "admin",
    jobTitle: input.jobTitle?.trim() || null,
  }).where(eq(users.id, partial.id));

  // Default prefs: KJV, 90-day retention, faithflow prefix. Same as seed.
  const [kjv] = await db.select().from(bibleTranslations).where(eq(bibleTranslations.code, "KJV")).limit(1);
  await db.insert(churchPreferences).values({
    churchId: church.id,
    defaultTranslationId: kjv?.id ?? null,
  });

  // Default subscription: Pilot (never charges).
  await db.insert(subscriptions).values({
    churchId: church.id,
    tier: "pilot",
    status: "pilot",
  });

  revalidatePath("/onboarding");
  return { ok: true, data: { churchId: church.id } };
}

export async function completeOnboarding(): Promise<Result> {
  const partial = await requirePartialUser();
  if (!partial.churchId) return { ok: false, error: "No church attached yet" };
  const db = getDb();
  await db.update(churches).set({ onboardingStatus: "complete" }).where(eq(churches.id, partial.churchId));
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function skipOnboarding(): Promise<Result> {
  const partial = await requirePartialUser();
  if (!partial.churchId) return { ok: false, error: "Set up your church first" };
  const db = getDb();
  await db.update(churches).set({ onboardingStatus: "skipped" }).where(eq(churches.id, partial.churchId));
  return { ok: true };
}
