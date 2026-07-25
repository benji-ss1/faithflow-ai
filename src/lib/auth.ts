import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { users } from "./db/schema";
import { consumeAuthToken } from "./auth-tokens";
import { createLimiter, createPeeker } from "./rate-limit";

// H1: brute-force protection on credentials login. Two axes — per-IP and
// per-email — so an attacker can neither grind one account from many IPs
// nor grind many accounts from one IP. Fail-only counting: successful
// logins do NOT consume the budget, so a legitimate user is never locked
// out by their own successful sessions.
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const chargeLoginIp = createLimiter("login-ip", LOGIN_LIMIT, LOGIN_WINDOW_MS);
const chargeLoginEmail = createLimiter("login-email", LOGIN_LIMIT, LOGIN_WINDOW_MS);
const peekLoginIp = createPeeker("login-ip", LOGIN_LIMIT);
const peekLoginEmail = createPeeker("login-email", LOGIN_LIMIT);

// Constant dummy hash of the same cost as real passwords. When the target
// email doesn't exist, we still run bcrypt.compare against this so timing
// doesn't reveal whether an account is registered. Generated with
// bcrypt.hash("__no_user__", 12) — value is inert.
const DUMMY_BCRYPT = "$2a$12$335D5UVYbxdTi0LCoKd1IuRaLuMq1vlTRH76Bzn/r2n6/LgEVSIgW";

function extractIp(request: Request | undefined): string {
  const h = request?.headers;
  if (!h) return "unknown";
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds, request) {
        if (!creds?.email || !creds?.password) return null;
        const email = String(creds.email).toLowerCase().trim();
        const ip = extractIp(request);

        // Pre-flight lockout check — peek only, no charge. A stream of
        // failures that trips the limit shouldn't extend the window with
        // every subsequent attempt.
        if (await peekLoginIp(ip)) return null;
        if (await peekLoginEmail(email)) return null;

        const db = getDb();
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        // Always run bcrypt.compare so unknown-email timing matches
        // known-email-wrong-password timing.
        const hash = user?.passwordHash ?? DUMMY_BCRYPT;
        const ok = await bcrypt.compare(String(creds.password), hash);

        if (!user || !ok) {
          // Charge both counters on failure only.
          await chargeLoginIp(ip);
          await chargeLoginEmail(email);
          return null;
        }

        // H2: fail-closed 2FA guard. schema has totpSecret + totpEnabled
        // but the TOTP challenge UI hasn't shipped. If a user record ever
        // has totpEnabled=true, refuse password-only login rather than
        // silently ignoring the flag — that would be a false-safety signal
        // to any admin who enrolled 2FA out-of-band.
        if (user.totpEnabled) return null;

        return { id: user.id, email: user.email, name: user.name, churchId: user.churchId, role: user.role };
      },
    }),
    // Desktop-app auto-login: exchanges a one-time device-link token (minted
    // from the website's download page, see device-link-actions.ts) for a
    // real session — no email/password re-entry inside the Electron window.
    Credentials({
      id: "device-token",
      name: "Device link",
      credentials: { token: {} },
      async authorize(creds) {
        if (!creds?.token) return null;
        const userId = await consumeAuthToken(String(creds.token), "device_link");
        if (!userId) return null;
        const db = getDb();
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name, churchId: user.churchId, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        // Initial sign-in — populate from the authorize() return value.
        token.uid = (user as { id: string }).id;
        token.churchId = (user as { churchId: string }).churchId;
        token.role = (user as { role: string }).role;
        token.refreshedAt = Date.now();
        return token;
      }
      // Refresh path: on explicit `session.update()` OR every 5 minutes,
      // re-select role/churchId from the DB so a removed teammate or
      // demoted admin can't keep operating on a stale session.
      // requireUser() already re-reads by email server-side, but any
      // client-visible session.user.role/churchId still lied until now.
      const REFRESH_MS = 5 * 60 * 1000;
      const stale = !token.refreshedAt || Date.now() - Number(token.refreshedAt) > REFRESH_MS;
      if (trigger === "update" || stale) {
        try {
          const uid = token.uid as string | undefined;
          if (uid) {
            const db = getDb();
            const [row] = await db
              .select({ churchId: users.churchId, role: users.role })
              .from(users)
              .where(eq(users.id, uid))
              .limit(1);
            if (row) {
              token.churchId = row.churchId;
              token.role = row.role;
            }
            token.refreshedAt = Date.now();
          }
        } catch {
          // On DB blip, don't nuke the session — just skip refresh; next
          // apiUser() call still refetches by email as the authoritative check.
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.uid as string;
        (session.user as { churchId?: string }).churchId = token.churchId as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
});
