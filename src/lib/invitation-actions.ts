"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, gte } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getDb } from "./db/client";
import { invitations, users, churches } from "./db/schema";
import { requireRole } from "./session";
import { mintToken, hashToken } from "./auth-tokens";
import { sendInvitationEmail } from "./email";

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

export async function inviteTeammate(input: { email: string; role: "admin" | "operator" | "pastor" }): Promise<Result> {
  const admin = await requireRole("admin");
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Invalid email" };
  const db = getDb();

  // Already in this church?
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing?.churchId === admin.churchId) return { ok: false, error: "That user is already in your church" };
  if (existing && existing.churchId && existing.churchId !== admin.churchId) return { ok: false, error: "That email belongs to another church" };

  const { plaintext, hash } = mintToken();
  await db.insert(invitations).values({
    churchId: admin.churchId,
    invitedByUserId: admin.id,
    email,
    role: input.role,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  const [church] = await db.select().from(churches).where(eq(churches.id, admin.churchId)).limit(1);
  await sendInvitationEmail(email, admin.name, church?.name || "your church", plaintext);
  revalidatePath("/settings/team");
  return { ok: true };
}

export async function revokeInvitation(id: string): Promise<Result> {
  const admin = await requireRole("admin");
  const db = getDb();
  await db.delete(invitations).where(and(eq(invitations.id, id), eq(invitations.churchId, admin.churchId)));
  revalidatePath("/settings/team");
  return { ok: true };
}

export async function updateTeammateRole(userId: string, role: "admin" | "operator" | "pastor"): Promise<Result> {
  const admin = await requireRole("admin");
  const db = getDb();
  const [target] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.churchId, admin.churchId))).limit(1);
  if (!target) return { ok: false, error: "User not found" };
  if (target.id === admin.id && role !== "admin") return { ok: false, error: "You cannot demote yourself" };
  // TOCTOU defense: repeat the churchId check in the UPDATE WHERE. Without
  // it, a race window between the select above and this update could see the
  // target re-attached to another church, letting admin A mutate a user now
  // belonging to church B. rowsAffected check surfaces the race explicitly.
  const upd = await db.update(users).set({ role })
    .where(and(eq(users.id, userId), eq(users.churchId, admin.churchId)));
  if ((upd as { rowCount?: number }).rowCount === 0) {
    return { ok: false, error: "User has moved to a different church — refresh and try again" };
  }
  revalidatePath("/settings/team");
  return { ok: true };
}

export async function removeTeammate(userId: string): Promise<Result> {
  const admin = await requireRole("admin");
  if (userId === admin.id) return { ok: false, error: "You cannot remove yourself" };
  const db = getDb();
  const [target] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.churchId, admin.churchId))).limit(1);
  if (!target) return { ok: false, error: "User not found" };
  // Detach rather than hard delete — preserves audit trail on transcripts,
  // sermon summaries, etc. Same TOCTOU-hardened WHERE as updateTeammateRole.
  const upd = await db.update(users).set({ churchId: null, role: "operator" })
    .where(and(eq(users.id, userId), eq(users.churchId, admin.churchId)));
  if ((upd as { rowCount?: number }).rowCount === 0) {
    return { ok: false, error: "User has moved to a different church — refresh and try again" };
  }
  revalidatePath("/settings/team");
  return { ok: true };
}

// Accept-invite flow (public endpoint) --------------------------------------
export async function acceptInvitation(input: { token: string; name: string; password: string }): Promise<Result<{ email: string }>> {
  const db = getDb();
  const hash = hashToken(input.token);
  const [inv] = await db.select().from(invitations).where(and(
    eq(invitations.tokenHash, hash),
    isNull(invitations.acceptedAt),
    gte(invitations.expiresAt, new Date()),
  )).limit(1);
  if (!inv) return { ok: false, error: "Invitation is invalid or expired" };

  if (input.password.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  if (!input.name.trim()) return { ok: false, error: "Name required" };

  const passwordHash = await bcrypt.hash(input.password, 12);
  const [existing] = await db.select().from(users).where(eq(users.email, inv.email)).limit(1);
  if (existing) {
    // Already has an account — attach + set role.
    await db.update(users).set({ churchId: inv.churchId, role: inv.role, emailVerifiedAt: new Date() }).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({
      email: inv.email, name: input.name.trim(), passwordHash,
      churchId: inv.churchId, role: inv.role, emailVerifiedAt: new Date(),
    });
  }
  await db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
  return { ok: true, data: { email: inv.email } };
}
