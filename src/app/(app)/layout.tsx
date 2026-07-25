import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { churches, settings, users } from "@/lib/db/schema";
import { presignGet } from "@/lib/s3";
import { AppShell } from "@/components/layout/AppShell";
import { TourGate } from "@/components/tutorial/TourGate";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Y6: server-side shell hint — read the pf_shell cookie (set by middleware
  // when the desktop app loads with ?ff_shell=desktop) or the x-pf-shell
  // header (injected by Electron webRequest). Pass to AppShell so SSR emits
  // the correct chrome on first paint.
  const cookieStore = await cookies();
  const hdrs = await headers();
  const initialShell: "desktop" | "web" =
    cookieStore.get("pf_shell")?.value === "desktop" || hdrs.get("x-pf-shell") === "desktop"
      ? "desktop"
      : "web";
  const db = getDb();
  const [church] = await db.select({ name: churches.name, onboardingStatus: churches.onboardingStatus })
    .from(churches).where(eq(churches.id, user.churchId)).limit(1);
  const [me] = await db.select({ tutorialCompletedAt: users.tutorialCompletedAt }).from(users).where(eq(users.id, user.id)).limit(1);
  const [display] = await db.select({ logoS3Key: settings.logoS3Key }).from(settings).where(eq(settings.churchId, user.churchId)).limit(1);
  const churchLogoUrl = display?.logoS3Key ? await presignGet(display.logoS3Key) : null;
  // CP5 guarded redirect: if the church is mid-onboarding AND the user hasn't
  // dismissed the tutorial yet, funnel them into /onboarding/tutorial. Once
  // the tutorial is completed OR skipped, tutorialCompletedAt is stamped and
  // onboardingStatus becomes "complete"/"skipped" — full app access. This
  // never loops because /onboarding/* is outside the (app) route group.
  if (
    church &&
    (church.onboardingStatus === "pending" || church.onboardingStatus === "in_progress") &&
    !me?.tutorialCompletedAt
  ) {
    redirect("/onboarding");
  }
  const showTour = !me?.tutorialCompletedAt;
  return (
    <div className="min-h-screen bg-background">
      <AppShell
        user={{ name: user.name, email: user.email }}
        churchName={church?.name || "PresentFlow Church"}
        churchLogoUrl={churchLogoUrl}
        initialShell={initialShell}
      >
        {children}
      </AppShell>
      <TourGate show={showTour} />
    </div>
  );
}
