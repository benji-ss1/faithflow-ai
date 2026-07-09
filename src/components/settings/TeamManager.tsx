"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus, Shield, Trash2, MailCheck, MailWarning } from "lucide-react";
import { cn } from "@/lib/utils";
import { inviteTeammate, revokeInvitation, updateTeammateRole, removeTeammate } from "@/lib/invitation-actions";

type Role = "admin" | "operator" | "pastor";
type Member = { id: string; email: string; name: string; role: Role; jobTitle: string | null; emailVerified: boolean };
type Pending = { id: string; email: string; role: Role; expiresAt: string };

const ROLE_BLURB: Record<Role, string> = {
  admin: "Church settings + user management + everything an operator can do.",
  operator: "Run services, edit playlists, upload media & songs.",
  pastor: "Read-only view of the sermon archive. Cannot operate services.",
};

export function TeamManager({ currentUserId, members, pendingInvites }: {
  currentUserId: string; members: Member[]; pendingInvites: Pending[];
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [pending, startTransition] = useTransition();

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
    });
  }

  function remove(userId: string) {
    if (!confirm("Remove this teammate? Their sermon summaries and audit trail stay intact.")) return;
    startTransition(async () => {
      const res = await removeTeammate(userId);
      if (!res.ok) toast.error(res.error);
      else toast.success("Removed");
    });
  }

  function revoke(id: string) {
    startTransition(async () => {
      const res = await revokeInvitation(id);
      if (!res.ok) toast.error(res.error);
      else toast.success("Revoked");
    });
  }

  return (
    <div className="space-y-4">
      {/* Invite */}
      <section className="border border-border rounded-md bg-card p-4">
        <header className="mb-3">
          <div className="text-sm font-semibold">Invite a teammate</div>
          <div className="text-xs text-muted-foreground">They'll get an email with a link that expires in 7 days.</div>
        </header>
        <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[220px]">
            <div className="text-xs font-semibold mb-1">Email</div>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="volunteer@church.org"
              className="h-9 w-full px-3 border border-border rounded-md bg-background text-sm" />
          </label>
          <label>
            <div className="text-xs font-semibold mb-1">Role</div>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}
              className="h-9 px-3 border border-border rounded-md bg-background text-sm">
              <option value="operator">Operator</option>
              <option value="pastor">Pastor</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" disabled={pending}
            className="h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">
            <UserPlus className="w-4 h-4" /> Send invite
          </button>
        </form>
        <div className="mt-2 text-[10px] text-muted-foreground">{ROLE_BLURB[role]}</div>
      </section>

      {/* Team */}
      <section className="border border-border rounded-md bg-card">
        <header className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Team</div>
            <div className="text-xs text-muted-foreground">{members.length} member{members.length !== 1 && "s"}</div>
          </div>
        </header>
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{m.name}</span>
                  {m.id === currentUserId && <span className="text-[10px] text-muted-foreground">(you)</span>}
                  {m.emailVerified
                    ? <MailCheck aria-label="Email verified" className="w-3.5 h-3.5 text-success" />
                    : <MailWarning aria-label="Email not yet verified" className="w-3.5 h-3.5 text-warning" />}
                </div>
                <div className="text-xs text-muted-foreground truncate">{m.email}{m.jobTitle && ` · ${m.jobTitle}`}</div>
              </div>
              <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value as Role)}
                disabled={pending || m.id === currentUserId}
                className={cn("h-8 px-2 text-xs border border-border rounded-md bg-background", m.id === currentUserId && "opacity-60 cursor-not-allowed")}>
                <option value="admin">Admin</option>
                <option value="operator">Operator</option>
                <option value="pastor">Pastor</option>
              </select>
              <button onClick={() => remove(m.id)} disabled={pending || m.id === currentUserId}
                className={cn("text-muted-foreground hover:text-destructive p-1", m.id === currentUserId && "opacity-30 cursor-not-allowed")}>
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <section className="border border-border rounded-md bg-card">
          <header className="px-4 py-3 border-b border-border">
            <div className="text-sm font-semibold">Pending invites</div>
            <div className="text-xs text-muted-foreground">{pendingInvites.length} outstanding</div>
          </header>
          <ul className="divide-y divide-border">
            {pendingInvites.map((p) => (
              <li key={p.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.email}</div>
                  <div className="text-xs text-muted-foreground">expires {new Date(p.expiresAt).toLocaleDateString()}</div>
                </div>
                <span className="text-xs text-muted-foreground font-mono">{p.role}</span>
                <button onClick={() => revoke(p.id)} disabled={pending}
                  className="text-muted-foreground hover:text-destructive p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
