"use client";
import { useEffect, useRef, useState } from "react";

// Desktop first-launch: "Continue with the account you signed into on the
// web" — no password. Gets a code + signed ticket, opens /link in the SYSTEM
// browser (where the church is already signed in), polls until approved, then
// navigates this window to device-exchange to set the session cookie here.

type ElectronAPI = { openExternal?: (url: string) => Promise<unknown> };
const POLL_MS = 3000;

export function isDesktopShellClient(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as unknown as { electronAPI?: unknown }).electronAPI) return true;
  return /(?:^|;\s*)pf_shell=desktop/.test(document.cookie);
}

export function DesktopPairPanel() {
  const [state, setState] = useState<"idle" | "starting" | "waiting" | "done" | "error">("idle");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const ticketRef = useRef<string | null>(null);
  const expiresRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  const linkUrl = (c: string) => `${window.location.origin}/link?code=${encodeURIComponent(c)}`;

  function openBrowser(c: string) {
    const url = linkUrl(c);
    const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
    if (api?.openExternal) void api.openExternal(url).catch(() => window.open(url, "_blank", "noopener"));
    else window.open(url, "_blank", "noopener");
  }

  async function poll() {
    if (!ticketRef.current) return;
    if (Date.now() > expiresRef.current) {
      setState("error");
      setError("That code expired. Start again.");
      return;
    }
    try {
      const r = await fetch("/api/auth/device-pair/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: ticketRef.current }),
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as { status?: string; token?: string };
      if (j.status === "approved" && j.token) {
        setState("done");
        window.location.href = `/api/auth/device-exchange?token=${encodeURIComponent(j.token)}`;
        return;
      }
      if (j.status === "invalid") {
        setState("error");
        setError("That code expired. Start again.");
        return;
      }
    } catch { /* transient network — keep polling */ }
    timerRef.current = window.setTimeout(poll, POLL_MS);
  }

  async function start() {
    setState("starting");
    setError("");
    try {
      const r = await fetch("/api/auth/device-pair/start", { method: "POST", cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 429 ? "Too many attempts. Please wait a few minutes." : "Couldn't start. Check your internet connection.");
      const j = (await r.json()) as { code: string; ticket: string; expiresAt: number };
      ticketRef.current = j.ticket;
      expiresRef.current = j.expiresAt;
      setCode(j.code);
      setState("waiting");
      openBrowser(j.code);
      timerRef.current = window.setTimeout(poll, POLL_MS);
    } catch (e) {
      setState("error");
      setError((e as Error).message || "Couldn't start.");
    }
  }

  const btn: React.CSSProperties = { width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid var(--orange)", background: "transparent", color: "var(--paper, #fff)", cursor: "pointer", font: "inherit", fontWeight: 600, fontSize: 14 };

  return (
    <div style={{ margin: "0 0 20px", padding: 14, borderRadius: 11, border: "1px solid var(--hair-strong)", background: "rgba(255,255,255,0.03)" }}>
      {state === "waiting" || state === "done" ? (
        <div role="status" style={{ fontSize: 13, lineHeight: 1.5 }}>
          <div style={{ marginBottom: 8 }}>We opened your web browser. Approve this computer there.</div>
          <div style={{ fontFamily: "ui-monospace,Menlo,monospace", fontSize: 26, letterSpacing: 4, textAlign: "center", margin: "8px 0", color: "var(--orange)" }}>{code}</div>
          <div style={{ opacity: 0.7 }}>
            Browser didn&apos;t open? On any computer, go to <strong>{typeof window !== "undefined" ? `${window.location.host}/link` : "/link"}</strong> and enter this code.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" style={btn} onClick={() => openBrowser(code)}>Open browser again</button>
          </div>
          {state === "done" && <div style={{ marginTop: 8 }}>Approved — signing you in…</div>}
        </div>
      ) : (
        <>
          <button type="button" style={btn} onClick={start} disabled={state === "starting"}>
            {state === "starting" ? "Starting…" : "Continue with the account you signed into on the web"}
          </button>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>No password needed — approve this computer from your browser.</div>
          {error && <div role="alert" style={{ fontSize: 12, color: "#ff8a7a", marginTop: 6 }}>{error}</div>}
        </>
      )}
    </div>
  );
}
