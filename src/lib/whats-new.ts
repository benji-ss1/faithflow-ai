// Pure What's-New last-seen logic (extracted from WhatsNewModal for testing).
//
// Bug fixed 2026-09-14: on desktop the app version (electron app.version, e.g.
// 0.1.380) can be BEHIND the top changelog entry (0.1.402, bundled via the
// renderer deploy). The modal wrote currentVersion as last-seen when nothing was
// newer, and CHANGELOG[0] on dismiss — so last-seen ping-ponged 0.1.402 ↔ 0.1.380
// and the modal re-popped every other launch. last-seen now only ever moves
// FORWARD, so genuinely new entries show exactly once.

export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** The value to store as last-seen: the max of prev and candidate (never backwards). */
export function forwardLastSeen(prev: string | null | undefined, candidate: string | null | undefined): string | null {
  if (!candidate) return prev ?? null;
  if (!prev) return candidate;
  return cmpVersion(candidate, prev) > 0 ? candidate : prev;
}

/**
 * What to do on launch. last-seen is only ever a CHANGELOG version the operator
 * was actually shown (or, on first run, the newest CHANGELOG version) — never the
 * app/package version: a desktop build ahead of the notes (app 0.1.999, notes
 * 0.1.405) would otherwise mask every future note forever.
 *  - first run: store the newest entry's version, show nothing (tour handles it)
 *  - nothing newer: store nothing
 *  - newer entries: show them; the modal stores newer[0] on dismiss
 */
export function launchDecision<T extends { version: string }>(
  entries: T[],
  lastSeen: string | null | undefined,
): { newer: T[]; store: string | null } {
  if (!lastSeen) return { newer: [], store: entries[0]?.version ?? null };
  return { newer: newerEntries(entries, lastSeen), store: null };
}

/** Entries strictly newer than last-seen (empty on first visit — the tour handles that). */
export function newerEntries<T extends { version: string }>(entries: T[], lastSeen: string | null | undefined): T[] {
  if (!lastSeen) return [];
  return entries.filter((e) => cmpVersion(e.version, lastSeen) > 0);
}
