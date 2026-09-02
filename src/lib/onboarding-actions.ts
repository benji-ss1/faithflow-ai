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
  // Read the default translation BEFORE the write transaction (no lock needed).
  const [kjv] = await db.select().from(bibleTranslations).where(eq(bibleTranslations.code, "KJV")).limit(1);

  // 2026-09-01 (pilot signup hardening): all four writes are wrapped in ONE
  // transaction so church creation is ATOMIC. Previously a failure after the
  // `users` update (e.g. the subscription insert) left the user row with a
  // churchId set but NO churchPreferences / NO subscription — and because
  // createChurchAndAttachUser short-circuits on `partial.churchId`, those rows
  // could NEVER be created afterward, permanently stranding a half-onboarded
  // church (no billing state, defaulted prefs). All-or-nothing fixes that.
  let churchId: string;
  try {
    churchId = await db.transaction(async (tx) => {
      const [church] = await tx.insert(churches).values({
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
      await tx.update(users).set({
        churchId: church.id,
        role: "admin",
        jobTitle: input.jobTitle?.trim() || null,
      }).where(eq(users.id, partial.id));

      // Default prefs: KJV. Same as seed.
      await tx.insert(churchPreferences).values({
        churchId: church.id,
        defaultTranslationId: kjv?.id ?? null,
      });

      // Beta trial: full pilot-tier features, but on a TRIALING clock. After
      // TRIAL_DAYS the app locks behind the "trial ended — contact us" prompt
      // until they pay (getEntitlement.trialExpired). tier stays "pilot" so every
      // feature is unlocked during the trial. Exactly one week.
      const TRIAL_DAYS = 7;
      const trialEnd = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      await tx.insert(subscriptions).values({
        churchId: church.id,
        tier: "pilot",
        status: "trialing",
        trialEnd,
      });

      return church.id;
    });
  } catch (e) {
    console.error("[onboarding] createChurchAndAttachUser failed (rolled back):", e);
    return { ok: false, error: "Could not create your church — please try again." };
  }

  revalidatePath("/onboarding");
  return { ok: true, data: { churchId } };
}

export async function completeOnboarding(): Promise<Result> {
  const partial = await requirePartialUser();
  if (!partial.churchId) return { ok: false, error: "No church attached yet" };
  const db = getDb();
  await db.update(churches).set({ onboardingStatus: "complete" }).where(eq(churches.id, partial.churchId));
  // Stamp tutorialCompletedAt so the (app) layout gate doesn't bounce
  // the user back into /onboarding on their first dashboard visit.
  await db.update(users).set({ tutorialCompletedAt: new Date() }).where(eq(users.id, partial.id));
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
