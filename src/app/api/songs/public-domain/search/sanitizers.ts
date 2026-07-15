// Extracted from route.ts so test files can import without hitting the
// Next 15 route-export restriction (arbitrary exports from route.ts fail
// the type check).

export type PublicDomainCandidate = {
  source: "hymnary" | "llm";
  title: string;
  author: string | null;
  lyrics: string[];
  slidesGuess: { text: string }[][];
};

const HTML_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function sanitiseText(input: unknown, cap = 400): string {
  if (typeof input !== "string") return "";
  const stripped = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  const escaped = stripped.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] || c);
  return escaped.slice(0, cap);
}

export function sanitiseCandidate(c: Partial<PublicDomainCandidate>): PublicDomainCandidate | null {
  const source = c.source === "hymnary" || c.source === "llm" ? c.source : null;
  if (!source) return null;
  const title = sanitiseText(c.title, 200);
  if (!title) return null;
  const author = typeof c.author === "string" ? sanitiseText(c.author, 120) : null;
  const rawLyrics = Array.isArray(c.lyrics) ? c.lyrics : [];
  const lyrics = rawLyrics
    .map((s) => sanitiseText(s, 400))
    .filter((s) => s.length > 0)
    .slice(0, 12);
  if (lyrics.length === 0) return null;
  const slidesGuess = lyrics.map((l) => [{ text: l }]);
  return { source, title, author, lyrics, slidesGuess };
}

export const _internal = { sanitiseCandidate, sanitiseText };
