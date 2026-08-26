/*
 * OpenFlow church context — server-only. Assembles the real, church-scoped facts
 * that ground OpenFlow's system prompt so its answers are specific to THIS
 * church and never fabricated. Every field is read from the DB through existing
 * helpers; each section is defensive (a missing table degrades to "unknown",
 * never throws), so OpenFlow still works on a brand-new church.
 *
 * Honesty rule (see OPENFLOW_PLAN.md D2): per-song usage frequency and a
 * first-class preacher entity are NOT tracked yet, so we surface only what is
 * real — aggregate "most used" songs/scriptures from churchServicePatterns — and
 * the prompt explicitly tells the model not to invent stats it wasn't given.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { churches, churchPreferences, bibleTranslations, mediaAssets } from "@/lib/db/schema";
import { listSongs } from "@/lib/server/services";
import { getChurchPatterns } from "@/lib/server/service-patterns";
import { listTranslations, availableLicensedCodes } from "@/lib/server/bible";
import type { OpenFlowMode } from "@/lib/openflow/types";

export type { OpenFlowMode };

export type OpenFlowChurchContext = {
  churchName: string;
  city: string | null;
  country: string | null;
  denomination: string | null;
  timezone: string;
  songCount: number;
  songTitles: { title: string; artist: string | null }[];
  translations: string[];
  defaultTranslation: string | null;
  servicesAnalyzed: number;
  avgItemCount: number;
  topSongs: { title: string; count: number }[];
  topScriptures: { book: string; chapter: number; count: number }[];
  mediaCount: number;
};

export async function getOpenFlowChurchContext(churchId: string): Promise<OpenFlowChurchContext> {
  const db = getDb();

  const ctx: OpenFlowChurchContext = {
    churchName: "your church",
    city: null, country: null, denomination: null, timezone: "UTC",
    songCount: 0, songTitles: [],
    translations: [], defaultTranslation: null,
    servicesAnalyzed: 0, avgItemCount: 0, topSongs: [], topScriptures: [],
    mediaCount: 0,
  };

  // These sections are independent — run them CONCURRENTLY (one round-trip of
  // latency instead of five), each keeping its own try/catch so a single failure
  // still degrades to the default rather than sinking the whole context. This
  // runs on every chat turn, so the serial cost mattered.
  await Promise.all([
    (async () => {
      try {
        const [church] = await db.select().from(churches).where(eq(churches.id, churchId)).limit(1);
        if (church) {
          ctx.churchName = church.name || ctx.churchName;
          ctx.city = church.city; ctx.country = church.country;
          ctx.denomination = church.denomination; ctx.timezone = church.timezone || "UTC";
        }
      } catch { /* keep defaults */ }
    })(),
    (async () => {
      try {
        const songs = await listSongs(churchId);
        ctx.songCount = songs.length;
        // Cap the title list so a huge library doesn't blow the prompt budget;
        // the model is told this is a sample, and Songs mode queries live later.
        ctx.songTitles = songs.slice(0, 60).map((s) => ({ title: s.title, artist: s.artist ?? null }));
      } catch { /* keep defaults */ }
    })(),
    (async () => {
      try {
        const [all, licensed, prefs] = await Promise.all([
          listTranslations(),
          availableLicensedCodes(churchId).catch(() => new Set<string>()),
          db.select().from(churchPreferences).where(eq(churchPreferences.churchId, churchId)).limit(1),
        ]);
        ctx.translations = all
          .filter((t) => t.isPublicDomain || licensed.has(t.code))
          .map((t) => t.code);
        const defId = prefs[0]?.defaultTranslationId;
        if (defId) {
          const [t] = await db.select({ code: bibleTranslations.code })
            .from(bibleTranslations).where(eq(bibleTranslations.id, defId)).limit(1);
          ctx.defaultTranslation = t?.code ?? null;
        }
        if (!ctx.defaultTranslation && ctx.translations.includes("KJV")) ctx.defaultTranslation = "KJV";
      } catch { /* keep defaults */ }
    })(),
    (async () => {
      try {
        const patterns = await getChurchPatterns(churchId);
        if (patterns) {
          ctx.servicesAnalyzed = patterns.servicesAnalyzed;
          ctx.avgItemCount = patterns.avgItemCount;
          ctx.topSongs = patterns.topSongs.slice(0, 10);
          ctx.topScriptures = patterns.topScriptures.slice(0, 10);
        }
      } catch { /* keep defaults */ }
    })(),
    (async () => {
      try {
        // Just the count — no need to pull every media row's columns to read a length.
        const [row] = await db.select({ n: sql<number>`count(*)::int` })
          .from(mediaAssets).where(eq(mediaAssets.churchId, churchId));
        ctx.mediaCount = row?.n ?? 0;
      } catch { /* keep defaults */ }
    })(),
  ]);

  return ctx;
}

