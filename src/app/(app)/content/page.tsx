import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountCard } from "@/components/account/AccountCard";

const LIBRARY_LINKS = [
  { href: "/library/songs", title: "Songs", description: "Public-domain hymns, imported worship songs, and per-song settings." },
  { href: "/library/bible", title: "Bible", description: "Enabled translations and licensed provider setup." },
  { href: "/library/media", title: "Media", description: "Images, videos, and supporting slide assets." },
  { href: "/library/imports", title: "Imports", description: "PPTX conversions and migration batches from other systems." },
  { href: "/library/themes", title: "Themes", description: "Slide styling, colour palettes, and presentation defaults." },
] as const;

export default function ContentLibraryHubPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Content"
        title="Content Library"
        description="One admin view of every asset the desktop app can present. A polished library hub is coming in the next build — for now, jump straight into the individual libraries below."
      />
      <div className="grid gap-4 xl:grid-cols-3">
        {LIBRARY_LINKS.map((link) => (
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
