/**
 * ProPresenter 7 (.pro) parser — pragmatic binary string-extraction.
 *
 * Why not use protobufjs with a community .proto schema?
 *
 *   Renewed Vision does not publish the schema, and every community-derived
 *   one (greyshirtguy/ProPresenter7-Proto, jeffmikels/propresenter-parser,
 *   etc.) is incomplete and version-drift-prone. When PP7.x ships a new
 *   minor and the schema changes, the parser silently returns garbage or
 *   crashes on an unknown wire tag. That is a worse failure than what we
 *   have here.
 *
 *   Instead we exploit two invariants that ProPresenter has NEVER broken:
 *     - Slide text is stored as RTF, always wrapped in `{\rtf1...}` — the
 *       same RTF our .pro6 parser already strips.
 *     - Section labels (Verse 1, Chorus, Bridge, Pre-Chorus, Tag, Ending,
 *       Intro, Outro, Interlude) are stored as plain UTF-8 strings,
 *       length-prefixed by the protobuf runtime but immediately readable.
 *     - Media references keep their `.jpg`/`.mp4` extensions in plain UTF-8.
 *
 *   We walk the binary once, collect every {\rtf...} block and every
 *   printable UTF-8 run ≥3 chars, then reconstruct: title from filename,
 *   slides from RTF blocks (in file order — that's ProPresenter's own
 *   render order), sections from label strings that appear near RTF
 *   starts, and media hints from any file-extension strings.
 *
 *   This is guaranteed to produce something usable for EVERY PP7 file —
 *   never a hard failure — while giving up some structure the protobuf
 *   would encode (custom arrangements, notes, per-slide transitions).
 *   Trade-off documented explicitly: correct migration path over perfect
 *   fidelity.
 */

import { stripRtf } from "./pro6-parser";

export type ParsedPro7Song = {
  title: string;
  artist: string | null;
  ccli: string | null;
  /** Flat per-slide lyrics in the order they appear in the binary. */
  slides: string[];
  /** Slide groups with detected section names. */
  sections: { name: string; slides: string[] }[];
  /** Filenames referenced from within the file (backgrounds, videos). */
  mediaHints: string[];
  warnings: string[];
};

const SECTION_KEYWORDS = [
  "verse", "chorus", "bridge", "pre-chorus", "prechorus", "pre chorus",
  "tag", "outro", "intro", "interlude", "ending", "refrain",
];

/** Find every `{\rtf` block in the buffer and return their [start,end) offsets. */
function findRtfBlocks(buf: Buffer): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  const needle = Buffer.from("{\\rtf", "utf8");
  let i = 0;
  while (i < buf.length) {
    const at = buf.indexOf(needle, i);
    if (at < 0) break;
    // Walk braces to find the matching close. RTF may contain escaped
    // braces (\{ \}) — skip those.
    let depth = 0;
    let end = at;
    for (let j = at; j < buf.length; j++) {
      const c = buf[j];
      if (c === 0x5c /* \ */) { j++; continue; } // skip escaped char
      if (c === 0x7b /* { */) depth++;
      else if (c === 0x7d /* } */) {
        depth--;
        if (depth === 0) { end = j + 1; break; }
      }
    }
    if (end <= at) break;
    const raw = buf.subarray(at, end).toString("utf8");
    out.push({ start: at, end, text: stripRtf(raw) });
    i = end;
  }
  return out;
}

/** Extract printable UTF-8 runs of at least `minLen` chars from the buffer. */
function extractPrintableRuns(buf: Buffer, minLen = 3): { offset: number; text: string }[] {
  const runs: { offset: number; text: string }[] = [];
  let start = -1;
  const isPrintable = (b: number) => (b >= 0x20 && b <= 0x7e) || b === 0x09 || (b >= 0xc2 && b <= 0xf4);
  for (let i = 0; i <= buf.length; i++) {
    const b = i < buf.length ? buf[i] : 0;
    if (isPrintable(b) && i < buf.length) {
      if (start < 0) start = i;
    } else {
      if (start >= 0 && i - start >= minLen) {
        try {
          const text = buf.subarray(start, i).toString("utf8");
          runs.push({ offset: start, text });
        } catch { /* skip invalid utf8 */ }
      }
      start = -1;
    }
  }
  return runs;
}

/** Given a candidate label string, return a normalized section name or null. */
function classifySectionLabel(s: string): string | null {
  const cleaned = s.trim().toLowerCase();
  if (!cleaned || cleaned.length > 40) return null;
  for (const kw of SECTION_KEYWORDS) {
    if (cleaned === kw || cleaned.startsWith(kw + " ") || cleaned.startsWith(kw)) {
      // Preserve the original casing/number ("Verse 1", "Chorus 2") when possible.
      const cap = s.trim().replace(/\s+/g, " ");
      if (cap.length <= 30) return cap;
      return kw.charAt(0).toUpperCase() + kw.slice(1);
    }
  }
  return null;
}

