"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateChurch } from "@/lib/actions";

type ChurchProfile = {
  name: string;
  timezone: string;
  city: string;
  country: string;
  congregationSize: number | null;
  denomination: string;
};

export function ChurchProfileForm({ initial }: { initial: ChurchProfile }) {
  const [v, setV] = useState<ChurchProfile>(initial);
  const [pending, startTransition] = useTransition();

  const dirty =
    v.name !== initial.name ||
    v.timezone !== initial.timezone ||
    v.city !== initial.city ||
    v.country !== initial.country ||
    v.congregationSize !== initial.congregationSize ||
    v.denomination !== initial.denomination;

  function save() {
    startTransition(async () => {
      const res = await updateChurch({
        name: v.name,
        timezone: v.timezone,
        city: v.city || null,
        country: v.country || null,
        congregationSize: v.congregationSize,
        denomination: v.denomination || null,
      });
      if (res.ok) { toast.success("Church profile saved"); return; }
      toast.error(res.error || "Could not save");
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Church name" required>
          <input
            className={inputCls}
            value={v.name}
            maxLength={200}
            onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))}
          />
        </Field>
        <Field label="Timezone" hint="IANA name, e.g. Europe/London">
          <input
            className={inputCls}
            value={v.timezone}
            maxLength={64}
            onChange={(e) => setV((s) => ({ ...s, timezone: e.target.value }))}
          />
        </Field>
        <Field label="City">
          <input
            className={inputCls}
            value={v.city}
            maxLength={120}
            onChange={(e) => setV((s) => ({ ...s, city: e.target.value }))}
          />
        </Field>
        <Field label="Country">
          <input
            className={inputCls}
            value={v.country}
            maxLength={120}
            onChange={(e) => setV((s) => ({ ...s, country: e.target.value }))}
          />
        </Field>
        <Field label="Congregation size" hint="Approximate — used for planning defaults">
          <input
            className={inputCls}
            inputMode="numeric"
            value={v.congregationSize?.toString() ?? ""}
            onChange={(e) => {
              const s = e.target.value.trim();
              setV((prev) => ({ ...prev, congregationSize: s === "" ? null : Number(s.replace(/[^0-9]/g, "")) || 0 }));
            }}
          />
        </Field>
        <Field label="Denomination">
          <input
            className={inputCls}
            value={v.denomination}
            maxLength={120}
            onChange={(e) => setV((s) => ({ ...s, denomination: e.target.value }))}
          />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2">
        {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending || !v.name.trim() || !v.timezone.trim()}
          className="h-10 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-[var(--color-primary)]/70";

function Field({ label, hint, required, children }: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
        {required ? <span className="text-[10px] normal-case tracking-normal text-[var(--color-primary)]">required</span> : null}
      </label>
      {children}
      {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
