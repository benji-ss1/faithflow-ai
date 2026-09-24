// New-slide style inheritance (createSongSlide) — pure, so the "does a new
// slide match its song?" rules are directly unit-testable.
//
// History: 2026-09-06 a BLANK new slide copied its sibling's objects + bgColor/
// bgImageUrl/bgExplicit. Round 5 (composable): a theme baked onto a blank /
// legacy-lyric song lives on the ROOT of objectsJson with `objects: []`, which
// that rule never copied — so a verse added to a themed song came out black.
// Now, for a THEMED song (settings.appliedThemeId) or a sibling whose background
// was deliberately chosen (bgExplicit), the sibling's whole root background
// (bgType, bgColor, bgColor2, bgImageUrl, bgExplicit, transition) is copied —
// even when its objects are empty and even when the caller supplied its own
// objects (the slide editor's Add). A caller that supplies its own background
// always wins. Unthemed songs with a non-explicit sibling behave exactly as
// before.

export const ROOT_BG_KEYS = ["bgType", "bgColor", "bgColor2", "bgImageUrl", "bgExplicit", "transition"] as const;

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

export type NewSlideInitial = {
  bgColor?: string;
  bgImageUrl?: string;
  bgExplicit?: boolean;
  objects?: unknown[];
  lyrics?: string;
};

/**
 * Build a new slide's objectsJson + lyrics from its sibling.
 * `idFor(oldObjectId)` must return a fresh id, and the SAME id for the same old
 * id across calls — so the new slide and its pre-theme backup (built from the
 * sibling's snapshot, whose objects share ids with the baked sibling) line up
 * for resetThemeOwnedFields on revert.
 */
export function inheritNewSlide(opts: {
  sibling: unknown;
  initial?: NewSlideInitial;
  themed: boolean;
  idFor: (oldId: unknown) => string;
}): { objectsJson: Obj | null; lyrics: string } {
  const { initial, themed, idFor } = opts;
  const tpl = asObj(opts.sibling);
  let objects: unknown[] = Array.isArray(initial?.objects) ? initial!.objects! : [];
  let bgColor = initial?.bgColor;
  let bgImageUrl = initial?.bgImageUrl;
  let bgExplicit = initial?.bgExplicit;
  const callerSetBg = bgColor !== undefined || bgImageUrl !== undefined || bgExplicit === true;

  const tplObjects = Array.isArray(tpl.objects) ? (tpl.objects as Obj[]) : [];
  if (objects.length === 0 && tplObjects.length > 0) {
    const newText = (initial?.lyrics ?? "").trim();
    let usedTextSlot = false;
    objects = tplObjects.map((o) => {
      const cloned: Obj = { ...o, id: idFor(o?.id) };
      if (o?.kind === "text") {
        cloned.text = usedTextSlot ? "" : newText;
        usedTextSlot = true;
      }
      return cloned;
    });
    bgColor = bgColor ?? (tpl.bgColor as string | undefined);
    bgImageUrl = bgImageUrl ?? (tpl.bgImageUrl as string | undefined);
    bgExplicit = bgExplicit ?? (tpl.bgExplicit as boolean | undefined);
  }

  // Round 5: copy the sibling's full root background for themed songs / chosen
  // backgrounds, unless the caller picked its own.
  const extra: Obj = {};
  if ((themed || tpl.bgExplicit === true) && !callerSetBg) {
    for (const k of ROOT_BG_KEYS) if (tpl[k] !== undefined && tpl[k] !== null) extra[k] = tpl[k];
  }

  const textObjects = objects.filter((o): o is { kind: string; text?: string } =>
    typeof o === "object" && o !== null && (o as { kind?: unknown }).kind === "text");
  const lyrics = textObjects
    .map((o) => (typeof o.text === "string" ? o.text.trim() : ""))
    .filter(Boolean)
    .join("\n") || initial?.lyrics || "";

  if (objects.length > 0) {
    const out: Obj = { bgColor, bgImageUrl, ...(bgExplicit === true ? { bgExplicit: true } : {}), objects };
    for (const [k, v] of Object.entries(extra)) out[k] = v;
    if (out.bgExplicit !== true) delete out.bgExplicit;
    return { objectsJson: out, lyrics };
  }
  if (Object.keys(extra).length > 0) {
    const out: Obj = { ...extra, objects: [] };
    if (out.bgExplicit !== true) delete out.bgExplicit;
    return { objectsJson: out, lyrics };
  }
  return { objectsJson: null, lyrics };
}

