import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { users } from "./db/schema";
import { consumeAuthToken } from "./auth-tokens";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        if (!creds?.email || !creds?.password) return null;
        const db = getDb();
        const [user] = await db.select().from(users).where(eq(users.email, String(creds.email))).limit(1);
        if (!user) return null;
        const ok = await bcrypt.compare(String(creds.password), user.passwordHash);
        if (!ok) return null;
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
