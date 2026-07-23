/**
 * Deepgram keyterm prompting list.
 *
 * Hint terms Deepgram nova-3 uses to bias transcription so scripture book
 * names, church-specific vocabulary, and worship phrases are transcribed
 * correctly (e.g. "Ecclesiastes" instead of "a see zesee").
 *
 * Passed to the Deepgram streaming endpoint as repeated URL params:
 * `keyterm=Deuteronomy&keyterm=Ecclesiastes&...`. Order does not matter.
 *
 * Storage:
 *   - Default list lives in `config/deepgram-keyterms/default.json`.
 *   - Per-church override: `config/deepgram-keyterms/<churchId>.json`.
 *   - Bridge calls `loadKeyterms(churchId)` on WS upgrade; result is cached
 *     in-memory for 5 minutes to avoid disk hit per connection.
 *
 * The legacy `DEEPGRAM_KEYTERMS` const is preserved for backwards compat
 * and as the ultimate hard-coded fallback if disk reads fail.
 */
import fs from "node:fs";
import path from "node:path";

export const DEEPGRAM_KEYTERMS: string[] = [
  // Expanded 2026-07-23 from 12 → all 66 books + core Christian vocab +
  // common preacher phrasing to bias Deepgram nova-3 against the accented/
  // fast/homophone mishearings surfacing on Nigerian / RCCG-style delivery.
  // The parser's `repairNumberHomophones()` and `fuzzyBookMatch()` remain
  // the downstream safety net; keyterm biasing prevents the miss at source.
  // Deepgram caps at 100 keyterms per connection — this list is under that
  // ceiling with room for a few per-church overrides.
  // — Old Testament (39) —
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
  "Joshua", "Judges", "Ruth",
  "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
  "1 Chronicles", "2 Chronicles",
  "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
  "Ecclesiastes", "Song of Solomon",
  "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel",
  "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
  "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
  // — New Testament (27) —
  "Matthew", "Mark", "Luke", "John", "Acts",
  "Romans", "1 Corinthians", "2 Corinthians",
  "Galatians", "Ephesians", "Philippians", "Colossians",
  "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon",
  "Hebrews", "James", "1 Peter", "2 Peter",
  "1 John", "2 John", "3 John", "Jude", "Revelation",
  // — Divine names / core theological vocab —
  "Jesus Christ", "Holy Spirit", "Jehovah", "Yahweh", "Messiah",
  "hallelujah", "amen", "righteousness", "salvation", "covenant",
  // — Preacher/liturgical phrasing bias —
  "the Bible says", "turn with me to", "verse", "chapter",
];

const CACHE_TTL_MS = 5 * 60_000;
type CacheEntry = { terms: string[]; loadedAt: number };
const cache = new Map<string, CacheEntry>();

/**
 * Resolve the config directory. In dev it's `<repo>/config`. When packaged
 * inside Electron, the app ships `config/` alongside the executable — set
 * `PF_CONFIG_DIR` on process start (or default to `./config`).
 */
function configDir(): string {
  return process.env.PF_CONFIG_DIR || path.resolve(process.cwd(), "config");
}

function readJsonTerms(file: string): string[] | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as { terms?: unknown };
    if (!parsed || !Array.isArray(parsed.terms)) return null;
    const terms = parsed.terms.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    return terms;
  } catch {
    return null;
  }
}

/**
 * Load the effective keyterm list for a church.
 *
 * Precedence:
 *   1. `config/deepgram-keyterms/<churchId>.json` (if present)
 *   2. `config/deepgram-keyterms/default.json`
 *   3. Hard-coded `DEEPGRAM_KEYTERMS`
 *
 * Cached per-churchId for 5 minutes.
 */
export function loadKeyterms(churchId: string | null | undefined): string[] {
  // Y15: strict UUID validation to prevent path traversal via crafted churchId.
  // Anything not a UUID gets treated as "default" — no disk access with the bad value.
  if (churchId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(churchId)) {
    churchId = null;
  }
  const key = churchId || "__default__";
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.loadedAt < CACHE_TTL_MS) return hit.terms;

  const dir = configDir();
  let terms: string[] | null = null;
  if (churchId) {
    const perChurch = path.join(dir, "deepgram-keyterms", `${churchId}.json`);
    terms = readJsonTerms(perChurch);
  }
  if (!terms) {
    terms = readJsonTerms(path.join(dir, "deepgram-keyterms", "default.json"));
  }
  if (!terms || terms.length === 0) terms = DEEPGRAM_KEYTERMS;

  cache.set(key, { terms, loadedAt: now });
  return terms;
}

/**
 * Roadmap #4 — load the learned keyterms for a church from the database.
 * Non-blocking, returns [] on any failure (never blocks a Deepgram
 * connection). Cached per-churchId for 5 minutes to avoid a DB roundtrip
 * on every WS reconnect during a service.
 *
 * Cap of 30 per church leaves comfortable headroom for the JSON default's
 * ~80 static terms under Deepgram's 100/connection limit.
 */
const MAX_LEARNED_TERMS_PER_CHURCH = 30;
// Shorter TTL for LEARNED terms (60s) vs static file terms (5min). Static
// terms only change on redeploy; learned terms can flip active mid-day
// after any operator's service ends, so a fresh Deepgram connection
// after that promotion should see the new term without a 5-min lag.
const LEARNED_CACHE_TTL_MS = 60_000;
const learnedCache = new Map<string, CacheEntry>();

export async function loadLearnedKeyterms(churchId: string | null | undefined): Promise<string[]> {
  if (!churchId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(churchId)) return [];
  const now = Date.now();
  const hit = learnedCache.get(churchId);
  if (hit && now - hit.loadedAt < LEARNED_CACHE_TTL_MS) return hit.terms;
  try {
    const { db } = await import("./db/client").then((m) => ({ db: m.getDb() }));
    const { churchLearnedKeyterms } = await import("./db/schema");
    const { and, eq, desc } = await import("drizzle-orm");
    const rows = await db
      .select({ displayTerm: churchLearnedKeyterms.displayTerm })
      .from(churchLearnedKeyterms)
      .where(and(eq(churchLearnedKeyterms.churchId, churchId), eq(churchLearnedKeyterms.active, true)))
      .orderBy(desc(churchLearnedKeyterms.occurrences))
      .limit(MAX_LEARNED_TERMS_PER_CHURCH);
    const terms = rows.map((r) => r.displayTerm).filter((s): s is string => typeof s === "string" && s.length > 0);
    learnedCache.set(churchId, { terms, loadedAt: now });
    return terms;
  } catch (e) {
    // Never let a DB blip block a Deepgram connection — fail open, log,
    // return an empty list so the caller still gets the JSON default.
    console.warn("[deepgram-keyterms] loadLearnedKeyterms failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Test hook — clears the in-memory caches. Not exported for runtime use.
 */
export function _clearKeytermCache(): void {
  cache.clear();
  learnedCache.clear();
}
