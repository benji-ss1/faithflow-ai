import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser, requirePartialUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { churches, users } from "@/lib/db/schema";
import { mintDeviceLinkToken } from "@/lib/device-link-actions";
import { DesktopDownloadPanel } from "@/components/settings/DesktopDownloadPanel";

export const dynamic = "force-dynamic";

// Reaching this page means the church has walked the wizard to its final step,
// so mark onboarding complete HERE. This is the critical fix for the desktop
// first-run: if the account is still "in_progress" when they install and launch
// the .exe, the (app) layout bounces them to /onboarding and (before the
// middleware universal-allow fix) they dead-looped. Completing now guarantees a
// fresh Windows install boots straight into /operator. Done inline (not via the
// completeOnboarding server action) because that action calls revalidatePath(),
// which throws when invoked during a server-component render. Idempotent +
// church-scoped, mirroring completeOnboarding() exactly.
async function markOnboardingCompleteOnFinalStep(): Promise<void> {
  try {
    const partial = await requirePartialUser();
    if (!partial.churchId) return;
    const db = getDb();
    await db.update(churches).set({ onboardingStatus: "complete" }).where(eq(churches.id, partial.churchId));
    await db.update(users).set({ tutorialCompletedAt: new Date() }).where(eq(users.id, partial.id));
  } catch {
    // Never block the download page on a completion write — the middleware
    // universal-allow fix already prevents the dead-loop as a safety net.
  }
}

export default async function OnboardingDownloadPage() {
  await requireUser();
  await markOnboardingCompleteOnFinalStep();
  // Minted fresh on every page load (5 min TTL) — if the user sits on this
  // page a while before clicking, they can just refresh for a new one.
  const link = await mintDeviceLinkToken();
  const deepLinkHref = link.ok ? `presentflow://auth?token=${encodeURIComponent(link.token)}` : null;
  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 640, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", opacity: 0.6, marginBottom: 12 }}>
          Final step
        </div>
        <h1 style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1, marginBottom: 16, background: "linear-gradient(90deg,#ffb861,#e8501a)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Download Present Flow for your computer
        </h1>
        <p style={{ opacity: 0.8, fontSize: 17, lineHeight: 1.5, marginBottom: 32 }}>
          Your workspace is ready. The Present Flow desktop app is where you run live services — projector output, stage display, real-time AI detection, and Bible panel all run locally on your church's computer.
        </p>

        <DesktopDownloadPanel deepLinkHref={deepLinkHref} />

        <Link
          href="/dashboard"
          style={{ color: "#ffb861", textDecoration: "underline", fontSize: 14 }}
        >
          Skip for now — take me to the web dashboard
        </Link>
      </div>
    </div>
  );
}
