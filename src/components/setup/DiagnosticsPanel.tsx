"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCw } from "lucide-react";

type CheckState = "pending" | "ok" | "fail" | "warn";
type Check = {
  key: string;
  label: string;
  desc: string;
  state: CheckState;
  detail?: string;
};

const INITIAL: Check[] = [
  { key: "app", label: "App server", desc: "The Next.js app itself is responding.", state: "pending" },
  { key: "db", label: "Database", desc: "Supabase Postgres reachable, session live.", state: "pending" },
  { key: "storage", label: "Media storage", desc: "S3-compatible bucket reachable, presigned URL works.", state: "pending" },
  { key: "deepgram", label: "Deepgram API key", desc: "AI listening requires a Deepgram key on the audio bridge.", state: "pending" },
  { key: "audioWs", label: "Audio bridge (wss://)", desc: "Fly.io WebSocket accepting connections.", state: "pending" },
  { key: "audioInputs", label: "Audio input devices", desc: "Local microphones / interfaces the browser can hear.", state: "pending" },
  { key: "displays", label: "Displays", desc: "Extended displays available for the projector output.", state: "pending" },
  { key: "ai", label: "AI helpers (Groq)", desc: "AI helper endpoint returning success or clear degraded state.", state: "pending" },
  { key: "realtime", label: "Realtime channel", desc: "Cross-device projector sync channel reachable.", state: "pending" },
];

/**
 * Diagnostics for install-time / first-Sunday sanity checks. Every check
 * hits a real signal (fetch, WebSocket handshake, or device enumeration).
 * The "Refresh" button re-runs every check without a full page reload so
 * a volunteer can plug in a mic and see the counter tick.
 */