/** Time-of-day greeting word for the church's timezone (falls back to server
 *  local time if the timezone is invalid). */
function greetingFor(timezone: string, now: Date): string {
  let hour = now.getHours();
  try {
    const s = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone }).format(now);
    const parsed = parseInt(s, 10);
    if (!Number.isNaN(parsed)) hour = parsed % 24;
  } catch { /* invalid tz — keep server hour */ }
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Lightweight read for the welcome screen — just the church's name and its
 *  time-of-day greeting word (in the church's timezone). Avoids loading the full
 *  context (songs/patterns) for what the greeting needs. */
export async function getChurchGreeting(churchId: string, now = new Date()): Promise<{ churchName: string; greeting: string }> {
  const db = getDb();
  let name = "your church";
  let tz = "UTC";
  try {
    const [church] = await db.select({ name: churches.name, timezone: churches.timezone })
      .from(churches).where(eq(churches.id, churchId)).limit(1);
    if (church) { name = church.name || name; tz = church.timezone || "UTC"; }
  } catch { /* keep defaults */ }
  return { churchName: name, greeting: greetingFor(tz, now) };
}

/** Build OpenFlow's system prompt from real church context. Increment 1 wires
 *  the "chat" persona; the mode-specific structured-output instructions arrive
 *  with their capabilities in later increments. */
export function buildOpenFlowSystemPrompt(
  ctx: OpenFlowChurchContext,
  mode: OpenFlowMode,
  now: Date,
): string {
  const lines: string[] = [];
  lines.push(`You are OpenFlow, the AI assistant built into PresentFlow — the church presentation app the team at ${ctx.churchName} runs during their services.`);
  lines.push("");
  lines.push("PERSONALITY:");
  lines.push("- Warm, confident, and church-aware. You speak like a knowledgeable member of their team, not a generic chatbot.");
  lines.push("- You reference this church's real data naturally when it helps.");
  lines.push("- You NEVER invent songs that are not in their library, and you NEVER fabricate service history, statistics, or preacher details you were not given. If you do not know, say so plainly.");
  lines.push("- Keep replies focused and practical. Prefer short paragraphs.");
  lines.push("- Never use emoji. If you need to label something, use words, not emoji or decorative symbols.");
  lines.push("");
  lines.push("WHAT THIS CHURCH KNOWS:");
  lines.push(`- Church: ${ctx.churchName}${ctx.city ? `, ${ctx.city}` : ""}${ctx.country ? `, ${ctx.country}` : ""}${ctx.denomination ? ` (${ctx.denomination})` : ""}.`);
  lines.push(`- Song library: ${ctx.songCount} songs.` + (ctx.songTitles.length
    ? ` A sample: ${ctx.songTitles.slice(0, 40).map((s) => `"${s.title}"${s.artist ? ` by ${s.artist}` : ""}`).join(", ")}${ctx.songCount > 40 ? ", and more" : ""}.`
    : ""));
  if (ctx.translations.length) {
    lines.push(`- Bible translations available: ${ctx.translations.join(", ")}.` + (ctx.defaultTranslation ? ` Default: ${ctx.defaultTranslation}.` : ""));
  }
  if (ctx.servicesAnalyzed > 0) {
    lines.push(`- Services analysed: ${ctx.servicesAnalyzed} (typically about ${ctx.avgItemCount} items each).`);
    if (ctx.topSongs.length) lines.push(`- Most-used songs: ${ctx.topSongs.map((s) => `"${s.title}" (${s.count}x)`).join(", ")}.`);
    if (ctx.topScriptures.length) lines.push(`- Most-projected scriptures: ${ctx.topScriptures.map((s) => `${s.book} ${s.chapter} (${s.count}x)`).join(", ")}.`);
  } else {
    lines.push("- No service history has been analysed yet, so do not claim any past-service statistics.");
  }
  lines.push(`- Media library: ${ctx.mediaCount} assets.`);
  lines.push("");
  lines.push(`Note: per-song 'last used' dates and individual preacher profiles are not tracked yet — do not state them. You MAY reference 'most-used' counts above, which are real.`);
  lines.push("");
  lines.push(`The operator's local greeting right now is "${greetingFor(ctx.timezone, now)}".`);
  lines.push("");
  lines.push(`CURRENT MODE: ${mode}. In this mode, answer conversationally and helpfully.`);
  return lines.join("\n");
}
