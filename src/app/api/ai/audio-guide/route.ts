// POST /api/ai/audio-guide — Sarah's chat reply during audio setup.
//
// Grounding is SERVER-SIDE: the knowledge excerpt is looked up by `step` from
// src/lib/audio/sarahKnowledge.ts (client-sent knowledge is ignored). Diagnostics
// are whitelisted to {id,status,value}. Requires AI entitlement (same gate as
// /api/ai/helpers). Missing Groq key → { ok:false, code:"MISSING_API_KEY" } and the
// wizard falls back to its scripted guidance.
import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { getEntitlement, canUseAI } from "@/lib/server/entitlement";
import { audioGuideReply, audioGuideSearch, MissingApiKeyError, GroqRateLimitedError } from "@/lib/ai-helpers";
import { SARAH_KNOWLEDGE, SARAH_ASK_KNOWLEDGE, SARAH_STEPS, CHECK_IDS, knowledgeCovers, type SarahStep } from "@/lib/audio/sarahKnowledge";
import { OS_VALUES, CONNECTION_VALUES, MIX_VALUES } from "@/lib/server/audio-setup";
import { createLimiter } from "@/lib/rate-limit";

// Web search costs real money per call. Daily caps per church and per person, on the
// shared limiter (in-memory today; becomes durable when the Redis/pg backend is set).
const searchPerChurchDay = createLimiter("sarah-search-church", 50, 24 * 60 * 60 * 1000);
const searchPerUserDay = createLimiter("sarah-search-user", 30, 24 * 60 * 60 * 1000);

export const runtime = "nodejs";

const RATE_LIMIT = 12; // req/user/min
const WINDOW_MS = 60_000;
const counters = new Map<string, { count: number; windowStart: number }>();
function checkRate(userId: string): boolean {
  const now = Date.now();
  if (counters.size > 5000) for (const [k, v] of counters) if (now - v.windowStart > WINDOW_MS) counters.delete(k);
  const e = counters.get(userId);
  if (!e || now - e.windowStart > WINDOW_MS) { counters.set(userId, { count: 1, windowStart: now }); return true; }
  if (e.count >= RATE_LIMIT) return false;
  e.count += 1; return true;
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const ent = await getEntitlement(user.churchId);
  if (!canUseAI(ent)) return NextResponse.json({ ok: false, code: "NOT_ENTITLED", error: "Sarah's chat needs an active subscription" });
  if (!checkRate(user.id)) return NextResponse.json({ ok: false, code: "RATE_LIMITED", error: "Sarah needs a moment — try again in a minute." });

  const text = await req.text().catch(() => "");
  if (text.length > 32_000) return NextResponse.json({ ok: false, code: "BAD_INPUT", error: "Too large" }, { status: 413 });
  let body: Record<string, unknown> = {};
  try { const j = JSON.parse(text || "{}"); if (j && typeof j === "object") body = j as Record<string, unknown>; } catch { /* empty */ }
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
  const step: SarahStep = (SARAH_STEPS as readonly string[]).includes(ctxIn.step as string) ? (ctxIn.step as SarahStep) : "connection";
  const setupIn = (ctxIn.setup && typeof ctxIn.setup === "object" ? ctxIn.setup : {}) as Record<string, unknown>;
  const setup: Record<string, string> = {};
  for (const k of ["desk", "os", "connection", "mixType", "deviceName", "deviceKind", "channel"]) {
    const v = str(setupIn[k], 80).replace(/[\r\n]+/g, " "); if (v) setup[k] = v;
  }
  const diagnostics = Array.isArray(ctxIn.diagnostics)
    ? (ctxIn.diagnostics as unknown[]).slice(0, 12).flatMap((d) => {
        const x = d as Record<string, unknown>;
        return (CHECK_IDS as readonly string[]).includes(x?.id as string) && ["pass", "warn", "fail"].includes(x?.status as string)
          ? [{ id: x.id as string, status: x.status as string, value: typeof x.value === "number" && Number.isFinite(x.value) ? Math.round(x.value) : undefined }] : [];
      })
    : [];

  try {
    // Real questions ("my X32 USB shows nothing", "how do I send NDI from OBS?") get a
    // grounded web search over manufacturer docs first. If search finds nothing solid,
    // Sarah answers from the curated knowledge base instead — never an unsourced guess.
    // Gear the curated knowledge covers → answer from verified knowledge, never search.
    if (body.mode === "ask" && knowledgeCovers(message)) {
      const data = await audioGuideReply({ message, history, context: { step, setup, diagnostics, knowledge: SARAH_ASK_KNOWLEDGE } });
      console.info("[audio-guide] ask answered from knowledge base");
      return NextResponse.json({ ok: true, data: { ...data, correction: undefined } });
    }
    if (body.mode === "ask") {
      // Search is best-effort: a rate limit or an over-size request (common on lower Groq
      // tiers — search runs on a larger model) falls back to the knowledge-base answer
      // below instead of failing the question. Only a missing key is a hard stop.
      // Only gear facts go to the search provider — never the device name (it can carry a
      // church's name) or anything identifying.
      const searchSetup: Record<string, string> = {};
      for (const k of ["desk", "os", "connection", "mixType", "deviceKind"]) if (setup[k]) searchSetup[k] = setup[k];
      const allowed = (await searchPerChurchDay(user.churchId)) && (await searchPerUserDay(user.id));
      const found = !allowed ? null : await audioGuideSearch({ question: message, setup: searchSetup }).catch((e) => {
        if (e instanceof MissingApiKeyError) throw e;
        return null;
      });
      console.info(`[audio-guide] ask: ${!allowed ? "search capped" : found ? "answered by web search" : "search gave nothing — knowledge base"}`);
      if (found) {
        return NextResponse.json({ ok: true, data: { reply: found.reply, mood: "nod", suggestions: [], sources: found.sources } });
      }
    }
    const data = await audioGuideReply({ message, history, context: { step, setup, diagnostics, knowledge: body.mode === "ask" ? SARAH_ASK_KNOWLEDGE : SARAH_KNOWLEDGE[step] } });
    // Corrections must map to known values (desk stays free text).
    if (data.correction) {
      const { field, to } = data.correction;
      const lower = to.toLowerCase();
      const allowed =
        field === "desk" ? to :
        field === "os" ? (OS_VALUES as readonly string[]).find((v) => lower.includes(v)) ?? (/macos|macbook|imac/.test(lower) ? "mac" : /pc|win/.test(lower) ? "windows" : undefined) :
        field === "connection" ? (CONNECTION_VALUES as readonly string[]).find((v) => v === lower) :
        field === "mixType" ? (MIX_VALUES as readonly string[]).find((v) => v === lower) : undefined;
      data.correction = allowed ? { field, to: allowed } : undefined;
    }
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    if (e instanceof MissingApiKeyError) return NextResponse.json({ ok: false, code: "MISSING_API_KEY", error: "AI chat is unavailable" });
    if (e instanceof GroqRateLimitedError) return NextResponse.json({ ok: false, code: "RATE_LIMITED", error: "Sarah is busy — try again shortly." });
    console.error("[audio-guide] failed", e);
    return NextResponse.json({ ok: false, code: "UPSTREAM", error: "Sarah couldn't answer just now." });
  }
}
