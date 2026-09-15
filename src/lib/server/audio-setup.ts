// Server-only. Do not import from client components.
//
// Sarah audio setup — church-scoped DB core. churchId/user always come from the
// session via the thin route wrapper; never from the client.
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { betaApplications, churchAudioProfiles, churches, users } from "../db/schema";
import { bestApplicationMatch, type ApplicationMatch, type ApplicationRow } from "../audio/applicationMatch";

type Db = ReturnType<typeof getDb>;

export const OS_VALUES = ["mac", "windows"] as const;
export const CONNECTION_VALUES = ["usb-desk", "interface", "ndi", "dante", "sdi-capture", "builtin"] as const;

export interface AudioSetupProfile {
  desk?: string;
  os?: (typeof OS_VALUES)[number];
  connection?: (typeof CONNECTION_VALUES)[number];
  mixType?: "main" | "aux" | "unsure";
  failedRoutes?: { connection: string; reason: string; at: number }[];
  corrections?: { field: string; from?: string; to: string; at: number }[];
  completedAt?: number;
}

/** Whitelist-rebuild a client-supplied profile. Unknown keys dropped, strings capped. */
export function sanitizeProfile(raw: unknown): AudioSetupProfile {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, n = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
  const out: AudioSetupProfile = {};
  const desk = str(o.desk); if (desk) out.desk = desk;
  if ((OS_VALUES as readonly string[]).includes(o.os as string)) out.os = o.os as AudioSetupProfile["os"];
  if ((CONNECTION_VALUES as readonly string[]).includes(o.connection as string)) out.connection = o.connection as AudioSetupProfile["connection"];
  if (o.mixType === "main" || o.mixType === "aux" || o.mixType === "unsure") out.mixType = o.mixType;
  if (Array.isArray(o.failedRoutes)) {
    out.failedRoutes = o.failedRoutes.slice(-20).flatMap((r) => {
      const x = r as Record<string, unknown>; const c = str(x?.connection, 40); const reason = str(x?.reason, 200);
      return c && reason ? [{ connection: c, reason, at: typeof x.at === "number" ? x.at : Date.now() }] : [];
    });
  }
  if (Array.isArray(o.corrections)) {
    out.corrections = o.corrections.slice(-30).flatMap((r) => {
      const x = r as Record<string, unknown>; const f = str(x?.field, 40); const to = str(x?.to, 200);
      return f && to ? [{ field: f, from: str(x?.from, 200), to, at: typeof x.at === "number" ? x.at : Date.now() }] : [];
    });
  }
  if (typeof o.completedAt === "number" && Number.isFinite(o.completedAt)) out.completedAt = o.completedAt;
  return out;
}

const isMissingTable = (e: unknown) => /church_audio_profiles/.test(String((e as Error)?.message ?? "")) && /does not exist|undefined table|42P01/i.test(String((e as Error)?.message ?? "") + String((e as { code?: string })?.code ?? ""));

export interface SetupContext {
  match: ApplicationMatch | null;
  profile: AudioSetupProfile;
  profileAvailable: boolean;
}

/**
 * Candidate applications: any whose contact email belongs to this church's team,
 * or whose church name shares a distinctive word with this church. Then scored
 * in-process (bestApplicationMatch). Only the setup-relevant fields leave this
 * function — never ip, user agent, phone, or other answers.
 */
export async function loadSetupContextCore(
  db: Db, user: { email: string; name?: string; churchId: string },
): Promise<SetupContext> {
  const [church] = await db.select({ name: churches.name, city: churches.city, country: churches.country })
    .from(churches).where(eq(churches.id, user.churchId)).limit(1);
  const memberRows = await db.select({ email: users.email }).from(users).where(eq(users.churchId, user.churchId)).limit(200);
  const memberEmails = memberRows.map((r) => r.email.toLowerCase());

  let match: ApplicationMatch | null = null;
  if (church) {
    const words = church.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).slice(0, 4);
    const nameConds = words.map((w) => sql`lower(${betaApplications.churchName}) LIKE ${"%" + w.replace(/[%_\\]/g, "") + "%"}`);
    const emailSet = [...new Set([user.email.toLowerCase(), ...memberEmails])];
    const rows = await db.select({
      id: betaApplications.id, churchName: betaApplications.churchName, contactEmail: betaApplications.contactEmail,
      answers: betaApplications.answers, createdAt: betaApplications.createdAt,
    }).from(betaApplications)
      .where(or(
        and(isNotNull(betaApplications.contactEmail), inArray(sql`lower(${betaApplications.contactEmail})`, emailSet)),
        ...nameConds,
      ))
      .orderBy(desc(betaApplications.createdAt))
      .limit(25);
    match = bestApplicationMatch(rows as ApplicationRow[], {
      userEmail: user.email, userName: user.name, memberEmails, churchName: church.name, city: church.city, country: church.country,
    });
  }

  let profile: AudioSetupProfile = {};
  let profileAvailable = true;
  try {
    const [row] = await db.select({ profile: churchAudioProfiles.profile }).from(churchAudioProfiles)
      .where(eq(churchAudioProfiles.churchId, user.churchId)).limit(1);
    profile = sanitizeProfile(row?.profile);
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    profileAvailable = false;
  }
  return { match, profile, profileAvailable };
}

export async function saveAudioProfileCore(
  db: Db, churchId: string, userId: string, rawProfile: unknown, confirmedApplicationId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = sanitizeProfile(rawProfile);
  let appId: string | null = null;
  if (confirmedApplicationId && /^[0-9a-f-]{36}$/i.test(confirmedApplicationId)) appId = confirmedApplicationId;
  try {
    await db.insert(churchAudioProfiles)
      .values({ churchId, profile, confirmedApplicationId: appId, updatedByUserId: userId })
      .onConflictDoUpdate({
        target: churchAudioProfiles.churchId,
        set: { profile, confirmedApplicationId: appId, updatedByUserId: userId, updatedAt: sql`now()` },
      });
    return { ok: true };
  } catch (e) {
    if (isMissingTable(e)) return { ok: false, error: "Audio profile storage isn't set up yet" };
    throw e;
  }
}
