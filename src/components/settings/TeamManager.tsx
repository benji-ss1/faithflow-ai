"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus, Trash2, MailCheck, MailWarning, Users2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { inviteTeammate, revokeInvitation, updateTeammateRole, removeTeammate } from "@/lib/invitation-actions";

type Role = "admin" | "operator" | "volunteer" | "pastor" | "viewer";
type Member = { id: string; email: string; name: string; role: Role; jobTitle: string | null; emailVerified: boolean; lastActiveAt: string | null };
type Pending = { id: string; email: string; role: Role; expiresAt: string };

function relativeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const ROLE_BLURB: Record<Role, string> = {
  admin: "Church settings + user management + everything an operator can do.",
  operator: "Run services, edit playlists, upload media & songs.",
  volunteer: "Run services and view the library, but can't edit songs, upload media, or change themes.",
  pastor: "Read-only view of the sermon archive. Cannot operate services.",
  viewer: "Read-only across services, songs, and the sermon archive. Cannot operate anything.",
};

// Merged row shape: existing team members + pending invites both render in
// the same list. Pending rows get a "Pending" pill instead of a role
// dropdown, and can be revoked but not role-changed.
type Row =
  | { kind: "member"; member: Member }
  | { kind: "pending"; pending: Pending };

function initials(name: string, email: string): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() || "").join("").slice(0, 2) || "?";
}

