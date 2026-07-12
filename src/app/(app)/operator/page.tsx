import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { CalendarClock, PlayCircle, Plus } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { churches, servicePlans } from "@/lib/db/schema";
import { getTodayInChurchTz } from "@/lib/dates";
import { OfflineState } from "./OfflineState";

// Desktop landing surface. If a service is scheduled for today (in the
// church's local timezone), jump straight into the operator console for it.
// Otherwise render a calm "ready to present" empty state — the operator
// sidebar handles all navigation. Wrapped in try/catch so a DB outage renders
// a friendly retry surface instead of a blank 500.
export default async function OperatorLandingPage() {
  const user = await requireUser();
  const db = getDb();

  let church: { timezone: string | null } | null = null;
  let plans: Array<{ id: string; title: string; scheduledFor: unknown }> = [];
  try {
    church = await db
      .select({ timezone: churches.timezone })
      .from(churches)
      .where(eq(churches.id, user.churchId))
      .limit(1)
      .then((rows) => rows[0] || null);

    plans = await db
      .select({
        id: servicePlans.id,
        title: servicePlans.title,
        scheduledFor: servicePlans.scheduledFor,
      })
      .from(servicePlans)
      .where(eq(servicePlans.churchId, user.churchId));
  } catch (err) {
    console.error("[operator] db read failed", err);
    return <OfflineState />;
  }

  const todayKey = getTodayInChurchTz(church?.timezone);

  // Multi-service same-day: no time-of-day column exists on service_plans
  // today (schema only has date `scheduled_for`). Pick the smallest id for
  // deterministic behavior. If a time column is added later, prefer nearest
  // to `now` in the church tz. Follow-up recorded in DECISIONS.md.
  const todaysPlans = plans
    .filter((p) => String(p.scheduledFor) === todayKey)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const todaysPlan = todaysPlans[0] || null;
  if (todaysPlan) redirect(`/services/${todaysPlan.id}/operate`);

  const upcoming = plans
    .filter((p) => !!p.scheduledFor && String(p.scheduledFor) > todayKey)
    .sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)))
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-10 shadow-[0_28px_80px_rgba(0,0,0,0.28)]">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[rgba(111,224,194,0.28)] bg-[rgba(111,224,194,0.08)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-primary)]">
          Ready to present
        </div>
        <h1 className="text-2xl font-semibold text-foreground">No service scheduled for today.</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          When a service is on the calendar for today, this screen jumps straight into the operator console.
          For now, open a plan below or use the sidebar to prepare content.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/services"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-foreground hover:bg-white/[0.08]"
          >
            <CalendarClock className="h-4 w-4" /> Open services
          </Link>
          <Link
            href="/services/new"
            className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(111,224,194,0.28)] bg-[rgba(111,224,194,0.10)] px-4 py-2 text-sm font-semibold text-[var(--color-primary)] hover:bg-[rgba(111,224,194,0.18)]"
          >
            <Plus className="h-4 w-4" /> New service plan
          </Link>
        </div>

        {upcoming.length ? (
          <div className="mt-10">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Upcoming</div>
            <ul className="mt-3 space-y-2">
              {upcoming.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/services/${p.id}/operate`}
                    className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 text-sm hover:border-white/16 hover:bg-white/[0.05]"
                  >
                    <span className="min-w-0 flex-1 truncate text-foreground">{p.title}</span>
                    <span className="ml-4 shrink-0 text-xs text-muted-foreground">{String(p.scheduledFor)}</span>
                    <PlayCircle className="ml-3 h-4 w-4 text-[var(--color-primary)]" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
