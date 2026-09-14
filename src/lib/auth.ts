import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { users } from "./db/schema";
import { exchangeDeviceLinkToken } from "./auth-tokens";
import { sessionTokenVerdict } from "./desktop-auth-core";
import { InvalidCredentialsError, RateLimitedError, chargeLoginAttempt, clientIpFromHeaders, refundLoginSuccess } from "./login-guard";

// H1 brute-force protection lives in login-guard.ts (per-IP 30, per-email 5,
// per-IP+email 5, charge-first, success refunds/clears).

// Constant dummy hash of the same cost as real passwords. When the target
// email doesn't exist, we still run bcrypt.compare against this so timing
// doesn't reveal whether an account is registered. Generated with
// bcrypt.hash("__no_user__", 12) — value is inert.
const DUMMY_BCRYPT = "$2a$12$335D5UVYbxdTi0LCoKd1IuRaLuMq1vlTRH76Bzn/r2n6/LgEVSIgW";

function extractIp(request: Request | undefined): string {
  // x-vercel-forwarded-for → x-real-ip → first x-forwarded-for → "unknown".
  return clientIpFromHeaders(request?.headers);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Rolling 90-day sessions: every GET /api/auth/session (SessionKeepAlive,
  // mounted in the app shell + operator) re-signs the JWT with a fresh 90-day
  // expiry, so an active church never gets signed out. updateAge is advisory
  // for JWT sessions (Auth.js re-issues on each session read) but documents
  // intent. Was the 30-day default with no refresh path.
  session: { strategy: "jwt", maxAge: 90 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds, request) {
        if (!creds?.email || !creds?.password) return null;
        const email = String(creds.email).toLowerCase().trim();
        const ip = extractIp(request);
        // Oversized input: reject BEFORE charging so junk can't grow the map
        // (RFC 5321 max address 254; bcrypt only reads 72 bytes anyway).
        if (email.length > 254 || String(creds.password).length > 1024) throw new InvalidCredentialsError();

        // CHARGE-FIRST: synchronous check-and-increment of all three buckets
        // BEFORE any await (DB/bcrypt), so parallel requests can't all pass
        // the check. A locked attempt is not charged (doesn't extend window).
        const lockedMin = chargeLoginAttempt(ip, email);
        if (lockedMin !== null) throw new RateLimitedError(lockedMin);

        const db = getDb();
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        // Always run bcrypt.compare so unknown-email timing matches
        // known-email-wrong-password timing.
        const hash = user?.passwordHash ?? DUMMY_BCRYPT;
        const ok = await bcrypt.compare(String(creds.password), hash);

        // Failure: already charged above.
        if (!user || !ok) throw new InvalidCredentialsError();

        // H2: fail-closed 2FA guard. schema has totpSecret + totpEnabled
        // but the TOTP challenge UI hasn't shipped. If a user record ever
        // has totpEnabled=true, refuse password-only login rather than
        // silently ignoring the flag — that would be a false-safety signal
        // to any admin who enrolled 2FA out-of-band.
        // Throws the SAME error as a wrong password (and keeps the charge),
        // so the response can't be used as a password-correctness oracle.
        if (user.totpEnabled) throw new InvalidCredentialsError();

        refundLoginSuccess(ip, email);

        return { id: user.id, email: user.email, name: user.name, churchId: user.churchId, role: user.role, sessionVersion: user.sessionVersion };
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
        // Burn + session_version read are atomic (see exchangeDeviceLinkToken).
        const user = await exchangeDeviceLinkToken(String(creds.token));
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name, churchId: user.churchId, role: user.role, sessionVersion: user.sessionVersion };
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
        // Revocation + absolute-lifetime anchors (see sessionTokenVerdict).
        token.sv = Number((user as { sessionVersion?: number }).sessionVersion ?? 0);
        token.authTime = Date.now();
        token.refreshedAt = Date.now();
        return token;
      }
      // Absolute cap: rolling refresh never extends past 180 days from the
      // ORIGINAL sign-in. Checked every call (no DB). Returning null ends the session.
      if (sessionTokenVerdict({ authTime: token.authTime }) === "expired") return null;
      // Legacy (pre-hardening) tokens: start the 180-day clock now.
      if (token.authTime === undefined) token.authTime = Date.now();
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
              .select({ churchId: users.churchId, role: users.role, sessionVersion: users.sessionVersion })
              .from(users)
              .where(eq(users.id, uid))
              .limit(1);
            // "Sign out all devices" / password reset bumped the version → end this session.
            if (row && sessionTokenVerdict({ authTime: token.authTime, tokenVersion: token.sv, dbVersion: row.sessionVersion }) !== "ok") {
              return null;
            }
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
