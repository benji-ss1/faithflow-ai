// POST /api/ai/audio-guide — Sarah's chat reply during audio setup.
//
// Grounded on the deterministic diagnostics + KB excerpt the client sends for the
// current step (the client computes them from its own meters). Missing Groq key →
// { ok:false, code:"MISSING_API_KEY" } and the wizard falls back to its scripted guidance.
import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { audioGuideReply, MissingApiKeyError, GroqRateLimitedError } from "@/lib/ai-helpers";

export const runtime = "nodejs";

const RATE_LIMIT = 12; // req/user/min
const WINDOW_MS = 60_000;
const counters = new Map<string, { count: number; windowStart: number }>();
function checkRate(userId: string): boolean {
  const now = Date.now();
  const e = counters.get(userId);
  if (!e || now - e.windowStart > WINDOW_MS) { counters.set(userId, { count: 1, windowStart: now }); return true; }
  if (e.count >= RATE_LIMIT) return false;
  e.count += 1; return true;
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!checkRate(user.id)) return NextResponse.json({ ok: false, code: "RATE_LIMITED", error: "Sarah needs a moment — try again in a minute." });

  let body: Record<string, unknown> = {};
  try { const j = await req.json(); if (j && typeof j === "object") body = j as Record<string, unknown>; } catch { /* empty */ }
  const message = str(body.message, 800).trim();
  if (!message) return NextResponse.json({ ok: false, code: "BAD_INPUT", error: "Empty message" });

  const history = Array.isArray(body.history)
    ? (body.history as unknown[]).slice(-8).flatMap((m) => {
        const x = m as Record<string, unknown>;
        return (x?.role === "user" || x?.role === "assistant") && typeof x.content === "string"
          ? [{ role: x.role as "user" | "assistant", content: x.content.slice(0, 800) }] : [];
      })
    : [];
  const ctxIn = (body.context && typeof body.context === "object" ? body.context : {}) as Record<string, unknown>;
  const setupIn = (ctxIn.setup && typeof ctxIn.setup === "object" ? ctxIn.setup : {}) as Record<string, unknown>;
  const setup: Record<string, string> = {};
  for (const k of ["desk", "os", "connection", "mixType", "deviceName", "deviceKind", "channel"]) {
    const v = str(setupIn[k], 120); if (v) setup[k] = v;
  }
  const diagnostics = Array.isArray(ctxIn.diagnostics)
    ? (ctxIn.diagnostics as unknown[]).slice(0, 12).flatMap((d) => {
        const x = d as Record<string, unknown>;
        return typeof x?.id === "string" && typeof x?.status === "string"
          ? [{ id: str(x.id, 30), status: str(x.status, 10), value: typeof x.value === "number" ? x.value : undefined, detail: str(x.detail, 200) }] : [];
      })
    : [];

  try {
    const data = await audioGuideReply({ message, history, context: { step: str(ctxIn.step, 40), setup, diagnostics, knowledge: str(ctxIn.knowledge, 4000) } });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    if (e instanceof MissingApiKeyError) return NextResponse.json({ ok: false, code: "MISSING_API_KEY", error: "AI chat is unavailable" });
    if (e instanceof GroqRateLimitedError) return NextResponse.json({ ok: false, code: "RATE_LIMITED", error: "Sarah is busy — try again shortly." });
    console.error("[audio-guide] failed", e);
    return NextResponse.json({ ok: false, code: "UPSTREAM", error: "Sarah couldn't answer just now." });
  }
}