export function DiagnosticsPanel() {
  const [checks, setChecks] = useState<Check[]>(INITIAL);
  const [runId, setRunId] = useState(0);

  const setOne = useCallback((key: string, patch: Partial<Check>) => {
    setChecks((cs) => cs.map((c) => c.key === key ? { ...c, ...patch } : c));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setChecks(INITIAL.map((c) => ({ ...c })));

    const guard = <T,>(fn: () => Promise<T> | T) => (cancelled ? undefined : fn());

    void Promise.all([
      runFetch("app", "/api/health", (r) => (r.ok ? "ok" : "fail"), undefined, undefined, guard, setOne),
      runFetch("db", "/api/health/db", async (r) => {
        try { const j = await r.json(); return j.ok ? "ok" : "fail"; } catch { return "fail"; }
      },
        "Set DATABASE_URL to the Supabase POOLER (aws-0-…). Vercel Functions can't reach IPv6-only direct hosts.",
        undefined, guard, setOne),
      runFetch("storage", "/api/health/storage", (r) => (r.ok ? "ok" : "fail"),
        "Check S3_ENDPOINT, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION.",
        undefined, guard, setOne),
      runFetch("deepgram", "/api/health/deepgram", async (r) => {
        try { const j = await r.json(); return j.ok ? "ok" : "warn"; } catch { return "fail"; }
      },
        "No Deepgram key configured. Set DEEPGRAM_API_KEY on the Fly.io bridge for AI listening.",
        undefined, guard, setOne),
      runWs(guard, setOne, "audioWs",
        "Deploy the Fly.io audio bridge (`./scripts/deploy.sh audio`) and set NEXT_PUBLIC_AUDIO_WS_URL."),
      runAudioInputs(guard, setOne, "audioInputs"),
      runDisplays(guard, setOne, "displays"),
      runFetch("ai", "/api/ai/helpers/improve_readability", async (r) => {
        const j = await r.json().catch(() => ({}));
        if (j.ok) return "ok";
        if (j.code === "MISSING_API_KEY") return "warn";
        return "fail";
      }, "Set GROQ_API_KEY on Vercel. Cards show a graceful disabled state without it.",
        { method: "POST", body: JSON.stringify({ text: "diagnostic ping" }), headers: { "Content-Type": "application/json" } },
        guard, setOne),
      runRealtime(guard, setOne, "realtime",
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. Realtime is optional — same-machine BroadcastChannel still works without it."),
    ]).catch(() => { /* individual failures already recorded */ });

    return () => { cancelled = true; };
  }, [runId, setOne]);

  const allDone = checks.every((c) => c.state !== "pending");
  const anyFail = checks.some((c) => c.state === "fail");
  const anyWarn = checks.some((c) => c.state === "warn");

  return (
    <div className="max-w-3xl space-y-3">
      <div className="border border-border rounded-lg p-4 bg-card flex items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Overall</div>
          <div className="text-lg font-semibold">
            {!allDone ? "Running…" : anyFail ? "Some services need attention" : anyWarn ? "Mostly OK — a few features degraded" : "All services healthy"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRunId((n) => n + 1)}
          disabled={!allDone}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Re-run all diagnostic checks"
        >
          <RefreshCw className={`w-4 h-4 ${!allDone ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="space-y-2">
        {checks.map((c) => (
          <div key={c.key} className="border border-border rounded-md p-3 flex items-start gap-3 bg-card">
            <div className="shrink-0 mt-0.5">
              {c.state === "pending" && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              {c.state === "ok" && <CheckCircle2 className="w-4 h-4 text-success" />}
              {c.state === "warn" && <AlertTriangle className="w-4 h-4 text-warning" />}
              {c.state === "fail" && <XCircle className="w-4 h-4 text-destructive" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{c.label}</div>
              <div className="text-xs text-muted-foreground">{c.desc}</div>
              {c.detail && (
                <div className={`mt-1 text-xs ${c.state === "fail" ? "text-destructive" : "text-warning"}`}>
                  {c.detail}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type Guard = <T>(fn: () => Promise<T> | T) => Promise<T> | T | undefined;
type SetOne = (key: string, patch: Partial<Check>) => void;

async function runFetch(
  key: string,
  url: string,
  interpret: (r: Response) => Promise<CheckState> | CheckState,
  hint: string | undefined,
  init: RequestInit | undefined,
  guard: Guard,
  setOne: SetOne,
) {
  try {
    const r = await fetch(url, init);
    const state = await interpret(r);
    guard(() => setOne(key, { state, detail: state !== "ok" ? hint : undefined }));
  } catch (e) {
    guard(() => setOne(key, { state: "fail", detail: hint || (e instanceof Error ? e.message : "unknown") }));
  }
}

async function runWs(guard: Guard, setOne: SetOne, key: string, hint: string) {
  const url = getPublicEnv("NEXT_PUBLIC_AUDIO_WS_URL");
  if (!url) {
    guard(() => setOne(key, { state: "warn", detail: hint }));
    return;
  }
  try {
    const probe = new WebSocket(url + (url.includes("?") ? "&" : "?") + "probe=1");
    const state = await new Promise<CheckState>((res) => {
      const t = setTimeout(() => { try { probe.close(); } catch { /* */ } res("fail"); }, 3000);
      probe.onopen = () => { clearTimeout(t); try { probe.close(); } catch { /* */ } res("ok"); };
      probe.onerror = () => { clearTimeout(t); res("fail"); };
    });
    guard(() => setOne(key, { state, detail: state !== "ok" ? hint : undefined }));
  } catch {
    guard(() => setOne(key, { state: "fail", detail: hint }));
  }
}

async function runAudioInputs(guard: Guard, setOne: SetOne, key: string) {
  try {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      guard(() => setOne(key, { state: "warn", detail: "This browser doesn't expose mediaDevices.enumerateDevices." }));
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === "audioinput");
    if (inputs.length === 0) {
      guard(() => setOne(key, { state: "fail", detail: "No audio input devices detected. Plug in a microphone or USB interface." }));
    } else {
      guard(() => setOne(key, { state: "ok", detail: `${inputs.length} audio input${inputs.length === 1 ? "" : "s"} detected.` }));
    }
  } catch (e) {
    guard(() => setOne(key, { state: "fail", detail: e instanceof Error ? e.message : "Enumerate failed." }));
  }
}

async function runDisplays(guard: Guard, setOne: SetOne, key: string) {
  const w = typeof window !== "undefined"
    ? (window as Window & { electronAPI?: { screens?: { list: () => Promise<unknown> } } })
    : undefined;
  const api = w?.electronAPI?.screens;
  if (!api) {
    guard(() => setOne(key, { state: "warn", detail: "Not available in browser. Install the desktop app to detect projector displays." }));
    return;
  }
  try {
    const res = (await api.list()) as { displays?: unknown[] } | unknown[];
    const list = Array.isArray(res) ? res : Array.isArray(res?.displays) ? res.displays : [];
    if (list.length === 0) {
      guard(() => setOne(key, { state: "fail", detail: "No displays reported by Electron. Check monitor cabling." }));
    } else {
      guard(() => setOne(key, { state: "ok", detail: `${list.length} display${list.length === 1 ? "" : "s"} available.` }));
    }
  } catch (e) {
    guard(() => setOne(key, { state: "fail", detail: e instanceof Error ? e.message : "screens.list() failed." }));
  }
}

async function runRealtime(guard: Guard, setOne: SetOne, key: string, hint: string) {
  const url = getPublicEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (!url) {
    guard(() => setOne(key, { state: "warn", detail: hint }));
    return;
  }
  try {
    const r = await fetch(url + "/rest/v1/", { method: "HEAD" });
    const state: CheckState = r.status < 500 ? "ok" : "fail";
    guard(() => setOne(key, { state, detail: state !== "ok" ? hint : undefined }));
  } catch {
    guard(() => setOne(key, { state: "fail", detail: hint }));
  }
}

// Next.js inlines NEXT_PUBLIC_* only at LITERAL references — dynamic lookup
// via process.env[name] always returns undefined on the client. Reference each
// var by its literal key here so the bundler can substitute the value.
function getPublicEnv(name: "NEXT_PUBLIC_AUDIO_WS_URL" | "NEXT_PUBLIC_SUPABASE_URL"): string | undefined {
  switch (name) {
    case "NEXT_PUBLIC_AUDIO_WS_URL": return process.env.NEXT_PUBLIC_AUDIO_WS_URL;
    case "NEXT_PUBLIC_SUPABASE_URL": return process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
}
