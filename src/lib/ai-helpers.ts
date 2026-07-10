// Phase 5D-3 — server-only AI helpers, exposed via /api/ai/helpers/[action].
//
// Groq is the ONLY provider (per user global CLAUDE.md). No fallback.
// Every helper:
//   • throws MissingApiKeyError if GROQ_API_KEY is not set,
//   • uses a 6s AbortController timeout,
//   • requests json_object response format,
//   • retries once on 5xx.
//
// This module must be imported ONLY from server code (API routes / server
// actions). It must never be bundled into a client component.

import type { EditableSlide, SlideObject } from "./slide-objects";
import type { EffectId } from "./effects";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const TIMEOUT_MS = 6000;

export class MissingApiKeyError extends Error {
  code = "MISSING_API_KEY" as const;
  constructor() { super("GROQ_API_KEY is not configured"); this.name = "MissingApiKeyError"; }
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function groqJson<T>(messages: ChatMessage[], temperature = 0.2): Promise<T> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new MissingApiKeyError();

  const body = {
    model: GROQ_MODEL,
    messages,
    temperature,
    max_tokens: 800,
    response_format: { type: "json_object" as const },
  };

  const attempt = async (): Promise<Response> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      return await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } finally { clearTimeout(timer); }
  };

  let res = await attempt();
  if (res.status >= 500) {
    res = await attempt();
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${errText.slice(0, 200)}`);
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
