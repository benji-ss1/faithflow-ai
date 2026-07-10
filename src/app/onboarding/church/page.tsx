import { redirect } from "next/navigation";
import { requirePartialUser } from "@/lib/session";
import { ChurchDetailsForm } from "@/components/onboarding/ChurchDetailsForm";

// CP5: dedicated route for church-details capture. If the user already has a
// churchId, we bounce them into whichever onboarding step still needs
// attention (or the dashboard if fully set up).
export default async function OnboardingChurchPage() {
  const partial = await requirePartialUser();
  if (partial.churchId) redirect("/onboarding/migration");

  return (
    <div className="min-h-screen bg-background flex items-start justify-center py-10 px-6">
      <div className="w-full max-w-2xl space-y-6">
        <div>
          <div className="eyebrow text-muted-foreground mb-1">Step 1 of 3 · Getting set up</div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display">Tell us about your church, {partial.name.split(" ")[0]}</h1>
          <p className="text-sm text-muted-foreground mt-1">These details set the right defaults. You can edit any of this later from Settings.</p>
        </div>
        <ChurchDetailsForm />
      </div>
    </div>
  );
}
