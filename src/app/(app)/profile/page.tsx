import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/session";
import { AccountCard } from "@/components/account/AccountCard";

export default async function ProfilePage() {
  const user = await requireUser();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="My Profile"
        title="My profile"
        description="Personal account details and security posture for the current FaithFlow user."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <AccountCard title="Profile" description="Core identity information for this account.">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Name" value={user.name} />
            <Detail label="Email" value={user.email} />
            <Detail label="Role" value={user.role} />
            <Detail label="Church ID" value={user.churchId} />
          </dl>
        </AccountCard>
        <AccountCard title="Security" description="Security controls stay conservative until broader account management lands.">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>Password and session management remain in the existing auth flow.</li>
            <li>TOTP and deeper account controls should surface here later without leaking into operator surfaces.</li>
            <li>Delete-account workflows should stay heavily gated and audit-friendly.</li>
          </ul>
        </AccountCard>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-white/[0.02] p-3">
      <dt className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className="break-all text-sm font-medium">{value}</dd>
    </div>
  );
}
