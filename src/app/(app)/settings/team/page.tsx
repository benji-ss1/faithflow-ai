import { and, eq, isNull, gte } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { users, invitations } from "@/lib/db/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { TeamManager } from "@/components/settings/TeamManager";

export default async function TeamPage() {
  const admin = await requireRole("admin");
  const db = getDb();

  const members = await db.select({
    id: users.id, email: users.email, name: users.name, role: users.role, jobTitle: users.jobTitle,
    emailVerifiedAt: users.emailVerifiedAt,
  }).from(users).where(eq(users.churchId, admin.churchId));

  const pending = await db.select().from(invitations).where(and(
    eq(invitations.churchId, admin.churchId),
    isNull(invitations.acceptedAt),
    gte(invitations.expiresAt, new Date()),
  ));

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Team"
        title="Team"
        description="Manage church members, invitations, and operational roles without leaking into the live-service console."
      />
      <TeamManager
        currentUserId={admin.id}
        members={members.map((m) => ({ ...m, emailVerified: !!m.emailVerifiedAt }))}
        pendingInvites={pending.map((p) => ({ id: p.id, email: p.email, role: p.role, expiresAt: p.expiresAt.toISOString() }))}
      />
    </div>
  );
}
