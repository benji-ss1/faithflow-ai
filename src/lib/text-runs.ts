/**
 * "Special" text formatting that survives a theme apply — ProPresenter parity (R2).
 *
 * THE BUG: applying a theme overwrote fontFamily / fontSize / fontWeight /
 * color / align on EVERY text object, so any manual emphasis an operator had
 * added was wiped. Re-theme a song and the one word you had bolded went plain.
 *
 * WHAT PP7 ACTUALLY DOES (RV "Maintaining Text Attributes", quoted):
 *   "The types of formatting that will pass through is text that is Bold,
 *    Italic, Underlined, or a different color."
 *   "...meaning text formatted differently from surrounding text in the same box."
 *   "Text position and font size will always match the theme's settings."
 *   "...if your entire text box shares one format (all bold and red), both the
 *    bold nature and red text will not be maintained."
 *
 * So the rule is a CONTRAST rule, not an "I touched it" rule: a run survives
 * only where it DIFFERS from the rest of its own box. Uniform formatting is
 * indistinguishable from no formatting and is overwritten.
 *
 * WHY A RUN MODEL AND NOT A SIMPLER FLAG: a box-level "the operator customised
 * this" flag would protect the WHOLE box forever once one word was bolded —
 * visibly wrong in exactly the case the feature exists for. Contrast cannot be
 * computed without knowing which characters differ.
 *
 * DELIBERATELY NOT FULL RICH TEXT. Four attributes (PP7's own exhaustive list),
 * flat non-overlapping offset ranges, no font family or size inside a run
 * (PP7 always overwrites those anyway). Anything more would be more powerful
 * than PP7 itself and would ripple through the wire, both renderers, the
 * editor, export and lyric matching for no parity gain.
 *
 * `runs` is optional. Absent — every slide that exists today — behaves exactly
 * as it does now, so this needs no migration.
 */

/** The four attributes PP7 names as able to survive. */
export type RunAttr = "bold" | "italic" | "underline" | "color";

export type TextRun = {
  /** Character offsets into the object's plain `text`. Half-open: [start, end). */
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
};

/** The box-level values a run is compared against. */
export type BoxDefaults = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
};

export const RUN_ATTRS: readonly RunAttr[] = ["bold", "italic", "underline", "color"];
/** A slide with more runs than this is not hand-authored; refuse rather than render it. */
export const MAX_RUNS = 200;

/**
 * Drop anything malformed and sort. Runs arrive from an editor and cross a
 * wire, so the renderer must never see an overlap, a reversed range, or an
 * offset past the end of the text.
 */
export function normalizeRuns(runs: readonly TextRun[] | undefined, textLength: number): TextRun[] {
  if (!Array.isArray(runs) || runs.length === 0) return [];
  const clean: TextRun[] = [];
  for (const r of runs.slice(0, MAX_RUNS)) {
    if (!r || typeof r !== "object") continue;
    const start = Math.max(0, Math.floor(Number(r.start)));
    const end = Math.min(textLength, Math.floor(Number(r.end)));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    // A run that carries no attribute says nothing — drop it rather than
    // splitting the render for no reason.
    if (r.bold === undefined && r.italic === undefined && r.underline === undefined && r.color === undefined) continue;
    clean.push({ start, end, bold: r.bold, italic: r.italic, underline: r.underline, color: r.color });
  }
  clean.sort((a, b) => a.start - b.start || a.end - b.end);
  // Later runs win on overlap — the editor applies newest-last.
  const out: TextRun[] = [];
  for (const r of clean) {
    const prev = out[out.length - 1];
    if (prev && r.start < prev.end) {
      if (r.end <= prev.end) { prev.end = r.start; out.push(r); continue; }
      prev.end = r.start;
    }
    if (r.end > r.start) out.push(r);
  }
  return out.filter((r) => r.end > r.start);
}

/**
 * Is this run's value for `attr` DIFFERENT from the box's? That difference is
 * the whole of PP7's rule — it is what makes formatting "special".
 */
export function runDiffersFromBox(run: TextRun, box: BoxDefaults, attr: RunAttr): boolean {
  const rv = run[attr];
  if (rv === undefined) return false;
  const bv = box[attr];
  if (attr === "color") {
    const norm = (c: unknown) => (typeof c === "string" ? c.trim().toLowerCase() : undefined);
    return norm(rv) !== undefined && norm(rv) !== norm(bv);
  }
  return !!rv !== !!bv;
}

