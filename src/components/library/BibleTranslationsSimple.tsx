"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BookOpen, ShieldCheck, Lock } from "lucide-react";
import { updatePreferences } from "@/lib/actions";

type Card = {
  id: string;
  code: string;
  name: string;
  status: "included" | "licensed";
  description: string;
};

export function BibleTranslationsSimple({
  cards,
  selectableTranslations,
  defaultTranslationId,
}: {
  cards: Card[];
  selectableTranslations: { id: string; code: string; name: string }[];
  defaultTranslationId: string;
}) {
  const [selected, setSelected] = useState(defaultTranslationId);
  const [pending, startTransition] = useTransition();

  function onChange(id: string) {
    const prev = selected;
    setSelected(id);
    startTransition(async () => {
      const res = await updatePreferences({ defaultTranslationId: id });
      if (!res.ok) {
        setSelected(prev);
        toast.error(res.error || "Could not update default translation");
      } else {
        toast.success("Default translation updated");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card/80 p-4">
        <label htmlFor="default-translation" className="block text-sm font-medium mb-2">
          Default translation
        </label>
        <select
          id="default-translation"
          value={selected}
          disabled={pending}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full max-w-sm rounded-xl border border-border bg-background px-3 text-sm"
        >
          {selectableTranslations.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.code})
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-muted-foreground">
          Used when scripture is projected without an explicit translation.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <article key={c.code} className="rounded-2xl border border-border bg-card/80 p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{c.name}</div>
                <span className="mt-1 inline-flex items-center rounded bg-[var(--pf-admin-bg-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--pf-admin-text-muted)]">
                  {c.code}
                </span>
              </div>
              {c.status === "included" ? (
                <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-500" />
              ) : (
                <Lock className="mt-0.5 h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <div className="mb-2">
              {c.status === "included" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  <BookOpen className="h-3 w-3" /> Included
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Requires license
                </span>
              )}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{c.description}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
