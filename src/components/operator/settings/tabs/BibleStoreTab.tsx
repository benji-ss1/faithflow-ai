"use client";
import { useEffect, useState } from "react";
import { BookOpen, Check } from "lucide-react";
import { SectionHeader } from "./DisplayTab";

// Paid translations — always show as Paid regardless of DB state.
const PAID_CODES = new Set(["AMP", "AMPC", "ASV", "HCSB", "TPT"]);

// Fallback row list mirrors the previous hard-coded set so the tab still
// renders something on API failure. When the /status endpoint returns,
// these are merged with real DB state.
const FALLBACK_ROWS: { code: string; name: string }[] = [
  { code: "KJV", name: "King James Version" },
  { code: "NKJV", name: "New King James Version" },
  { code: "NLT", name: "New Living Translation" },
  { code: "NIV", name: "New International Version" },
  { code: "ESV", name: "English Standard Version" },
  { code: "NASB", name: "New American Standard Bible" },
  { code: "AMP", name: "Amplified Bible" },
  { code: "AMPC", name: "Amplified Bible Classic" },
  { code: "ASV", name: "American Standard Version" },
  { code: "HCSB", name: "Holman Christian Standard" },
  { code: "TPT", name: "The Passion Translation" },
];

type StatusRow = {
  code: string;
  name: string;
  licenseRequired: boolean;
  books: number;
  downloaded: boolean;
  partial: boolean;
};

export function BibleStoreTab({ onUpgrade }: { onUpgrade: () => void }) {
  const [toast, setToast] = useState<string | null>(null);
  const [rows, setRows] = useState<StatusRow[]>(
    FALLBACK_ROWS.map((r) => ({ ...r, licenseRequired: PAID_CODES.has(r.code), books: 0, downloaded: false, partial: false })),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/bible/translations/status", { credentials: "include" });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        if (Array.isArray(j.translations) && j.translations.length > 0) {
          const byCode = new Map<string, StatusRow>();
          for (const t of j.translations as StatusRow[]) byCode.set(t.code.toUpperCase(), t);
          const merged: StatusRow[] = FALLBACK_ROWS.map((f) => {
            const dbrow = byCode.get(f.code.toUpperCase());
            if (dbrow) return dbrow;
            return { code: f.code, name: f.name, licenseRequired: PAID_CODES.has(f.code), books: 0, downloaded: false, partial: false };
          });
          for (const [code, dbrow] of byCode) {
            if (!merged.some((m) => m.code.toUpperCase() === code)) merged.push(dbrow);
          }
          setRows(merged);
        }
      } catch { /* offline / not signed in — keep fallback */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  function download(code: string) {
    // Bulk translation ingestion is a server-side seed job (see
    // scripts/seed-bible.ts) that requires admin credentials and OSIS
    // licensing checks. Rather than expose a toast that promises magic,
    // route the operator to support with a pre-filled email so they can
    // request the translation on their tenant.
    const subject = encodeURIComponent(`Bible translation request: ${code}`);
    const body = encodeURIComponent(
      `Please enable the ${code} translation on my church account.\n\n(Sent from Settings › Bible Store)`,
    );
    const mailto = `mailto:support@presentflow.app?subject=${subject}&body=${body}`;
    if (typeof window !== "undefined") window.location.href = mailto;
    setToast(`Opening email to request ${code}…`);
    setTimeout(() => setToast(null), 2500);
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Bible Translations Store"
        description="Browse and download Bible translations for each language."
      />

      <div className="flex flex-wrap gap-2">
        <span className="text-[11px] px-2.5 py-1 rounded-full inline-flex items-center gap-1.5" style={{ background: "#1a2020", border: "1px solid #2a3232" }}>
          <span>🇬🇧</span>
          <span className="text-zinc-200">English</span>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#6ee7b7" }}>Active</span>
        </span>
        {loading && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-mono self-center" style={{ background: "rgba(56,189,248,0.12)", color: "#7dd3fc" }}>Loading…</span>
        )}
      </div>

      <div className="space-y-1.5">
        {rows.map((r) => {
          const paid = PAID_CODES.has(r.code) || r.licenseRequired;
          return (
            <div
              key={r.code}
              className="flex items-center justify-between h-11 px-3 rounded-md border"
              style={{ borderColor: "#2a3232", background: "#171c1c" }}
            >
              <div className="flex items-center gap-2.5">
                <BookOpen className="w-4 h-4 text-zinc-500" />
                <div>
                  <div className="text-[12px] font-semibold text-zinc-100">{r.code}</div>
                  <div className="text-[10px] text-zinc-500">{r.name}</div>
                </div>
              </div>
              <div>
                {paid ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(249,115,22,0.15)", color: "#fdba74" }}>Paid</span>
                    <button
                      onClick={onUpgrade}
                      className="h-7 px-2.5 rounded-md text-[10px] font-semibold text-white"
                      style={{ background: "#f97316" }}
                    >
                      Upgrade
                    </button>
                  </div>
                ) : r.downloaded ? (
                  <span className="text-[10px] font-mono inline-flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#6ee7b7" }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <Check className="w-3 h-3" /> Downloaded
                  </span>
                ) : r.partial ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: "rgba(234,179,8,0.15)", color: "#fde68a" }}>
                      Partial ({r.books}/66 books)
                    </span>
                    <button
                      onClick={() => download(r.code)}
                      className="h-7 px-2.5 rounded-md text-[10px] font-semibold text-white"
                      style={{ background: "#f97316" }}
                    >
                      Request
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => download(r.code)}
                    className="h-7 px-2.5 rounded-md text-[10px] font-semibold text-white"
                    style={{ background: "#f97316" }}
                  >
                    Request
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-md text-[11px] text-white shadow-2xl" style={{ background: "#1a2020", border: "1px solid #2a3232" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
