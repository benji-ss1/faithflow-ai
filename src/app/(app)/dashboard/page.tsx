import Link from "next/link";
import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { eq } from "drizzle-orm";
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
import { RecentUpdatesPanel } from "@/components/dashboard/RecentUpdatesPanel";
import { ServiceReadinessPanel, type PrepItem } from "@/components/dashboard/ServiceReadinessPanel";
import { DesktopDownloadPanel } from "@/components/settings/DesktopDownloadPanel";
import { mintDeviceLinkToken } from "@/lib/device-link-actions";

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

  // Desktop-app download for this dashboard card. Minted fresh (5-min TTL) so
  // the church can one-click auto-login into the desktop app. Best-effort — a
  // failure just renders the download buttons without the auto-login deep link.
  const deviceLink = await mintDeviceLinkToken().catch(() => null);
  const deepLinkHref = deviceLink?.ok ? `presentflow://auth?token=${encodeURIComponent(deviceLink.token)}` : null;

  const churchSuggestions = suggestionRows.filter((row) => plans.some((plan) => plan.id === row.servicePlanId));
  const sortedUpcomingPlans = [...plans]
    .filter((plan) => !!plan.scheduledFor)
    .sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
  const todaysService = sortedUpcomingPlans.find((plan) => String(plan.scheduledFor) === todayKey) || null;
  const nextService = sortedUpcomingPlans.find((plan) => String(plan.scheduledFor) > todayKey) || todaysService || null;
  const pendingSuggestions = churchSuggestions.filter((row) => row.status === "pending");
  const resolvedSuggestions = churchSuggestions.filter((row) => row.status !== "pending");

  // Operational-prep items — each auto-ticks from real DB state. "Media and
  // branding" and "Audio input" live in the desktop app; the readiness panel
  // lets the admin tick anything the web can't yet see (a live desktop
  // heartbeat that auto-detects these lands after Sunday).
  const prep: PrepItem[] = [
    {
      key: "profile",
      label: "Church profile",
      hint: church?.timezone ? `${church.timezone} saved` : "Add timezone and church defaults",
      done: !!church?.timezone,
      href: "/organization",
    },
    {
      key: "media",
      label: "Media and branding",
      hint: settingsRow?.logoS3Key ? "Branding uploaded" : "Logo and background defaults pending",
      done: !!settingsRow?.logoS3Key,
      href: "/organization",
    },
    {
      key: "team",
      label: "Team readiness",
      hint: teamRows.length > 1 ? `${teamRows.length} teammates active` : "Invite another operator or admin",
      done: teamRows.length > 1,
      href: "/settings/team",
    },
  ];

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

      <ServiceReadinessPanel
        churchId={user.churchId}
        nextService={
          nextService
            ? { title: nextService.title, date: formatServiceDate(nextService.scheduledFor) }
            : null
        }
        prep={prep}
        ai={{
          pending: pendingSuggestions.length,
          reviewed: resolvedSuggestions.length,
        }}
        audio={{ done: !!prefs?.audioInputDeviceLabel, label: prefs?.audioInputDeviceLabel ?? null }}
        output={{ done: !!settingsRow?.logoS3Key || mediaRows.length > 0 }}
      />

      <section className="rounded-lg border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-card)] p-5">
        <h2 className="text-base font-semibold text-[var(--pf-admin-text)]">Run live services — get the desktop app</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--pf-admin-text-muted)]">
          This web dashboard is for setup, imports, and your account. You run live services — projector output, stage
          display, and real-time AI detection — from the PresentFlow desktop app on your church computer. Available for
          Windows and Mac.
        </p>
        <DesktopDownloadPanel deepLinkHref={deepLinkHref} showSkipLink={false} />
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
