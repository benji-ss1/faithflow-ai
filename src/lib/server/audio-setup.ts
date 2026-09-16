// Server-only. Do not import from client components.
//
// Sarah audio setup — church-scoped DB core. churchId/user always come from the
// session via the thin route wrapper; never from the client.
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { betaApplications, churchAudioProfiles, churches, users } from "../db/schema";
import { bestApplicationMatch, norm, FREE_MAIL, type ApplicationMatch, type ApplicationRow } from "../audio/applicationMatch";

type Db = ReturnType<typeof getDb>;

export const OS_VALUES = ["mac", "windows"] as const;
export const CONNECTION_VALUES = ["usb-desk", "interface", "ndi", "dante", "sdi-capture", "builtin"] as const;
export const MIX_VALUES = ["main", "aux", "unsure"] as const;

export interface AudioSetupProfile {
  desk?: string;
  os?: (typeof OS_VALUES)[number];
  connection?: (typeof CONNECTION_VALUES)[number];
  mixType?: (typeof MIX_VALUES)[number];
  failedRoutes?: { connection: string; reason: string; at: number }[];
  corrections?: { field: string; from?: string; to: string; at: number }[];
  completedAt?: number;
}

const finiteOr = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Whitelist-rebuild a client-supplied profile. Unknown keys dropped, strings capped. */
export function sanitizeProfile(raw: unknown): AudioSetupProfile {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, n = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
  const out: AudioSetupProfile = {};
  const desk = str(o.desk); if (desk) out.desk = desk;
  if ((OS_VALUES as readonly string[]).includes(o.os as string)) out.os = o.os as AudioSetupProfile["os"];
  if ((CONNECTION_VALUES as readonly string[]).includes(o.connection as string)) out.connection = o.connection as AudioSetupProfile["connection"];
  if ((MIX_VALUES as readonly string[]).includes(o.mixType as string)) out.mixType = o.mixType as AudioSetupProfile["mixType"];
  if (Array.isArray(o.failedRoutes)) {
    out.failedRoutes = o.failedRoutes.slice(-20).flatMap((r) => {
      const x = r as Record<string, unknown>; const c = str(x?.connection, 40); const reason = str(x?.reason, 200);
      return c && reason && (CONNECTION_VALUES as readonly string[]).includes(c) ? [{ connection: c, reason, at: finiteOr(x.at, Date.now()) }] : [];
    });
  }
  if (Array.isArray(o.corrections)) {
    out.corrections = o.corrections.slice(-30).flatMap((r) => {
      const x = r as Record<string, unknown>; const f = str(x?.field, 40); const to = str(x?.to, 200);
      return f && to && ["desk", "os", "connection", "mixType"].includes(f) ? [{ field: f, from: str(x?.from, 200), to, at: finiteOr(x.at, Date.now()) }] : [];
    });
  }
  if (typeof o.completedAt === "number" && Number.isFinite(o.completedAt)) out.completedAt = o.completedAt;
  return out;
}

/** Postgres 42P01 for our table, whether the driver error is raw or wrapped (drizzle ≥0.44 puts it on .cause). */
export function isMissingProfilesTable(e: unknown): boolean {
  const err = e as { message?: string; code?: string; cause?: { message?: string; code?: string } };
  const codes = [err?.code, err?.cause?.code];
  const msg = `${err?.message ?? ""} ${err?.cause?.message ?? ""}`;
  if (!/church_audio_profiles/.test(msg)) return false;
  return codes.includes("42P01") || /does not exist|undefined table/i.test(msg);
}

export interface SetupContext {
  match: ApplicationMatch | null;
  profile: AudioSetupProfile;
  profileAvailable: boolean;
}

