import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { churches, mediaAssets, migrationJobs, sermonSummaries, servicePlans, songs, subscriptions, users } from "@/lib/db/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { DashboardCard, StatusPill } from "@/components/dashboard/DashboardCard";

export default async function DashboardPage() {
  const user = await requireUser();
  const db = getDb();

  const [church] = await db.select().from(churches).where(eq(churches.id, user.churchId)).limit(1);
  const [plans, songRows, mediaRows, archiveRows, teamRows, importRows, sub] = await Promise.all([
    db.select().from(servicePlans).where(eq(servicePlans.churchId, user.churchId)),
    db.select().from(songs).where(eq(songs.churchId, user.churchId)),
    db.select().from(mediaAssets).where(eq(mediaAssets.churchId, user.churchId)),
    db.select().from(sermonSummaries).innerJoin(servicePlans, eq(sermonSummaries.servicePlanId, servicePlans.id)).where(eq(servicePlans.churchId, user.churchId)),
    db.select().from(users).where(eq(users.churchId, user.churchId)),
    db.select().from(migrationJobs).where(eq(migrationJobs.churchId, user.churchId)),
    db.select().from(subscriptions).where(eq(subscriptions.churchId, user.churchId)).limit(1).then((rows) => rows[0] || null),
  ]);

  const recentPlans = [...plans].sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0)).slice(0, 4);
  const openImports = importRows.filter((row) => row.status !== "ready" && row.status !== "failed");
  const latestImport = [...importRows].sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))[0];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Overview"
        title={`Welcome, ${user.name.split(" ")[0]}`}
        description="A calmer control center for your church account, content library, archive, billing, and setup readiness."
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/services" className="inline-flex h-10 items-center rounded-xl border border-border px-4 text-sm font-medium hover:bg-accent">
              View services
            </Link>
            <Link href="/organization" className="inline-flex h-10 items-center rounded-xl bg-foreground px-4 text-sm font-semibold text-background hover:opacity-90">
              Manage organization
            </Link>
          </div>
        }
      />

      <section className="grid gap-4 lg:grid-cols-4">
        <DashboardCard title="Church" eyebrow="Identity">
          <div className="text-2xl font-semibold">{church?.name || "Church profile"}</div>
          <div className="mt-2 text-sm text-muted-foreground">{church?.city ? `${church.city}, ${church.country || ""}` : "Profile needs finishing"}</div>
        </DashboardCard>
        <DashboardCard title="Today’s readiness" eyebrow="Service">
          <div className="text-2xl font-semibold">{plans.length}</div>
          <div className="mt-2 text-sm text-muted-foreground">Total service plans in workspace</div>
        </DashboardCard>
        <DashboardCard title="Bible + songs" eyebrow="Library">
          <div className="text-2xl font-semibold">{songRows.length}</div>
          <div className="mt-2 text-sm text-muted-foreground">Songs available for service preparation</div>
        </DashboardCard>
        <DashboardCard title="Plan state" eyebrow="Subscription">
          <div className="mb-2 flex flex-wrap gap-2">
            <StatusPill label={sub?.tier || "pilot"} tone="brand" />
            <StatusPill label={sub?.status || "pilot"} tone={sub?.status === "past_due" ? "warning" : "success"} />
          </div>
          <div className="text-sm text-muted-foreground">Billing should never block Sunday live operation; surface warnings to admins instead.</div>
        </DashboardCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <DashboardCard title="Recent service plans" eyebrow="Run of service">
          {recentPlans.length === 0 ? (
            <div className="text-sm text-muted-foreground">No plans yet. <Link href="/services" className="underline">Create your first service</Link>.</div>
          ) : (
            <ul className="space-y-3">
              {recentPlans.map((plan) => (
                <li key={plan.id} className="flex items-center justify-between gap-4 rounded-xl border border-border bg-white/[0.02] p-3">
                  <div>
                    <div className="text-sm font-semibold">{plan.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {plan.scheduledFor ? new Date(plan.scheduledFor).toLocaleDateString() : "No service date set"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/services/${plan.id}`} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-accent">Edit</Link>
                    <Link href={`/services/${plan.id}/operate`} className="inline-flex h-9 items-center rounded-lg bg-foreground px-3 text-xs font-semibold text-background hover:opacity-90">Operate</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        <div className="grid gap-4">
          <DashboardCard title="Setup checklist" eyebrow="MVP">
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>{church?.timezone ? "Done" : "Needs review"} · Church timezone</li>
              <li>{songRows.length > 0 ? "Done" : "Needs import"} · Song library</li>
              <li>{mediaRows.length > 0 ? "Done" : "Optional"} · Media library</li>
              <li>{teamRows.length > 1 ? "Done" : "Optional"} · Team invites</li>
            </ul>
          </DashboardCard>
          <DashboardCard title="Archive + imports" eyebrow="Operations">
            <div className="mb-3 flex flex-wrap gap-2">
              <StatusPill label={`${archiveRows.length} archived sermons`} tone="success" />
              <StatusPill label={`${openImports.length} imports in flight`} tone={openImports.length > 0 ? "warning" : "neutral"} />
            </div>
            <div className="text-sm text-muted-foreground">
              {latestImport
                ? `Latest import: ${latestImport.sourceFileName || latestImport.source} · ${latestImport.status}`
                : "No migration jobs recorded yet."}
            </div>
          </DashboardCard>
        </div>
      </section>
    </div>
  );
}
