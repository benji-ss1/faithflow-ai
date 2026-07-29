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
      // Audio capture happens on the desktop app (native ffmpeg). The web
      // dashboard has no way to configure it, so show as neutral info rather
      // than a warning the admin can't act on here.
      hint: prefs?.audioInputDeviceLabel ? prefs.audioInputDeviceLabel : "Configure in desktop app",
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

  // Audio + projector setup happen in the desktop app; on web we surface
  // status but never mark them as a warning the admin should chase from here.
  const audioTone: "success" | "neutral" = prefs?.audioInputDeviceLabel ? "success" : "neutral";
  const projectorTone: "brand" | "neutral" =
    settingsRow?.logoS3Key || mediaRows.length > 0 ? "brand" : "neutral";

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
              className="inline-flex h-10 items-center rounded-md border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-card)] px-4 text-sm font-medium text-[var(--pf-admin-text)] transition hover:bg-[var(--pf-admin-bg-hover)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--pf-admin-accent-ring)]"
            >
              Open services
            </Link>
            <Link
              href="/organization"
              className="inline-flex h-10 items-center rounded-md bg-[var(--pf-admin-accent)] px-4 text-sm font-semibold text-[var(--pf-admin-text-inverse)] transition hover:bg-[var(--pf-admin-accent-hover)] focus:outline-none focus:ring-[3px] focus:ring-[var(--pf-admin-accent-ring)]"
            >
              Manage organization
            </Link>
          </div>
        }
      />

      <RecentUpdatesPanel />

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr_0.85fr]">
        <DashboardCard title="Next service checklist" eyebrow="Operational prep">
          <div className="space-y-2">
            {nextService ? (
              <div className="rounded-md border border-[var(--pf-admin-accent)]/25 bg-[var(--pf-admin-accent-soft)] px-3 py-2.5 text-sm text-[var(--pf-admin-text)]">
                <div className="font-semibold">{nextService.title}</div>
                <div className="text-xs text-[var(--pf-admin-text-secondary)]">Next scheduled service · {formatServiceDate(nextService.scheduledFor)}</div>
              </div>
            ) : null}
            {checklist.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="group flex items-start gap-3 rounded-md border border-transparent px-3 py-2.5 transition hover:border-[var(--pf-admin-border-subtle)] hover:bg-[var(--pf-admin-bg-hover)] focus:outline-none focus-visible:border-[var(--pf-admin-accent)] focus-visible:ring-[3px] focus-visible:ring-[var(--pf-admin-accent-ring)]"
              >
                {item.done ? (
                  <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] text-[var(--pf-admin-green)]" />
                ) : (
                  <TriangleAlert className="mt-0.5 h-[18px] w-[18px] text-[var(--pf-admin-gold)]" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--pf-admin-text)]">{item.label}</div>
                  <div className="text-xs leading-5 text-[var(--pf-admin-text-secondary)]">{item.hint}</div>
                </div>
                <ArrowRight className="mt-0.5 h-4 w-4 text-[var(--pf-admin-text-muted)] opacity-0 transition group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        </DashboardCard>

        <DashboardCard title="AI health" eyebrow="Suggestions" className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--pf-admin-accent-soft)]">
                <Bot className="h-5 w-5 text-[var(--pf-admin-accent)]" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--pf-admin-text)]">
                  {prefs?.aiListeningDefault ? "AI listening enabled" : "AI listening paused"}
                </div>
                <div className="text-xs text-[var(--pf-admin-text-secondary)]">
                  {pendingSuggestions.length} pending · {resolvedSuggestions.length} reviewed
                </div>
              </div>
            </div>
            <StatusPill label={prefs?.aiListeningDefault ? "Ready" : "Needs setup"} tone={aiTone} />
          </div>
          <p className="text-sm leading-6 text-[var(--pf-admin-text-secondary)]">
            Dashboard health reads the suggestion queue and church defaults only — the live listening pipeline is isolated in the operator stack.
          </p>
          <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--pf-admin-accent)] hover:text-[var(--pf-admin-accent-hover)]">
            Review AI defaults <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </DashboardCard>

        <div className="grid gap-4">
          <DashboardCard title="Audio setup" eyebrow="Readiness">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--pf-admin-bg-muted)]">
                <Mic className="h-[18px] w-[18px] text-[var(--pf-admin-text-secondary)]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[var(--pf-admin-text)]">
                  {prefs?.audioInputDeviceLabel ? "Input source saved" : "Input source missing"}
                </div>
                <div className="mt-0.5 text-xs text-[var(--pf-admin-text-secondary)]">
                  {prefs?.audioInputDeviceLabel || "Choose an audio input in settings before service day."}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <StatusPill label={prefs?.audioInputDeviceLabel ? "Configured" : "Configure in desktop"} tone={audioTone} />
            </div>
          </DashboardCard>

          <DashboardCard title="Projector setup" eyebrow="Outputs">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--pf-admin-bg-muted)]">
                <MonitorPlay className="h-[18px] w-[18px] text-[var(--pf-admin-text-secondary)]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[var(--pf-admin-text)]">
                  {settingsRow?.logoS3Key || mediaRows.length > 0 ? "Visual defaults present" : "Output review still needed"}
                </div>
                <div className="mt-0.5 text-xs text-[var(--pf-admin-text-secondary)]">
                  Dashboard surfaces readiness only. Dedicated device registration can land without touching live output internals.
                </div>
              </div>
            </div>
            <div className="mt-3">
              <StatusPill label={projectorTone === "neutral" ? "Configure in desktop" : "Prepared"} tone={projectorTone} />
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
