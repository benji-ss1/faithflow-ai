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
import { parseReferences, knownBook, parseBareVerse, isValidChapter } from "../src/lib/bible-parser";
import { extractSongCandidates, fuzzyMatchSong } from "../src/lib/song-parser";
import { parseCommands } from "../src/lib/command-parser";
import { semanticSearch } from "../src/lib/server/bible";
import { songs, aiSuggestions } from "../src/lib/db/schema";
import { loadKeyterms, loadLearnedKeyterms } from "../src/lib/deepgram-keyterms";
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

// Roadmap #2 — canonical (Whisper) two-pass helpers. Wraps 16kHz mono
// PCM in a WAV RIFF header + POSTs to Groq's Whisper endpoint. Returns
// null on any failure (bad key, network, non-2xx) so callers can no-op.
function wrapPcmAsWav(pcm: Buffer, sampleRate = 16000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = pcm.length;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);              // PCM chunk size
  buf.writeUInt16LE(1, 20);               // format = PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  pcm.copy(buf, 44);
  return buf;
}

// Special-cased return: caller sets a circuit-breaker cooldown on this
// sentinel so a rate-limit storm doesn't keep hammering Groq.
async function whisperTranscribe(pcm: Buffer, groqKey: string, timeoutMs = 5000): Promise<string | "__RATE_LIMITED__" | null> {
  if (!groqKey || pcm.length < 3200 /* ~0.1s @16k */) return null;
  const wav = wrapPcmAsWav(pcm);
  // Node's built-in fetch supports FormData + Blob via undici. Explicit
  // filename "audio.wav" so Groq/OpenAI-style endpoint content-type
  // detection lands correctly.
  const form = new FormData();
  // TS strict-mode dance: DOM's Blob typing requires ArrayBufferView<ArrayBuffer>
  // but Node Buffer.buffer widens to ArrayBufferLike. Copy into a fresh
  // ArrayBuffer so the type is definitively ArrayBuffer, not SharedArrayBuffer.
  const arrayBuf = new ArrayBuffer(wav.length);
  new Uint8Array(arrayBuf).set(wav);
  form.set("file", new Blob([arrayBuf], { type: "audio/wav" }), "audio.wav");
  form.set("model", "whisper-large-v3");
  form.set("response_format", "text");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body: form,
      signal: ctl.signal,
    });
    if (!res.ok) {
      if (res.status === 429) return "__RATE_LIMITED__";
      console.warn(`[canonical] whisper POST failed status=${res.status}`);
      return null;
    }
    const text = (await res.text()).trim();
    return text || null;
  } catch (e) {
    console.warn("[canonical] whisper POST error:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(t);
  }
}
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
async function openDeepgram(churchId: string): Promise<WebSocket> {
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
    // Roadmap #8 — diarization. Deepgram nova-3 tags each word with a
    // speaker index. Congregation shouts and side conversations that
    // aren't the primary preacher get a different speaker label; the
    // client can weight or ignore them. Enabled server-side but consumed
    // gracefully client-side (if the field's missing, nothing changes).
    diarize: "true",
  });
  // Keyterm prompts biasing scripture / worship vocabulary. Each term is a
  // separate `keyterm=...` query param — do NOT collapse into a single
  // comma-joined value. Precedence:
  //   1. `config/deepgram-keyterms/<churchId>.json` if present
  //   2. `config/deepgram-keyterms/default.json`
  //   3. Hard-coded `DEEPGRAM_KEYTERMS`
  // Plus, roadmap #4: db-backed learned keyterms for this church merged
  // on top (capped by MAX_LEARNED_TERMS_PER_CHURCH). Deepgram's stated
  // ceiling is 100 keyterms/connection; hard-cap the merged output to 100
  // to stay safely under.
  const [staticTerms, learnedTerms] = await Promise.all([
    Promise.resolve(loadKeyterms(churchId)),
    loadLearnedKeyterms(churchId),
  ]);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const t of [...staticTerms, ...learnedTerms]) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(t);
    if (merged.length >= 100) break;
  }
  for (const term of merged) params.append("keyterm", term);
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
// 5-min in-memory cache, same shape/rationale as loadKeyterms (see
// src/lib/deepgram-keyterms.ts) — this was previously an unconditional DB
// round trip on EVERY finalized transcript segment regardless of whether it
// contained a voice command at all. Prefs essentially never change mid-
// service, so a short TTL cache removes that per-segment query entirely.
const PREFS_CACHE_TTL_MS = 5 * 60 * 1000;
const prefsCache = new Map<string, { value: ResolvedPrefs; at: number }>();

