import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requirePartialUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { settings, users } from "@/lib/db/schema";
import { presignGet } from "@/lib/s3";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export default async function OnboardingPage() {
  const partial = await requirePartialUser();

  // F4 (Phase 3B security): block unverified users from entering the wizard.
  // The wizard creates a church and (in step 4) fires teammate-invite emails
  // via Resend on our shared allowance — burner-email signups spamming
  // invites is a real cost/reputation surface. /verify-email will bounce
  // them back here on success via the ?after=onboarding hint.
  if (!partial.emailVerified) {
    redirect("/verify-email?after=onboarding");
  }

  // Reviewer 🟡 (Phase 3B): a returning user (church already attached) enters
  // the wizard at the branding step. Fetch their existing logo so the
  // ChurchBrandingUploader shows the current image instead of an empty
  // dropzone. First-run users have no church yet → no settings row → null.
  let initialLogoUrl: string | null = null;
  let hasChurch = false;
  if (partial.churchId) {
    hasChurch = true;
    const db = getDb();
    const [display] = await db
      .select({ logoS3Key: settings.logoS3Key })
      .from(settings)
      .where(eq(settings.churchId, partial.churchId))
      .limit(1);
    // Belt-and-braces: also check user's role — if they somehow landed here
    // as a non-admin (invited operator/pastor whose church is mid-onboarding),
    // the (app) layout gate should have skipped them here per its own role
    // check, but defense-in-depth in case that gate is bypassed.
    const [me] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, partial.id))
      .limit(1);
    if (me && me.role !== "admin") {
      redirect("/dashboard");
    }
    initialLogoUrl = display?.logoS3Key ? await presignGet(display.logoS3Key) : null;
  }

  return (
    <OnboardingWizard
      userName={partial.name}
      userEmail={partial.email}
      hasChurch={hasChurch}
      emailVerified={partial.emailVerified}
      initialLogoUrl={initialLogoUrl}
    />
  );
}
