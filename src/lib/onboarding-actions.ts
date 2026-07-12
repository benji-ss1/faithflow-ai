"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { churches, users, subscriptions, churchPreferences, bibleTranslations } from "./db/schema";
import { requirePartialUser } from "./session";

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

// Reject anything the ICU timezone db doesn't recognise. Prevents users
// from persisting "asdf" and blowing up every downstream .toLocaleString().
function normalizeTimezone(tz: string | undefined | null): string {
  const candidate = (tz || "").trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

// Church names have real-world upper bounds. 120 chars is comfortable for
// "Saint Mary's Cathedral of the Holy Rosary Ballymun, Dublin". Anything
// longer is almost certainly a paste accident or an attack payload.
const CHURCH_NAME_MAX = 120;

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
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Church name required" };
  if (name.length > CHURCH_NAME_MAX) return { ok: false, error: `Church name too long (max ${CHURCH_NAME_MAX} characters)` };

  const db = getDb();
  const [church] = await db.insert(churches).values({
    name,
    city: input.city?.trim() || null,
    country: input.country?.trim() || null,
    timezone: normalizeTimezone(input.timezone),
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

  // Default prefs: KJV, 90-day retention, presentflow prefix. Same as seed.
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

export async function updateChurchProfile(input: {
  name: string;
  city?: string;
  country?: string;
  timezone: string;
  congregationSize?: number;
  denomination?: string;
}): Promise<Result> {
  const { requireRole } = await import("./session");
  const admin = await requireRole("admin");
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Church name required" };
  if (name.length > CHURCH_NAME_MAX) return { ok: false, error: `Church name too long (max ${CHURCH_NAME_MAX} characters)` };
  const db = getDb();
  await db.update(churches).set({
    name,
    city: input.city?.trim() || null,
    country: input.country?.trim() || null,
    timezone: normalizeTimezone(input.timezone),
    congregationSize: input.congregationSize || null,
    denomination: input.denomination?.trim() || null,
  }).where(eq(churches.id, admin.churchId));
  revalidatePath("/organization");
  return { ok: true };
}

export async function deleteChurchAccount(confirmation: string): Promise<Result> {
  const { requireRole } = await import("./session");
  const admin = await requireRole("admin");
  const db = getDb();
  const [church] = await db.select().from(churches).where(eq(churches.id, admin.churchId)).limit(1);
  if (!church) return { ok: false, error: "Church not found" };
  if (confirmation.trim() !== church.name) {
    return { ok: false, error: "Type the church name exactly to confirm." };
  }
  // ON DELETE CASCADE covers users/invitations/subscriptions/servicePlans/etc.
  // Rows without cascade FKs (songs, media_assets, settings) delete first to
  // avoid FK constraint errors. This is a genuinely destructive op — no undo.
  const result = await db.transaction(async (tx) => {
    // Detach every user in the church first so the session doesn't
    // reference a deleted church row mid-request. Then delete the church
    // and return the number of rows affected — 0 means someone else
    // deleted it between our SELECT and the transaction.
    await tx.update(users).set({ churchId: null }).where(eq(users.churchId, admin.churchId));
    const deleted = await tx.delete(churches).where(eq(churches.id, admin.churchId)).returning({ id: churches.id });
    return deleted.length;
  });
  if (result === 0) return { ok: false, error: "Church already deleted." };
  revalidatePath("/");
  return { ok: true };
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
