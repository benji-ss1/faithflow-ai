// Custom vocabulary → Deepgram keyterm boosting.
//
// Operators maintain a list of names/places/song titles Deepgram keeps
// mishearing (Nigerian names, pastor names, the church's own name — see
// CLAUDE.md rule 9). The list is read at pipeline start and sent to the
// audio bridge in the session config message, where it's appended as
// `keyterm` query params on the Deepgram nova-3 streaming URL.
//
// Terms may contain spaces ("Pastor Adeboye", song titles). Deepgram's
// stated ceiling is 100 keyterms per connection — we cap here so the
// client never ships more than the bridge (which also hard-caps at 100
// after merging with church-level static/learned keyterms) can use.

const STORAGE_KEY = "presentflow.pro.customVocabulary.v1";

/** Deepgram nova-3 keyterm ceiling per streaming connection. */
export const MAX_VOCABULARY_TERMS = 100;

/** Fired on window whenever the vocabulary list changes (add/remove). */
export const VOCABULARY_CHANGED_EVENT = "presentflow:vocabulary-changed";

function normalize(terms: unknown): string[] {
  if (!Array.isArray(terms)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_VOCABULARY_TERMS) break;
  }
  return out;
}

/** SSR-safe read. Dedupes case-insensitively, trims, drops empties, caps at 100. */
export function readVocabulary(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalize(JSON.parse(raw));
  } catch {
    return [];
  }
}

function write(terms: string[]): string[] {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(terms));
  } catch {
    /* quota/private mode — vocabulary just won't persist */
  }
  try {
    window.dispatchEvent(new CustomEvent(VOCABULARY_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
  return terms;
}

/** Add a term (case-insensitive dedupe). Returns the updated list. */
export function addVocabularyTerm(term: string): string[] {
  const current = readVocabulary();
  const trimmed = term.trim();
  if (!trimmed) return current;
  if (current.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return current;
  if (current.length >= MAX_VOCABULARY_TERMS) return current;
  return write([...current, trimmed]);
}

/** Remove a term (case-insensitive match). Returns the updated list. */
export function removeVocabularyTerm(term: string): string[] {
  const current = readVocabulary();
  const key = term.trim().toLowerCase();
  const next = current.filter((t) => t.toLowerCase() !== key);
  if (next.length === current.length) return current;
  return write(next);
}
