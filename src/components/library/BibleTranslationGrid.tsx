"use client";
import { useState } from "react";
import { BookOpen, Lock, ShieldCheck, X } from "lucide-react";
import { StatusPill } from "@/components/dashboard/DashboardCard";
import { BIBLE_PROVENANCE } from "@/lib/bible-provenance";

type PublicTranslation = {
  id: string;
  code: string;
  name: string;
  isPublicDomain: boolean;
  licenseRequired: boolean;
};

type LicensedSlot = {
  id: string;
  code: string;
  name: string;
  isPublicDomain: boolean;
  licenseRequired: boolean;
};

type LicensedTranslation = {
  id: string;
  displayCode: string;
  displayName: string;
  provider: string;
  active: boolean;
};

const HOLDERS: Record<string, string> = {
  NIV: "Biblica / Zondervan",
  ESV: "Crossway",
  NKJV: "Thomas Nelson",
};

export function BibleTranslationGrid({
  publicTranslations,
  licensedSlots,
  licensedTranslations,
}: {
  publicTranslations: PublicTranslation[];
  licensedSlots: LicensedSlot[];
  licensedTranslations: LicensedTranslation[];
}) {
  const [openCode, setOpenCode] = useState<string | null>(null);
  const modalProv = openCode ? BIBLE_PROVENANCE[openCode] : null;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <div className="eyebrow mb-1">Public Domain</div>
          <h2 className="text-lg font-semibold">Ready for use in PresentFlow</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {publicTranslations.map((translation) => {
            const prov = BIBLE_PROVENANCE[translation.code];
            return (
              <article key={translation.id} className="rounded-2xl border border-border bg-card/80 p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{translation.name}</div>
                    <div className="text-xs text-muted-foreground">{translation.code}{prov ? ` · ${prov.originalYear}` : ""}</div>
                  </div>
                  <BookOpen className="mt-0.5 h-4 w-4 text-cyan-300" />
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusPill label={translation.isPublicDomain ? "Public domain" : "Built in"} tone="success" />
                  <StatusPill label="Included with PresentFlow" tone="brand" />
                  {prov?.uncertain ? <StatusPill label="Provenance flag" tone="warning" /> : null}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {prov?.caveats || "Safe built-in translation for staging scripture, archive summaries, and service preparation."}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <div className="eyebrow mb-1">Licensed</div>
          <h2 className="text-lg font-semibold">Requires licensing agreement</h2>
          <p className="text-xs text-muted-foreground mt-1">
            No verse text is stored in PresentFlow for these translations. Access is enabled through an approved provider.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {licensedSlots.map((translation) => {
            const connected = licensedTranslations.find((item) => item.displayCode === translation.code && item.active);
            const holder = HOLDERS[translation.code] || "Publisher";
            return (
              <article key={translation.code} className="rounded-2xl border border-border bg-card/60 p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{translation.name}</div>
                    <div className="text-xs text-muted-foreground">{translation.code} · {holder}</div>
                  </div>
                  {connected ? <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-300" /> : <Lock className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusPill label={connected ? "Connected provider" : "Requires licensing agreement"} tone={connected ? "success" : "warning"} />
                  <StatusPill label={connected ? connected.provider : "Locked"} />
                </div>
                <p className="text-xs leading-5 text-muted-foreground mb-3">
                  {connected
                    ? "Provider connection detected. Treat access as rights-bound content, not bundled PresentFlow text."
                    : "Not bundled in PresentFlow. Enable later through an approved provider or church-owned licensing path."}
                </p>
                {!connected ? (
                  <button
                    type="button"
                    onClick={() => setOpenCode(translation.code)}
                    className="text-xs font-medium underline text-muted-foreground hover:text-foreground"
                  >
                    See licensing path
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {modalProv ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpenCode(null)}
        >
          <div
            className="max-w-md w-full rounded-2xl border border-border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-semibold">{modalProv.name}</div>
                <div className="text-xs text-muted-foreground">{modalProv.code} · Requires licensing agreement</div>
              </div>
              <button type="button" onClick={() => setOpenCode(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground mb-3">
              PresentFlow does not bundle any {modalProv.code} verse text. To display this translation the request must be routed through an approved provider.
            </p>
            <div className="text-xs font-medium mb-1">Planned providers</div>
            <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground mb-3">
              <li><strong>Faithlife / Logos API</strong> — churchwide licence.</li>
              <li><strong>YouVersion / Bible.com API</strong> — developer approval required.</li>
              <li><strong>Bible Gateway API</strong> — per-lookup rate limits.</li>
            </ul>
            <p className="text-xs leading-5 text-muted-foreground">
              {modalProv.textSource}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