async function getPrefs(churchId: string): Promise<ResolvedPrefs> {
  const cached = prefsCache.get(churchId);
  if (cached && Date.now() - cached.at < PREFS_CACHE_TTL_MS) return cached.value;
  const [prefs] = await db.select().from(churchPreferences).where(eq(churchPreferences.churchId, churchId)).limit(1);
  let defaultTranslationId = prefs?.defaultTranslationId ?? null;
  if (!defaultTranslationId) {
    const [kjv] = await db.select().from(bibleTranslations).where(eq(bibleTranslations.code, "KJV")).limit(1);
    defaultTranslationId = kjv?.id ?? null;
  }
  const value: ResolvedPrefs = { defaultTranslationId, commandPrefix: prefs?.commandPrefix ?? "presentflow" };
  prefsCache.set(churchId, { value, at: Date.now() });
  return value;
}

async function getDefaultTranslationId(churchId: string): Promise<string | null> {
  return (await getPrefs(churchId)).defaultTranslationId;
}

// Same cache pattern — was a full `songs` SELECT on every transcript segment
// that contained any song-cue phrase (common during a worship set), with no
// caching at all. A church's library doesn't change mid-service.
const SONG_LIBRARY_CACHE_TTL_MS = 5 * 60 * 1000;
const songLibraryCache = new Map<string, { value: { id: string; title: string }[]; at: number }>();

