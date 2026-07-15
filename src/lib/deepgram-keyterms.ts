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
  "Deuteronomy",
  "Ecclesiastes",
  "Obadiah",
  "Matthew",
  "Colossians",
  "Songs of Solomon",
  "Malachi",
  "Micah",
  "Ephesians",
  "Proverbs",
  "Nahum",
  "Amos",
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
 * Test hook — clears the in-memory cache. Not exported for runtime use.
 */
export function _clearKeytermCache(): void {
  cache.clear();
}
