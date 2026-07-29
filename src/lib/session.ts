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

// Throttle map for lastActiveAt bumps — one write per user per LAST_ACTIVE_TTL.
// Per-Vercel-instance memory is fine here: worst case a hot user is written to
// slightly more than once per TTL across instances; never fewer. No PII leaks,
// no cross-user state.
const LAST_ACTIVE_TTL_MS = 5 * 60 * 1000;
const lastActiveTouched = new Map<string, number>();

function touchLastActive(userId: string): void {
  const now = Date.now();
  const seen = lastActiveTouched.get(userId);
  if (seen && now - seen < LAST_ACTIVE_TTL_MS) return;
  lastActiveTouched.set(userId, now);
  // Fire-and-forget — no await. A failed bump on a bad-DB blip just means
  // the timestamp lags a bit; nothing user-visible breaks.
  const db = getDb();
  db.update(users).set({ lastActiveAt: new Date(now) }).where(eq(users.id, userId))
    .catch(() => { /* ignore */ });
}

async function resolvePartialUser(): Promise<PartialUser | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) return null;
  touchLastActive(row.id);
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
 * Role hierarchy (most → least privileged):
 *  - admin      : everything, plus church settings + user management
 *  - operator   : run services, edit playlists, upload media, edit songs library
 *  - volunteer  : run services + view library, but CANNOT edit songs /
 *                 upload media / change themes / touch settings
 *  - pastor     : read-only view of sermon archive; cannot operate
 *  - viewer     : read-only across services, songs, and archive (broader
 *                 than pastor); cannot operate anything
 */
export type Role = "admin" | "operator" | "volunteer" | "pastor" | "viewer";

export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role as Role)) {
    // Redirect rather than 500. Not fatal — user might have picked a
    // link they shouldn't have seen.
    redirect("/dashboard?reason=insufficient-role");
  }
  return user;
}

export async function apiRequireRole(...roles: Role[]): Promise<CurrentUser | null> {
  const user = await resolveUser();
  if (!user) return null;
  if (!roles.includes(user.role as Role)) return null;
  return user;
}

/**
 * Capability checks — prefer these over enumerating roles in every action.
 * The mapping below is the SINGLE source of truth for what each role can
 * do. If we add or rename roles, update this map and every server action
 * automatically gets the correct behavior.
 */
export type Capability =
  | "manage_church"        // settings, branding, church profile
  | "manage_team"          // invite, remove, change roles
  | "manage_billing"       // Stripe portal, plan changes
  | "edit_library"         // create/edit/delete songs, upload media, edit themes
  | "operate_services"     // run services, fire slides live, use the operator console
  | "view_library"         // read songs, bible, media, themes
  | "view_archive";        // read sermon archive + summaries

const ROLE_CAPS: Record<Role, Capability[]> = {
  admin:     ["manage_church", "manage_team", "manage_billing", "edit_library", "operate_services", "view_library", "view_archive"],
  operator:  ["edit_library", "operate_services", "view_library", "view_archive"],
  volunteer: ["operate_services", "view_library", "view_archive"],
  pastor:    ["view_archive"],
  viewer:    ["view_library", "view_archive"],
};

export function hasCap(role: string, cap: Capability): boolean {
  return (ROLE_CAPS[role as Role] || []).includes(cap);
}

/**
 * requireCap — capability-based gate used by server actions instead of
 * hard-coded role lists. Same redirect semantics as requireRole. Prefer
 * this in new code so role additions don't require touching every
 * action.
 */
export async function requireCap(cap: Capability): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasCap(user.role, cap)) redirect("/dashboard?reason=insufficient-role");
  return user;
}
