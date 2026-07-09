import { BookOpen, Lock, ShieldCheck } from "lucide-react";
import { StatusPill } from "@/components/dashboard/DashboardCard";

type PublicTranslation = {
  id: string;
  code: string;
  name: string;
  isPublicDomain: boolean;
};

type LicensedTranslation = {
  id: string;
  displayCode: string;
  displayName: string;
  provider: string;
  active: boolean;
};

const LOCKED_TRANSLATIONS = [
  { code: "NIV", name: "New International Version", holder: "Biblica / Zondervan" },
  { code: "ESV", name: "English Standard Version", holder: "Crossway" },
  { code: "NKJV", name: "New King James Version", holder: "Thomas Nelson" },
  { code: "NLT", name: "New Living Translation", holder: "Tyndale" },
  { code: "MSG", name: "The Message", holder: "NavPress" },
  { code: "NASB", name: "New American Standard Bible", holder: "Lockman Foundation" },
  { code: "AMP", name: "Amplified Bible", holder: "Lockman Foundation" },
  { code: "CSB", name: "Christian Standard Bible", holder: "Holman / Lifeway" },
  { code: "NRSV", name: "New Revised Standard Version", holder: "National Council of Churches" },
  { code: "RSV", name: "Revised Standard Version", holder: "National Council of Churches" },
] as const;

export function BibleTranslationGrid({
  publicTranslations,
  licensedTranslations,
}: {
  publicTranslations: PublicTranslation[];
  licensedTranslations: LicensedTranslation[];
}) {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <div className="eyebrow mb-1">Public Domain</div>
          <h2 className="text-lg font-semibold">Ready for use in FaithFlow</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {publicTranslations.map((translation) => (
            <article key={translation.id} className="rounded-2xl border border-border bg-card/80 p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{translation.name}</div>
                  <div className="text-xs text-muted-foreground">{translation.code}</div>
                </div>
                <BookOpen className="mt-0.5 h-4 w-4 text-cyan-300" />
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                <StatusPill label={translation.isPublicDomain ? "Public domain" : "Built in"} tone="success" />
                <StatusPill label="Included with FaithFlow" tone="brand" />
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                Safe built-in translation for staging scripture, archive summaries, and service preparation.
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <div className="eyebrow mb-1">Licensed</div>
          <h2 className="text-lg font-semibold">Available through provider or church-owned rights</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {LOCKED_TRANSLATIONS.map((translation) => {
            const connected = licensedTranslations.find((item) => item.displayCode === translation.code && item.active);
            return (
              <article key={translation.code} className="rounded-2xl border border-border bg-card/60 p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{translation.name}</div>
                    <div className="text-xs text-muted-foreground">{translation.code} · {translation.holder}</div>
                  </div>
                  {connected ? <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-300" /> : <Lock className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusPill label={connected ? "Connected provider" : "Requires license"} tone={connected ? "success" : "warning"} />
                  <StatusPill label={connected ? connected.provider : "Locked"} />
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {connected
                    ? "Provider connection detected. Treat access as rights-bound content, not bundled FaithFlow text."
                    : "Not bundled in MVP. Enable later through an approved provider or church-owned licensing path."}
                </p>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
