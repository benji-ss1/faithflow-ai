"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateChurchProfile, deleteChurchAccount } from "@/lib/onboarding-actions";

const CONGREGATION_BUCKETS = [
  { label: "Under 50", value: 25 },
  { label: "50-150", value: 100 },
  { label: "150-500", value: 300 },
  { label: "500+", value: 750 },
] as const;

const DENOMINATIONS = ["Non-denominational", "Catholic", "Protestant", "Pentecostal", "Other"] as const;

type Church = {
  name: string;
  city: string | null;
  country: string | null;
  timezone: string;
  congregationSize: number | null;
  denomination: string | null;
};

function nearestBucket(size: number | null): number {
  if (size == null) return 100;
  let best: number = CONGREGATION_BUCKETS[0].value;
  for (const b of CONGREGATION_BUCKETS) {
    if (Math.abs(b.value - size) < Math.abs(best - size)) best = b.value;
  }
  return best;
}

export function ChurchProfileForm({ church }: { church: Church }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(church.name);
  const [city, setCity] = useState(church.city ?? "");
  const [country, setCountry] = useState(church.country ?? "");
  const [timezone, setTimezone] = useState(church.timezone);
  const [congregationSize, setCongregationSize] = useState<number>(nearestBucket(church.congregationSize));
  const [denomination, setDenomination] = useState<string>(church.denomination ?? "Non-denominational");
  const [confirmName, setConfirmName] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  function save() {
    startTransition(async () => {
      const res = await updateChurchProfile({
        name: name.trim(),
        city: city.trim() || undefined,
        country: country.trim() || undefined,
        timezone: timezone || "UTC",
        congregationSize,
        denomination,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Church profile saved");
      router.refresh();
    });
  }

  function del() {
    startTransition(async () => {
      const res = await deleteChurchAccount(confirmName);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Church deleted");
      window.location.href = "/onboarding";
    });
  }

  const inputCls = "w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm text-[#f1ede6] placeholder:text-[#6f685e] focus:border-[#ff7a2c] focus:outline-none";
  const labelCls = "mb-1.5 block text-[11px] uppercase tracking-[0.14em] text-[#847d72]";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h3 className="mb-1 text-base font-semibold text-[#f1ede6]">Church details</h3>
        <p className="mb-5 text-sm text-[#847d72]">Editable identity and location. Changes save when you click Save.</p>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={labelCls}>Church name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>City</label>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Dublin" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Country</label>
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Ireland" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Congregation size</label>
            <select value={congregationSize} onChange={(e) => setCongregationSize(Number(e.target.value))} className={inputCls}>
              {CONGREGATION_BUCKETS.map((b) => (<option key={b.value} value={b.value}>{b.label}</option>))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Denomination</label>
            <select value={denomination} onChange={(e) => setDenomination(e.target.value)} className={inputCls}>
              {DENOMINATIONS.map((d) => (<option key={d} value={d}>{d}</option>))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Timezone</label>
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/Dublin" className={inputCls} />
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-xl bg-gradient-to-r from-[#ff9048] to-[#ff7a2c] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#ff7a2c]/25 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-red-500/25 bg-red-500/[0.04] p-6">
        <h3 className="mb-1 text-base font-semibold text-red-300">Danger zone</h3>
        <p className="mb-4 text-sm text-red-200/70">
          Deletes the church, every service plan, every song, every media asset. Cannot be undone. Team members are detached and returned to onboarding.
        </p>
        {!confirmOpen ? (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/20"
          >
            Delete church account…
          </button>
        ) : (
          <div className="space-y-3">
            <label className={labelCls}>Type <span className="text-red-300 font-semibold">{church.name}</span> to confirm</label>
            <input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              className={inputCls}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={del}
                disabled={pending || confirmName !== church.name}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {pending ? "Deleting…" : "Permanently delete"}
              </button>
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); setConfirmName(""); }}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-[#c4bcaf]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
