import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { licensedTranslations, mediaAssets, songs } from "@/lib/db/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountCard } from "@/components/account/AccountCard";
import { listSermonSummaries } from "@/lib/server/sermon-summary";

export default async function ApplicationsPage() {
  const admin = await requireRole("admin");
  const db = getDb();
  const [libraryCount, mediaCount, licensedCount, archives] = await Promise.all([
    db.select().from(songs).where(eq(songs.churchId, admin.churchId)),
    db.select().from(mediaAssets).where(eq(mediaAssets.churchId, admin.churchId)),
    db.select().from(licensedTranslations).where(eq(licensedTranslations.churchId, admin.churchId)),
    listSermonSummaries(admin.churchId),
  ]);
  const archiveCount = archives.length;

  const products = [
    { name: "FaithFlow Presenter", status: "Active", detail: `${libraryCount.length} songs available for service prep` },
    { name: "FaithFlow Archive", status: archiveCount > 0 ? "Available" : "Preparing", detail: `${archiveCount} archived sermons` },
    { name: "FaithFlow AI", status: "Configured", detail: "Suggestion and archive intelligence surfaces are visible in the admin shell" },
    { name: "FaithFlow Livestream", status: "Future", detail: "Reserved for future rollout without changing Sunday operator flow" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Applications"
        title="Applications and modules"
        description="A product-level view of enabled FaithFlow surfaces, licensed Bible states, and church content readiness."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        {products.map((product) => (
          <AccountCard key={product.name} title={product.name} description={product.detail}>
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-muted-foreground">
              {product.status}
            </div>
          </AccountCard>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <AccountCard title="Bible licenses" description="Licensed translations remain provider- or rights-gated.">
          <div className="text-3xl font-semibold">{licensedCount.filter((item) => item.active).length}</div>
          <div className="mt-2 text-sm text-muted-foreground">active church-level licensed translation connections</div>
        </AccountCard>
        <AccountCard title="Media assets" description="Uploaded visual content in the church workspace.">
          <div className="text-3xl font-semibold">{mediaCount.length}</div>
          <div className="mt-2 text-sm text-muted-foreground">images and videos registered in Media Library</div>
        </AccountCard>
        <AccountCard title="Presenter content" description="Core content that feeds service preparation.">
          <div className="text-3xl font-semibold">{libraryCount.length}</div>
          <div className="mt-2 text-sm text-muted-foreground">songs in church-scoped library</div>
        </AccountCard>
      </div>
    </div>
  );
}
