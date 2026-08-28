"use client";
// Desktop OBS Browser-Source overlay control (Hardware → Screens). Lets a desktop
// operator create the cross-machine OBS overlay link WITHOUT the web-only
// SyncControl (which collides with the desktop toolbar). Minting a code announces
// it via a window event so OperatorConsole publishes live state on that channel;
// the OBS Browser Source on a second computer then receives the lyrics.
//
// For SAME-machine OBS you don't need this — use the native Livestream output
// window (the "Livestream" role + OBS mode above). This is for a SEPARATE
// broadcast computer.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { mintPairCode, revokePairCode } from "@/lib/device-pair-actions";

const CODE_KEY = "presentflow.obs.pairCode";
const CHURCH_KEY = "presentflow.obs.pairChurch";
const EXP_KEY = "presentflow.obs.pairExpiresAt";

function announce(code: string | null) {
  try { window.dispatchEvent(new CustomEvent("presentflow:obs-pair-code", { detail: { code } })); } catch { /* ignore */ }
}
function obsUrl(code: string, churchId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const churchQ = churchId ? `&church=${encodeURIComponent(churchId)}` : "";
  return `${origin}/livestream?bg=transparent&pair=${code}${churchQ}`;
}

export function ObsOverlayCard() {
  const [code, setCode] = useState<string | null>(null);
  const [churchId, setChurchId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Restore + re-announce a still-valid code on mount (so publishing resumes
  // after an app reload without re-minting).
  useEffect(() => {
    try {
      const c = localStorage.getItem(CODE_KEY);
      const ch = localStorage.getItem(CHURCH_KEY) || "";
      const exp = localStorage.getItem(EXP_KEY);
      if (c && exp && Number(exp) > Date.now()) { setCode(c); setChurchId(ch); announce(c); }
      else { localStorage.removeItem(CODE_KEY); localStorage.removeItem(CHURCH_KEY); localStorage.removeItem(EXP_KEY); }
    } catch { /* ignore */ }
  }, []);

  const create = useCallback(async () => {
    setBusy(true);
    try {
      const res = await mintPairCode({ screenKind: "stream", label: "OBS overlay" });
      if (!res.ok) { toast.error(res.error); return; }
      setCode(res.data.code); setChurchId(res.data.churchId);
      announce(res.data.code);
      try {
        localStorage.setItem(CODE_KEY, res.data.code);
        localStorage.setItem(CHURCH_KEY, res.data.churchId);
        localStorage.setItem(EXP_KEY, String(new Date(res.data.expiresAt).getTime()));
      } catch { /* ignore */ }
      toast.success("OBS overlay link created");
    } finally { setBusy(false); }
  }, []);

  const revoke = useCallback(async () => {
    if (!code) return;
    setBusy(true);
    try {
      await revokePairCode(code).catch(() => {});
      setCode(null); setChurchId("");
      announce(null);
      try { localStorage.removeItem(CODE_KEY); localStorage.removeItem(CHURCH_KEY); localStorage.removeItem(EXP_KEY); } catch { /* ignore */ }
      toast.success("OBS overlay link revoked");
    } finally { setBusy(false); }
  }, [code]);

  const copy = useCallback(async () => {
    if (!code) return;
    const url = obsUrl(code, churchId);
    // navigator.clipboard.writeText() is async and REJECTS on a blocked/non-secure
    // context — a sync try/catch would toast "copied" while nothing landed. Await
    // it, and fall back to a hidden-textarea execCommand copy (works in Electron /
    // http origins where the async Clipboard API is unavailable).
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast.success("OBS overlay URL copied");
        return;
      }
      throw new Error("clipboard unavailable");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) toast.success("OBS overlay URL copied");
        else toast.error("Couldn't copy — select the link and copy it manually");
      } catch {
        toast.error("Couldn't copy — select the link and copy it manually");
      }
    }
  }, [code, churchId]);

  return (
    <div className="rounded-md border border-[var(--color-border)] p-3 space-y-2">
      <div className="eyebrow">OBS overlay — different computer</div>
      {!code ? (
        <>
          <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">
            Create a link that shows your lyrics as a transparent overlay in OBS on a <span className="text-[var(--color-foreground)]">separate broadcast computer</span> on the same network.
          </p>
          <button type="button" onClick={create} disabled={busy}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-md border border-[var(--color-brand)]/50 text-[var(--color-brand)] hover:border-[var(--color-brand)] disabled:opacity-40">
            {busy ? "Creating…" : "Create OBS overlay link"}
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={copy}
            className="w-full text-left text-[10px] font-mono text-sky-400 hover:text-sky-300 break-all" title="Copy the OBS Browser Source URL">
            {obsUrl(code, churchId)}
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={copy}
              className="text-[11px] font-semibold px-3 py-1 rounded-md border border-sky-500/50 text-sky-400 hover:border-sky-400">Copy OBS URL</button>
            <button type="button" onClick={revoke} disabled={busy}
              className="text-[11px] font-semibold px-3 py-1 rounded-md border border-red-500/50 text-red-400 hover:border-red-400 disabled:opacity-40">Revoke</button>
          </div>
        </>
      )}
      <button type="button" onClick={() => setShowHelp((v) => !v)}
        className="w-full text-left text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] flex items-center gap-1">
        <span className="inline-block w-2">{showHelp ? "▾" : "▸"}</span> How to add it in OBS
      </button>
      {showHelp && (
        <ol className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed list-decimal pl-4 space-y-0.5">
          <li>On the broadcast PC, open OBS.</li>
          <li>Sources → <span className="text-[var(--color-foreground)]">+ → Browser</span>.</li>
          <li>Paste this URL; set <span className="text-[var(--color-foreground)]">Width 1920, Height 1080</span>.</li>
          <li>Drag it <span className="text-[var(--color-foreground)]">above your camera</span> source.</li>
          <li>Both computers must be on the same network. The link stays live until you revoke it.</li>
        </ol>
      )}
    </div>
  );
}
