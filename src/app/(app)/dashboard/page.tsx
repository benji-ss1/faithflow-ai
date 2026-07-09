import Link from "next/link";
import { and, eq, gte, isNull } from "drizzle-orm";
import {
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  HardDrive,
  Mic,
  MonitorPlay,
  Receipt,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users2,
} from "lucide-react";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import {
  aiSuggestions,
  churches,
  churchPreferences,
  invitations,
  mediaAssets,
  migrationJobs,
  sermonSummaries,
  servicePlans,
  settings,
  subscriptions,
  users,
} from "@/lib/db/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { DashboardCard, StatusPill } from "@/components/dashboard/DashboardCard";

type ChecklistItem = {
  label: string;
  hint: string;
  done: boolean;
  href: string;
};

export default async function DashboardPage() {
  const user = await requireUser();
  const db = getDb();
  const todayKey = new Date().toISOString().slice(0, 10);

  const [church, prefs, settingsRow, plans, mediaRows, archiveRows, teamRows, importRows, sub, pendingInvites, suggestionRows] = await Promise.all([
    db.select().from(churches).where(eq(churches.id, user.churchId)).limit(1).then((rows) => rows[0] || null),
    db.select().from(churchPreferences).where(eq(churchPreferences.churchId, user.churchId)).limit(1).then((rows) => rows[0] || null),
    db.select().from(settings).where(eq(settings.churchId, user.churchId)).limit(1).then((rows) => rows[0] || null),
    db.select().from(servicePlans).where(eq(servicePlans.churchId, user.churchId)),
    db.select().from(mediaAssets).where(eq(mediaAssets.churchId, user.churchId)),
    db
      .select()
      .from(sermonSummaries)
      .innerJoin(servicePlans, eq(sermonSummaries.servicePlanId, servicePlans.id))
      .where(eq(servicePlans.churchId, user.churchId)),
    db.select().from(users).where(eq(users.churchId, user.churchId)),
    db.select().from(migrationJobs).where(eq(migrationJobs.churchId, user.churchId)),
    db.select().from(subscriptions).where(eq(subscriptions.churchId, user.churchId)).limit(1).then((rows) => rows[0] || null),
    db.select().from(invitations).where(and(eq(invitations.churchId, user.churchId), isNull(invitations.acceptedAt), gte(invitations.expiresAt, new Date()))),
    db.select().from(aiSuggestions).where(eq(aiSuggestions.servicePlanId, aiSuggestions.servicePlanId)),
  ]);

  const churchSuggestions = suggestionRows.filter((row) => plans.some((plan) => plan.id === row.servicePlanId));
  const sortedUpcomingPlans = [...plans]
    .filter((plan) => !!plan.scheduledFor)
    .sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
  const todaysService = sortedUpcomingPlans.find((plan) => String(plan.scheduledFor) === todayKey) || null;
  const nextService = sortedUpcomingPlans.find((plan) => String(plan.scheduledFor) > todayKey) || todaysService || null;
  const recentSermons = [...archiveRows]
    .sort((a, b) => (b.sermon_summaries.generatedAt?.getTime?.() || 0) - (a.sermon_summaries.generatedAt?.getTime?.() || 0))
    .slice(0, 3);
  const pendingImports = importRows.filter((row) => row.status === "pending" || row.status === "processing");
  const reviewImports = importRows.filter((row) => row.status === "ready" || row.status === "failed");
  const pendingSuggestions = churchSuggestions.filter((row) => row.status === "pending");
  const resolvedSuggestions = churchSuggestions.filter((row) => row.status !== "pending");
  const storageBytes = mediaRows.reduce((sum, row) => sum + row.sizeBytes, 0);
  const verifiedMembers = teamRows.filter((member) => !!member.emailVerifiedAt).length;
  const newestMember = [...teamRows].sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))[0];

  const checklist: ChecklistItem[] = [
    {
      label: "Church profile",
      hint: church?.timezone ? `${church.timezone} saved` : "Add timezone and church defaults",
      done: !!church?.timezone,
      href: "/organization",
    },
    {
      label: "Audio input",
      hint: prefs?.audioInputDeviceLabel ? prefs.audioInputDeviceLabel : "Select a listening source",
      done: !!prefs?.audioInputDeviceLabel,
      href: "/settings",
    },
    {
      label: "Media and branding",
      hint: settingsRow?.logoS3Key ? "Branding uploaded" : "Logo and background defaults pending",
      done: !!settingsRow?.logoS3Key,
      href: "/organization",
    },
    {
      label: "Team readiness",
      hint: teamRows.length > 1 ? `${teamRows.length} teammates active` : "Invite another operator or admin",
      done: teamRows.length > 1,
      href: "/settings/team",
    },
  ];

  const aiTone = !prefs?.aiListeningDefault
    ? "warning"
    : pendingSuggestions.length > 0
      ? "brand"
      : resolvedSuggestions.length > 0
        ? "success"
        : "neutral";

  const audioTone = prefs?.audioInputDeviceLabel ? "success" : "warning";
  const projectorTone = settingsRow?.logoS3Key || mediaRows.length > 0 ? "brand" : "warning";
  const planTone = sub?.status === "past_due" ? "warning" : sub?.status === "active" ? "success" : "brand";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview Dashboard"
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        description="A premium command surface for church admins: service readiness, archive health, content imports, billing posture, and the account layer around FaithFlow."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/services"
              className="inline-flex h-11 items-center rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm font-medium text-foreground transition hover:border-white/16 hover:bg-white/[0.06]"
            >
              Open services
            </Link>
            <Link
              href="/organization"
              className="inline-flex h-11 items-center rounded-2xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)] transition hover:brightness-105"
            >
              Manage organization
            </Link>
          </div>
        }
      />

      <section className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <DashboardCard title="Welcome card" eyebrow="Church workspace" tone="premium" className="overflow-hidden">
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                {church?.name || "FaithFlow Church"}
              </div>
              <div className="max-w-xl text-3xl font-semibold tracking-[-0.04em] text-foreground">
                Calm control before Sunday starts. Keep archive, AI, imports, and account readiness in one place.
              </div>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                The live operator surface stays separate. This workspace is for planning, profile health, billing posture, and keeping the wider church system ready.
              </p>
              <div className="flex flex-wrap gap-2">
                <StatusPill label={church?.onboardingStatus || "pending"} tone={church?.onboardingStatus === "complete" ? "success" : "brand"} />
                <StatusPill label={sub?.tier || "pilot"} tone="brand" />
                <StatusPill label={sub?.status || "pilot"} tone={planTone} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <MetricTile label="Team" value={String(teamRows.length)} hint={`${verifiedMembers} verified members`} icon={Users2} />
              <MetricTile label="Archive" value={String(archiveRows.length)} hint="Sermon summaries stored" icon={ShieldCheck} />
              <MetricTile label="Storage" value={formatBytes(storageBytes)} hint={`${mediaRows.length} media assets`} icon={HardDrive} />
            </div>
          </div>
        </DashboardCard>

        <DashboardCard title="Today’s service card" eyebrow="Sunday readiness" className="flex flex-col justify-between">
          {todaysService ? (
            <div className="space-y-4">
              <div>
                <div className="text-2xl font-semibold tracking-[-0.03em] text-foreground">{todaysService.title}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Scheduled for {formatServiceDate(todaysService.scheduledFor)}.
                </div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4 text-sm leading-6 text-muted-foreground">
                Today is live-ready from a planning perspective. Jump into the service workspace or open the operator route when the live team is ready.
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/services/${todaysService.id}`} className="inline-flex h-10 items-center rounded-xl border border-white/10 px-4 text-sm font-medium text-foreground hover:bg-white/[0.05]">
                  Review plan
                </Link>
                <Link href={`/services/${todaysService.id}/operate`} className="inline-flex h-10 items-center rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)] hover:brightness-105">
                  Open operator
                </Link>
              </div>
            </div>
          ) : (
            <EmptyStateCard
              icon={CalendarClock}
              title="No service scheduled today"
              description="Schedule the next service plan so your readiness and archive cards can lock onto a real Sunday timeline."
              href="/services"
              cta="Create or review services"
            />
          )}
        </DashboardCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr_0.85fr]">
        <DashboardCard title="Next service checklist" eyebrow="Operational prep">
          <div className="space-y-3">
            {nextService ? (
              <div className="rounded-2xl border border-[rgba(111,224,194,0.16)] bg-[rgba(111,224,194,0.08)] px-4 py-3 text-sm text-foreground">
                <div className="font-semibold">{nextService.title}</div>
                <div className="text-xs text-muted-foreground">Next scheduled service · {formatServiceDate(nextService.scheduledFor)}</div>
              </div>
            ) : null}
            {checklist.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 transition hover:border-white/14 hover:bg-white/[0.05]"
              >
                {item.done ? (
                  <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 text-[var(--color-success)]" />
                ) : (
                  <TriangleAlert className="mt-0.5 h-4.5 w-4.5 text-[var(--color-warning)]" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{item.label}</div>
                  <div className="text-xs leading-5 text-muted-foreground">{item.hint}</div>
                </div>
                <ArrowRight className="mt-0.5 h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </DashboardCard>

        <DashboardCard title="AI health card" eyebrow="Suggestions" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04]">
                <Bot className="h-5 w-5 text-[var(--color-primary)]" />
              </div>
              <div>
                <div className="text-lg font-semibold text-foreground">
                  {prefs?.aiListeningDefault ? "AI listening enabled" : "AI listening paused"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {pendingSuggestions.length} pending suggestions · {resolvedSuggestions.length} reviewed
                </div>
              </div>
            </div>
            <StatusPill label={prefs?.aiListeningDefault ? "Ready" : "Needs setup"} tone={aiTone} />
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Dashboard health uses suggestion queue and church defaults only. The live listening pipeline remains isolated in the operator stack.
          </p>
          <Link href="/settings" className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-[var(--color-primary)]">
            Review AI defaults <ArrowRight className="h-4 w-4" />
          </Link>
        </DashboardCard>

        <div className="grid gap-4">
          <DashboardCard title="Audio setup status" eyebrow="Readiness" tone="muted">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04]">
                <Mic className="h-4.5 w-4.5 text-[var(--color-primary)]" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {prefs?.audioInputDeviceLabel ? "Input source saved" : "Input source missing"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {prefs?.audioInputDeviceLabel || "Choose an audio input in settings before service day."}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <StatusPill label={prefs?.audioInputDeviceLabel ? "Configured" : "Needs setup"} tone={audioTone} />
            </div>
          </DashboardCard>

          <DashboardCard title="Projector setup status" eyebrow="Outputs" tone="muted">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04]">
                <MonitorPlay className="h-4.5 w-4.5 text-[var(--color-accent)]" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {settingsRow?.logoS3Key || mediaRows.length > 0 ? "Visual defaults present" : "Output review still needed"}
                </div>
                <div className="text-xs text-muted-foreground">
                  This phase surfaces readiness only. Dedicated device registration can land later without touching live output internals.
                </div>
              </div>
            </div>
            <div className="mt-4">
              <StatusPill label={projectorTone === "warning" ? "Review" : "Prepared"} tone={projectorTone} />
            </div>
          </DashboardCard>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr_0.9fr]">
        <DashboardCard title="Recent sermons" eyebrow="Archive">
          {recentSermons.length === 0 ? (
            <EmptyStateCard
              icon={ShieldCheck}
              title="No archived sermons yet"
              description="Sermon summaries appear here after services complete and archive generation runs."
              href="/archive"
              cta="Open archive"
            />
          ) : (
            <div className="space-y-3">
              {recentSermons.map((row) => (
                <Link
                  key={row.sermon_summaries.id}
                  href={`/archive/${row.sermon_summaries.id}`}
                  className="block rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 transition hover:border-white/14 hover:bg-white/[0.05]"
                >
                  <div className="text-sm font-semibold text-foreground">{row.sermon_summaries.title}</div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{row.sermon_summaries.overview}</div>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    {formatDateTime(row.sermon_summaries.generatedAt)} · {row.sermon_summaries.wordCount.toLocaleString()} words
                  </div>
                </Link>
              ))}
            </div>
          )}
        </DashboardCard>

        <DashboardCard title="Imports waiting review" eyebrow="Migration queue">
          <div className="mb-4 flex flex-wrap gap-2">
            <StatusPill label={`${pendingImports.length} in progress`} tone={pendingImports.length ? "warning" : "neutral"} />
            <StatusPill label={`${reviewImports.length} ready for review`} tone={reviewImports.length ? "brand" : "neutral"} />
          </div>
          <div className="space-y-3">
            {importRows.slice(0, 3).map((job) => (
              <div key={job.id} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{job.sourceFileName || job.source}</div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{job.source}</div>
                  </div>
                  <StatusPill
                    label={job.status}
                    tone={job.status === "failed" ? "danger" : job.status === "ready" ? "success" : "warning"}
                  />
                </div>
              </div>
            ))}
            {importRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
                No migration jobs yet. Start with song or media imports when a church moves into FaithFlow.
              </div>
            ) : null}
          </div>
        </DashboardCard>

        <DashboardCard title="Storage / billing status" eyebrow="Account health">
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">Plan posture</div>
                  <div className="text-xs text-muted-foreground">
                    {sub?.status === "past_due"
                      ? "Warn admins early, but do not block Sunday live operation."
                      : "Account is within the current subscription posture."}
                  </div>
                </div>
                <StatusPill label={sub?.status || "pilot"} tone={planTone} />
              </div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center gap-3">
                <Receipt className="h-4.5 w-4.5 text-[var(--color-accent)]" />
                <div>
                  <div className="text-sm font-semibold text-foreground">{formatBytes(storageBytes)} used</div>
                  <div className="text-xs text-muted-foreground">{mediaRows.length} stored assets across the media workspace.</div>
                </div>
              </div>
            </div>
          </div>
        </DashboardCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <DashboardCard title="Team activity" eyebrow="People and roles">
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat label="Members" value={String(teamRows.length)} />
            <MiniStat label="Pending invites" value={String(pendingInvites.length)} />
            <MiniStat label="Verified" value={String(verifiedMembers)} />
          </div>
          <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground">
            {newestMember
              ? `${newestMember.name} is the most recent team member on record.`
              : "No additional team activity recorded yet."}
          </div>
          <div className="mt-4">
            <Link href="/settings/team" className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-[var(--color-primary)]">
              Manage team <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </DashboardCard>

        <DashboardCard title="Next steps" eyebrow="What to do next" tone="muted">
          <div className="grid gap-3 md:grid-cols-2">
            <ActionPanel href="/services" title="Refine service plans" description="Confirm the next run-of-service and align songs, scripture, and media." />
            <ActionPanel href="/library/imports" title="Clear import reviews" description="Resolve queued migrations before they spill into service prep." />
            <ActionPanel href="/subscriptions" title="Check billing grace state" description="Keep finance stakeholders informed without creating Sunday friction." />
            <ActionPanel href="/organization" title="Finish church defaults" description="Timezone, branding, and ministry context improve everything else." />
          </div>
        </DashboardCard>
      </section>
    </div>
  );
}

function MetricTile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Sparkles;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/18 px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-[var(--color-primary)]" />
      </div>
      <div className="text-xl font-semibold tracking-[-0.03em] text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-semibold tracking-[-0.03em] text-foreground">{value}</div>
    </div>
  );
}

function EmptyStateCard({
  icon: Icon,
  title,
  description,
  href,
  cta,
}: {
  icon: typeof CalendarClock;
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="flex h-full flex-col justify-between gap-4 rounded-2xl border border-dashed border-white/12 bg-white/[0.02] p-5">
      <div className="space-y-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04]">
          <Icon className="h-5 w-5 text-[var(--color-primary)]" />
        </div>
        <div className="text-lg font-semibold text-foreground">{title}</div>
        <div className="text-sm leading-6 text-muted-foreground">{description}</div>
      </div>
      <Link href={href} className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-[var(--color-primary)]">
        {cta} <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function ActionPanel({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4 transition hover:border-white/14 hover:bg-white/[0.05]"
    >
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground">{description}</div>
    </Link>
  );
}

function formatServiceDate(value: unknown) {
  if (!value) return "Date not set";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatDateTime(value: Date | null | undefined) {
  if (!value) return "No timestamp";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
