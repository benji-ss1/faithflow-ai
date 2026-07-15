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
import { loadKeyterms } from "../src/lib/deepgram-keyterms";
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";

const PORT = Number(process.env.AUDIO_WS_PORT || 3001);
const DG_KEY = process.env.DEEPGRAM_API_KEY;
const TICKET_SECRET = process.env.AUTH_SECRET;

// Historically the bridge exited hard on a missing key so the operator got a
// "connection refused" with no context. In dev we now stay up and reply to
// every WS handshake with an explicit close code so the client can render
// "deepgram key missing" instead of a generic "AI error". Prod (Fly.io) still
// wants the fast-fail because a misconfigured deploy should not silently
// accept traffic — gated by NODE_ENV.
const KEY_MISSING = !DG_KEY;
const SECRET_MISSING = !TICKET_SECRET;
if ((KEY_MISSING || SECRET_MISSING) && process.env.NODE_ENV === "production") {
  if (KEY_MISSING) console.error("Missing DEEPGRAM_API_KEY");
  if (SECRET_MISSING) console.error("Missing AUTH_SECRET");
  process.exit(1);
}
if (KEY_MISSING) console.warn("[audio] DEEPGRAM_API_KEY missing — clients will get close code 1011 'deepgram key missing'");
if (SECRET_MISSING) console.warn("[audio] AUTH_SECRET missing — tickets cannot be verified");

const db = getDb();

/**
 * Open a raw WebSocket to Deepgram's streaming API. We tried the SDK's
 * high-level v1.connect() and its Results events never fired — even
 * though the same URL + params + audio worked when driven by hand-rolled
 * WS. Simpler, fewer moving parts.
 */
function openDeepgram(churchId: string): Promise<WebSocket> {
  const params = new URLSearchParams({
    model: "nova-3",
    language: "en",
    smart_format: "true",
    interim_results: "true",
    punctuate: "true",
    numerals: "true",
    // endpointing=200ms. Progression: initial 10ms was far too aggressive
    // (utterances ended mid-word); 400ms and 300ms both felt slightly slow
    // for reactive Bible-ref surfacing during preaching cadence. 200ms is
    // the current sweet spot — snappy without cutting mid-clause. Sent as
    // the integer 200 (string-encoded per URL params spec).
    endpointing: "200",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
  });
  // Keyterm prompts biasing scripture / worship vocabulary. Each term is a
  // separate `keyterm=...` query param — do NOT collapse into a single
  // comma-joined value. Per-church override loaded from
  // `config/deepgram-keyterms/<churchId>.json`, falling back to default.json,
  // falling back to the hard-coded list. Cached 5min in-process.
  const keyterms = loadKeyterms(churchId);
  for (const term of keyterms) params.append("keyterm", term);
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

// Y4: replay guard — a ticket sig is single-use within its exp window.
// Map<sig, expMs>. Cleaned opportunistically when new sigs arrive.
const usedTicketSigs = new Map<string, number>();
function pruneUsedSigs() {
  const now = Date.now();
  for (const [s, e] of usedTicketSigs) if (now > e) usedTicketSigs.delete(s);
}

// Y9: sig must be a lowercase-hex sha256 → exactly 64 chars.
function isValidSigFormat(sig: string): boolean {
  return typeof sig === "string" && sig.length === 64 && /^[0-9a-f]+$/i.test(sig);
}

function verifyTicket(planId: string, churchId: string, userId: string, exp: string, sig: string): boolean {
  if (!planId || !churchId || !userId || !exp || !sig) return false;
  if (!isValidSigFormat(sig)) return false;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || Date.now() > expMs) return false;
  // Y5: include userId in HMAC payload.
  const expected = crypto.createHmac("sha256", TICKET_SECRET!).update(`${planId}|${churchId}|${userId}|${exp}`).digest("hex");
  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex")); } catch { return false; }
  if (!ok) return false;
  // Y4: reject replayed sigs.
  pruneUsedSigs();
  if (usedTicketSigs.has(sig)) return false;
  usedTicketSigs.set(sig, expMs);
  return true;
}

// Y8: WS origin allowlist. Electron file:// sends no Origin (or "null").
const ORIGIN_ALLOWLIST = new Set<string>([
  "https://presentflow.app",
  ...(process.env.EXTRA_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
]);
function isOriginAllowed(origin: string | undefined): boolean {
  // Electron file:// packaged app: no Origin header, or literal "null".
  if (!origin || origin === "null") return true;
  if (ORIGIN_ALLOWLIST.has(origin)) return true;
  // Dev: any localhost port.
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
  } catch { /* ignore */ }
  return false;
}

// Y10: per-IP connection rate limit (single-instance in-memory Map — matches
// current Fly deployment). N connections per 60s window.
const RATE_LIMIT_N = Number(process.env.AUDIO_WS_RATE_LIMIT || 10);
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitBuckets = new Map<string, number[]>();
function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const arr = (rateLimitBuckets.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= RATE_LIMIT_N) { rateLimitBuckets.set(ip, arr); return false; }
  arr.push(now);
  rateLimitBuckets.set(ip, arr);
  return true;
}

type ClientMessage =
  | { type: "audio"; b64: string }
  | { type: "stop" };