async function getSongLibrary(churchId: string): Promise<{ id: string; title: string }[]> {
  const cached = songLibraryCache.get(churchId);
  if (cached && Date.now() - cached.at < SONG_LIBRARY_CACHE_TTL_MS) return cached.value;
  const library = await db.select({ id: songs.id, title: songs.title }).from(songs).where(eq(songs.churchId, churchId));
  songLibraryCache.set(churchId, { value: library, at: Date.now() });
  return library;
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
  "https://app.presentflow.com",
  "https://faithflow-ai.vercel.app",
  ...(process.env.EXTRA_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
]);
// Preview + branch deploys under our Vercel scope — matched by suffix so we
// don't have to redeploy the audio bridge every time a preview URL changes.
const ORIGIN_ALLOWED_SUFFIXES = [
  "-benjamin-sanusis-projects.vercel.app",
  "-benji-ss1.vercel.app",
];
function isOriginAllowed(origin: string | undefined): boolean {
  // Electron file:// packaged app: no Origin header, or literal "null".
  if (!origin || origin === "null") return true;
  if (ORIGIN_ALLOWLIST.has(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
    if (u.protocol === "https:" && ORIGIN_ALLOWED_SUFFIXES.some((s) => u.hostname.endsWith(s))) return true;
  } catch { /* ignore */ }
  return false;
}

// R7: per-user concurrent-connection cap. Each user is bounded to
// AUDIO_WS_PER_USER_CAP concurrent sessions (default 3). When exceeded, the
// oldest (LRU) is closed with 1013 "too many concurrent sessions". Also:
// same-plan dedupe — a newer connection for the same planId supersedes older.
const PER_USER_CAP = Number(process.env.AUDIO_WS_PER_USER_CAP || 3);
const openByUser = new Map<string, Set<WebSocket>>();
const wsMeta = new WeakMap<WebSocket, { userId: string; planId: string; openedAt: number }>();

// Y10: per-connection DG stall watchdog. If audio is flowing but no Results
// for 30s, close DG (client will reconnect).
const stallByConn = new WeakMap<WebSocket, { lastDgResultAt: number; lastAudioAt: number; timer: NodeJS.Timeout }>();

// Y11: periodic sweep of unbounded maps. Prune every 5 min; cap at 10k entries.
const MAP_ENTRY_CAP = 10_000;
function lruCapMap<K, V>(m: Map<K, V>) {
  while (m.size > MAP_ENTRY_CAP) {
    const oldest = m.keys().next().value;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
}
setInterval(() => {
  pruneUsedSigs();
  const now = Date.now();
  for (const [ip, arr] of rateLimitBuckets) {
    const kept = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (kept.length === 0) rateLimitBuckets.delete(ip);
    else rateLimitBuckets.set(ip, kept);
  }
  lruCapMap(usedTicketSigs);
  lruCapMap(rateLimitBuckets);
}, 5 * 60 * 1000).unref?.();

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
  | { type: "final"; segmentId: string; text: string; confidence?: number; words?: { w: string; c: number; s?: number; e?: number }[]; wordsDropped?: boolean }
  | { type: "interim_final_candidate"; text: string; confidence?: number; words?: { w: string; c: number; s?: number; e?: number }[]; wordsDropped?: boolean }
  | { type: "detection"; detection: { id: string; segmentId: string; book: string; chapter: number; verseStart: number; verseEnd: number; confidence: number; matchedText: string; forceLive?: boolean } }
  | { type: "canonical_correction"; segmentId: string; dgText: string; whisperText: string; original: { book: string; chapter: number; verseStart: number; verseEnd: number }; corrected: { book: string; chapter: number; verseStart: number; verseEnd: number } }
  | { type: "phrase_matches"; segmentId: string; matchedText: string; candidates: { book: string; chapter: number; verse: number; text: string; similarity: number }[] }
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
  // Y16: hard cap inbound frame size to 256KB (audio chunks are ~4KB;
  // anything above 64KB is malformed and dropped inline below).
  maxPayload: 256 * 1024,
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
  const churchIdRaw = url.searchParams.get("churchId") || "";
  const userId = url.searchParams.get("userId") || "";
  const exp = url.searchParams.get("exp") || "";
  const sig = url.searchParams.get("sig") || "";
  // Y15: churchId must be UUID or empty (bible-only default). Bad format = reject.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (churchIdRaw && !UUID_RE.test(churchIdRaw)) { ws.close(1008, "invalid churchId"); return; }
  if (userId && !UUID_RE.test(userId)) { ws.close(1008, "invalid userId"); return; }
  if (planId && !UUID_RE.test(planId)) { ws.close(1008, "invalid planId"); return; }
  const churchId = churchIdRaw;

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

  // R7: enforce per-user concurrent-connection cap + same-plan dedupe.
  // - Same planId, same user → newer supersedes; close older with 1013.
  // - Total per user > cap → close oldest (LRU) with 1013.
  let userSet = openByUser.get(userId);
  if (!userSet) { userSet = new Set(); openByUser.set(userId, userSet); }
  // Prune ghost sockets first — abnormal disconnects (Fly restart, upstream
  // reset) don't always fire ws.on("close"), so the Set can retain sockets
  // whose readyState is CLOSED. Without this pruning, force-closing a dead
  // socket is a no-op and the per-user cap effectively fails open.
  for (const other of Array.from(userSet)) {
    if (other.readyState !== WebSocket.OPEN && other.readyState !== WebSocket.CONNECTING) {
      userSet.delete(other);
      wsMeta.delete(other);
    }
  }
  for (const other of Array.from(userSet)) {
    const meta = wsMeta.get(other);
    if (meta && meta.planId === planId) {
      try { other.close(1013, "superseded by newer session"); } catch { /* ignore */ }
      userSet.delete(other);
    }
  }
  while (userSet.size >= PER_USER_CAP) {
    // LRU = oldest by openedAt. Set iteration is insertion order.
    const oldest = userSet.values().next().value as WebSocket | undefined;
    if (!oldest) break;
    try { oldest.close(1013, "too many concurrent sessions"); } catch { /* ignore */ }
    userSet.delete(oldest);
  }
  userSet.add(ws);
  wsMeta.set(ws, { userId, planId, openedAt: Date.now() });

  console.log(`[audio] client connected planId=${planId}`);
  const send = (msg: ServerMessage) => { try { ws.send(JSON.stringify(msg)); } catch { /* ignore */ } };

  let dg: WebSocket;
  // R11: server-side dedupe of interim_final_candidate vs recent final on same
  // (or containing) text. 800ms window. Prevents duplicate detection triggers.
  const recentEmittedTexts = new Map<string, number>();
  const R11_WINDOW_MS = 800;
  const isRecentFinal = (t: string): boolean => {
    const now = Date.now();
    const norm = t.toLowerCase().replace(/\s+/g, " ").trim();
    for (const [k, ts] of recentEmittedTexts) {
      if (now - ts > R11_WINDOW_MS) { recentEmittedTexts.delete(k); continue; }
      if (k === norm || k.includes(norm) || norm.includes(k)) return true;
    }
    return false;
  };
  const noteEmittedFinal = (t: string) => {
    const norm = t.toLowerCase().replace(/\s+/g, " ").trim();
    if (norm) recentEmittedTexts.set(norm, Date.now());
    if (recentEmittedTexts.size > 50) {
      const oldest = recentEmittedTexts.keys().next().value;
      if (oldest !== undefined) recentEmittedTexts.delete(oldest);
    }
  };
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
  // Roadmap #2 — canonical (Groq Whisper) two-pass buffer. Ring of the
  // last ~15s of PCM (16kHz mono 16-bit → 480KB max) so that when a
  // low-confidence scripture detection lands, we can WAV-wrap the recent
  // audio and canonically re-transcribe against Whisper. Cumulative byte
  // count lets us map DG's segment timestamps to byte offsets in this
  // ring. Fails open — Groq call errors just skip this segment silently.
  const CANONICAL_BUFFER_SECONDS = 15;
  const CANONICAL_BUFFER_MAX_BYTES = 16000 * 2 * CANONICAL_BUFFER_SECONDS;
  const canonicalRing: Buffer[] = [];
  let canonicalRingBytes = 0;
  const canonicalKey = process.env.GROQ_API_KEY || "";
  const canonicalEnabled = canonicalKey.length > 0;
  // 2026-07-23 review fixes: per-connection concurrency cap + min-gap +
  // per-segment dedupe + 429 circuit breaker so a degraded Groq can't pile
  // up in-flight 480KB PCM snapshots or hammer rate limits.
  const CANONICAL_MAX_INFLIGHT = 2;
  const CANONICAL_MIN_GAP_MS = 3000;
  const CANONICAL_COOLDOWN_ON_429_MS = 30000;
  let canonicalInflight = 0;
  let canonicalLastFiredAt = 0;
  let canonicalCooldownUntil = 0;
  const canonicalFiredSegments = new Set<string>();
  // Per-connection dedupe: a reference like "John 3:16" spoken twice within
  // this window collapses to one suggestion. Prevents the rolling transcript
  // overlap (or a pastor repeating the reference for emphasis) from
  // flooding the operator's panel.
  const DEDUPE_WINDOW_MS = 30_000;
  const recentRefs = new Map<string, number>(); // "book|ch|vs|ve" -> tsMs
  const recentSongs = new Map<string, number>(); // songId -> tsMs
  const recentCmds = new Map<string, number>(); // verb -> tsMs
  const recentPhraseMatches = new Map<string, number>(); // top candidate key -> tsMs
  let lastPhraseSearchAt = 0; // cooldown — bounds embed+vector-scan cost regardless of speech content
  const dedupeKey = (parts: string[]) => parts.join("|");
  const isDupe = (map: Map<string, number>, key: string) => {
    const now = Date.now();
    // prune stale entries opportunistically
    for (const [k, t] of map) if (now - t > DEDUPE_WINDOW_MS) map.delete(k);
    if (map.has(key)) return true;
    map.set(key, now);
    return false;
  };

  // Last book/chapter the preacher actually landed on this connection — used
  // to resolve bare "verse 11" / "what does verse 7 say" mentions (no book
  // or chapter spoken) against whatever passage is currently active. Reset
  // is intentionally never explicit — it just ages out naturally as new refs
  // overwrite it, matching how an operator would track "where we are" too.
  let lastActiveRef: { book: string; chapter: number } | null = null;

  // Repeat tracking — a preacher restating the SAME reference (even minutes
  // apart, not just within the anti-spam window below) is itself a strong
  // "put this on screen" signal, explicitly requested to bypass the normal
  // confidence floor when AUTO mode is on. Window is intentionally much
  // longer than the anti-spam DEDUPE_WINDOW_MS since restating for emphasis
  // often happens well outside a 30s chatter window.
  const REPEAT_WINDOW_MS = 10 * 60 * 1000;
  const refOccurrences = new Map<string, { count: number; firstAt: number }>();
  const noteRefOccurrence = (key: string): number => {
    const now = Date.now();
    for (const [k, v] of refOccurrences) if (now - v.firstAt > REPEAT_WINDOW_MS) refOccurrences.delete(k);
    const cur = refOccurrences.get(key);
    if (cur) { cur.count++; return cur.count; }
    refOccurrences.set(key, { count: 1, firstAt: now });
    return 1;
  };

  // Already open — the SDK-style "open" event has already fired since
  // openDeepgram() awaited it. Signal readiness immediately.
  console.log(`[audio] Deepgram OPEN for plan ${planId}`);
  send({ type: "ready" });

  // Y10: server-side DG stall watchdog. If audio is flowing (chunks in last
  // 5s) but no DG Results in 30s, close DG so the client's reconnect kicks in.
  // The stall handler must close the CURRENT `dg` socket, not whatever the
  // closed-over reference happened to be at timer-creation time. Lazy-reopen
  // (dgNeedsReopen path below) mutates `dg`; capturing via a getter avoids
  // closing the wrong socket if a stall + reopen collide.
  let lastDgResultAt = Date.now();
  let lastAudioAt = 0;
  let lastDgSendAt = Date.now();
  const stallTimer = setInterval(() => {
    const now = Date.now();
    if (lastAudioAt > 0 && now - lastAudioAt < 5000 && now - lastDgResultAt > 30_000) {
      console.warn(`[audio] DG stall detected — no Results in 30s while audio flowing. Closing DG for reconnect.`);
      try { dg.close(1006, "stall"); } catch { /* ignore */ }
    }
  }, 5_000);
  stallTimer.unref?.();
  // 2026-07-23: Deepgram closes idle sockets after ~12s of no audio OR no
  // text frame. Church services routinely have long silences (pastoral
  // pauses, worship transitions, altar calls). Without an explicit
  // KeepAlive frame those silences trip DG's timeout with code 1011
  // "did not receive audio data or a text message" — which is what the
  // preexisting logs were showing all along. Send a KeepAlive JSON text
  // frame every 6s whenever the socket's been quiet for ≥5s and DG is
  // open. This is DG's documented pattern for long-running open sockets.
  const keepAliveTimer = setInterval(() => {
    const now = Date.now();
    if (dg.readyState !== WebSocket.OPEN) return;
    if (now - lastDgSendAt < 5000) return; // recent audio counts as keepalive
    try {
      dg.send(JSON.stringify({ type: "KeepAlive" }));
      lastDgSendAt = now;
    } catch { /* ignore */ }
  }, 6_000);
  keepAliveTimer.unref?.();
  // Ensure the intervals don't keep running after the client WS closes —
  // orphaned intervals would try to close a long-gone `dg` reference.
  ws.on("close", () => {
    try { clearInterval(stallTimer); } catch { /* ignore */ }
    try { clearInterval(keepAliveTimer); } catch { /* ignore */ }
  });

  const dgOnMessage = async (raw: WebSocket.RawData) => {
    dgMessages++;
    let data: { type?: string; is_final?: boolean; speech_final?: boolean; channel?: { alternatives?: { transcript?: string; confidence?: number; words?: { word?: string; start?: number; end?: number; confidence?: number; speaker?: number }[] }[] } };
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (dgMessages === 1 || dgMessages % 20 === 0) {
      // Y7: gate transcript slice behind EXPLICIT DEBUG=1 only. Any other
      // NODE_ENV (development, staging) is treated as prod for pastoral
      // content protection — Fly's staging logs still ship to the same
      // aggregator, and no operator wants sermon fragments in a log search.
      const debugOn = process.env.DEBUG === "1";
      const slice = debugOn ? ` text="${(data.channel?.alternatives?.[0]?.transcript ?? "").slice(0, 40)}"` : "";
      console.log(`[audio] dg msg #${dgMessages} type=${data.type ?? "?"} final=${data.is_final ?? "?"}${slice}`);
    }
    if (data.type !== "Results") return;
    // 2026-07-23 real-bug fix (root cause of the DG stall/reconnect churn
    // seen in Fly logs): lastDgResultAt was previously bumped only on
    // FINAL results — line ~688. If DG returned interims-only for 30s
    // (which happens on room noise, distant mic, non-speech audio), the
    // stall watchdog fired even though DG was actively working. Bump on
    // ANY Results message here so interim traffic keeps the watchdog fed.
    lastDgResultAt = Date.now();
    const text = data.channel?.alternatives?.[0]?.transcript?.trim();
    if (!text) return;

    const dgConf = data.channel?.alternatives?.[0]?.confidence;
    // Task 10: forward word-level confidence in compact form. Deepgram's
    // Results payload includes `channel.alternatives[0].words` with per-word
    // confidence; client uses this to gate autopilot on low-confidence spans.
    const rawWords = data.channel?.alternatives?.[0]?.words;
    // R5: hard cap unbounded words[] to prevent memory/WS-frame bloat.
    //   - max 500 words per message
    //   - per-word: drop entries with w string > 128 chars
    //   - forward w/c and optional s/e (start/end seconds) for span mapping
    // Roadmap #8 — pass through Deepgram's per-word `speaker` index (int)
    // as `sp` when diarization is on. Optional field, absent when the
    // model wasn't confident enough to assign a speaker or diarize=false.
    let words: { w: string; c: number; s?: number; e?: number; sp?: number }[] | undefined;
    let wordsDropped = false;
    if (Array.isArray(rawWords)) {
      const filtered = rawWords
        .filter((w) => typeof w?.word === "string" && typeof w?.confidence === "number" && String(w.word).length <= 128)
        .slice(0, 500)
        .map((w) => {
          const out: { w: string; c: number; s?: number; e?: number; sp?: number } = { w: String(w.word), c: Number(w.confidence) };
          if (typeof w.start === "number") out.s = w.start;
          if (typeof w.end === "number") out.e = w.end;
          if (typeof w.speaker === "number") out.sp = w.speaker;
          return out;
        });
      words = filtered.length ? filtered : undefined;
      if (Array.isArray(rawWords) && rawWords.length > 500) wordsDropped = true;
    }
    // R5: size-check outbound payload; if > 128KB drop words[].
    const capWordsIfHuge = <T extends { words?: unknown }>(msg: T): T => {
      try {
        const size = JSON.stringify(msg).length;
        if (size > 128 * 1024) {
          return { ...msg, words: undefined, wordsDropped: true } as T;
        }
      } catch { /* ignore */ }
      return wordsDropped ? ({ ...msg, wordsDropped: true } as T) : msg;
    };

    if (!data.is_final) {
      // Fast-path: forward high-confidence interims to the client for
      // optimistic detection so the operator sees a verse the moment it's
      // spoken instead of ~200-400ms later when Deepgram finalises the
      // utterance. Client dedupes against the eventual final.
      send({ type: "interim", text });
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const conf = typeof dgConf === "number" ? dgConf : 1;
      // Predictive early-fire, strongest signal first:
      //  1. The interim ALREADY parses to a Bible reference ("John three
      //     sixteen") — fire immediately regardless of length, even at 2-3
      //     words and slightly lower confidence, because this is exactly the
      //     high-value case that used to wait for the final. parseReferences
      //     is a bounded regex pass (<4KB, no network) — cheap enough per
      //     interim, and only run when there's plausibly a reference (a digit
      //     or number-word present) to keep the hot path lean.
      //  2. Otherwise fall back to the generic "long, confident interim" gate,
      //     loosened from 4 words/0.8 to 3 words/0.75 so short references and
      //     song cues surface a beat earlier too.
      const looksNumeric = /\d/.test(text) || /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|verse|chapter|psalm|psalms)\b/i.test(text);
      // Wrapped in try/catch: this now runs on every interim (~5-15/sec).
      // parseReferences has no realistic throw path (guards non-string input,
      // bounded regexes), but this listener is unguarded and the process has
      // no uncaughtException handler — a future parser regression must not be
      // able to crash the audio bridge mid-service (review 🟡).
      let hasRef = false;
      if (looksNumeric && conf >= 0.6) {
        try { hasRef = parseReferences(text).length > 0; } catch { hasRef = false; }
      }
      const genericGate = wordCount >= 3 && conf >= 0.75;
      if ((hasRef || genericGate) && !isRecentFinal(text)) {
        // R11: skip candidate emission if we already fired a final for the
        // same/containing text within the 800ms window.
        send(capWordsIfHuge({ type: "interim_final_candidate", text, confidence: conf, words }) as ServerMessage);
      }
      return;
    }
    lastDgResultAt = Date.now();

    // Generate the id client-side (schema default is defaultRandom() anyway)
    // so the client-facing "final" message can send immediately instead of
    // blocking on the DB round trip — transcript persistence is for later
    // reference/search, never on the critical path of the operator seeing
    // text. Insert fires in the background; a failure is logged, not thrown,
    // since the live path already succeeded.
    const segId = crypto.randomUUID();
    noteEmittedFinal(text);
    send(capWordsIfHuge({ type: "final", segmentId: segId, text, confidence: dgConf, words }) as ServerMessage);
    // The client already has the "final" message — this insert no longer
    // blocks that. It's still awaited here (not fire-and-forget) because
    // detectedReferences/aiSuggestions below have an FK to this row and must
    // not race ahead of it.
    await db.insert(transcriptSegments).values({ id: segId, servicePlanId: planId, text });

    const refs = parseReferences(text);

    // Bare "verse 11" / "what does verse 7 say" — no book or chapter spoken
    // at all. Only meaningful once a passage is already active this
    // connection (lastActiveRef), and only as a fallback when the full
    // parser found nothing to avoid ever overriding an actual reference.
    if (refs.length === 0 && lastActiveRef) {
      const bare = parseBareVerse(text);
      if (bare && isValidChapter(lastActiveRef.book, lastActiveRef.chapter)) {
        refs.push({
          book: lastActiveRef.book, chapter: lastActiveRef.chapter,
          verseStart: bare.verse, verseEnd: bare.verse,
          confidence: 90, matchedText: bare.matchedText, needsSemanticFallback: false,
        });
      }
    }

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

      lastActiveRef = { book, chapter };

      // A preacher restating the exact same reference is itself a strong
      // "make sure this is on screen" signal — flag it so the client can
      // bypass the normal confidence floor, but ONLY when AUTO mode is
      // already on (the client still gates forceLive on that explicit
      // human toggle; this server never sends anything live itself).
      const refKey = dedupeKey([book, String(chapter), String(vs), String(ve)]);
      const occurrenceCount = noteRefOccurrence(refKey);
      const forceLive = occurrenceCount === 2;

      // Dedupe: same book+chapter+range within the window collapses — unless
      // this is the exact moment it becomes a repeat, in which case we still
      // want the client to see it (with forceLive set) even though the
      // ordinary "detection" spam-collapse would otherwise swallow it.
      const wasDupe = isDupe(recentRefs, refKey);
      if (wasDupe && !forceLive) continue;

      const [det] = await db.insert(detectedReferences).values({
        transcriptSegmentId: segId,
        book, chapter, verseStart: vs, verseEnd: ve, confidence, status: "pending",
      }).returning();
      send({ type: "detection", detection: {
        id: det.id, segmentId: segId, book, chapter,
        verseStart: vs, verseEnd: ve, confidence,
        matchedText: ref.matchedText,
        ...(forceLive ? { forceLive: true } : {}),
      }});

      // Roadmap #2 — canonical two-pass. Only worth the Groq round trip
      // when Deepgram was NOT rock-solid on this ref (confidence < 85) —
      // above that, primary and canonical would almost always agree and
      // it'd just burn budget/latency. Also skip when the ring buffer has
      // less than 2s of audio (fresh connection). Fire-and-forget; the
      // send() below happens on a different event-loop tick.
      //
      // 2026-07-23 review fixes:
      //   - Semaphore (max 2 in-flight) prevents pileup during a rapid
      //     stretch of low-conf detections when Groq is slow.
      //   - Min-gap 3s between canonical passes prevents chatter.
      //   - Per-segment dedupe: multiple refs in one segment ("John 3:16
      //     and Romans 8:28") fire canonical only once — same audio.
      //   - 429 circuit breaker: on rate limit, skip for 30s.
      //   - PCM snapshot moved INSIDE the async IIFE after a microtask
      //     yield so the sync WS handler isn't blocked on Buffer.concat.
      const nowMs = Date.now();
      if (canonicalEnabled
          && confidence < 85
          && canonicalRingBytes >= 16000 * 2 * 2
          && canonicalInflight < CANONICAL_MAX_INFLIGHT
          && nowMs - canonicalLastFiredAt >= CANONICAL_MIN_GAP_MS
          && nowMs >= canonicalCooldownUntil
          && !canonicalFiredSegments.has(segId)) {
        canonicalFiredSegments.add(segId);
        // Cap dedupe set so a long service doesn't grow it unbounded.
        if (canonicalFiredSegments.size > 500) {
          const first = canonicalFiredSegments.values().next().value;
          if (first) canonicalFiredSegments.delete(first);
        }
        canonicalLastFiredAt = nowMs;
        canonicalInflight++;
        const dgText = text;
        const origRef = { book, chapter, verseStart: vs, verseEnd: ve };
        const capturedSegId = segId;
        void (async () => {
          // Yield to the event loop so the sync WS handler returns
          // before the 480KB Buffer.concat runs.
          await new Promise((r) => setImmediate(r));
          const pcmSnapshot = Buffer.concat(canonicalRing);
          try {
            const result = await whisperTranscribe(pcmSnapshot, canonicalKey);
            if (result === "__RATE_LIMITED__") {
              canonicalCooldownUntil = Date.now() + CANONICAL_COOLDOWN_ON_429_MS;
              console.warn(`[canonical] rate-limited; cooldown until ${new Date(canonicalCooldownUntil).toISOString()}`);
              return;
            }
            if (!result) return;
            const whisperText = result;
            const whisperRefs = parseReferences(whisperText);
            if (whisperRefs.length === 0) {
              // Diagnostic: Whisper transcribed something but we couldn't
              // parse a scripture — worth logging for later keyterm mining.
              console.log(`[canonical] no-parse seg=${capturedSegId} dg="${dgText.slice(0, 60)}" whisper="${whisperText.slice(0, 80)}"`);
              return;
            }
            const wr = whisperRefs[0];
            // Only emit corrections when the Whisper-parsed book is an
            // EXACT knownBook match — the fuzzy-phonetic path can trip on
            // clean text and produce garbage "corrections" that undermine
            // operator trust in the purple chip.
            if (!knownBook(wr.book)) {
              console.log(`[canonical] fuzzy-only whisper book "${wr.book}" — dropped`);
              return;
            }
            // Divergence: any of book/chapter/verseStart/verseEnd differ.
            const differs = wr.book !== origRef.book
              || wr.chapter !== origRef.chapter
              || wr.verseStart !== origRef.verseStart
              || wr.verseEnd !== origRef.verseEnd;
            if (!differs) return;
            console.log(`[canonical] divergence seg=${capturedSegId} dg="${dgText.slice(0, 60)}" whisper="${whisperText.slice(0, 60)}" ${origRef.book}${origRef.chapter}:${origRef.verseStart} -> ${wr.book}${wr.chapter}:${wr.verseStart}`);
            send({
              type: "canonical_correction",
              segmentId: capturedSegId,
              dgText, whisperText,
              original: origRef,
              corrected: { book: wr.book, chapter: wr.chapter, verseStart: wr.verseStart, verseEnd: wr.verseEnd },
            });
          } catch (e) {
            console.warn("[canonical] pass error:", e instanceof Error ? e.message : e);
          } finally {
            canonicalInflight = Math.max(0, canonicalInflight - 1);
          }
        })();
      }
    }

    // ---- Phrase cross-reference (content match, no reference spoken) ------
    // Distinct from the semantic FALLBACK above, which only runs when the
    // rule-based parser already found something reference-SHAPED ("book
    // chapter:verse") but low-confidence. This runs when the preacher speaks
    // a verse's actual CONTENT with no reference structure at all (e.g. a
    // well-known phrase) — parseReferences finds nothing, so nothing above
    // ever fires. Sends MULTIPLE candidates for the operator to pick from
    // (never auto-picks one) since a phrase can genuinely match several
    // verses (a repeated phrase across books, or paraphrase ambiguity).
    //
    // Review found the original gate (refs.length===0 && length>=20) would
    // fire an embed+vector-scan on nearly every ordinary sermon segment that
    // isn't a formal reference — a real recurring compute cost with no
    // caching, reintroducing exactly the kind of per-segment cost the
    // keyterms/song-library caching pass just removed elsewhere. Raised the
    // length floor and added a hard per-connection cooldown so worst-case
    // cost is bounded regardless of how much the preacher talks.
    const PHRASE_SEARCH_COOLDOWN_MS = 4000;
    if (refs.length === 0 && text.trim().length >= 30 && Date.now() - lastPhraseSearchAt >= PHRASE_SEARCH_COOLDOWN_MS) {
      lastPhraseSearchAt = Date.now();
      try {
        const defaultT = await getDefaultTranslationId(churchId);
        if (defaultT) {
          const hits = await semanticSearch(defaultT, text, 5);
          const candidates = hits
            .map((h) => ({ ...h, similarity: Math.max(0, Math.round((1 - h.distance) * 100)) }))
            // Only surface hits that are actually plausible matches — a
            // weak/unrelated hit isn't worth cluttering the operator's panel.
            .filter((h) => h.similarity >= 60);
          if (candidates.length >= 1) {
            // Dedupe on the TOP candidate only, not the full set — review
            // found the full-set join was fragile: two calls for genuinely
            // the same repeated phrase can return slightly different
            // lower-ranked candidates (a fresh embedding call each time,
            // similarity filtering at a hard 60% cliff), so joining the
            // whole array almost never matched twice and spammed the panel
            // with near-duplicate groups. The top hit is stable enough to
            // dedupe on.
            const key = `${candidates[0].book}${candidates[0].chapter}:${candidates[0].verse}`;
            if (!isDupe(recentPhraseMatches, key)) {
              send({ type: "phrase_matches", segmentId: segId, matchedText: text, candidates: candidates.map((c) => ({
                book: knownBook(c.book) || c.book, chapter: c.chapter, verse: c.verse, text: c.text, similarity: c.similarity,
              })) });
            }
          }
        }
      } catch (e) {
        console.error("[audio] phrase cross-reference error:", e instanceof Error ? e.message : e);
      }
    }

    // ---- Song detection ---------------------------------------------------
    const songCands = extractSongCandidates(text);
    if (songCands.length > 0) {
      const library = await getSongLibrary(churchId);
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
          suggestionId: row.id, segmentId: segId,
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
        suggestionId: row.id, segmentId: segId,
        verb: cmd.verb, payload: cmd.payload,
        confidence: cmd.confidence, matchedText: cmd.matchedText,
      }});
    }
  };
  dg.on("message", dgOnMessage);

  dg.on("error", (err: Error) => {
    console.error("[audio] Deepgram error:", err.message);
    send({ type: "error", message: "Deepgram error" });
  });

  dg.on("close", (code: number, reason: Buffer) => {
    console.log(`[audio] Deepgram closed code=${code} reason=${reason.toString() || "(none)"} after ${dgMessages} msgs`);
    // R9: if the client is still connected AND we haven't sent much audio yet
    // (warm-start idle case), flag DG for lazy reopen on next audio chunk.
    if (ws.readyState === WebSocket.OPEN && (code === 1011 || code === 1006 || audioChunks === 0)) {
      dgNeedsReopen = true;
    }
  });

  let dgNeedsReopen = false;

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try { msg = JSON.parse(raw.toString()) as ClientMessage; } catch { return; }
    if (msg.type === "audio") {
      const buf = Buffer.from(msg.b64, "base64");
      // Y16: drop chunks > 64KB (audio should be ~4KB each; anything larger is malformed).
      if (buf.length > 64 * 1024) { return; }
      audioChunks++;
      lastAudioAt = Date.now();
      if (audioChunks === 1 || audioChunks % 500 === 0) console.log(`[audio] received chunk #${audioChunks} (${buf.length} bytes)`);
      // Feed canonical ring buffer (roadmap #2). Cheap unconditional push;
      // trim from the front when we exceed the byte cap.
      if (canonicalEnabled) {
        canonicalRing.push(buf);
        canonicalRingBytes += buf.length;
        while (canonicalRingBytes > CANONICAL_BUFFER_MAX_BYTES && canonicalRing.length > 0) {
          const shifted = canonicalRing.shift();
          if (shifted) canonicalRingBytes -= shifted.length;
        }
      }
      // R9: lazy-reopen DG if it closed while we were idle.
      if (dgNeedsReopen && dg.readyState !== WebSocket.OPEN) {
        dgNeedsReopen = false;
        openDeepgram(churchId).then((newDg) => {
          dg = newDg;
          console.log(`[audio] DG reopened lazily on audio resume`);
          // Rewire handlers on the new socket.
          dg.on("message", dgOnMessage);
          dg.on("error", (err: Error) => { console.error("[audio] Deepgram error:", err.message); send({ type: "error", message: "Deepgram error" }); });
          dg.on("close", (code: number, reason: Buffer) => {
            console.log(`[audio] Deepgram closed code=${code} reason=${reason.toString() || "(none)"}`);
            if (ws.readyState === WebSocket.OPEN && (code === 1011 || code === 1006)) dgNeedsReopen = true;
          });
          send({ type: "ready" });
          try { dg.send(buf); } catch { /* ignore */ }
        }).catch((err) => {
          console.error("[audio] DG lazy reopen failed:", err instanceof Error ? err.message : err);
          dgNeedsReopen = true;
        });
        return;
      }
      // Only forward if Deepgram socket is still open.
      if (dg.readyState === WebSocket.OPEN) {
        try { dg.send(buf); lastDgSendAt = Date.now(); } catch (e) { console.error("[audio] send err", e); }
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
    // R7: remove from per-user set.
    const set = openByUser.get(userId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) openByUser.delete(userId);
    }
    // Y10: clear stall watchdog.
    try { clearInterval(stallTimer); } catch { /* ignore */ }
  });
});

// Bind explicitly to 0.0.0.0 — Node's default (no host arg) binds the IPv6
// unspecified address only in this container, which Fly's TCP proxy can't
// reach, causing every WS connection to open then immediately drop (1006)
// with no data ever exchanged.
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ PresentFlow audio bridge listening on ws://0.0.0.0:${PORT}`);
});