export function TeamManager({ currentUserId, members, pendingInvites }: {
  currentUserId: string; members: Member[]; pendingInvites: Pending[];
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [pending, startTransition] = useTransition();

  const rows: Row[] = [
    ...members.map((m): Row => ({ kind: "member", member: m })),
    ...pendingInvites.map((p): Row => ({ kind: "pending", pending: p })),
  ];

  function invite(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await inviteTeammate({ email, role });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(`Invite sent to ${email}`);
      setEmail("");
    });
  }

  function changeRole(userId: string, newRole: Role) {
    startTransition(async () => {
      const res = await updateTeammateRole(userId, newRole);
      if (!res.ok) toast.error(res.error);
      else toast.success("Role updated");
    });
  }

  function remove(userId: string, name: string) {
    if (!confirm(`Remove ${name}? They'll lose access to services and content in this church, but their sermon-summary + audit trail entries are preserved.`)) return;
    startTransition(async () => {
      const res = await removeTeammate(userId);
      if (!res.ok) toast.error(res.error);
      else toast.success("Removed");
    });
  }

  function revoke(id: string, email: string) {
    if (!confirm(`Revoke pending invite to ${email}?`)) return;
    startTransition(async () => {
      const res = await revokeInvitation(id);
      if (!res.ok) toast.error(res.error);
      else toast.success("Invite revoked");
    });
  }

  return (
    <div className="space-y-4">
      {/* Invite */}
      <section className="rounded-md border border-border bg-card p-4">
        <header className="mb-3">
          <div className="text-sm font-semibold">Invite a teammate</div>
          <div className="text-xs text-muted-foreground">They&rsquo;ll get an email with a link that expires in 7 days.</div>
        </header>
        <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] flex-1">
            <div className="mb-1 text-xs font-semibold">Email</div>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="volunteer@church.org"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-[var(--pf-admin-accent)]/70"
            />
          </label>
          <label>
            <div className="mb-1 text-xs font-semibold">Role</div>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="operator">Operator</option>
              <option value="volunteer">Volunteer</option>
              <option value="pastor">Pastor</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--pf-admin-accent)] px-4 text-sm font-semibold text-[var(--pf-admin-text-inverse)] transition-colors hover:bg-[var(--pf-admin-accent-hover)] disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" /> Send invite
          </button>
        </form>
        <div className="mt-2 text-[11px] text-muted-foreground">{ROLE_BLURB[role]}</div>
      </section>

      {/* Team list — members + pending invites merged into one section */}
      <section className="overflow-hidden rounded-md border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Team</div>
            <div className="text-xs text-muted-foreground">
              {members.length} member{members.length !== 1 && "s"}
              {pendingInvites.length > 0 ? ` · ${pendingInvites.length} pending` : ""}
            </div>
          </div>
        </header>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--pf-admin-accent-soft)] text-[var(--pf-admin-accent)]">
              <Users2 className="h-5 w-5" />
            </div>
            <div className="text-base font-semibold text-foreground">No team members yet</div>
            <p className="max-w-sm text-sm text-muted-foreground">
              Invite the person who runs your screen on Sunday. Use the form above — they&rsquo;ll get an email with a link that expires in 7 days.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) =>
              row.kind === "member" ? (
                <MemberRow
                  key={`m-${row.member.id}`}
                  member={row.member}
                  isCurrentUser={row.member.id === currentUserId}
                  pending={pending}
                  onChangeRole={(r) => changeRole(row.member.id, r)}
                  onRemove={() => remove(row.member.id, row.member.name)}
                />
              ) : (
                <PendingRow
                  key={`p-${row.pending.id}`}
                  pending={row.pending}
                  saving={pending}
                  onRevoke={() => revoke(row.pending.id, row.pending.email)}
                />
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

function Avatar({ name, email, tone = "amber" }: { name: string; email: string; tone?: "amber" | "muted" }) {
  const cls =
    tone === "amber"
      ? "bg-[var(--pf-admin-accent-soft)] text-[var(--pf-admin-accent)]"
      : "bg-[var(--pf-admin-bg-muted)] text-[var(--pf-admin-text-muted)]";
  return (
    <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold", cls)}>
      {initials(name, email)}
    </div>
  );
}

function MemberRow({
  member, isCurrentUser, pending, onChangeRole, onRemove,
}: {
  member: Member;
  isCurrentUser: boolean;
  pending: boolean;
  onChangeRole: (role: Role) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Avatar name={member.name} email={member.email} tone="amber" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{member.name}</span>
          {isCurrentUser && <span className="text-[10px] text-muted-foreground">(you)</span>}
          {member.emailVerified
            ? <MailCheck aria-label="Email verified" className="h-3.5 w-3.5 text-[var(--pf-admin-green)]" />
            : <MailWarning aria-label="Email not yet verified" className="h-3.5 w-3.5 text-[var(--pf-admin-gold)]" />}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {member.email}{member.jobTitle && ` · ${member.jobTitle}`}
          {" · "}
          <span title={member.lastActiveAt ? new Date(member.lastActiveAt).toLocaleString() : "Never signed in with the new session-tracking on"}>
            Active {relativeAgo(member.lastActiveAt)}
          </span>
        </div>
      </div>
      <select
        value={member.role}
        onChange={(e) => onChangeRole(e.target.value as Role)}
        disabled={pending || isCurrentUser}
        className={cn(
          "h-8 rounded-md border border-border bg-background px-2 text-xs",
          isCurrentUser && "cursor-not-allowed opacity-60",
        )}
        title={isCurrentUser ? "You can't change your own role" : undefined}
      >
        <option value="admin">Admin</option>
        <option value="operator">Operator</option>
        <option value="volunteer">Volunteer</option>
        <option value="pastor">Pastor</option>
        <option value="viewer">Viewer</option>
      </select>
      <button
        onClick={onRemove}
        disabled={pending || isCurrentUser}
        title={isCurrentUser ? "You can't remove yourself" : "Remove teammate"}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-400",
          isCurrentUser && "cursor-not-allowed opacity-30 hover:bg-transparent hover:text-muted-foreground",
        )}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

function PendingRow({
  pending, saving, onRevoke,
}: {
  pending: Pending;
  saving: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Avatar name="" email={pending.email} tone="muted" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{pending.email}</span>
          <span className="rounded-full bg-[var(--pf-admin-gold)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--pf-admin-gold)]">
            Pending
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          Invite expires {new Date(pending.expiresAt).toLocaleDateString()}
        </div>
      </div>
      <span className="rounded border border-border bg-[var(--pf-admin-bg-subtle)] px-2 py-1 text-[11px] font-medium capitalize text-muted-foreground">
        {pending.role}
      </span>
      <button
        onClick={onRevoke}
        disabled={saving}
        title="Revoke invite"
        className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
