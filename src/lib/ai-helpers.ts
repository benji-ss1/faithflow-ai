// Phase 5D-3 — server-only AI helpers, exposed via /api/ai/helpers/[action].
//
// Provider ladder (2026-07-30 user sign-off — fixes the HIGH Groq outage risk):
//
//   Tier 1 — Groq primary   : llama-3.3-70b-versatile   (quality)
//   Tier 2 — Groq fallback  : llama-3.1-8b-instant      (rate-limit relief)
//   Tier 3 — xAI emergency  : grok-2-latest              (Groq completely down)
//
// Tier 3 only activates when:
//   (a) GROQ_XAI_FALLBACK=true is set in the environment, AND
//   (b) XAI_API_KEY is present, AND
//   (c) Groq threw a non-rate-limit error (5xx / network / timeout).
//
// Rate-limit errors (GroqRateLimitedError) still degrade gracefully without
// trying xAI — that path already has a UI message and the system is designed
// for graceful absence of AI features, not mandatory fallback.
//
// Every helper:
//   • throws MissingApiKeyError if GROQ_API_KEY is not set,
//   • uses a 6s AbortController timeout,
//   • requests json_object response format,
//   • retries once on 5xx,
//   • on 429 falls back to llama-3.1-8b-instant (see groq-fallback.ts);
//     if the fallback ALSO 429s it throws GroqRateLimitedError so callers
//     degrade like the missing-key path.
//   • on hard failure (5xx / network down) tries xAI if GROQ_XAI_FALLBACK=true.
//
// This module must be imported ONLY from server code (API routes / server
// actions). It must never be bundled into a client component.

import type { EditableSlide, SlideObject } from "./slide-objects";
import type { EffectId } from "./effects";
import {
  GROQ_FALLBACK_MODEL,
  GroqRateLimitedError,
  getGroqActiveModel,
  getGroqLimitStatus,
  markGroqPrimaryLimited,
} from "./groq-fallback";

export { GroqRateLimitedError };

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS = 6000;