type ServerMessage =
  | { type: "ready" }
  | { type: "interim"; text: string }
  | { type: "final"; segmentId: string; text: string; confidence?: number; words?: { w: string; c: number }[] }
  | { type: "interim_final_candidate"; text: string; confidence?: number; words?: { w: string; c: number }[] }
  | { type: "detection"; detection: { id: string; segmentId: string; book: string; chapter: number; verseStart: number; verseEnd: number; confidence: number; matchedText: string } }
  | { type: "song"; song: { suggestionId: string; segmentId: string; songId: string | null; title: string; confidence: number; matchedText: string } }
  | { type: "command"; command: { suggestionId: string; segmentId: string; verb: string; payload: Record<string, unknown>; confidence: number; matchedText: string } }
  | { type: "error"; message: string };

const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: !KEY_MISSING && !SECRET_MISSING,
      deepgramKey: KEY_MISSING ? "missing" : "present",
      authSecret: SECRET_MISSING ? "missing" : "present",
    }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("PresentFlow audio bridge OK\n");
});

const wss = new WebSocketServer({
  server: httpServer,
  // Y8: origin allowlist enforced during the upgrade handshake.
  verifyClient: (info, cb) => {
    const origin = info.origin as string | undefined;
    if (!isOriginAllowed(origin)) return cb(false, 403, "Origin not allowed");
    // Y10: per-IP rate limit.
    const ip = (info.req.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "");
    if (!rateLimitOk(ip)) return cb(false, 429, "Too many connections");
    cb(true);
  },
});

wss.on("connection", async (ws: WebSocket, req) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // Y7: diagnostics-panel reachability probe. Short-circuit BEFORE any
  // Deepgram connection (which would burn a session start / count against
  // the Deepgram concurrent-connection quota) and before ticket verify
  // (probe is unauthenticated by design — it only proves TCP+WS handshake).
  // Origin allowlist + per-IP rate limit already applied in verifyClient.
  if (url.searchParams.get("probe") === "1") {
    try { ws.send(JSON.stringify({ ok: true, probe: true })); } catch { /* ignore */ }
    try { ws.close(1000, "probe"); } catch { /* ignore */ }
    return;
  }

  const planId = url.searchParams.get("planId") || "";
  const churchId = url.searchParams.get("churchId") || "";
  const userId = url.searchParams.get("userId") || "";
  const exp = url.searchParams.get("exp") || "";
  const sig = url.searchParams.get("sig") || "";

  // Explicit close codes let the client render a specific error instead of
  // the generic "AI error" pill state.
  //   1008 = policy violation (bad ticket / expired / replayed)
  //   1011 = server-side config problem (missing key/secret)
  //   4004 = plan not found
  if (KEY_MISSING) { ws.close(1011, "deepgram key missing"); return; }
  if (SECRET_MISSING) { ws.close(1011, "auth secret missing"); return; }
  if (!verifyTicket(planId, churchId, userId, exp, sig)) { ws.close(1008, "invalid ticket"); return; }

  const [plan] = await db.select().from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, churchId))).limit(1);
  if (!plan) { ws.close(1008, "unknown plan"); return; }

  console.log(`[audio] client connected planId=${planId}`);
  const send = (msg: ServerMessage) => { try { ws.send(JSON.stringify(msg)); } catch { /* ignore */ } };

  let dg: WebSocket;
  try {
    dg = await openDeepgram(churchId);
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
    let data: { type?: string; is_final?: boolean; speech_final?: boolean; channel?: { alternatives?: { transcript?: string; confidence?: number; words?: { word?: string; start?: number; end?: number; confidence?: number }[] }[] } };
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (dgMessages === 1 || dgMessages % 20 === 0) {
      // Y7: gate transcript slice behind DEBUG in prod so transcripts don't
      // leak into audio-bridge logs.
      const debugOn = process.env.DEBUG === "1" || process.env.NODE_ENV !== "production";
      const slice = debugOn ? ` text="${(data.channel?.alternatives?.[0]?.transcript ?? "").slice(0, 40)}"` : "";
      console.log(`[audio] dg msg #${dgMessages} type=${data.type ?? "?"} final=${data.is_final ?? "?"}${slice}`);
    }
    if (data.type !== "Results") return;
    const text = data.channel?.alternatives?.[0]?.transcript?.trim();
    if (!text) return;

    const dgConf = data.channel?.alternatives?.[0]?.confidence;
    // Task 10: forward word-level confidence in compact form. Deepgram's
    // Results payload includes `channel.alternatives[0].words` with per-word
    // confidence; client uses this to gate autopilot on low-confidence spans.
    const rawWords = data.channel?.alternatives?.[0]?.words;
    const words = Array.isArray(rawWords)
      ? rawWords
          .filter((w) => typeof w?.word === "string" && typeof w?.confidence === "number")
          .map((w) => ({ w: String(w.word), c: Number(w.confidence) }))
      : undefined;

    if (!data.is_final) {
      // Fast-path: forward high-confidence long interims to the client for
      // optimistic detection (perf fix #2E). Client dedupes against final.
      send({ type: "interim", text });
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (wordCount >= 4 && typeof dgConf === "number" && dgConf >= 0.8) {
        send({ type: "interim_final_candidate", text, confidence: dgConf, words });
      }
      return;
    }

    const [seg] = await db.insert(transcriptSegments).values({ servicePlanId: planId, text }).returning();
    send({ type: "final", segmentId: seg.id, text, confidence: dgConf, words });

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
