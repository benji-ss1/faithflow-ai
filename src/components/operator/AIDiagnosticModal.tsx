"use client";
import { useCallback, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, X, Loader2, Activity } from "lucide-react";

type StepStatus = "pending" | "running" | "ok" | "fail" | "skip";
type Step = {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
};

const INITIAL: Step[] = [
  { id: "session", label: "Session cookie present", status: "pending" },
  { id: "ticket", label: "Mint audio ticket (/api/audio/ticket)", status: "pending" },
  { id: "wsurl", label: "WebSocket URL is wss:// and reachable", status: "pending" },
  { id: "mic", label: "Microphone permission granted", status: "pending" },
  { id: "audioctx", label: "AudioContext at 16kHz (or fallback)", status: "pending" },
  { id: "wsconnect", label: "WebSocket connects to Fly bridge", status: "pending" },
  { id: "wsopen", label: "WebSocket receives 'ready' from Deepgram", status: "pending" },
];

/**
 * Blocking diagnostic that runs the exact AI-listening pipeline steps and
 * reports each one. Testers who can't get AI to work run this once, screenshot
 * it, and support has actionable info — no DevTools required.
 */
export function AIDiagnosticModal({ planId, open, onOpenChange }: { planId?: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [steps, setSteps] = useState<Step[]>(INITIAL);
  const [running, setRunning] = useState(false);

  const update = (id: string, patch: Partial<Step>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setSteps(INITIAL.map((s) => ({ ...s })));

    // 1. Session cookie
    update("session", { status: "running" });
    try {
      const me = await fetch("/api/me", { credentials: "same-origin" });
      if (!me.ok) {
        update("session", { status: "fail", detail: `HTTP ${me.status} — sign in again from the login screen` });
        setRunning(false);
        return;
      }
      update("session", { status: "ok" });
    } catch (e) {
      update("session", { status: "fail", detail: e instanceof Error ? e.message : "fetch failed" });
      setRunning(false);
      return;
    }

    // 2. Ticket mint
    update("ticket", { status: "running" });
    let ticketUrl = "";
    try {
      const res = await fetch("/api/audio/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: planId || "diagnostic" }),
      });
      const body = await res.json().catch(() => ({} as { url?: string; error?: string }));
      if (!res.ok) {
        update("ticket", { status: "fail", detail: `HTTP ${res.status}: ${(body as { error?: string }).error || "no error body"}` });
        setRunning(false);
        return;
      }
      ticketUrl = (body as { url?: string }).url || "";
      if (!ticketUrl) {
        update("ticket", { status: "fail", detail: "endpoint returned no URL" });
        setRunning(false);
        return;
      }
      update("ticket", { status: "ok", detail: `URL scheme: ${ticketUrl.split("?")[0].slice(0, 40)}…` });
    } catch (e) {
      update("ticket", { status: "fail", detail: e instanceof Error ? e.message : "fetch failed" });
      setRunning(false);
      return;
    }

    // 3. URL scheme
    update("wsurl", { status: "running" });
    try {
      const u = new URL(ticketUrl);
      if (u.protocol !== "wss:" && !(u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
        update("wsurl", { status: "fail", detail: `insecure ${u.protocol} on non-localhost — env misconfigured` });
        setRunning(false);
        return;
      }
      update("wsurl", { status: "ok", detail: u.host });
    } catch (e) {
      update("wsurl", { status: "fail", detail: e instanceof Error ? e.message : "URL parse failed" });
      setRunning(false);
      return;
    }

    // 4. Mic permission (skip if we don't have mediaDevices)
    update("mic", { status: "running" });
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      update("mic", { status: "skip", detail: "navigator.mediaDevices unavailable in this context" });
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        update("mic", { status: "ok" });
      } catch (e) {
        const name = (e as { name?: string })?.name || "";
        const msg = (e as { message?: string })?.message || "unknown";
        const hint = name === "NotAllowedError"
          ? "Enable in System Settings → Privacy & Security → Microphone, then restart the app"
          : name === "NotFoundError" ? "No microphone connected"
          : name === "NotReadableError" ? "Mic is in use by another app (Zoom, OBS, Chrome)"
          : msg;
        update("mic", { status: "fail", detail: hint });
        setRunning(false);
        return;
      }
    }

    // 5. AudioContext
    update("audioctx", { status: "running" });
    try {
      let ctx: AudioContext;
      try { ctx = new AudioContext({ sampleRate: 16000 }); }
      catch { ctx = new AudioContext(); }
      update("audioctx", { status: "ok", detail: `${ctx.sampleRate} Hz` });
      try { await ctx.close(); } catch { /* noop */ }
    } catch (e) {
      update("audioctx", { status: "fail", detail: e instanceof Error ? e.message : "AudioContext failed" });
      setRunning(false);
      return;
    }

    // 6. WebSocket connect
    update("wsconnect", { status: "running" });
    let ws: WebSocket;
    try {
      ws = new WebSocket(ticketUrl);
    } catch (e) {
      update("wsconnect", { status: "fail", detail: e instanceof Error ? e.message : "WebSocket constructor threw" });
      setRunning(false);
      return;
    }
    const wsOpened = await new Promise<{ ok: true } | { ok: false; reason: string }>((resolve) => {
      const to = setTimeout(() => resolve({ ok: false, reason: "timeout after 6s" }), 6000);
      ws.onopen = () => { clearTimeout(to); resolve({ ok: true }); };
      ws.onerror = () => { clearTimeout(to); resolve({ ok: false, reason: "onerror fired (blocked by proxy/firewall?)" }); };
      ws.onclose = (e) => {
        clearTimeout(to);
        if (e.code !== 1000 && e.code !== 1005) resolve({ ok: false, reason: `closed code=${e.code} reason=${e.reason || "(none)"}` });
      };
    });
    if (!wsOpened.ok) {
      try { ws.close(); } catch { /* noop */ }
      update("wsconnect", { status: "fail", detail: wsOpened.reason });
      setRunning(false);
      return;
    }
    update("wsconnect", { status: "ok" });

    // 7. Deepgram ready
    update("wsopen", { status: "running" });
    const dgReady = await new Promise<{ ok: true } | { ok: false; reason: string }>((resolve) => {
      const to = setTimeout(() => resolve({ ok: false, reason: "no 'ready' from Deepgram in 8s" }), 8000);
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data));
          if (msg?.type === "ready") { clearTimeout(to); resolve({ ok: true }); }
          if (msg?.type === "error") { clearTimeout(to); resolve({ ok: false, reason: msg.message || "bridge error" }); }
        } catch { /* wait for next */ }
      };
      ws.onclose = (e) => { clearTimeout(to); resolve({ ok: false, reason: `bridge closed code=${e.code} ${e.reason || ""}` }); };
    });
    try { ws.close(1000, "diagnostic-done"); } catch { /* noop */ }
    if (!dgReady.ok) {
      update("wsopen", { status: "fail", detail: dgReady.reason });
      setRunning(false);
      return;
    }
    update("wsopen", { status: "ok" });
    setRunning(false);
  }, [planId, running]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[520px] max-w-[92vw] max-h-[85vh] overflow-hidden flex flex-col bg-[var(--color-panel)] border border-[var(--color-border)] rounded-xl shadow-2xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-[var(--color-brand)]" />
              <Dialog.Title className="text-base font-semibold">AI Listening — Diagnostic</Dialog.Title>
            </div>
            <button onClick={() => onOpenChange(false)} className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] text-lg leading-none">×</button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            {steps.map((s) => {
              const Icon = s.status === "ok" ? Check : s.status === "fail" ? X : s.status === "running" ? Loader2 : Activity;
              const color =
                s.status === "ok" ? "text-emerald-400" :
                s.status === "fail" ? "text-red-400" :
                s.status === "running" ? "text-[var(--color-brand)] animate-spin" :
                s.status === "skip" ? "text-amber-400" :
                "text-[var(--color-muted-foreground)]";
              return (
                <div key={s.id} className="flex items-start gap-2 py-1.5 border-b border-[var(--color-border)]/40 last:border-0">
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[12px] font-medium ${s.status === "pending" ? "text-[var(--color-muted-foreground)]" : ""}`}>{s.label}</div>
                    {s.detail && (
                      <div className={`text-[11px] mt-0.5 ${s.status === "fail" ? "text-red-300" : "text-[var(--color-muted-foreground)]"} break-words`}>
                        {s.detail}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-5 py-3 border-t border-[var(--color-border)] flex justify-between items-center">
            <div className="text-[11px] text-[var(--color-muted-foreground)]">
              Screenshot the results if support asks — every failure has a hint.
            </div>
            <button
              onClick={run}
              disabled={running}
              className="h-9 px-4 rounded-md bg-[var(--color-brand)] text-black text-sm font-semibold disabled:opacity-50"
            >
              {running ? "Running…" : "Run diagnostic"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