export class MissingApiKeyError extends Error {
  code = "MISSING_API_KEY" as const;
  constructor() { super("GROQ_API_KEY is not configured"); this.name = "MissingApiKeyError"; }
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// ── xAI emergency fallback (Tier 3) ──────────────────────────────────────────
// Only called when Groq is unreachable/5xx AND GROQ_XAI_FALLBACK=true.
// Uses the same OpenAI-compatible API shape, so the response parsing is shared.
async function xaiJson<T>(messages: ChatMessage[], temperature: number): Promise<T> {
  const key = process.env.XAI_API_KEY;
  const baseUrl = process.env.XAI_BASE_URL ?? "https://api.x.ai/v1";
  const model = process.env.XAI_MODEL ?? "grok-2-latest";
  if (!key) throw new Error("xAI fallback: XAI_API_KEY not set");

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS + 2000); // slightly longer for xAI
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: 800,
        response_format: { type: "json_object" as const },
      }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`xAI ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) throw new Error("xAI returned empty response");
    try { return JSON.parse(raw) as T; }
    catch { throw new Error("xAI returned invalid JSON"); }
  } finally {
    clearTimeout(timer);
  }
}

// ── Groq with model ladder + xAI emergency fallback ─────────────────────────
async function groqJson<T>(messages: ChatMessage[], temperature = 0.2): Promise<T> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new MissingApiKeyError();

  const attempt = async (model: string): Promise<Response> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      return await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: 800,
          response_format: { type: "json_object" as const },
        }),
        signal: ctl.signal,
      });
    } finally { clearTimeout(timer); }
  };

  // Model ladder: skip the primary entirely while it is known rate-limited.
  let model = getGroqActiveModel();
  let res = await attempt(model);
  if (res.status >= 500) {
    res = await attempt(model); // one retry on 5xx
  }
  if (res.status === 429) {
    if (model !== GROQ_FALLBACK_MODEL) {
      // Primary rate-limited: record it and retry the SAME request on fallback.
      const errText = await res.text().catch(() => "");
      markGroqPrimaryLimited(res, errText);
      model = GROQ_FALLBACK_MODEL;
      res = await attempt(model);
    }
    if (res.status === 429) {
      // Both models rate-limited — degrade gracefully; do NOT try xAI for
      // rate-limit conditions (the rate is shared; xAI is for outage only).
      throw new GroqRateLimitedError(getGroqLimitStatus().resetAt);
    }
  }

  // Hard failure path (5xx persistent, network down, timeout)
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const groqError = new Error(`Groq ${res.status}: ${errText.slice(0, 200)}`);

    // Tier 3: xAI emergency fallback — only when explicitly enabled and key present
    if (process.env.GROQ_XAI_FALLBACK === "true" && process.env.XAI_API_KEY) {
      console.warn("[ai-helpers] Groq hard failure — attempting xAI emergency fallback", groqError.message);
      try {
        const result = await xaiJson<T>(messages, temperature);
        console.log("[ai-helpers] xAI fallback succeeded");
        return result;
      } catch (xaiErr) {
        // Both providers failed — surface the original Groq error, log xAI's
        console.error("[ai-helpers] xAI fallback also failed:", xaiErr);
      }
    }

    throw groqError;
  }

  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Groq returned empty response");
  try { return JSON.parse(raw) as T; }
  catch { throw new Error("Groq returned invalid JSON"); }
}

// ---------- Helpers ---------------------------------------------------------

export async function improveReadability(text: string): Promise<{ suggestions: string[]; reason: string }> {
  const trimmed = (text || "").trim().slice(0, 2000);
  if (!trimmed) return { suggestions: [], reason: "No text provided." };
  const messages: ChatMessage[] = [
    { role: "system", content: "You improve slide text readability for large-screen worship display. Return JSON {\"suggestions\":[\"...\",\"...\"],\"reason\":\"...\"}. suggestions is up to 3 rewritten versions of the text, each optimised for on-screen readability (short lines, active voice, clear breaks). reason is one sentence." },
    { role: "user", content: trimmed },
  ];
  const out = await groqJson<{ suggestions?: unknown; reason?: unknown }>(messages);
  const suggestions = Array.isArray(out.suggestions)
    ? out.suggestions.filter((s): s is string => typeof s === "string").slice(0, 3)
    : [];
  const reason = typeof out.reason === "string" ? out.reason : "";
  return { suggestions, reason };
}

export async function formatLyrics(text: string): Promise<{ formatted: string; sections: { name: string; lines: string[] }[] }> {
  const trimmed = (text || "").trim().slice(0, 4000);
  if (!trimmed) return { formatted: "", sections: [] };
  const messages: ChatMessage[] = [
    { role: "system", content: "You format worship song lyrics that the user already owns. Return JSON {\"formatted\":\"...\",\"sections\":[{\"name\":\"Verse 1\",\"lines\":[\"...\"]}]}. Do NOT invent lyrics — only reformat what you were given. Split into sections (Verse, Chorus, Bridge, Tag) using visible structure or repetition. Keep original words." },
    { role: "user", content: trimmed },
  ];
  const out = await groqJson<{ formatted?: unknown; sections?: unknown }>(messages);
  const formatted = typeof out.formatted === "string" ? out.formatted : trimmed;
  const sections = Array.isArray(out.sections)
    ? out.sections.filter((s): s is { name: string; lines: string[] } => {
        return !!s && typeof s === "object"
          && typeof (s as { name?: unknown }).name === "string"
          && Array.isArray((s as { lines?: unknown }).lines)
          && (s as { lines: unknown[] }).lines.every((l) => typeof l === "string");
      })
    : [];
  return { formatted, sections };
}

const EFFECT_IDS: EffectId[] = [
  "fade_in", "fade_out", "cross_fade",
  "slide_up", "slide_down", "slide_left", "slide_right",
  "zoom_in", "zoom_out", "blur_in", "blur_out",
  "dissolve", "type_on",
  "wipe_left", "wipe_right", "wipe_up", "wipe_down",
  "bounce_in", "scale_pop", "soft_rise",
];

export async function suggestEffect(slideDescription: { textPreview: string; theme?: string; itemType: string }): Promise<{ effectId: EffectId; reason: string; alt: EffectId[] }> {
  const messages: ChatMessage[] = [
    { role: "system", content: `You choose a slide transition effect for a worship display. Valid effect ids: ${EFFECT_IDS.join(", ")}. Return JSON {"effectId":"<id>","reason":"<one sentence>","alt":["<id>","<id>"]}. Prefer subtle effects (fade_in, cross_fade, soft_rise) for worship/scripture; use zoom_in / scale_pop only for celebratory content.` },
    { role: "user", content: JSON.stringify(slideDescription).slice(0, 1000) },
  ];
  const out = await groqJson<{ effectId?: unknown; reason?: unknown; alt?: unknown }>(messages);
  const isEffect = (v: unknown): v is EffectId => typeof v === "string" && (EFFECT_IDS as string[]).includes(v);
  const effectId: EffectId = isEffect(out.effectId) ? out.effectId : "fade_in";
  const reason = typeof out.reason === "string" ? out.reason : "Default subtle fade.";
  const alt = Array.isArray(out.alt) ? out.alt.filter(isEffect).slice(0, 3) : [];
  return { effectId, reason, alt };
}

export async function draftAnnouncement(topic: string, tone: "warm" | "formal" | "urgent" | "celebratory"): Promise<{ line1: string; line2: string; reason: string }> {
  const trimmed = (topic || "").trim().slice(0, 300);
  const messages: ChatMessage[] = [
    { role: "system", content: `You draft a two-line lower-third church announcement. Tone: ${tone}. Return JSON {"line1":"...","line2":"...","reason":"..."}. line1 <= 50 chars, line2 <= 80 chars. No emojis unless tone is celebratory.` },
    { role: "user", content: trimmed || "General announcement" },
  ];
  const out = await groqJson<{ line1?: unknown; line2?: unknown; reason?: unknown }>(messages);
  return {
    line1: typeof out.line1 === "string" ? out.line1.slice(0, 60) : "",
    line2: typeof out.line2 === "string" ? out.line2.slice(0, 100) : "",
    reason: typeof out.reason === "string" ? out.reason : "",
  };
}

export async function fixSlide(slide: EditableSlide): Promise<{ patch: Partial<EditableSlide>; reason: string; warnings: string[] }> {
  // Summarise the slide for the LLM. We do NOT send unlimited detail.
  const summary = {
    bgColor: slide.bgColor,
    objects: slide.objects.map((o: SlideObject) => {
      if (o.kind === "text") return { id: o.id, kind: "text", text: (o.text || "").slice(0, 200), color: o.color, fontSize: o.fontSize, x: o.x, y: o.y, w: o.w, h: o.h };
      if (o.kind === "shape") return { id: o.id, kind: "shape", shape: o.shape, fill: o.fill };
      return { id: o.id, kind: "image" };
    }),
  };
  const messages: ChatMessage[] = [
    { role: "system", content: "You review a worship slide for on-screen readability. Return JSON {\"patch\":{},\"reason\":\"...\",\"warnings\":[\"...\"]}. patch is a SHALLOW partial EditableSlide — you may set bgColor. You may NOT change objects (the client will apply per-object suggestions separately in a later phase). warnings is a short list of specific issues you found (contrast, overflow, whitespace). If nothing to fix, return {\"patch\":{},\"reason\":\"Slide looks good.\",\"warnings\":[]}." },
    { role: "user", content: JSON.stringify(summary).slice(0, 2000) },
  ];
  const out = await groqJson<{ patch?: unknown; reason?: unknown; warnings?: unknown }>(messages);
  const patchIn = (out.patch && typeof out.patch === "object") ? out.patch as Record<string, unknown> : {};
  const patch: Partial<EditableSlide> = {};
  if (typeof patchIn.bgColor === "string") patch.bgColor = patchIn.bgColor;
  const reason = typeof out.reason === "string" ? out.reason : "";
  const warnings = Array.isArray(out.warnings) ? out.warnings.filter((w): w is string => typeof w === "string").slice(0, 8) : [];
  return { patch, reason, warnings };
}
