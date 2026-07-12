/**
 * Standalone WebSocket audio bridge for Present Flow.
 *
 * Browser (operator console) opens WS to ws://localhost:3001?planId=<uuid>&...
 * with a signed HMAC ticket (minted by /api/audio/ticket), streams 16kHz
 * linear16 PCM chunks. This server:
 *   - Verifies the ticket against AUTH_SECRET.
 *   - Opens a Deepgram v5 streaming connection with the server-side API key.
 *   - Persists finalized transcripts as TranscriptSegment rows.
 *   - Runs the rule-based Bible parser on every finalized segment; on match,
 *     persists a DetectedReference row and pushes the suggestion back.
 *   - Emits interim transcripts to the browser (not persisted).
 *
 * The Deepgram key never leaves the server.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { getDb } from "../src/lib/db/client";
import { transcriptSegments, detectedReferences, servicePlans, bibleTranslations, churchPreferences } from "../src/lib/db/schema";
import { parseReferences, knownBook } from "../src/lib/bible-parser";
import { extractSongCandidates, fuzzyMatchSong } from "../src/lib/song-parser";
import { parseCommands } from "../src/lib/command-parser";
import { semanticSearch } from "../src/lib/server/bible";
import { songs, aiSuggestions } from "../src/lib/db/schema";
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";

const PORT = Number(process.env.AUDIO_WS_PORT || 3001);
const DG_KEY = process.env.DEEPGRAM_API_KEY;
const TICKET_SECRET = process.env.AUTH_SECRET;

if (!DG_KEY) { console.error("Missing DEEPGRAM_API_KEY"); process.exit(1); }
if (!TICKET_SECRET) { console.error("Missing AUTH_SECRET"); process.exit(1); }

const db = getDb();

/**
 * Open a raw WebSocket to Deepgram's streaming API. We tried the SDK's
 * high-level v1.connect() and its Results events never fired — even
 * though the same URL + params + audio worked when driven by hand-rolled
 * WS. Simpler, fewer moving parts.
 */
