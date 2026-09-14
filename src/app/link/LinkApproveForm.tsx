"use client";
import { useState } from "react";
import { approveDesktopPairing } from "@/lib/desktop-link-actions";

export function LinkApproveForm({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await approveDesktopPairing(code);
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

  return (
    <form onSubmit={onSubmit}>
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
      <button type="submit" disabled={busy} style={{ width: "100%", marginTop: 14, padding: "12px 16px", borderRadius: 10, border: 0, background: "linear-gradient(90deg,#ffb861,#e8501a)", color: "#0a0a0a", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
        {busy ? "Approving…" : "Approve this computer"}
      </button>
    </form>
  );
}
