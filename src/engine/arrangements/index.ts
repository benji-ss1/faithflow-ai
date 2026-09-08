/**
 * src/engine/arrangements — Groups & Arrangements pure model (ProPresenter §12 /
 * MVP §9). Pure TypeScript: no React, no DB, no side effects at module scope.
 * The DB loader (src/lib/server/services.ts) builds an `ArrangedSong` from rows
 * and calls `expandArrangement` to obtain the ordered slide list for a plan item.
 *
 * THE DIFFERENTIATOR (edit-once-update-everywhere): an arrangement NEVER copies a
 * slide — it repeats a REFERENCE to a group, and a group holds references to the
 * physical slide rows. So `expandArrangement` returns the SAME `SlideRef` objects
 * (by identity) multiple times when a group repeats; editing that slide anywhere
 * updates every instance. Nothing here mutates its inputs.
 *
 * THE NO-REGRESSION LINE: `expandArrangement(song, undefined)` — and any song with
 * no groups/arrangements — returns `song.slides` in their given order, unchanged.
 * A song that never adopted groups behaves EXACTLY as today.
 */

// ── Group colour palette (ProPresenter 7.3 token colours) ──────────────────
// Self-contained (no dependency on the left-rail SECTION_COLORS): the spec allows
// defining group colours here. Keyed by group KIND so an unset `color` still
// renders a sensible, consistent hue; custom groups fall back to the neutral slate.
export const GROUP_KINDS = ["verse", "chorus", "bridge", "intro", "blank", "tag", "custom"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

export const GROUP_KIND_COLORS: Record<GroupKind, string> = {
  verse: "#2563eb",   // blue
  chorus: "#dc2626",  // red
  bridge: "#7c3aed",  // violet
  intro: "#059669",   // emerald
  blank: "#475569",   // slate
  tag: "#d97706",     // amber
  custom: "#64748b",  // neutral slate
};

/** Resolve a group's display colour: explicit override wins, else palette-by-kind. */
export function groupColor(g: Pick<SongGroup, "kind" | "color">): string {
  if (g.color && /^#[0-9a-fA-F]{6}$/.test(g.color)) return g.color;
  const kind = (GROUP_KINDS as readonly string[]).includes(g.kind) ? (g.kind as GroupKind) : "custom";
  return GROUP_KIND_COLORS[kind];
}

// ── Model ──────────────────────────────────────────────────────────────────

/** A reference to a physical slide row (never copied). `T` carries whatever the
 *  caller needs downstream (lyrics/objectsJson for the DB loader; nothing in tests). */
export type SlideRef<T = unknown> = { id: string; groupId: string | null } & T;

export type SongGroup = {
  id: string;
  name: string;
  kind: string;
  color: string | null;
  order: number;
};

export type Arrangement = {
  id: string;
  name: string;
  isDefault: boolean;
  /** Ordered, REPEATABLE list of SongGroup ids. */
  order: string[];
  sort: number;
};

export type ArrangedSong<T = unknown> = {
  songId: string;
  /** Physical slides in NATURAL order (song_slides.order). Source of truth. */
  slides: SlideRef<T>[];
  groups: SongGroup[];
  arrangements: Arrangement[];
};

// ── Expansion ────────────────────────────────────────────────────────────────

/** Slides that belong to a group, in natural slide order. Pure; O(slides). */
export function slidesInGroup<T>(song: ArrangedSong<T>, groupId: string): SlideRef<T>[] {
  return song.slides.filter((s) => s.groupId === groupId);
}

/**
 * Expand a song into its ordered slide list for a given arrangement.
 *
 * Resolution:
 *  - `arrangementId` names a real arrangement → emit each referenced group's
 *    slides in group order, repeating groups as the order repeats. Unknown group
 *    ids in the order are skipped (defensive against a deleted group). Ungrouped
 *    slides are NOT emitted by a custom arrangement (only grouped content is
 *    arrangeable — matches ProPresenter).
 *  - `arrangementId` is undefined/null/unknown, OR the song has no arrangements →
 *    MASTER order == `song.slides` unchanged (the no-regression line).
 *
 * Never mutates inputs; repeated groups yield the SAME SlideRef identities.
 */
export function expandArrangement<T>(
  song: ArrangedSong<T>,
  arrangementId?: string | null,
): SlideRef<T>[] {
  if (!arrangementId) return song.slides;
  const arr = song.arrangements.find((a) => a.id === arrangementId);
  if (!arr) return song.slides; // unknown pin → master (no-regression)

  const byGroup = new Map<string, SlideRef<T>[]>();
  for (const g of song.groups) byGroup.set(g.id, slidesInGroup(song, g.id));

  const out: SlideRef<T>[] = [];
  for (const gid of arr.order) {
    const groupSlides = byGroup.get(gid);
    if (groupSlides) out.push(...groupSlides);
  }
  return out;
}

/**
 * The natural "master" arrangement order as a group-id list: groups sorted by
 * their `order`. Useful as the seed when a UI creates the first custom
 * arrangement (a copy of the master it can then reorder). Pure.
 */
export function masterOrder<T>(song: ArrangedSong<T>): string[] {
  return [...song.groups].sort((a, b) => a.order - b.order).map((g) => g.id);
}

/** True when a song actually uses groups — i.e. any slide is assigned. When
 *  false the loader can skip all arrangement work (fast + provably no-regression). */
export function hasGroups<T>(song: ArrangedSong<T>): boolean {
  return song.slides.some((s) => s.groupId !== null) && song.groups.length > 0;
}
