"use client";
import { useState } from "react";
import { BookOpen, Check } from "lucide-react";
import { SectionHeader } from "./DisplayTab";

type Row = { code: string; name: string; kind: "free" | "paid"; downloaded?: boolean };

const ROWS: Row[] = [
  { code: "KJV", name: "King James Version", kind: "free", downloaded: true },
  { code: "NKJV", name: "New King James Version", kind: "free", downloaded: true },
  { code: "NLT", name: "New Living Translation", kind: "free", downloaded: true },
  { code: "NIV", name: "New International Version", kind: "free", downloaded: true },
  { code: "ESV", name: "English Standard Version", kind: "free", downloaded: true },
  { code: "NASB", name: "New American Standard Bible", kind: "free", downloaded: true },
  { code: "AMP", name: "Amplified Bible", kind: "paid" },
  { code: "AMPC", name: "Amplified Bible Classic", kind: "paid" },
  { code: "ASV", name: "American Standard Version", kind: "paid" },
  { code: "HCSB", name: "Holman Christian Standard", kind: "paid" },
  { code: "TPT", name: "The Passion Translation", kind: "paid" },
];

export function BibleStoreTab({ onUpgrade }: { onUpgrade: () => void }) {
  const [toast, setToast] = useState<string | null>(null);

  function download(code: string) {
    setToast(`Bible download for ${code} — coming soon`);
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
        <span className="text-[10px] px-2 py-0.5 rounded-full font-mono self-center" style={{ background: "rgba(56,189,248,0.12)", color: "#7dd3fc" }}>Bundled</span>
      </div>

      <div className="space-y-1.5">
        {ROWS.map((r) => (
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
              {r.kind === "free" && r.downloaded && (
                <span className="text-[10px] font-mono inline-flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#6ee7b7" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <Check className="w-3 h-3" /> Downloaded
                </span>
              )}
              {r.kind === "free" && !r.downloaded && (
                <button
                  onClick={() => download(r.code)}
                  className="h-7 px-2.5 rounded-md text-[10px] font-semibold text-white"
                  style={{ background: "#f97316" }}
                >
                  Download
                </button>
              )}
              {r.kind === "paid" && (
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
              )}
            </div>
          </div>
        ))}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-md text-[11px] text-white shadow-2xl" style={{ background: "#1a2020", border: "1px solid #2a3232" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
