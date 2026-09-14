// Song auto-switch guard (CLAUDE.md rule 7, 2026-09-14 user sign-off): while a
// DIFFERENT song is live the AI must NEVER auto-switch the projector — it stages
// a chip instead. Pure + dependency-free so every auto path (the detection loop,
// the staged→risen promotion, and autoLiveSong itself) shares ONE decision.
//
// POSITIVE EVIDENCE (2026-09-14 revision). The first version held auto-start on
// ANY un-attributed text on screen, so the first song after a Welcome /
// announcement / sermon-point / pasted / scripture-without-reference slide always
// needed a tap — contradicting the 2026-08-20 "why do I have to push it live?"
// directive. Now the AI is held ONLY on positive evidence that a DIFFERENT song
// is on the projector:
//   1. tracked live song (liveSongRef) is a different song            → HELD
//      (same song → NOT held; the same-song skip lives in the callers).
//   2. live slide is not text / is blank text (blank, empty, logo, image,
//      video)                                                           → ALLOWED
//   3. the live output's recorded ORIGIN (stamped by OperatorConsole at every
//      send path, valid only while its content identity is still live) is song
//      content for a different songId, or a song with an unknown id     → HELD
//      (covers library/SongsBrowser sends, chip clicks, G confirm, autoLiveSong,
//      song auto-advance — which liveSongRef does not reliably track).
//   4. the live slide matched a plan item of type "song" (setlist on screen) for
//      a different / unknown song                                       → HELD
//   5. anything else — origin text / scripture / media / other, or UNKNOWN origin
//      (e.g. output restored from another device)                       → ALLOWED
//
// POST-SONG-ENDED (kept deliberately, matches the signed-off rule): when song A
// has finished but its LAST lyric is still on the projector, the output is still
// song-A content (tracked or origin "song"), so song B is HELD as a chip until the
// operator moves on (or taps it). Clear / blank / logo resets the origin.
export type LiveOriginKind = "song" | "scripture" | "media" | "text" | "other";
export type LiveOrigin = { kind: LiveOriginKind; songId?: string };

export type SongSwitchGuardInput = {
  targetSongId: string;
  /** liveSongRef.current?.songId — the positively-identified live song, if any. */
  trackedLiveSongId: string | null | undefined;
  /** What is actually on the projector (post-layout). Only kind/text are read. */
  liveSlide: { kind: string; text?: string } | null | undefined;
  /** Origin of the CURRENT live output; null/undefined = unknown (→ allow). */
  liveOrigin?: LiveOrigin | null;
  /** Plan item type of the live slide when it matched a plan item (else undefined). */
  liveItemType?: string | null;
  /** songId of that plan item when it is a song item. */
  liveItemSongId?: string | null;
};

export function shouldHoldSongAutoSwitch(i: SongSwitchGuardInput): boolean {
  if (i.trackedLiveSongId) return i.trackedLiveSongId !== i.targetSongId;
  const s = i.liveSlide;
  if (!s || s.kind !== "text") return false;
  if (typeof s.text !== "string" || !s.text.trim()) return false;
  if (i.liveOrigin?.kind === "song") return i.liveOrigin.songId !== i.targetSongId;
  if (i.liveItemType === "song") return i.liveItemSongId !== i.targetSongId;
  return false;
}

/** Stable key for "has the live origin changed?" — used to log SWITCH HELD once
 *  per (songId, live origin) instead of on every transcript tick. */
export function liveOriginKey(i: Pick<SongSwitchGuardInput, "trackedLiveSongId" | "liveOrigin" | "liveItemType" | "liveItemSongId">): string {
  return `${i.trackedLiveSongId ?? ""}|${i.liveOrigin?.kind ?? "?"}:${i.liveOrigin?.songId ?? ""}|${i.liveItemType ?? ""}:${i.liveItemSongId ?? ""}`;
}

/** Best-effort origin for a send that did not declare one. Never claims "song"
 *  (song senders must declare it, or it is resolved from the plan). */
export function inferLiveOrigin(slide: { kind: string; reference?: string } | null | undefined): LiveOrigin {
  if (!slide) return { kind: "other" };
  if (slide.kind === "image" || slide.kind === "video") return { kind: "media" };
  if (slide.kind !== "text") return { kind: "other" };
  if (typeof slide.reference === "string" && slide.reference.trim()) return { kind: "scripture" };
  return { kind: "text" };
}

/** LRU memory of declared origins per output identity (capped). A hit refreshes
 *  recency so an origin that keeps being re-sent is never the one evicted. */
export function recallOrigin(m: Map<string, LiveOrigin>, identity: string): LiveOrigin | undefined {
  const o = m.get(identity);
  if (o !== undefined) { m.delete(identity); m.set(identity, o); }
  return o;
}
export function rememberOrigin(m: Map<string, LiveOrigin>, identity: string, origin: LiveOrigin, cap = 300): void {
  m.delete(identity);
  m.set(identity, origin);
  while (m.size > cap) { const first = m.keys().next().value; if (first === undefined) break; m.delete(first); }
}
/** Re-send of the CURRENT live slide with no declared origin (background drop,
 *  editor show, theme/layout/layer re-send): carry the previous live origin
 *  forward instead of re-inferring (re-inference can never claim "song", so a
 *  library-sent song would silently lose its attribution). Applies when the
 *  caller says so (`carry`) or the text content is unchanged. */
export function carriedOrigin(
  prior: LiveOrigin | null | undefined,
  next: { kind: string; text?: string },
  live: { kind: string; text?: string } | null | undefined,
  carry?: boolean,
): LiveOrigin | undefined {
  if (!prior || next.kind !== "text") return undefined;
  if (carry) return prior;
  if (live && live.kind === "text" && typeof live.text === "string" && typeof next.text === "string"
    && live.text.trim() !== "" && live.text.trim() === next.text.trim()) return prior;
  return undefined;
}
