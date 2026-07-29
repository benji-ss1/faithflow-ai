"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updatePreferences, updateSettings } from "@/lib/actions";

type Translation = { id: string; code: string; name: string };
type Initial = { defaultTranslationId: string | null; blankBgColor: string };

export function WorshipDefaultsForm({ translations, initial }: {
  translations: Translation[]; initial: Initial;
}) {
  const [translationId, setTranslationId] = useState(initial.defaultTranslationId ?? "");
  const [blankColor, setBlankColor] = useState(initial.blankBgColor);
  const [pending, startTransition] = useTransition();

  const dirty =
    (translationId || null) !== (initial.defaultTranslationId ?? null) ||
    blankColor.toLowerCase() !== initial.blankBgColor.toLowerCase();

  function save() {
    startTransition(async () => {
      const jobs: Promise<{ ok: boolean; error?: string }>[] = [];
      if ((translationId || null) !== (initial.defaultTranslationId ?? null)) {
        jobs.push(updatePreferences({ defaultTranslationId: translationId || null }));
      }
      if (blankColor.toLowerCase() !== initial.blankBgColor.toLowerCase()) {
        jobs.push(updateSettings({ blankBgColor: blankColor }));
      }
      const results = await Promise.all(jobs);
      const failed = results.find((r) => !r.ok);
      if (failed) { toast.error(failed.error || "Could not save worship defaults"); return; }
      toast.success("Worship defaults saved");
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Default Bible translation</div>
          <select
            value={translationId}
            onChange={(e) => setTranslationId(e.target.value)}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-[var(--pf-admin-accent)]/70"
          >
            <option value="">Not set</option>
            {translations.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
            ))}
          </select>
          <div className="mt-1 text-[11px] text-muted-foreground">Used when scripture is projected without an explicit translation.</div>
        </label>

        <label className="block">
          <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Blank screen color</div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={blankColor}
              onChange={(e) => setBlankColor(e.target.value)}
              className="h-10 w-14 shrink-0 cursor-pointer rounded-lg border border-border bg-background"
            />
            <input
              type="text"
              value={blankColor}
              maxLength={7}
              onChange={(e) => setBlankColor(e.target.value)}
              placeholder="#000000"
              className="h-10 w-full rounded-xl border border-border bg-background px-3 font-mono text-sm outline-none focus:border-[var(--pf-admin-accent)]/70"
            />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">What the projector shows for &ldquo;blank&rdquo; slides.</div>
        </label>
      </div>

      <div className="flex items-center justify-end gap-2">
        {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="h-10 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save defaults"}
        </button>
      </div>
    </div>
  );
}
