"use client";
import { useState } from "react";
import { approveDesktopPairing, lookupDesktopPairing, type PairLookupView } from "@/lib/desktop-link-actions";

// Two steps: (1) type the code shown on your computer → (2) review the
// requesting device + location + time, then approve. The code is never
// pre-filled from the URL (anti-phishing).

const card: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid #2a2a2a", borderRadius: 10, padding: 14, lineHeight: 1.6, fontSize: 14 };
const primary: React.CSSProperties = { width: "100%", marginTop: 14, padding: "12px 16px", borderRadius: 10, border: 0, background: "linear-gradient(90deg,#ffb861,#e8501a)", color: "#0a0a0a", fontWeight: 600, fontSize: 15, cursor: "pointer" };

export function LinkApproveForm({ showTypeNotice }: { showTypeNotice?: boolean }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [req, setReq] = useState<PairLookupView | null>(null);
  const [geoConfirmed, setGeoConfirmed] = useState(false);
  const [done, setDone] = useState(false);

  async function onLookup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await lookupDesktopPairing(code);
      if (res.ok) { setReq(res.request); setGeoConfirmed(false); }
      else setError(res.error);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onApprove() {
    if (!req) return;
    setBusy(true);
    setError(null);
    try {
      const res = await approveDesktopPairing(code, { confirmedGeoMismatch: req.geoMismatch && geoConfirmed });
      if (res.ok) setDone(true);
      else setError(res.error);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" style={{ background: "rgba(80,200,120,0.12)", border: "1px solid rgba(80,200,120,0.4)", borderRadius: 10, padding: 16, lineHeight: 1.5 }}>
        <strong>Approved.</strong> Go back to the desktop app — it will sign in within a few seconds. You can close this tab.
      </div>
    );
  }

  if (req) {
    const blocked = busy || (req.geoMismatch && !geoConfirmed);
    return (
      <div>
        <div style={card}>
          <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase", letterSpacing: 1 }}>Computer asking to sign in</div>
          <div><strong>Device:</strong> {req.device}</div>
          <div><strong>Approximate location:</strong> {req.location}</div>
          <div><strong>Started:</strong> {new Date(req.startedAt).toLocaleString()}</div>
        </div>
        {req.geoMismatch && (
          <div role="alert" style={{ marginTop: 12, background: "rgba(255,80,60,0.12)", border: "1px solid rgba(255,80,60,0.6)", borderRadius: 10, padding: 14, lineHeight: 1.5, fontSize: 14 }}>
            <strong>Warning: this computer appears to be in a different country from you.</strong> If you did not start this yourself, someone may be trying to get into your account. Do not approve.
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={geoConfirmed} onChange={(e) => setGeoConfirmed(e.target.checked)} style={{ marginTop: 4 }} />
              <span>I understand. This is my computer and I started this myself (for example, I&apos;m using a VPN).</span>
            </label>
          </div>
        )}
        <p style={{ marginTop: 14, marginBottom: 0, fontWeight: 700, fontSize: 15, color: "#ffb861" }}>
          Only approve if you started this on your own computer, right now.
        </p>
        {error && <div role="alert" style={{ color: "#ff8a7a", fontSize: 13, marginTop: 8 }}>{error}</div>}
        <button type="button" onClick={onApprove} disabled={blocked} style={{ ...primary, opacity: blocked ? 0.5 : 1, cursor: blocked ? "not-allowed" : "pointer" }}>
          {busy ? "Approving…" : "Approve this computer"}
        </button>
        <button type="button" onClick={() => { setReq(null); setCode(""); setError(null); }} style={{ ...primary, background: "transparent", border: "1px solid #444", color: "#fff", marginTop: 8 }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onLookup}>
      {showTypeNotice && (
        <div role="note" style={{ ...card, marginBottom: 12 }}>Type the code shown on your computer.</div>
      )}
      <label htmlFor="pair-code" style={{ display: "block", fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Code shown on the desktop app</label>
      <input
        id="pair-code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="XXXX-XXXX"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={12}
        required
        style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 9, border: "1px solid #3a3a3a", background: "#0a0a0a", color: "#fff", fontSize: 22, letterSpacing: 4, fontFamily: "ui-monospace,Menlo,monospace", textAlign: "center" }}
      />
      {error && <div role="alert" style={{ color: "#ff8a7a", fontSize: 13, marginTop: 8 }}>{error}</div>}
      <button type="submit" disabled={busy} style={primary}>
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
