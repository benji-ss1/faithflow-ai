"use server";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { getDb } from "./db/client";
import { users } from "./db/schema";
import { issueAuthToken, consumeAuthToken } from "./auth-tokens";
import { sendVerificationEmail, sendPasswordResetEmail } from "./email";
import { createLimiter } from "./rate-limit";

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signUpLimiter = createLimiter("signup", 5, 60 * 60 * 1000);

async function checkSignUpRateLimit(): Promise<boolean> {
  let ip = "unknown";
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  } catch {
    return true;
  }
  return signUpLimiter(ip);
}

export async function signUp(input: { email: string; password: string; name: string }): Promise<Result<{ userId: string }>> {
  if (!(await checkSignUpRateLimit())) {
    return { ok: false, error: "Too many sign-up attempts from this network. Please wait an hour and try again." };
  }
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address" };
  if (input.password.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  if (!name) return { ok: false, error: "Name required" };

  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    // Non-enumerating response: don't say "email in use" — that's a user
    // enumeration vector. If the account already exists and isn't verified,
    // re-send the verification email so the honest user can proceed.
    if (!existing.emailVerifiedAt) {
      const token = await issueAuthToken(existing.id, "verify_email", 24 * 60 * 60 * 1000);
      await sendVerificationEmail(existing.email, existing.name, token);
    }
    return { ok: true, data: { userId: existing.id } };
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  // First user of a church becomes admin during onboarding. churchId is
  // NULL until the church-details step; requireUser() redirects to
  // /onboarding when churchId is null so no protected route ever sees a
  // half-set-up user.
  const [row] = await db.insert(users).values({
    email, passwordHash, name, role: "admin", churchId: null,
  }).returning();

  const token = await issueAuthToken(row.id, "verify_email", 24 * 60 * 60 * 1000);
  await sendVerificationEmail(row.email, row.name, token);
  return { ok: true, data: { userId: row.id } };
}

export async function verifyEmail(token: string): Promise<Result<{ userId: string }>> {
  const userId = await consumeAuthToken(token, "verify_email");
  if (!userId) return { ok: false, error: "This link is invalid or expired. Sign in and we'll send a fresh one." };
  const db = getDb();
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
  return { ok: true, data: { userId } };
}

export async function requestPasswordReset(email: string): Promise<Result> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return { ok: false, error: "Enter a valid email address" };
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  // Silent success on unknown email — don't reveal whether an account exists.
  if (!row) return { ok: true };
  const token = await issueAuthToken(row.id, "password_reset", 60 * 60 * 1000);
  await sendPasswordResetEmail(row.email, row.name, token);
  return { ok: true };
}

export async function resetPassword(token: string, newPassword: string): Promise<Result> {
  if (newPassword.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  const userId = await consumeAuthToken(token, "password_reset");
  if (!userId) return { ok: false, error: "This link is invalid or expired. Request a new one from the sign-in page." };
  const db = getDb();
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  return { ok: true };
}

export async function resendVerificationEmail(email: string): Promise<Result> {
  const normalized = email.trim().toLowerCase();
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (!row || row.emailVerifiedAt) return { ok: true }; // silent
  const token = await issueAuthToken(row.id, "verify_email", 24 * 60 * 60 * 1000);
  await sendVerificationEmail(row.email, row.name, token);
  return { ok: true };
}
