// POST /api/ai/helpers/[action]
//
// action ∈ { improve_readability | format_lyrics | suggest_effect | draft_announcement | fix_slide }
//
// All actions go through xAI server-side (see src/lib/ai-helpers.ts).
// If XAI_API_KEY is missing, we respond 200 with { ok:false, code:"MISSING_API_KEY" }
// so the client can render a clear "xAI API key required" disabled state.

import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import {
  improveReadability, formatLyrics, suggestEffect, draftAnnouncement, fixSlide,
  MissingApiKeyError,
} from "@/lib/ai-helpers";
import type { EditableSlide } from "@/lib/slide-objects";

export const runtime = "nodejs";

const RATE_LIMIT = 10; // req/user/min
const WINDOW_MS = 60_000;
const counters = new Map<string, { count: number; windowStart: number }>();

function checkRate(userId: string): boolean {
  const now = Date.now();
  const entry = counters.get(userId);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    counters.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

type ErrCode = "MISSING_API_KEY" | "RATE_LIMITED" | "BAD_INPUT" | "UPSTREAM";
function err(code: ErrCode, error: string, status = 200) {
  return NextResponse.json({ ok: false, error, code }, { status });
}
function ok<T>(data: T) { return NextResponse.json({ ok: true, data }); }

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try { const j = await req.json(); return (j && typeof j === "object") ? j as Record<string, unknown> : null; }
  catch { return null; }
}

const TONES = new Set(["warm", "formal", "urgent", "celebratory"]);

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized", code: "BAD_INPUT" }, { status: 401 });
  if (!checkRate(user.id)) return err("RATE_LIMITED", "Rate limit exceeded (10/min)", 429);

  const { action } = await ctx.params;
  const body = await readBody(req);
  if (!body) return err("BAD_INPUT", "Invalid JSON body", 400);

  try {
    switch (action) {
      case "improve_readability": {
        const text = typeof body.text === "string" ? body.text : "";
        if (!text.trim() || text.length > 4000) return err("BAD_INPUT", "text must be 1-4000 chars");
        return ok(await improveReadability(text));
      }
      case "format_lyrics": {
        const text = typeof body.text === "string" ? body.text : "";
        if (!text.trim() || text.length > 8000) return err("BAD_INPUT", "text must be 1-8000 chars");
        return ok(await formatLyrics(text));
      }
      case "suggest_effect": {
        const d = body.slide;
        if (!d || typeof d !== "object") return err("BAD_INPUT", "slide description required");
        const dd = d as Record<string, unknown>;
        const desc = {
          textPreview: typeof dd.textPreview === "string" ? dd.textPreview.slice(0, 500) : "",
          theme: typeof dd.theme === "string" ? dd.theme : undefined,
          itemType: typeof dd.itemType === "string" ? dd.itemType : "blank",
        };
        return ok(await suggestEffect(desc));
      }
      case "draft_announcement": {
        const topic = typeof body.topic === "string" ? body.topic : "";
        const tone = typeof body.tone === "string" && TONES.has(body.tone) ? body.tone : "warm";
        return ok(await draftAnnouncement(topic, tone as "warm" | "formal" | "urgent" | "celebratory"));
      }
      case "fix_slide": {
        const s = body.slide as EditableSlide | undefined;
        if (!s || typeof s !== "object" || !Array.isArray((s as EditableSlide).objects)) {
          return err("BAD_INPUT", "slide required");
        }
        return ok(await fixSlide(s));
      }
      default:
        return err("BAD_INPUT", `Unknown action: ${action}`);
    }
  } catch (e) {
    if (e instanceof MissingApiKeyError) return err("MISSING_API_KEY", "xAI API key required");
    const msg = e instanceof Error ? e.message : String(e);
    return err("UPSTREAM", msg.slice(0, 200), 502);
  }
}
