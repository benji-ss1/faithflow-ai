export type Highlight = string | { text: string; tryItHref?: string; tryItLabel?: string; highlightParam?: string };

export type ChangelogEntry = {
  version: string;
  date: string; // ISO YYYY-MM-DD
  headline: string;
  highlights: Highlight[];
};

function cmp(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Merge generated (changes/*.md) entries with curated history. Deduped by
 * version — the curated history entry wins — and returned newest-first
 * (stable for equal versions).
 */
export function mergeChangelog(generated: ChangelogEntry[], history: ChangelogEntry[]): ChangelogEntry[] {
  const seen = new Set(history.map((e) => e.version));
  const extra: ChangelogEntry[] = [];
  for (const e of generated) {
    if (seen.has(e.version)) continue;
    seen.add(e.version);
    extra.push(e);
  }
  return [...extra, ...history]
    .map((e, i) => [e, i] as const)
    .sort(([a, ia], [b, ib]) => cmp(b.version, a.version) || ia - ib)
    .map(([e]) => e);
}
