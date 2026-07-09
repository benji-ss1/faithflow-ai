"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, ChevronLeft, Mail, Building2, Upload, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { createChurchAndAttachUser, completeOnboarding } from "@/lib/onboarding-actions";
import { resendVerificationEmail } from "@/lib/auth-actions";
import { MigrationStep } from "./MigrationStep";

type Step = "verify" | "church" | "migrate" | "checklist";

const TIMEZONES = ["UTC", "Europe/Dublin", "Europe/London", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Africa/Lagos", "Africa/Nairobi", "Asia/Manila", "Asia/Singapore", "Australia/Sydney"];

export function OnboardingWizard({ userName, userEmail, hasChurch, emailVerified }: { userName: string; userEmail: string; hasChurch: boolean; emailVerified: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(
    !emailVerified ? "verify" :
    !hasChurch ? "church" :
    "migrate"
  );
  const [churchDetails, setChurchDetails] = useState({
    name: "", city: "", country: "", timezone: "UTC",
    congregationSize: "", denomination: "", jobTitle: "",
  });
  const [pending, startTransition] = useTransition();

  function submitChurch(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createChurchAndAttachUser({
        name: churchDetails.name,
        city: churchDetails.city,
        country: churchDetails.country,
        timezone: churchDetails.timezone,
        congregationSize: churchDetails.congregationSize ? Number(churchDetails.congregationSize) : undefined,
        denomination: churchDetails.denomination,
        jobTitle: churchDetails.jobTitle,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(`${churchDetails.name} created`);
      setStep("migrate");
    });
  }

  function finish() {
    startTransition(async () => {
      const res = await completeOnboarding();
      if (!res.ok) { toast.error(res.error); return; }
      router.push("/dashboard");
    });
  }

  return (
    <div className="min-h-screen bg-background flex items-start justify-center py-10 px-6">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div>
          <div className="eyebrow text-muted-foreground mb-1">Getting set up</div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display">Welcome, {userName.split(" ")[0]}</h1>
          <p className="text-sm text-muted-foreground mt-1">Four short steps and you'll be running your first service plan.</p>
        </div>

        {/* Step indicators */}
        <StepBar current={step} hasChurch={hasChurch} emailVerified={emailVerified} />

        {/* Steps */}
        {step === "verify" && <VerifyStep userEmail={userEmail} onSkip={() => setStep("church")} />}

        {step === "church" && (
          <form onSubmit={submitChurch} className="border border-border rounded-md bg-card p-6 space-y-4">
            <StepHeader icon={<Building2 className="w-4 h-4" />} title="About your church"
              description="These details help us set up the right defaults and let us tailor the AI to how you actually run services." />

            <div className="grid grid-cols-2 gap-3">
              <Field label="Church name" required>
                <input required value={churchDetails.name} onChange={(e) => setChurchDetails({ ...churchDetails, name: e.target.value })}
                  className="input" />
              </Field>
              <Field label="City" hint="Used for scheduling context">
                <input value={churchDetails.city} onChange={(e) => setChurchDetails({ ...churchDetails, city: e.target.value })}
                  placeholder="Dublin" className="input" />
              </Field>
              <Field label="Country">
                <input value={churchDetails.country} onChange={(e) => setChurchDetails({ ...churchDetails, country: e.target.value })}
                  placeholder="Ireland" className="input" />
              </Field>
              <Field label="Timezone" required>
                <select required value={churchDetails.timezone} onChange={(e) => setChurchDetails({ ...churchDetails, timezone: e.target.value })}
                  className="input">
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </Field>
              <Field label="Approx. congregation size" hint="Rough estimate is fine">
                <input type="number" min={1} value={churchDetails.congregationSize} onChange={(e) => setChurchDetails({ ...churchDetails, congregationSize: e.target.value })}
                  placeholder="150" className="input" />
              </Field>
              <Field label="Denomination / tradition" hint="Optional">
                <input value={churchDetails.denomination} onChange={(e) => setChurchDetails({ ...churchDetails, denomination: e.target.value })}
                  placeholder="Non-denominational" className="input" />
              </Field>
              <Field label="Your role" hint="What are you day-to-day?" span={2}>
                <select value={churchDetails.jobTitle} onChange={(e) => setChurchDetails({ ...churchDetails, jobTitle: e.target.value })}
                  className="input">
                  <option value="">Select…</option>
                  <option value="pastor">Pastor</option>
                  <option value="media_team_lead">Media team lead</option>
                  <option value="volunteer_operator">Volunteer operator</option>
                  <option value="worship_leader">Worship leader</option>
                  <option value="other">Other</option>
                </select>
              </Field>
            </div>

            <div className="flex justify-end pt-2">
              <button type="submit" disabled={pending || !churchDetails.name.trim()}
                className="h-11 px-6 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">
                {pending ? "Creating…" : "Continue"} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}

        {step === "migrate" && <MigrationStep onNext={() => setStep("checklist")} onBack={() => setStep("church")} />}

        {step === "checklist" && (
          <div className="border border-border rounded-md bg-card p-6 space-y-4">
            <StepHeader icon={<Compass className="w-4 h-4" />} title="Ready to go"
              description="Quick things to check before your first service. All optional — you can circle back." />

            <ul className="space-y-2 text-sm">
              <ChecklistItem href="/settings" done={false}>Confirm your default Bible translation (KJV by default)</ChecklistItem>
              <ChecklistItem href="/services" done={false}>Create your first service plan</ChecklistItem>
              <ChecklistItem href="/library/songs" done={false}>Review the seeded public domain hymns</ChecklistItem>
              <ChecklistItem href="/services" done={false}>Run a test operator session (Operate → Open projector window → F for fullscreen)</ChecklistItem>
            </ul>

            <div className="flex justify-between pt-2">
              <button onClick={() => setStep("migrate")} className="h-11 px-4 border border-border rounded-md text-sm font-semibold hover:bg-accent flex items-center gap-1.5">
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <button onClick={finish} disabled={pending}
                className="h-11 px-6 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                {pending ? "Finishing…" : "Go to dashboard"}
              </button>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        :global(.input) {
          height: 36px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 6px;
          background: var(--color-background); font-size: 14px; width: 100%;
        }
      `}</style>
    </div>
  );
}

function StepBar({ current, hasChurch, emailVerified }: { current: Step; hasChurch: boolean; emailVerified: boolean }) {
  const steps: { key: Step; label: string; done: boolean }[] = [
    { key: "verify", label: "Verify email", done: emailVerified },
    { key: "church", label: "Church details", done: hasChurch },
    { key: "migrate", label: "Migrate library", done: false },
    { key: "checklist", label: "First run", done: false },
  ];
  const currentIdx = steps.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-1 text-xs">
      {steps.map((s, i) => {
        const active = i === currentIdx;
        const past = s.done || i < currentIdx;
        return (
          <li key={s.key} className="flex items-center gap-1 flex-1">
            <span className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-sm",
              active ? "bg-foreground text-background font-semibold" : past ? "text-success" : "text-muted-foreground"
            )}>
              {past ? <CheckCircle2 className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-current inline-block" />}
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="flex-1 h-px bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

function VerifyStep({ userEmail, onSkip }: { userEmail: string; onSkip: () => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="border border-border rounded-md bg-card p-6 space-y-4">
      <StepHeader icon={<Mail className="w-4 h-4" />} title="Confirm your email"
        description="We sent a link to your inbox. It expires in 24 hours. Once you click it, come back here." />
      <div className="text-sm">
        Sent to <span className="font-mono">{userEmail}</span>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => startTransition(async () => { const r = await resendVerificationEmail(userEmail); toast.info(r.ok ? "Sent — check your inbox" : "Sent"); })}
          disabled={pending}
          className="h-9 px-4 border border-border rounded-md text-sm font-semibold hover:bg-accent">
          Resend link
        </button>
        <button type="button" onClick={onSkip}
          className="h-9 px-4 text-sm font-semibold text-muted-foreground hover:text-foreground">
          Continue for now, verify later
        </button>
      </div>
    </div>
  );
}

function StepHeader({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <header className="border-b border-border pb-3 mb-1 flex items-start gap-3">
      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">{icon}</div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
    </header>
  );
}

function Field({ label, hint, required, span = 1, children }: { label: string; hint?: string; required?: boolean; span?: 1 | 2; children: React.ReactNode }) {
  return (
    <label className={cn("block", span === 2 && "col-span-2")}>
      <div className="text-xs font-semibold mb-1 flex items-center gap-1.5">{label}{required && <span className="text-destructive">*</span>}</div>
      {children}
      {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
    </label>
  );
}

function ChecklistItem({ href, done, children }: { href: string; done: boolean; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className={cn(
        "flex items-center gap-2 p-2 rounded-sm border transition-all",
        done ? "border-success/30 bg-success/5 text-success" : "border-border hover:bg-accent"
      )}>
        {done ? <CheckCircle2 className="w-4 h-4" /> : <span className="w-4 h-4 rounded-full border border-current inline-block shrink-0" />}
        <span className="flex-1">{children}</span>
        <ChevronRight className="w-3 h-3 text-muted-foreground" />
      </Link>
    </li>
  );
}