/** Memoised id mapper: same old id → same new id; missing ids always fresh. */
export function makeIdMapper(fresh: () => string): (oldId: unknown) => string {
  const m = new Map<string, string>();
  return (oldId) => {
    if (typeof oldId !== "string") return fresh();
    let v = m.get(oldId);
    if (!v) { v = fresh(); m.set(oldId, v); }
    return v;
  };
}

/**
 * Keep a themed song's undo snapshots valid when a slide is ADDED after the
 * theme was applied. Without an entry, revertSongTheme skips the new slide (it
 * stays themed) and a re-apply treats its already-themed look as "original".
 * The entry is what the slide would have been on the UNTHEMED song (built from
 * the sibling's own snapshot), so revert restores it to the unthemed default.
 * Returns the new settings, or null when nothing changes.
 */
export function addNewSlideToThemeBackups(opts: {
  settings: unknown;
  siblingId: string | undefined;
  newSlideId: string;
  newSlideObjectsJson: unknown;
  initial?: NewSlideInitial;
  idFor: (oldId: unknown) => string;
}): Obj | null {
  const s = asObj(opts.settings);
  const next: Obj = { ...s };
  let changed = false;
  const unthemedFrom = (snap: unknown) =>
    inheritNewSlide({ sibling: snap, initial: opts.initial, themed: false, idFor: opts.idFor }).objectsJson;

  const backup = asObj(s.themeBackup);
  if (typeof s.appliedThemeId === "string" && Array.isArray(backup.slides)) {
    const list = backup.slides as Obj[];
    if (!list.some((e) => e && e.id === opts.newSlideId)) {
      const hit = opts.siblingId ? list.find((e) => e && e.id === opts.siblingId) : undefined;
      const pre = hit ? unthemedFrom(hit.objectsJson ?? null) : null;
      next.themeBackup = { ...backup, slides: [...list, { id: opts.newSlideId, objectsJson: pre }] };
      changed = true;
    }
  }
  const per = asObj(s.slideThemeBackups);
  const sib = opts.siblingId ? per[opts.siblingId] : undefined;
  if (sib !== undefined && per[opts.newSlideId] === undefined && opts.newSlideObjectsJson != null) {
    const entry = asObj(sib);
    next.slideThemeBackups = { ...per, [opts.newSlideId]: { ...entry, objectsJson: unthemedFrom(entry.objectsJson ?? null) } };
    changed = true;
  }
  return changed ? next : null;
}

/**
 * Revert result for one slide: when the pre-theme snapshot was a NULL
 * objectsJson (a plain lyric slide) and nothing but theme-owned fields was
 * added since, restore the exact NULL rather than `{"objects":[]}`.
 */
export function restoreNullIfEmpty(reset: Obj, original: unknown): Obj | null {
  if (original !== null && original !== undefined) return reset;
  const keys = Object.keys(reset).filter((k) => reset[k] !== undefined);
  const onlyEmptyObjects = keys.every((k) => k === "objects") && (reset.objects === undefined || (Array.isArray(reset.objects) && reset.objects.length === 0));
  return onlyEmptyObjects ? null : reset;
}

/**
 * Songs-browser quick edit: may this slide's text be saved IN PLACE
 * (updateSongSlideText — same id, objectsJson kept) instead of the rewrite-all
 * updateSongSlides (delete + re-insert every row, lyrics only)?
 *  - themed song: ALWAYS (the rewrite-all drops the baked background and
 *    rewrites the ids the theme undo snapshot is keyed by);
 *  - plain lyric slide (NULL objectsJson): yes — identical result, ids kept;
 *  - designed slide with exactly ONE text box, or a blank root-bg slide: yes —
 *    the text is swapped and the design survives (the rewrite-all wiped it);
 *  - more than one text box, or media-only objects: NO — the single textarea
 *    can't be split back across boxes, so keep the old behaviour.
 */
export function quickEditInPlace(songThemed: boolean, objectsJson: unknown): boolean {
  if (songThemed) return true;
  if (objectsJson == null) return true;
  const objs = Array.isArray(asObj(objectsJson).objects) ? (asObj(objectsJson).objects as Obj[]) : [];
  const texts = objs.filter((o) => o && o.kind === "text").length;
  if (objs.length === 0) return true;
  return texts === 1;
}