async function findMatch(db: Db, user: { email: string; name?: string; churchId: string }): Promise<ApplicationMatch | null> {
  const [church] = await db.select({ name: churches.name, city: churches.city, country: churches.country })
    .from(churches).where(eq(churches.id, user.churchId)).limit(1);
  if (!church) return null;
  // Team signal: only VERIFIED members count (an invited-but-unverified address can't unlock someone's application).
  const memberRows = await db.select({ email: users.email }).from(users)
    .where(and(eq(users.churchId, user.churchId), isNotNull(users.emailVerifiedAt))).limit(200);
  const memberEmails = memberRows.map((r) => r.email.toLowerCase());
  const emailSet = [...new Set([user.email.toLowerCase(), ...memberEmails])];
  // ONE free-mail list (shared with applicationMatch) so the prefilter and the scorer
  // can never disagree about what counts as a church's own domain.
  const domains = [...new Set(emailSet.map((e) => e.split("@")[1]).filter((d) => d && !FREE_MAIL.has(d)))].slice(0, 5);
  const words = norm(church.name).split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !["church", "chapel", "ministries", "ministry", "international", "assembly", "fellowship", "redeemed", "christian", "house", "gospel", "mission"].includes(w))
    .slice(0, 4);
  const likeEsc = (w: string) => w.replace(/[%_\\]/g, "");
  const rows = await db.select({
    id: betaApplications.id, churchName: betaApplications.churchName, contactEmail: betaApplications.contactEmail,
    answers: betaApplications.answers, createdAt: betaApplications.createdAt,
  }).from(betaApplications)
    .where(or(
      and(isNotNull(betaApplications.contactEmail), inArray(sql`lower(${betaApplications.contactEmail})`, emailSet)),
      ...domains.map((d) => sql`lower(${betaApplications.contactEmail}) LIKE ${"%@" + likeEsc(d)}`),
      ...words.map((w) => sql`lower(${betaApplications.churchName}) LIKE ${"%" + likeEsc(w) + "%"}`),
    ))
    .orderBy(desc(betaApplications.createdAt))
    .limit(50);
  return bestApplicationMatch(rows as ApplicationRow[], {
    userEmail: user.email, userName: user.name, memberEmails, churchName: church.name, city: church.city, country: church.country,
  });
}

/**
 * Starting context for Sarah. Only setup-relevant fields leave this function and,
 * via applicationMatch, only when an identity signal ties the application to this
 * church — never ip, user agent, phone, or other answers.
 */
export async function loadSetupContextCore(
  db: Db, user: { email: string; name?: string; churchId: string },
): Promise<SetupContext> {
  const match = await findMatch(db, user);
  let profile: AudioSetupProfile = {};
  let profileAvailable = true;
  try {
    const [row] = await db.select({ profile: churchAudioProfiles.profile }).from(churchAudioProfiles)
      .where(eq(churchAudioProfiles.churchId, user.churchId)).limit(1);
    profile = sanitizeProfile(row?.profile);
  } catch (e) {
    if (!isMissingProfilesTable(e)) throw e;
    profileAvailable = false;
  }
  return { match, profile, profileAvailable };
}

/**
 * Save the church's audio profile. `confirmedApplicationId` is only stored when the
 * server's OWN match for this church returns that id with an identity signal — a
 * client can't attach itself to another church's application.
 */
export async function saveAudioProfileCore(
  db: Db, user: { id: string; email: string; name?: string; churchId: string }, rawProfile: unknown, confirmedApplicationId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = sanitizeProfile(rawProfile);
  let appId: string | null = null;
  if (confirmedApplicationId) {
    const m = await findMatch(db, user);
    if (m && m.identityMatched && m.applicationId === confirmedApplicationId) appId = m.applicationId;
  }
  try {
    await db.insert(churchAudioProfiles)
      .values({ churchId: user.churchId, profile, confirmedApplicationId: appId, updatedByUserId: user.id })
      .onConflictDoUpdate({
        target: churchAudioProfiles.churchId,
        set: { profile, confirmedApplicationId: appId, updatedByUserId: user.id, updatedAt: sql`now()` },
      });
    return { ok: true };
  } catch (e) {
    if (isMissingProfilesTable(e)) return { ok: false, error: "Audio profile storage isn't set up yet" };
    throw e;
  }
}
