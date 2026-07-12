import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountCard } from "@/components/account/AccountCard";

const HELP_LINKS = [
  { href: "/help/first-sunday", title: "First Sunday playbook", description: "Step-by-step guide to running your first live service." },
  { href: "/tutorial", title: "Guided tutorial", description: "Interactive walk-through of the admin portal and desktop app." },
  { href: "/setup/projector", title: "Projector setup", description: "Wire up a networked projector or streaming output." },
  { href: "/setup/audio", title: "Microphone / mixer setup", description: "Connect an audio source for AI listening." },
  { href: "/setup/diagnostics", title: "Install diagnostics", description: "Verify your Present Flow install is healthy." },
] as const;

export default function HelpPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Help"
        title="Help & Support"
        description="Playbooks, setup guides, and diagnostic tools. For direct support, email support@presentflow.app."
      />
      <div className="grid gap-4 xl:grid-cols-3">
        {HELP_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="group">
            <AccountCard title={link.title} description={link.description}>
              <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-muted-foreground group-hover:border-white/20">
                Open →
              </div>
            </AccountCard>
          </Link>
        ))}
      </div>
    </div>
  );
}
