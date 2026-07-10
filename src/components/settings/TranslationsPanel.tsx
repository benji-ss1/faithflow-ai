import { BIBLE_PROVENANCE } from "@/lib/bible-provenance";
import { Lock, BookOpen, AlertTriangle } from "lucide-react";

type Translation = {
  id: string;
  code: string;
  name: string;
  isPublicDomain: boolean;
  licenseRequired: boolean;
};

export function TranslationsPanel({ translations }: { translations: Translation[] }) {
  const publicOnes = translations.filter((t) => !t.licenseRequired);
  const licensed = translations.filter((t) => t.licenseRequired);

  return (
    <section className="rounded-2xl border border-border bg-card/60 p-5">
      <div className="mb-3">
        <div className="eyebrow mb-1">Translations</div>
        <h2 className="text-lg font-semibold">Provenance & licensing</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Every bundled translation is documented for legal provenance. Licensed slots have no verse text stored; contact licensing to enable.
        </p>
      </div>

      <div className="space-y-3">
        {publicOnes.map((t) => {
          const prov = BIBLE_PROVENANCE[t.code];
          return (
            <div key={t.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <BookOpen className="h-3.5 w-3.5 text-cyan-300" />
                    {prov?.fullName || t.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.code} · Original {prov?.originalYear || "?"} · {prov?.verified === "checked-against-original" ? "Checked against original" : "Trusted community typeset"}
                    {prov?.uncertain ? " · Provenance flag" : ""}
                  </div>
                </div>
                {prov?.uncertain ? <AlertTriangle className="h-4 w-4 text-amber-400" /> : null}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                <strong>PD basis:</strong> {prov?.pdJustification || "Public domain."}
              </p>
              <p className="text-xs leading-5 text-muted-foreground mt-1">
                <strong>Source:</strong> {prov?.textSource || "—"}
              </p>
              {prov?.caveats ? (
                <p className="text-xs leading-5 text-amber-300/90 mt-1">
                  <strong>Caveats:</strong> {prov.caveats}
                </p>
              ) : null}
            </div>
          );
        })}

        {licensed.map((t) => {
          const prov = BIBLE_PROVENANCE[t.code];
          return (
            <div key={t.id} className="rounded-lg border border-border bg-card/40 p-3">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    {prov?.fullName || t.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.code} · Original {prov?.originalYear || "?"} · Under copyright
                  </div>
                </div>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                Not yet configured — contact licensing to enable via {prov?.textSource || "an approved provider"}.
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