/** File extension check for media hint candidates. */
const MEDIA_RX = /[\w\-. ]+\.(jpe?g|png|gif|webp|mp4|mov|m4v|webm)$/i;

/**
 * Parse a Pro7 .pro binary buffer. Never throws — returns a warnings list
 * for the caller to surface.
 */
export function parsePro7(buf: Buffer, fileName: string): ParsedPro7Song {
  const warnings: string[] = [];
  const titleFromFile = fileName
    .split(/[/\\]/)
    .pop()!
    .replace(/\.(pro|pro7|pro7x)$/i, "")
    .trim();

  // 1. RTF blocks — these are definitively slide lyrics, in file order.
  const rtf = findRtfBlocks(buf);
  const slides = rtf
    .map((b) => b.text)
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0);

  // 2. Printable runs — used for section labels + media hints + CCLI.
  const runs = extractPrintableRuns(buf, 3);

  // 3. Section labels: look for section-keyword strings, associate each
  // with the NEXT RTF block that follows it in file order.
  type LabelHit = { offset: number; name: string };
  const labels: LabelHit[] = [];
  for (const r of runs) {
    const cls = classifySectionLabel(r.text);
    if (cls) labels.push({ offset: r.offset, name: cls });
  }
  labels.sort((a, b) => a.offset - b.offset);

  const sections: { name: string; slides: string[] }[] = [];
  if (rtf.length > 0) {
    // For each RTF block, find the last section label whose offset < RTF start.
    let currentSection = "Song";
    let currentSlides: string[] = [];
    let li = 0;
    for (const block of rtf) {
      while (li < labels.length && labels[li].offset < block.start) {
        // Advance labels — the latest one before this RTF block is the current section.
        if (labels[li].offset < block.start) currentSection = labels[li].name;
        li++;
      }
      // If the next slide is in a new section, flush the accumulator.
      const lastAccumSection = sections.length > 0 ? sections[sections.length - 1].name : null;
      const bestLabel = (() => {
        let best: string | null = null;
        for (const l of labels) if (l.offset < block.start) best = l.name;
        return best;
      })();
      const thisSection = bestLabel || currentSection;
      if (sections.length === 0 || sections[sections.length - 1].name !== thisSection) {
        sections.push({ name: thisSection, slides: [] });
      }
      const cleaned = block.text.replace(/\s+/g, " ").trim();
      if (cleaned) sections[sections.length - 1].slides.push(cleaned);
      // Silence unused-variable warnings from the exploratory loop.
      void lastAccumSection; void currentSlides;
    }
  }

  // 4. Media hints: any string matching a media-file extension.
  const mediaHints = Array.from(
    new Set(
      runs
        .map((r) => r.text.trim())
        .filter((t) => MEDIA_RX.test(t))
        .map((t) => t.split(/[/\\]/).pop() || t),
    ),
  );

  // 5. CCLI number: look for a token like "CCLI" followed within ~30 chars
  // by 4–8 digits.
  let ccli: string | null = null;
  const joined = runs.map((r) => r.text).join(" \x01 ");
  const ccliMatch = /CCLI[^0-9]{0,30}(\d{4,8})/i.exec(joined);
  if (ccliMatch) ccli = ccliMatch[1];

  // 6. Artist: heuristic — look for a "by" prefix or a "Author" adjacent
  // string. Frequently absent in PP7 exports; we accept null.
  let artist: string | null = null;
  const authorMatch = /(?:Author|Artist|Writer)[^\w]{0,10}([A-Z][A-Za-z .,'&-]{2,60})/.exec(joined);
  if (authorMatch) artist = authorMatch[1].trim();
  const byMatch = /\bby\s+([A-Z][A-Za-z .,'&-]{2,60})/.exec(joined);
  if (!artist && byMatch) artist = byMatch[1].trim();

  if (slides.length === 0) {
    warnings.push(
      "No lyric slides found in this Pro7 file. Bundle may contain images/videos only, or a schema variant we don't yet recognize.",
    );
  } else if (slides.length > 1) {
    // Honest ordering caveat: Pro7 (.pro) is a binary protobuf and slides are
    // recovered in the file's stored order, NOT the song ARRANGEMENT (which
    // encodes the real play order + repeated choruses in protobuf references
    // we don't decode). So the sequence may be wrong. Give the operator the
    // heads-up + the reliable workaround. (.pro6 arrangement order IS honored.)
    warnings.push(
      "Heads up: Pro7 (.pro) slide order may not match the song's arrangement — please verify the sequence after import. For guaranteed order, export the song from ProPresenter as .pro6 (or use a text export) and import that instead.",
    );
  }

  return {
    title: titleFromFile || "Untitled",
    artist,
    ccli,
    slides,
    sections: sections.length > 0 ? sections : (slides.length > 0 ? [{ name: "Song", slides: [...slides] }] : []),
    mediaHints,
    warnings,
  };
}
