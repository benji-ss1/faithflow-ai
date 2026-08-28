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

const STORAGE_KEY = "presentflow.sync.pairCode";
const STORAGE_EXP_KEY = "presentflow.sync.pairExpiresAt";

// Robust copy: await the async Clipboard API, fall back to a hidden-textarea
// execCommand copy for Electron / non-secure origins where writeText rejects or
// is unavailable. Returns true only when the text actually reached the clipboard.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to execCommand */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

export function SyncControl({ planId, churchId, onCodeChange }: {
  planId?: string;
  churchId?: string;
  onCodeChange: (code: string | null) => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [showObsHelp, setShowObsHelp] = useState(false);

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

  const copy = useCallback(async () => {
    if (!code) return;
    // writeText() is async and rejects on insecure/blocked contexts — a sync
    // try/catch would toast success while nothing copied. Await + fallback.
    if (await copyToClipboard(code)) toast.success("Code copied");
    else toast.error("Couldn't copy — select the code and copy it manually");
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

  // Y8: include churchId so remote projectors join the church-scoped
  // Realtime channel (`ff-out-<churchId>-<CODE>`). Older projectors that only
  // pass `?pair=CODE` continue to work via the legacy unscoped channel.
  const churchQ = churchId ? `&church=${encodeURIComponent(churchId)}` : "";
  const url = typeof window !== "undefined"
    ? `${window.location.origin}/live?pair=${code}${churchQ}`
    : `/live?pair=${code}${churchQ}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
  const hoursLeft = expiresAt ? Math.max(0, Math.round((expiresAt - Date.now()) / 3_600_000)) : null;

  // OBS / livestream TRANSPARENT overlay URL (bg=transparent → alpha lyrics for
  // an OBS Browser Source over the camera). Shares the SAME pair code, so it
  // follows LIVE and updates on every slide change on the broadcast machine.
  const obsUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/livestream?bg=transparent&pair=${code}${churchQ}`;
  const copyObs = async () => {
    if (await copyToClipboard(obsUrl)) toast.success("OBS overlay URL copied");
    else toast.error("Couldn't copy — select the link and copy it manually");
  };

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
          {/* OBS transparent lyrics overlay — for the livestream team. */}
          <div className="pt-2 mt-1 border-t border-white/10 space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-white/50">OBS overlay (transparent)</div>
            <button
              type="button"
              onClick={copyObs}
              className="w-full text-[10px] text-left font-mono text-sky-300 hover:text-sky-200 break-all"
              title="Copy the OBS Browser Source URL"
            >{obsUrl}</button>
            <button
              type="button"
              onClick={copyObs}
              className="w-full text-[10px] uppercase tracking-widest py-1 rounded border border-sky-400/40 text-sky-300 hover:border-sky-300"
            >Copy OBS URL</button>
            {/* Collapsible in-app setup guide — lives with the Copy button so the
                livestream team can follow the steps + do a quick test without
                leaving the app. Full runbook: docs/OBS_OVERLAY_SETUP.md. */}
            <button
              type="button"
              onClick={() => setShowObsHelp((v) => !v)}
              className="w-full text-left text-[10px] text-white/50 hover:text-white/80 flex items-center gap-1"
              aria-expanded={showObsHelp}
            >
              <span className="inline-block w-2 text-white/40">{showObsHelp ? "▾" : "▸"}</span>
              How to set up in OBS
            </button>
            {showObsHelp && (
              <div className="space-y-1.5 pt-0.5">
                <ol className="text-[9px] text-white/50 leading-relaxed list-decimal pl-4 space-y-0.5">
                  <li>Tap <span className="text-white/70">Copy OBS URL</span> above.</li>
                  <li>In OBS: <span className="text-white/70">Sources → + → Browser</span>, click OK.</li>
                  <li>Paste the URL; set <span className="text-white/70">Width 1920, Height 1080</span>; OK.</li>
                  <li>In Sources, drag the new item <span className="text-white/70">above your Camera</span>.</li>
                </ol>
                <div className="text-[9px] text-amber-300/70 leading-snug">
                  Test before the service: project a slide → words show over the camera; clear it → camera is clean.
                </div>
                <div className="text-[9px] text-white/35 leading-snug">
                  Words appear see-through over your live camera and follow every slide. View-only — it can’t change anything. On another PC? Both must share this network &amp; sync code.
                </div>
              </div>
            )}
          </div>
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
