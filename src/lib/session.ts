import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth, signOut } from "./auth";
import { getDb } from "./db/client";
import { users } from "./db/schema";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  churchId: string;
  role: string;
};

export type PartialUser = { id: string; email: string; name: string; churchId: string | null; role: string; emailVerified: boolean };

async function resolvePartialUser(): Promise<PartialUser | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, churchId: row.churchId, role: row.role, emailVerified: !!row.emailVerifiedAt };
}

async function resolveUser(): Promise<CurrentUser | null> {
  const partial = await resolvePartialUser();
  if (!partial || !partial.churchId) return null;
  return { id: partial.id, email: partial.email, name: partial.name, churchId: partial.churchId, role: partial.role };
}

/**
 * For pages inside the onboarding flow: returns the partial user even when
 * churchId is null. Redirects to /login if there's no session at all.
 */
export async function requirePartialUser(): Promise<PartialUser> {
  const p = await resolvePartialUser();
  if (!p) redirect("/login");
  return p;
}

/**
 * For API route handlers. Returns null when the session is invalid or stale
 * (caller should return a 401). Never throws or redirects.
 */
export async function apiUser(): Promise<CurrentUser | null> {
  return resolveUser();
}

/**
 * Resolves the current authenticated user by re-reading the DB by email
 * (email is stable, the JWT is not — a DB reset can leave a stale JWT with
 * ids that no longer exist).  Every server action / RSC that needs the
 * user MUST go through this, so church_id is always current.
 *
 * If the session's email no longer maps to a user row, or the row has no
 * church_id, we clear the JWT and redirect to /login — never silently
 * return a stale id that would cascade into FK violations on writes.
 */
export async function requireUser(): Promise<CurrentUser> {
  const partial = await resolvePartialUser();
  if (!partial) {
    try { await signOut({ redirect: false }); } catch { /* ignore */ }
    redirect("/login?reason=stale-session");
  }
  // Signed up, but hasn't finished the onboarding wizard. Send them to the
  // church-details step (CP5) rather than into a protected route where
  // they'd hit missing-church errors on every write.
  if (!partial.churchId) redirect("/onboarding");
  return { id: partial.id, email: partial.email, name: partial.name, churchId: partial.churchId, role: partial.role };
}

/**
 * Enforce that the current user has one of the given roles. Throws (as a
 * plain error result — actions convert to { ok: false, error }) if not.
 *
 * Role hierarchy:
 *  - admin: everything, plus church settings + user management
 *  - operator: run services, edit playlists, upload media/songs
 *  - pastor: read-only view of sermon archive; cannot operate
 */
export async function requireRole(...roles: ("admin" | "operator" | "pastor")[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role as "admin" | "operator" | "pastor")) {
    // Redirect rather than 500. Not fatal — user might have picked a
    // link they shouldn't have seen.
    redirect("/dashboard?reason=insufficient-role");
  }
  return user;
}

export async function apiRequireRole(...roles: ("admin" | "operator" | "pastor")[]): Promise<CurrentUser | null> {
  const user = await resolveUser();
  if (!user) return null;
  if (!roles.includes(user.role as "admin" | "operator" | "pastor")) return null;
  return user;
}
