"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";

type Check = {
  key: string;
  label: string;
  desc: string;
  state: "pending" | "ok" | "fail" | "warn";
  detail?: string;
};

/**
 * Runs a fan-out of health checks on mount.
 * If any check fails, shows a specific "how to fix" hint below.
 */
export function DiagnosticsPanel() {
  const [checks, setChecks] = useState<Check[]>([
    { key: "app", label: "App server", desc: "The Next.js app itself is responding.", state: "pending" },
    { key: "db", label: "Database", desc: "Supabase Postgres reachable, session live.", state: "pending" },
    { key: "storage", label: "Media storage", desc: "S3-compatible bucket reachable, presigned URL works.", state: "pending" },
    { key: "audioWs", label: "Audio bridge (wss://)", desc: "Fly.io WebSocket accepting connections.", state: "pending" },
    { key: "ai", label: "AI helpers (Groq)", desc: "AI helper endpoint returning success or clear degraded state.", state: "pending" },
    { key: "realtime", label: "Realtime channel", desc: "Cross-device projector sync channel reachable.", state: "pending" },
  ]);

  useEffect(() => {
    (async () => {
      await runOne("app", "/api/health", (r) => (r.ok ? "ok" : "fail"));
      await runOne("db", "/api/health/db", (r) => (r.ok ? "ok" : "fail"),
        "Set DATABASE_URL to the Supabase POOLER (aws-0-…), not the direct db.<ref>.supabase.co host — Vercel Functions can't reach IPv6-only direct hosts.");
      await runOne("storage", "/api/health/storage", (r) => (r.ok ? "ok" : "fail"),
        "Check S3_ENDPOINT, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION.");
      await runWs("audioWs",
        "Deploy the Fly.io audio bridge (`./scripts/deploy.sh audio`) and set NEXT_PUBLIC_AUDIO_WS_URL.");
      await runOne("ai", "/api/ai/helpers/improve_readability", async (r) => {
        const j = await r.json().catch(() => ({}));
        if (j.ok) return "ok";
        if (j.code === "MISSING_API_KEY") return "warn";
        return "fail";
      }, "Set GROQ_API_KEY on Vercel. Cards will show a graceful disabled state without it.",
      { method: "POST", body: JSON.stringify({ text: "diagnostic ping" }), headers: { "Content-Type": "application/json" } });
      await runRealtime("realtime",
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. Realtime is optional — same-machine BroadcastChannel still works without it.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runOne(
    key: string, url: string,
    interpret: (r: Response) => Promise<"ok" | "warn" | "fail"> | "ok" | "warn" | "fail",
    hint?: string, init?: RequestInit,
  ) {
    try {
      const r = await fetch(url, init);
      const state = await interpret(r);
      setChecks((cs) => cs.map((c) => c.key === key ? { ...c, state, detail: state !== "ok" ? hint : undefined } : c));
    } catch (e) {
      setChecks((cs) => cs.map((c) => c.key === key ? { ...c, state: "fail", detail: hint || (e instanceof Error ? e.message : "unknown") } : c));
    }
  }

  async function runWs(key: string, hint: string) {
    const url = getPublicEnv("NEXT_PUBLIC_AUDIO_WS_URL");
    if (!url) {
      setChecks((cs) => cs.map((c) => c.key === key ? { ...c, state: "warn", detail: hint } : c));
      return;
    }
    try {
      // We can't actually authenticate without a plan — just probe the handshake
      const probe = new WebSocket(url + "?probe=1");
      const done = new Promise<"ok" | "fail">((res) => {
        const t = setTimeout(() => { try { probe.close(); } catch { /* */ } res("fail"); }, 3500);
        probe.onopen = () => { clearTimeout(t); try { probe.close(); } catch { /* */ } res("ok"); };
        probe.onerror = () => { clearTimeout(t); res("fail"); };
      });
      const state = await done;
      setChecks((cs) => cs.map((c) => c.key === key ? { ...c, state, detail: state !== "ok" ? hint : undefined } : c));
    } catch {
      setChecks((cs) => cs.map((c) => c.key === key ? { ...c, state: "fail", detail: hint } : c));
    }
  }

  async function runRealtime(key: string, hint: string) {
    const url = getPublicEnv("NEXT_PUBLIC_SUPABASE_URL");
    if (!url) {
      setChecks((cs) => cs.map((c) => c.key === key ? { ...c, state: "warn", detail: hint } : c));
      return;
    }
    try {
      const r = await fetch(url + "/rest/v1/", { method: "HEAD" });
      const state: "ok" | "fail" = r.status < 500 ? "ok" : "fail";
      setChecks((cs) => cs.map((c) => c.key === key ? { ...c, state, detail: state !== "ok" ? hint : undefined } : c));
    } catch {
      setChecks((cs) => cs.map((c) => c.key === key ? { ...c, state: "fail", detail: hint } : c));
    }
  }

  const allDone = checks.every((c) => c.state !== "pending");
  const anyFail = checks.some((c) => c.state === "fail");
  const anyWarn = checks.some((c) => c.state === "warn");

  return (
    <div className="max-w-3xl space-y-3">
      <div className="border border-border rounded-lg p-4 bg-card">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Overall</div>
        <div className="text-lg font-semibold">
          {!allDone ? "Running…" : anyFail ? "Some services need attention" : anyWarn ? "Mostly OK — a few features degraded" : "All services healthy"}
        </div>
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
                  How to fix: {c.detail}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Trick to read a NEXT_PUBLIC_* at runtime — Next inlines these at build time
// but for a runtime probe we can access via process.env in client code (Next
// tree-shakes the string references).
function getPublicEnv(name: string): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (process.env as any) as Record<string, string | undefined>;
  return env[name];
}
