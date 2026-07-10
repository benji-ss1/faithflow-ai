import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requirePartialUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { churches } from "@/lib/db/schema";
import { OnboardingMigrationClient } from "@/components/onboarding/OnboardingMigrationClient";

// CP5: onboarding migration step. Wraps the same wizard flow as
// /library/imports/wizard so churches follow one battle-tested code path.
// "Skip" and "Continue" both advance to /onboarding/tutorial without gating.
export default async function OnboardingMigrationPage() {
  const partial = await requirePartialUser();
  if (!partial.churchId) redirect("/onboarding/church");

  const db = getDb();
  const [ch] = await db.select({ status: churches.onboardingStatus }).from(churches).where(eq(churches.id, partial.churchId)).limit(1);
  if (ch?.status === "complete" || ch?.status === "skipped") {
    // User is coming back to redo migration — allow it, no forced redirect.
  }

  return (
    <div className="min-h-screen bg-background flex items-start justify-center py-10 px-6">
      <div className="w-full max-w-3xl space-y-6">
        <div>
          <div className="eyebrow text-muted-foreground mb-1">Step 2 of 3 · Getting set up</div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display">Bring your library</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Import songs and media from your current worship platform, or skip this if you&apos;re starting fresh.
          </p>
        </div>
        <OnboardingMigrationClient />
      </div>
    </div>
  );
}
