// Song auto-switch guard (CLAUDE.md rule 7, 2026-09-14 user sign-off): while a
// DIFFERENT song is live the AI must NEVER auto-switch the projector — it stages
// a chip instead. Pure + dependency-light so every auto path (the detection loop,
// the staged→risen promotion, and autoLiveSong itself) shares ONE decision.
//
// SIGNAL CHOICE (why not just liveSongRef): the slide payload carries NO song
// origin metadata (SlidePayload text has only text/bg/objects/reference/band),
// and liveSongRef is only set when the live text matches exactly ONE cached
// slide of a song in TODAY's plan with ≥3 words. It is therefore EMPTY for a
// library-sent song (SongsBrowser), a short line, or a line shared by two
// setlist songs — which silently skipped the guard. So the guard is conservative:
//   1. tracked live song === target  → NOT held (same-song skip lives elsewhere).
//   2. tracked live song is another  → HELD.
//   3. live slide is not text (blank / empty / logo / image / video) → allowed.
//   4. text slide that is positively scripture — carries `reference`, belongs to
//      a scripture plan item, or its text ends in a parseable "Book C:V"
//      (legacy plan-item verse text) → allowed.
//   5. text slide that belongs to a known NON-song plan item (sermon, header…)
//      → allowed.
//   6. blank-text slide → allowed.
//   7. any other text on screen (lyric-like, un-attributed) that is not
//      positively identified as THIS target song → HELD. Worst case is one
//      operator tap on a chip; never a wrong song on the projector.
import type { SlidePayload } from "./broadcast";
import { bandableTextOf } from "./obs-lowerthird";
import { parseLiveScriptureRef } from "./bible-antireplay";

export type SongSwitchGuardInput = {
  targetSongId: string;
  /** liveSongRef.current?.songId — the positively-identified live song, if any. */
  trackedLiveSongId: string | null | undefined;
  /** What is actually on the projector (post-layout). */
  liveSlide: SlidePayload | null | undefined;
  /** Plan item type of the live slide when it matched a plan item (else undefined). */
  liveItemType?: string | null;
};

export function shouldHoldSongAutoSwitch(i: SongSwitchGuardInput): boolean {
  if (i.trackedLiveSongId) return i.trackedLiveSongId !== i.targetSongId;
  const s = i.liveSlide;
  if (!s || s.kind !== "text") return false;
  if (typeof s.reference === "string" && s.reference.trim()) return false;
  if (i.liveItemType === "scripture") return false;
  if (i.liveItemType && i.liveItemType !== "song") return false;
  const text = bandableTextOf(s);
  if (!text.trim()) return false;
  if (parseLiveScriptureRef(text.trim())) return false;
  return true;
}
