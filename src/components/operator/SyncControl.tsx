"use client";
/**
 * Networked-projector-sync control for the operator toolbar.
 *
 * Behaviour:
 *  - Idle: shows a "Sync devices" button. Clicking mints a fresh pair code
 *    (server-side, church-scoped, rate-limited).
 *  - Active: shows "SYNC: <CODE>" pill. Click reveals a popover with:
 *      • the code, big + copyable
 *      • an inline QR image pointing at /live?pair=<CODE>
 *      • a Revoke button
 *  - The `onCodeChange` callback tells the parent to also publish OutputState
 *    on the Supabase Realtime channel `ff-out-<code>` in addition to the
 *    same-machine BroadcastChannel.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { mintPairCode, revokePairCode } from "@/lib/device-pair-actions";

const STORAGE_KEY = "faithflow.sync.pairCode";
const STORAGE_EXP_KEY = "faithflow.sync.pairExpiresAt";

export function SyncControl({ planId, onCodeChange }: {
  planId?: string;
  onCodeChange: (code: string | null) => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  // Restore session-scoped code from localStorage. If expired, drop it.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const exp = localStorage.getItem(STORAGE_EXP_KEY);
      if (stored && exp && Number(exp) > Date.now()) {
        setCode(stored);
        setExpiresAt(Number(exp));
        onCodeChange(stored);
      } else {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_EXP_KEY);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mint = useCallback(async () => {
    setBusy(true);
    try {
      const res = await mintPairCode({ planId, screenKind: "projector" });
      if (!res.ok) { toast.error(res.error); return; }
      const exp = new Date(res.data.expiresAt).getTime();
      setCode(res.data.code);
      setExpiresAt(exp);
      try {
        localStorage.setItem(STORAGE_KEY, res.data.code);
        localStorage.setItem(STORAGE_EXP_KEY, String(exp));
      } catch { /* ignore */ }
      onCodeChange(res.data.code);
      setShowPanel(true);
      toast.success(`Sync code minted: ${res.data.code}`);
    } finally {
      setBusy(false);
    }
  }, [planId, onCodeChange]);

  const revoke = useCallback(async () => {
    if (!code) return;
    setBusy(true);
    try {
      const res = await revokePairCode(code);
      if (!res.ok) { toast.error(res.error); return; }
      setCode(null);
      setExpiresAt(null);
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_EXP_KEY);
      } catch { /* ignore */ }
      onCodeChange(null);
      setShowPanel(false);
      toast.success("Sync code revoked");
    } finally {
      setBusy(false);
    }
  }, [code, onCodeChange]);

  const copy = useCallback(() => {
    if (!code) return;
    try {
      navigator.clipboard.writeText(code);
      toast.success("Code copied");
    } catch {
      toast.error("Copy failed");
    }
  }, [code]);

  if (!code) {
    return (
      <button
        type="button"
        onClick={mint}
        disabled={busy}
        className="text-[11px] font-mono uppercase tracking-widest px-2 py-1 rounded border border-white/15 text-white/70 hover:text-white hover:border-white/30 disabled:opacity-50"
        title="Mint a pair code to sync a projector on another device"
      >
        {busy ? "…" : "Sync devices"}
      </button>
    );
  }

  const url = typeof window !== "undefined"
    ? `${window.location.origin}/live?pair=${code}`
    : `/live?pair=${code}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
  const hoursLeft = expiresAt ? Math.max(0, Math.round((expiresAt - Date.now()) / 3_600_000)) : null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowPanel((v) => !v)}
        className="text-[11px] font-mono uppercase tracking-widest px-2 py-1 rounded border border-emerald-400/40 text-emerald-300 hover:border-emerald-300"
        title="Networked projector sync active"
      >
        SYNC: {code}
      </button>
      {showPanel && (
        <div className="absolute right-0 mt-2 w-64 z-50 bg-neutral-950 border border-white/10 rounded-md shadow-xl p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-white/50">Sync code</div>
          <button type="button" onClick={copy} className="text-2xl font-mono font-semibold text-emerald-300 hover:text-emerald-200 block">{code}</button>
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="QR code" width={140} height={140} className="bg-white p-1 rounded" />
          </div>
          <div className="text-[10px] text-white/50 break-all">{url}</div>
          {hoursLeft !== null && (
            <div className="text-[10px] text-white/40">Expires in ~{hoursLeft}h</div>
          )}
          <button
            type="button"
            onClick={revoke}
            disabled={busy}
            className="w-full text-[11px] uppercase tracking-widest py-1 rounded border border-red-400/40 text-red-300 hover:border-red-300 disabled:opacity-50"
          >Revoke</button>
        </div>
      )}
    </div>
  );
}