/**
 * The runs a theme apply must NOT overwrite: those that differ from the box on
 * at least one attribute. A run that merely repeats the box's own formatting is
 * not special and is dropped — matching PP7, where an all-bold box loses its
 * bold.
 */
export function specialRuns(runs: readonly TextRun[] | undefined, box: BoxDefaults, textLength: number): TextRun[] {
  const norm = normalizeRuns(runs, textLength);
  const kept: TextRun[] = [];
  for (const r of norm) {
    const attrs = RUN_ATTRS.filter((a) => runDiffersFromBox(r, box, a));
    if (attrs.length === 0) continue;
    // Keep ONLY the attributes that actually contrast. A run that is bold (same
    // as the box) and red (different) survives as red alone, so the box's bold
    // can still follow the theme.
    const out: TextRun = { start: r.start, end: r.end };
    for (const a of attrs) (out as Record<string, unknown>)[a] = r[a];
    kept.push(out);
  }
  return kept;
}

export type RenderSegment = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
};

/**
 * Split `text` into the segments to render. No runs (or none that survive
 * normalisation) yields a single plain segment, so the renderer's output is
 * byte-identical to before for every existing slide.
 */
export function splitIntoSegments(text: string, runs: readonly TextRun[] | undefined): RenderSegment[] {
  const norm = normalizeRuns(runs, text.length);
  if (norm.length === 0) return [{ text }];
  const segs: RenderSegment[] = [];
  let at = 0;
  for (const r of norm) {
    if (r.start > at) segs.push({ text: text.slice(at, r.start) });
    segs.push({ text: text.slice(r.start, r.end), bold: r.bold, italic: r.italic, underline: r.underline, color: r.color });
    at = r.end;
  }
  if (at < text.length) segs.push({ text: text.slice(at) });
  return segs.filter((s) => s.text.length > 0);
}

/**
 * Shift runs so they still cover the same words after the text changes.
 *
 * Editing the text of a box that has runs must not silently move someone's
 * emphasis onto different words. We only handle the safe case — a pure
 * insertion or deletion at a known offset. When we cannot be sure, runs are
 * DROPPED rather than left pointing at the wrong characters: losing the
 * emphasis is recoverable, quietly bolding the wrong word on a projector is not.
 */
export function shiftRuns(runs: readonly TextRun[] | undefined, at: number, delta: number, newLength: number): TextRun[] {
  const norm = normalizeRuns(runs, Number.MAX_SAFE_INTEGER);
  if (norm.length === 0 || delta === 0) return normalizeRuns(runs, newLength);
  const moved = norm.map((r) => {
    const shift = (n: number) => (n <= at ? n : Math.max(at, n + delta));
    return { ...r, start: shift(r.start), end: shift(r.end) };
  });
  return normalizeRuns(moved, newLength);
}

/**
 * Re-map runs for a whole-text replacement (quick edit swaps a box's text).
 * Diff old vs new by common prefix/suffix. If the change is a PURE insertion
 * or deletion, shift the runs with shiftRuns (same words stay formatted). Any
 * other change (a replacement) is ambiguous → runs are DROPPED (conservative:
 * losing emphasis is recoverable, bolding the wrong word on a projector is not).
 * Returns undefined when there are no runs left to keep.
 */
export function remapRunsForTextEdit(runs: readonly TextRun[] | undefined, oldText: string, newText: string): TextRun[] | undefined {
  if (!Array.isArray(runs) || runs.length === 0) return undefined;
  if (oldText === newText) return normalizeRuns(runs, newText.length);
  let p = 0;
  const max = Math.min(oldText.length, newText.length);
  while (p < max && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < max - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
  const removed = oldText.length - p - s;
  const inserted = newText.length - p - s;
  if (removed > 0 && inserted > 0) return undefined;
  let out: TextRun[];
  if (inserted > 0) {
    out = shiftRuns(runs, p, inserted, newText.length);
  } else {
    // Pure deletion of [p, p+removed): a run touching the deleted span loses
    // characters; shiftRuns clamps offsets into the collapsed span.
    out = shiftRuns(runs, p, -removed, newText.length);
  }
  return out.length ? out : undefined;
}
