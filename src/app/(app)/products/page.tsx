import { PageHeader } from "@/components/layout/PageHeader";
import { AccountCard } from "@/components/account/AccountCard";

const PRODUCTS = [
  {
    name: "Motion backgrounds",
    description: "Premium visual loops and ambient backgrounds for church media teams.",
    state: "Future marketplace",
  },
  {
    name: "Sermon graphics packs",
    description: "Original media bundles for title slides, lower thirds, and event graphics.",
    state: "Curated add-on",
  },
  {
    name: "Church media templates",
    description: "Presentation and archive templates that extend the main FaithFlow workspace.",
    state: "Not in MVP",
  },
] as const;

export default function ProductsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Marketplace"
        title="Get more products"
        description="A future-facing product shelf for add-ons and media packs. Useful for premium expansion later, but intentionally not part of the core MVP path."
      />
      <div className="grid gap-4 xl:grid-cols-3">
        {PRODUCTS.map((product) => (
          <AccountCard key={product.name} title={product.name} description={product.description}>
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-muted-foreground">
              {product.state}
            </div>
          </AccountCard>
        ))}
      </div>
    </div>
  );
}
