/*
 * OpenFlow structured-output parsers — PURE and total. In Service Builder /
 * Scripture / Songs modes the model wraps a JSON payload in a tagged block
 * (<service_plan>…</service_plan>, <scripture>…</scripture>,
 * <song_suggestions>…</song_suggestions>). This module extracts the first such
 * block from a (possibly still-streaming) assistant message, parses it
 * defensively, and returns the surrounding prose with the tag stripped so the
 * chat can render clean text plus a structured card. Malformed or partial JSON
 * never throws — it yields card:null and leaves the prose intact.
 */

export type ServicePlanBlock = {
  name: string;
  durationMin: number;
  type: "songs" | "scripture" | "sermon" | "media" | "other";
  items: string[];
};
export type ServicePlan = {
  serviceType: string;
  blocks: ServicePlanBlock[];
  totalMin: number;
  insights: string[];
};

export type ScriptureRef = { reference: string; translation?: string };

export type SongSuggestion = { title: string; author?: string; reason?: string };
export type SongSuggestions = { suggestions: SongSuggestion[] };

export type OpenFlowCard =
  | { kind: "service_plan"; data: ServicePlan }
  | { kind: "scripture"; data: ScriptureRef }
  | { kind: "song_suggestions"; data: SongSuggestions };

const TAGS = ["service_plan", "scripture", "song_suggestions"] as const;
type TagName = (typeof TAGS)[number];

function firstString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function coerce(tag: TagName, raw: unknown): OpenFlowCard | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (tag === "service_plan") {
    const blocksRaw = Array.isArray(o.blocks) ? o.blocks : [];
    const blocks: ServicePlanBlock[] = blocksRaw.map((b) => {
      const bo = (b || {}) as Record<string, unknown>;
      const t = firstString(bo.type, "other");
      const type = (["songs", "scripture", "sermon", "media", "other"].includes(t) ? t : "other") as ServicePlanBlock["type"];
      return { name: firstString(bo.name, "Block"), durationMin: num(bo.durationMin ?? bo.duration), type, items: strArray(bo.items ?? bo.content) };
    }).filter((b) => b.name);
    if (blocks.length === 0) return null;
    const totalMin = num(o.totalMin ?? o.totalDuration) || blocks.reduce((s, b) => s + b.durationMin, 0);
    return { kind: "service_plan", data: { serviceType: firstString(o.serviceType, "Service"), blocks, totalMin, insights: strArray(o.insights) } };
  }
  if (tag === "scripture") {
    const reference = firstString(o.reference);
    if (!reference) return null;
    const translation = firstString(o.translation) || undefined;
    return { kind: "scripture", data: { reference, translation } };
  }
  // song_suggestions
  const sugRaw = Array.isArray(o.suggestions) ? o.suggestions : [];
  const suggestions: SongSuggestion[] = sugRaw.map((s) => {
    const so = (s || {}) as Record<string, unknown>;
    return { title: firstString(so.title), author: firstString(so.author) || undefined, reason: firstString(so.reason) || undefined };
  }).filter((s) => s.title);
  if (suggestions.length === 0) return null;
  return { kind: "song_suggestions", data: { suggestions } };
}

/**
 * Extract the first structured card from an assistant message. Returns the
 * prose with the tag block removed, and the parsed card (or null). Tolerant of
 * a still-open tag mid-stream (no closing tag yet → treated as not-ready, prose
 * up to the open tag is shown, card stays null until it closes).
 */
export function extractOpenFlowCard(text: string): { prose: string; card: OpenFlowCard | null } {
  for (const tag of TAGS) {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    const i = text.indexOf(open);
    if (i === -1) continue;
    const j = text.indexOf(close, i + open.length);
    if (j === -1) {
      // Tag is still streaming — hide the partial JSON, show prose before it.
      return { prose: text.slice(0, i).trim(), card: null };
    }
    const jsonStr = text.slice(i + open.length, j).trim();
    const prose = (text.slice(0, i) + text.slice(j + close.length)).trim();
    let parsed: unknown = null;
    try { parsed = JSON.parse(jsonStr); } catch { parsed = null; }
    const card = parsed ? coerce(tag, parsed) : null;
    return { prose, card };
  }
  return { prose: text, card: null };
}
