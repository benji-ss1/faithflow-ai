import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/layout/PageHeader";

export default async function LicensedBiblePage() {
  await requireUser();
  return (
    <div>
      <PageHeader
        eyebrow="Library / Bible"
        title="Licensed translations"
        description="NIV, ESV, NKJV, NLT and other copyrighted translations require a licensed provider integration."
      />
      <div className="space-y-4 max-w-2xl text-sm">
        <p>
          FaithFlow currently ships with the two public-domain translations that don&apos;t
          need a licence: <strong>KJV</strong> (King James Version) and <strong>WEB</strong> (World English Bible).
          To display copyrighted translations we have to route requests through an
          approved provider so verses aren&apos;t cached or redistributed in ways that
          violate the publisher&apos;s terms.
        </p>
        <div className="border border-border rounded-md p-4">
          <div className="font-medium mb-2">Planned providers</div>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>
              <strong>Faithlife / Logos API</strong> — best for NIV, NKJV, NLT with an
              existing Logos subscription. Ships as a churchwide licence.
            </li>
            <li>
              <strong>YouVersion / Bible.com API</strong> — massive translation catalogue,
              requires developer approval and attribution.
            </li>
            <li>
              <strong>American Bible Society / Bible Gateway API</strong> — ESV and NIV
              with per-lookup rate limits; suitable for smaller churches.
            </li>
          </ul>
        </div>
        <p className="text-muted-foreground text-xs">
          When licensed access is enabled we will add a connect flow here so the
          admin can enter their provider credentials and pick which translations
          to expose to operators.
        </p>
      </div>
    </div>
  );
}
