// Internet SONG METADATA lookup — TITLE / ARTIST ONLY.
//
// ⚠️ HARD LICENSING RULE: This module NEVER fetches, caches, or returns
// song words of any kind. Only identifier-level metadata (title, artist,
// external ID, source URL) is allowed. The MusicBrainz recording endpoint
// is a metadata-only registry — it does not return song words even if
// asked. We further strip anything except title/artist/ids on the way out.
//
// Fallback: if the network is unavailable, we return a clearly-labeled
// DEGRADED_MODE stub so the operator sees "internet lookup unavailable"
// instead of the app silently failing.

export type InternetMetadataResult = {
  title: string;
  artist: string;
  source: "musicbrainz" | "degraded_stub";
  externalId?: string;
  confidence: number; // 0-100
  url?: string;
  degraded?: boolean;
};

type CacheEntry = { ts: number; value: InternetMetadataResult | null };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

function diceCoefficient(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s']/g, " ").trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bigrams(na);
  const B = bigrams(nb);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/**
 * Look up a candidate song by TITLE (optionally with an artist hint) using
 * the MusicBrainz open recording API. Returns metadata-only or null.
 *
 * @param candidateTitle 3-120 chars
 * @param artistHint     optional, ≤ 80 chars
 */
export async function lookupSongMetadata(
  candidateTitle: string,
  artistHint?: string,
): Promise<InternetMetadataResult | null> {
  const title = (candidateTitle || "").trim();
  if (title.length < 3 || title.length > 120) return null;
  const hint = (artistHint || "").trim().slice(0, 80);

  const key = `${title.toLowerCase()}::${hint.toLowerCase()}`;
  const now = Date.now();
  const cached = CACHE.get(key);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.value;

  // Build MusicBrainz query. Recording endpoint, JSON, metadata only.
  const q = hint
    ? `recording:"${title}" AND artist:"${hint}"`
    : `recording:"${title}"`;
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=5`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "PresentFlow/1.0 (contact@faithflow.ai)",
        Accept: "application/json",
      },
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const stub = degradedStub(title, hint);
      CACHE.set(key, { ts: now, value: stub });
      return stub;
    }
    const data = await res.json() as {
      recordings?: Array<{
        id?: string;
        title?: string;
        score?: number;
        "artist-credit"?: Array<{ name?: string; artist?: { name?: string } }>;
      }>;
    };
    const recordings = data.recordings || [];
    // Pick top scored recording whose title dice-matches ≥ 0.6
    let best: InternetMetadataResult | null = null;
    for (const rec of recordings) {
      const recTitle = (rec.title || "").trim();
      if (!recTitle) continue;
      const sim = diceCoefficient(title, recTitle);
      if (sim < 0.6) continue;
      const artist = (rec["artist-credit"]?.map((c) => c.name || c.artist?.name).filter(Boolean).join(", ") || "").trim();
      const confidence = Math.round(Math.max(sim * 100, Math.min(100, rec.score ?? 0)));
      const candidate: InternetMetadataResult = {
        title: recTitle,
        artist: artist || "Unknown",
        source: "musicbrainz",
        externalId: rec.id,
        confidence,
        url: rec.id ? `https://musicbrainz.org/recording/${rec.id}` : undefined,
      };
      if (!best || candidate.confidence > best.confidence) best = candidate;
    }
    CACHE.set(key, { ts: now, value: best });
    return best;
  } catch {
    clearTimeout(timer);
    const stub = degradedStub(title, hint);
    CACHE.set(key, { ts: now, value: stub });
    return stub;
  }
}

function degradedStub(title: string, hint: string): InternetMetadataResult {
  return {
    title,
    artist: hint || "Unknown",
    source: "degraded_stub",
    confidence: 0,
    degraded: true,
  };
}

/** For testing */
export function _clearInternetMetadataCache() { CACHE.clear(); }
