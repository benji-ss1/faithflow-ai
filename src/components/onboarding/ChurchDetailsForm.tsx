"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createChurchAndAttachUser } from "@/lib/onboarding-actions";

const TIMEZONES = ["UTC", "Europe/Dublin", "Europe/London", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Africa/Lagos", "Africa/Nairobi", "Asia/Manila", "Asia/Singapore", "Australia/Sydney"];

// CP5 church-details step. Server action `createChurchAndAttachUser` inserts
// the churches row + attaches the user + sets onboardingStatus=in_progress.
// After success we advance to /onboarding/migration.
export function ChurchDetailsForm() {
  const router = useRouter();
  const [state, setState] = useState({
    name: "", city: "", country: "", timezone: "UTC",
    congregationSize: "", denomination: "", jobTitle: "",
    mode: "real" as "real" | "demo",
  });
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createChurchAndAttachUser({
        name: state.name,
        city: state.city,
        country: state.country,
        timezone: state.timezone,
        congregationSize: state.congregationSize ? Number(state.congregationSize) : undefined,
        denomination: state.denomination,
        jobTitle: state.jobTitle,
        isDemo: state.mode === "demo",
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(`${state.name} created`);
      router.push("/onboarding/migration");
    });
  }

  return (
    <form onSubmit={submit} className="border border-border rounded-md bg-card p-6 space-y-4">
      <header className="border-b border-border pb-3 mb-1 flex items-start gap-3">
        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Building2 className="w-4 h-4" />
        </div>
        <div>
          <div className="text-sm font-semibold">About your church</div>
          <div className="text-xs text-muted-foreground mt-0.5">All fields except name + timezone are optional.</div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <label className={cn(
          "border rounded-md p-3 cursor-pointer text-xs",
          state.mode === "real" ? "border-foreground bg-muted/40" : "border-border hover:bg-muted/20"
        )}>
          <input type="radio" name="mode" value="real" checked={state.mode === "real"}
            onChange={() => setState({ ...state, mode: "real" })} className="mr-2" />
          <span className="font-semibold">Real church</span>
          <div className="text-muted-foreground mt-1">Production tenant. Counts in analytics.</div>
        </label>
        <label className={cn(
          "border rounded-md p-3 cursor-pointer text-xs",
          state.mode === "demo" ? "border-foreground bg-muted/40" : "border-border hover:bg-muted/20"
        )}>
          <input type="radio" name="mode" value="demo" checked={state.mode === "demo"}
            onChange={() => setState({ ...state, mode: "demo" })} className="mr-2" />
          <span className="font-semibold">Demo / test tenant</span>
          <div className="text-muted-foreground mt-1">Flagged as demo. Excluded from production analytics.</div>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Church name" required>
          <input required value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} className="ff-input" />
        </Field>
        <Field label="City">
          <input value={state.city} onChange={(e) => setState({ ...state, city: e.target.value })} placeholder="Dublin" className="ff-input" />
        </Field>
        <Field label="Country">
          <input value={state.country} onChange={(e) => setState({ ...state, country: e.target.value })} placeholder="Ireland" className="ff-input" />
        </Field>
        <Field label="Timezone" required>
          <select required value={state.timezone} onChange={(e) => setState({ ...state, timezone: e.target.value })} className="ff-input">
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </Field>
        <Field label="Approx. congregation size">
          <input type="number" min={1} value={state.congregationSize} onChange={(e) => setState({ ...state, congregationSize: e.target.value })} placeholder="150" className="ff-input" />
        </Field>
        <Field label="Denomination">
          <input value={state.denomination} onChange={(e) => setState({ ...state, denomination: e.target.value })} placeholder="Non-denominational" className="ff-input" />
        </Field>
      </div>

      <div className="flex justify-end pt-2">
        <button type="submit" disabled={pending || !state.name.trim()}
          className="h-11 px-6 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">
          {pending ? "Creating…" : "Continue"} <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <style jsx>{`
        :global(.ff-input) {
          height: 36px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 6px;
          background: var(--color-background); font-size: 14px; width: 100%;
        }
      `}</style>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className={cn("block")}>
      <div className="text-xs font-semibold mb-1 flex items-center gap-1.5">{label}{required && <span className="text-destructive">*</span>}</div>
      {children}
    </label>
  );
}
