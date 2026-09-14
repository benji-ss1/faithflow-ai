import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { churches, users } from "@/lib/db/schema";
import { normalizePairCode, formatPairCode } from "@/lib/desktop-auth-core";
import { LinkApproveForm } from "./LinkApproveForm";

export const dynamic = "force-dynamic";

// Web page the desktop app opens in the system browser: approve a computer to
// sign in as the account signed into THIS browser. Public in middleware so we
// can bounce to /login with a ?next= back to this exact code.
export default async function LinkDevicePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code: rawCode } = await searchParams;
  const code = normalizePairCode(rawCode ?? "");
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    const next = code ? `/link?code=${formatPairCode(code)}` : "/link";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  const db = getDb();
  const [me] = await db.select({ name: users.name, email: users.email, churchId: users.churchId }).from(users).where(eq(users.email, email)).limit(1);
  if (!me) redirect("/login");
  if (!me.churchId) redirect("/onboarding");
  const [church] = await db.select({ name: churches.name }).from(churches).where(eq(churches.id, me.churchId)).limit(1);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ maxWidth: 480, width: "100%", background: "#151515", border: "1px solid #2a2a2a", borderRadius: 14, padding: 28 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", opacity: 0.6, marginBottom: 10 }}>Desktop app</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 12px" }}>Sign in a computer</h1>
        <p style={{ opacity: 0.8, lineHeight: 1.5, margin: "0 0 18px" }}>
          The PresentFlow desktop app on that computer will be signed in as <strong>{me.email}</strong> for <strong>{church?.name ?? "your church"}</strong>.
        </p>
        <LinkApproveForm initialCode={code ? formatPairCode(code) : ""} />
        <p style={{ opacity: 0.55, fontSize: 12, lineHeight: 1.5, marginTop: 18 }}>
          Only approve a code that is showing on a computer in front of you. Never approve a code someone sent you.
        </p>
      </div>
    </div>
  );
}
