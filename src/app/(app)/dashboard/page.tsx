import Link from "next/link";
import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { eq } from "drizzle-orm";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Mic,
  MonitorPlay,
  TriangleAlert,
} from "lucide-react";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import {
  aiSuggestions,
  churches,
  churchPreferences,
  mediaAssets,
  servicePlans,
  settings,
  users,
} from "@/lib/db/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { DashboardCard, StatusPill } from "@/components/dashboard/DashboardCard";
import { RecentUpdatesPanel } from "@/components/dashboard/RecentUpdatesPanel";

type ChecklistItem = {
  label: string;
  hint: string;
  done: boolean;
  href: string;
};

export default async function DashboardPage() {
  // Belt-and-braces: middleware already redirects desktop-shell users away
  // from admin surfaces, but if a stale cookie or edge case leaks through we
  // punt to /operator here at the server-component level as well.
  const h = await headers();
  const c = await cookies();
  if (h.get("x-pf-shell") === "desktop" || c.get("pf_shell")?.value === "desktop") {
    redirect("/operator");
  }
  const user = await requireUser();
  const db = getDb();
  const todayKey = new Date().toISOString().slice(0, 10);

  const [church, prefs, settingsRow, plans, mediaRows, teamRows, suggestionRows] = await Promise.all([
    db.select().from(churches).where(eq(churches.id, user.churchId)).limit(1).then((rows) => rows[0] || null),
    db.select().from(churchPreferences).where(eq(churchPreferences.churchId, user.churchId)).limit(1).then((rows) => rows[0] || null),
    db.select().from(settings).where(eq(settings.churchId, user.churchId)).limit(1).then((rows) => rows[0] || null),
    db.select().from(servicePlans).where(eq(servicePlans.churchId, user.churchId)),
    db.select().from(mediaAssets).where(eq(mediaAssets.churchId, user.churchId)),
    db.select().from(users).where(eq(users.churchId, user.churchId)),
    db
      .select({
        id: aiSuggestions.id,
        servicePlanId: aiSuggestions.servicePlanId,
        status: aiSuggestions.status,
      })
      .from(aiSuggestions)
      .innerJoin(servicePlans, eq(aiSuggestions.servicePlanId, servicePlans.id))
      .where(eq(servicePlans.churchId, user.churchId)),
  ]);

  const churchSuggestions = suggestionRows.filter((row) => plans.some((plan) => plan.id === row.servicePlanId));
  const sortedUpcomingPlans = [...plans]
    .filter((plan) => !!plan.scheduledFor)
    .sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
  const todaysService = sortedUpcomingPlans.find((plan) => String(plan.scheduledFor) === todayKey) || null;
  const nextService = sortedUpcomingPlans.find((plan) => String(plan.scheduledFor) > todayKey) || todaysService || null;
  const pendingSuggestions = churchSuggestions.filter((row) => row.status === "pending");
  const resolvedSuggestions = churchSuggestions.filter((row) => row.status !== "pending");

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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview Dashboard"
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        description="A premium command surface for church admins: service readiness, archive health, content imports, billing posture, and the account layer around PresentFlow."
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

      <RecentUpdatesPanel />

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

    </div>
  );
}

function formatServiceDate(value: unknown) {
  if (!value) return "Date not set";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}