function openDeepgram(): Promise<WebSocket> {
  const params = new URLSearchParams({
    model: "nova-2",
    language: "en-US",
    smart_format: "true",
    interim_results: "true",
    punctuate: "true",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    endpointing: "400",
  });
  const url = `wss://api.deepgram.com/v1/listen?${params}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Authorization: `Token ${DG_KEY}` } });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

type ResolvedPrefs = { defaultTranslationId: string | null; commandPrefix: string };

// Refetched on each finalized segment. Cheap query; keeps behaviour honest
// if the operator flips a preference mid-service.
async function getPrefs(churchId: string): Promise<ResolvedPrefs> {
  const [prefs] = await db.select().from(churchPreferences).where(eq(churchPreferences.churchId, churchId)).limit(1);
  let defaultTranslationId = prefs?.defaultTranslationId ?? null;
  if (!defaultTranslationId) {
    const [kjv] = await db.select().from(bibleTranslations).where(eq(bibleTranslations.code, "KJV")).limit(1);
    defaultTranslationId = kjv?.id ?? null;
  }
  return { defaultTranslationId, commandPrefix: prefs?.commandPrefix ?? "presentflow" };
}

async function getDefaultTranslationId(churchId: string): Promise<string | null> {
  return (await getPrefs(churchId)).defaultTranslationId;
}

function verifyTicket(planId: string, churchId: string, exp: string, sig: string): boolean {
  if (!planId || !churchId || !exp || !sig) return false;
  if (Date.now() > Number(exp)) return false;
  const expected = crypto.createHmac("sha256", TICKET_SECRET!).update(`${planId}|${churchId}|${exp}`).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}

type ClientMessage =
  | { type: "audio"; b64: string }
  | { type: "stop" };

type ServerMessage =
  | { type: "ready" }
  | { type: "interim"; text: string }
  | { type: "final"; segmentId: string; text: string }
  | { type: "detection"; detection: { id: string; segmentId: string; book: string; chapter: number; verseStart: number; verseEnd: number; confidence: number; matchedText: string } }
  | { type: "song"; song: { suggestionId: string; segmentId: string; songId: string | null; title: string; confidence: number; matchedText: string } }
  | { type: "command"; command: { suggestionId: string; segmentId: string; verb: string; payload: Record<string, unknown>; confidence: number; matchedText: string } }
  | { type: "error"; message: string };

const httpServer = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("PresentFlow audio bridge OK\n");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", async (ws: WebSocket, req) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const planId = url.searchParams.get("planId") || "";
  const churchId = url.searchParams.get("churchId") || "";
  const exp = url.searchParams.get("exp") || "";
  const sig = url.searchParams.get("sig") || "";

  if (!verifyTicket(planId, churchId, exp, sig)) { ws.close(4001, "Invalid ticket"); return; }

  const [plan] = await db.select().from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, churchId))).limit(1);
  if (!plan) { ws.close(4004, "Unknown plan"); return; }

  console.log(`[audio] client connected planId=${planId}`);
  const send = (msg: ServerMessage) => { try { ws.send(JSON.stringify(msg)); } catch { /* ignore */ } };

  let dg: WebSocket;
  try {
    dg = await openDeepgram();
  } catch (e) {
    console.error("[audio] Deepgram connect failed:", e instanceof Error ? e.message : e);
    send({ type: "error", message: "Could not reach Deepgram" });
    ws.close();
    return;
  }

  let audioChunks = 0;
  let dgMessages = 0;
  // Per-connection dedupe: a reference like "John 3:16" spoken twice within
  // this window collapses to one suggestion. Prevents the rolling transcript
  // overlap (or a pastor repeating the reference for emphasis) from
  // flooding the operator's panel.
  const DEDUPE_WINDOW_MS = 30_000;
  const recentRefs = new Map<string, number>(); // "book|ch|vs|ve" -> tsMs
  const recentSongs = new Map<string, number>(); // songId -> tsMs
  const recentCmds = new Map<string, number>(); // verb -> tsMs
  const dedupeKey = (parts: string[]) => parts.join("|");
  const isDupe = (map: Map<string, number>, key: string) => {
    const now = Date.now();
    // prune stale entries opportunistically
    for (const [k, t] of map) if (now - t > DEDUPE_WINDOW_MS) map.delete(k);
    if (map.has(key)) return true;
    map.set(key, now);
    return false;
  };

  // Already open — the SDK-style "open" event has already fired since
  // openDeepgram() awaited it. Signal readiness immediately.
  console.log(`[audio] Deepgram OPEN for plan ${planId}`);
  send({ type: "ready" });

  dg.on("message", async (raw: WebSocket.RawData) => {
    dgMessages++;
    let data: { type?: string; is_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } };
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (dgMessages === 1 || dgMessages % 20 === 0) {
      console.log(`[audio] dg msg #${dgMessages} type=${data.type ?? "?"} final=${data.is_final ?? "?"} text="${(data.channel?.alternatives?.[0]?.transcript ?? "").slice(0, 40)}"`);
    }
    if (data.type !== "Results") return;
    const text = data.channel?.alternatives?.[0]?.transcript?.trim();
    if (!text) return;

    if (!data.is_final) { send({ type: "interim", text }); return; }

    const [seg] = await db.insert(transcriptSegments).values({ servicePlanId: planId, text }).returning();
    send({ type: "final", segmentId: seg.id, text });

    const refs = parseReferences(text);
    for (const ref of refs) {
      let book = ref.book, chapter = ref.chapter, vs = ref.verseStart, ve = ref.verseEnd;
      let confidence = ref.confidence;

      // Semantic disambiguation fallback — only when the parser flags low
      // confidence AND the segment has enough substance to embed. Uses the
      // church's default translation if set, else KJV.
      if (ref.needsSemanticFallback && text.length >= 12) {
        try {
          const defaultT = await getDefaultTranslationId(churchId);
          if (defaultT) {
            const hits = await semanticSearch(defaultT, text, 3);
            const top = hits[0];
            // cosine distance: 0 = identical, 2 = opposite. Normalize to
            // a similarity score in [0..100]. Then blend with parser
            // confidence rather than replacing — a low parser signal +
            // strong semantic hit should still be honest, not inflated.
            if (top) {
              const semanticSim = Math.max(0, Math.round((1 - top.distance) * 100));
              // Only override the position (book/chapter/verse) when the
              // semantic top hit is clearly better than the parser guess
              // (semanticSim >= 55 AND parser confidence < 75).
              if (semanticSim >= 55 && confidence < 75) {
                const canonicalTop = knownBook(top.book) || top.book;
                book = canonicalTop; chapter = top.chapter; vs = top.verse; ve = top.verse;
              }
              // Blended confidence: weighted, never higher than the
              // stronger of the two signals.
              confidence = Math.min(95, Math.max(confidence, Math.round(0.6 * semanticSim + 0.4 * confidence)));
            }
          }
        } catch (e) {
          console.error("[audio] semantic fallback error:", e instanceof Error ? e.message : e);
          // Preserve original parser guess; don't drop the suggestion.
        }
      }

      // Dedupe: same book+chapter+range within the window collapses.
      if (isDupe(recentRefs, dedupeKey([book, String(chapter), String(vs), String(ve)]))) continue;

      const [det] = await db.insert(detectedReferences).values({
        transcriptSegmentId: seg.id,
        book, chapter, verseStart: vs, verseEnd: ve, confidence, status: "pending",
      }).returning();
      send({ type: "detection", detection: {
        id: det.id, segmentId: seg.id, book, chapter,
        verseStart: vs, verseEnd: ve, confidence,
        matchedText: ref.matchedText,
      }});
    }

    // ---- Song detection ---------------------------------------------------
    const songCands = extractSongCandidates(text);
    if (songCands.length > 0) {
      const library = await db.select({ id: songs.id, title: songs.title })
        .from(songs).where(eq(songs.churchId, churchId));
      for (const cand of songCands) {
        const match = fuzzyMatchSong(cand, library);
        // Dedupe on matched song (or title text if unmatched)
        if (isDupe(recentSongs, dedupeKey([match.songId ?? `t:${match.title.toLowerCase()}`]))) continue;
        const [row] = await db.insert(aiSuggestions).values({
          servicePlanId: planId,
          type: "song",
          payload: { songId: match.songId, title: match.title, matchedText: match.matchedText, needsSemanticFallback: match.needsSemanticFallback },
          confidence: match.confidence,
          status: "pending",
        }).returning();
        send({ type: "song", song: {
          suggestionId: row.id, segmentId: seg.id,
          songId: match.songId, title: match.title,
          confidence: match.confidence, matchedText: match.matchedText,
        }});
      }
    }

    // ---- Voice commands ---------------------------------------------------
    const prefs = await getPrefs(churchId);
    const commands = parseCommands(text, prefs.commandPrefix);
    for (const cmd of commands) {
      // Command dedupe by verb (with payload for show_reference to avoid
      // collapsing distinct references)
      const cmdKey = cmd.verb === "show_reference" ? `show:${JSON.stringify(cmd.payload)}` : cmd.verb;
      if (isDupe(recentCmds, cmdKey)) continue;
      const [row] = await db.insert(aiSuggestions).values({
        servicePlanId: planId,
        type: "action",
        payload: { verb: cmd.verb, ...cmd.payload, matchedText: cmd.matchedText },
        confidence: cmd.confidence,
        status: "pending",
      }).returning();
      send({ type: "command", command: {
        suggestionId: row.id, segmentId: seg.id,
        verb: cmd.verb, payload: cmd.payload,
        confidence: cmd.confidence, matchedText: cmd.matchedText,
      }});
    }
  });

  dg.on("error", (err: Error) => {
    console.error("[audio] Deepgram error:", err.message);
    send({ type: "error", message: "Deepgram error" });
  });

  dg.on("close", (code: number, reason: Buffer) => {
    console.log(`[audio] Deepgram closed code=${code} reason=${reason.toString() || "(none)"} after ${dgMessages} msgs`);
  });

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try { msg = JSON.parse(raw.toString()) as ClientMessage; } catch { return; }
    if (msg.type === "audio") {
      const buf = Buffer.from(msg.b64, "base64");
      audioChunks++;
      if (audioChunks === 1 || audioChunks % 500 === 0) console.log(`[audio] received chunk #${audioChunks} (${buf.length} bytes)`);
      // Only forward if Deepgram socket is still open.
      if (dg.readyState === WebSocket.OPEN) {
        try { dg.send(buf); } catch (e) { console.error("[audio] send err", e); }
      }
    } else if (msg.type === "stop") {
      try { dg.send(JSON.stringify({ type: "CloseStream" })); } catch { /* ignore */ }
    }
  });

  ws.on("close", () => {
    console.log("[audio] client disconnected");
    try {
      if (dg.readyState === WebSocket.OPEN) dg.send(JSON.stringify({ type: "CloseStream" }));
      dg.close();
    } catch { /* ignore */ }
  });
});

httpServer.listen(PORT, () => {
  console.log(`✓ PresentFlow audio bridge listening on ws://localhost:${PORT}`);
});
