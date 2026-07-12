import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "./db/client";
import { users } from "./db/schema";
import { createLimiter } from "./rate-limit";

const signinLimiter = createLimiter("signin", 5, 15 * 60_000);

// Precomputed bcrypt hash of a random constant, used to equalize timing
// on the "user not found" path so an attacker cannot enumerate accounts
// by measuring response time. Cost 12 to match issueAuthToken hashing.
const DUMMY_BCRYPT_HASH = "$2b$12$abcdefghijklmnopqrstuu9pT8sZs.h/zXPvMz2RRJcYq5jZo1Z8m";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        if (!creds?.email || !creds?.password) return null;
        const email = String(creds.email).toLowerCase().trim();
        let ip = "unknown";
        try {
          const h = await headers();
          ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
        } catch {}
        const allowed = await signinLimiter(`${email}|${ip}`);
        if (!allowed) {
          // Log lockouts so ops can distinguish "user forgot password" from
          // "credential-stuffing attack in progress". NextAuth surfaces the
          // same "invalid credentials" toast either way — that's fine, we
          // don't want to reveal the lockout to an attacker.
          console.warn("[auth] signin rate-limit hit", { email, ip });
          return null;
        }
        const db = getDb();
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user) {
          // Equalize timing with the "user found + wrong password" path so
          // response time cannot be used to enumerate accounts.
          await bcrypt.compare(String(creds.password), DUMMY_BCRYPT_HASH);
          return null;
        }
        const ok = await bcrypt.compare(String(creds.password), user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name, churchId: user.churchId, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = (user as { id: string }).id;
        token.churchId = (user as { churchId: string }).churchId;
        token.role = (user as { role: string }).role;
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
