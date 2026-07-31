/**
 * ProPresenter .pro6 / .pro5 parser.
 *
 * Format research summary:
 *   - `.pro6` is a single XML file (root: RVPresentationDocument).
 *     Slide groups live in <RVSlideGrouping name="Verse 1"> →
 *     <RVDisplaySlide> → <RVTextElement>. The slide text is base64-encoded
 *     RTF, stored either as an `RTFData` attribute (Pro5 style) or in a
 *     child <NSString rvXMLIvarName="RTFData">…base64…</NSString> (Pro6
 *     style). Some exports also carry a PlainText NSString (base64 plain).
 *   - `.pro5` is the same XML family with the RTFData attribute form.
 *   - Song metadata (title, author, CCLI) is on the root element as
 *     attributes: `CCLISongTitle`, `CCLIAuthor`, `CCLISongNumber`.
 *   - `.pro` (ProPresenter 7) is a BINARY protobuf file — NOT XML. We
 *     detect it and report honestly rather than crash or emit garbage.
 */

import { XMLParser } from "fast-xml-parser";

export type ParsedProSection = { name: string; slides: string[] };

export type ParsedProSong = {
  title: string;
  artist: string | null;
  ccli: string | null;
  /** Flat per-slide lyrics in document order (what gets projected). */
  slides: string[];
  /** Slide groups with their section names (Verse 1, Chorus, …). */
  sections: ParsedProSection[];
  /** Warnings for the caller to surface, e.g. "Slide 3 had no readable text" */
  warnings: string[];
};

// XXE-safe: `processEntities: false` prevents external and expanded entity
// resolution when parsing untrusted .pro6 XML.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: false,
  isArray: () => false,
});

/**
 * Detect a ProPresenter 7 file: `.pro` extension and/or binary (protobuf)
 * content. Pro7 files are not XML — they contain NUL/control bytes and
 * never start with an XML declaration or `<RV` root.
 */
export function isPro7Binary(contents: Buffer | string, path?: string): boolean {
  const buf = typeof contents === "string" ? Buffer.from(contents, "utf8") : contents;
  const head = buf.subarray(0, Math.min(buf.length, 512));
  // Any NUL byte in the head is a dead giveaway of protobuf, not XML.
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) return true;
  }
  const text = head.toString("utf8").replace(/^﻿/, "").trimStart();
  const looksXml = text.startsWith("<");
  if (!looksXml && path && /\.pro$/i.test(path)) return true;
  return false;
}

// Private-use sentinels that protect RTF escaped literals (\\ \{ \}) from
// the control-word / brace strip passes; restored at the end of stripRtf.
const S_BACKSLASH = "";
const S_OPEN = "";
const S_CLOSE = "";

/**
 * Strip RTF control words / groups down to plain text. Not a full RTF
 * parser — a deliberate ~50-line stripper that handles the constructs
 * ProPresenter actually emits:
 *   - \par, \line               → newlines
 *   - \'xx hex escapes          → the encoded byte (latin-1)
 *   - \uN?                      → the unicode codepoint, consuming the
 *                                  single ANSI fallback char that follows
 *   - \\ \{ \} escaped literals → preserved via sentinels
 *   - {\fonttbl…} {\colortbl…} {\*\…} destination groups → removed whole
 *   - remaining control words \word[-]N and braces → removed
 */
export function stripRtf(rtf: string): string {
  let s = rtf;

  // Protect escaped literals FIRST so later passes can't eat them.
  s = s
    .replace(/\\\\/g, S_BACKSLASH)
    .replace(/\\\{/g, S_OPEN)
    .replace(/\\\}/g, S_CLOSE);

  // Remove destination groups whose CONTENT must not leak into the text
  // (font names, color tables, stylesheets, \*-prefixed extensions).
  // Balanced-brace matching, bounded iteration.
  s = removeGroups(s, /\{\\(?:fonttbl|colortbl|stylesheet|info|pict|\*)/i);

  s = s
    // \uN? — unicode escape; RTF requires exactly ONE ANSI fallback char
    // right after (usually a literal "?", sometimes a \'xx escape), which
    // must be consumed so it doesn't duplicate the glyph.
    .replace(/\\u(-?\d+) ?(?:\\'[0-9a-fA-F]{2}|.)?/g, (_m, n) => {
      let code = Number(n);
      if (code < 0) code += 65536; // RTF stores >32767 as negative
      try { return String.fromCodePoint(code); } catch { return ""; }
    })
    // Line-break control words BEFORE the generic control-word strip.
    .replace(/\\(?:par|line|sect|page)d?\b\s?/g, "\n")
    // \'xx hex escapes (latin-1 byte)
    .replace(/\\'([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    // Non-breaking space control symbol
    .replace(/\\~/g, " ")
    // Remaining control words: \word, \word-12, \word12, optional space
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, "")
    // Any leftover control symbols (\* etc.) and group braces
    .replace(/\\\*/g, "")
    .replace(/[{}]/g, "");

  // Restore protected escaped literals.
  s = s
    .replace(new RegExp(S_BACKSLASH, "g"), "\\")
    .replace(new RegExp(S_OPEN, "g"), "{")
    .replace(new RegExp(S_CLOSE, "g"), "}");

  // Normalise line endings + collapse excess whitespace
  s = s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n");
  return sanitizeLyrics(s);
}

/**
 * Strip lyric artifact patterns that appear in both freshly-imported RTF
 * AND in lyrics already stored in the DB (from imports before this fix).
 *
 * Apply at import time (end of stripRtf) AND at DB-read time
 * (getExpandedServicePlan) so existing data is fixed without a migration.
 *
 * Patterns stripped:
 *   [[Am]]  [[G/B]]  [[]]  — ProPresenter chord annotations (double bracket).
 *                            ProPresenter stores chord markers as [[chord]]
 *                            literal text inside RTF; they survive stripRtf
 *                            because square brackets are not RTF syntax.
 *   [Am]  [G]  [C#m7]     — ChordPro single-bracket chord markers.
 *                            Uses an explicit chord grammar (root[#b][quality][ext][/bass])
 *                            so section labels like `[Bridge]`, `[Chorus]`, `[Bass]`,
 *                            `[Break]`, `[Ending]`, `[Coda]` are NOT stripped — they
 *                            don't match any valid chord quality sequence.
 *    /     |               — Visual line-separator characters that ProPresenter
 *                            (and some other export tools) emit between lyric
 *                            segments. Converted to newlines rather than deleted
 *                            so line breaks are preserved.
 */
export function sanitizeLyrics(text: string): string {
  return text
    // Strip literal backslashes — RTF/ProPresenter export artifacts that land
    // at the end of lines (e.g. "Amazing grace\"). Must run before chord/pipe
    // rules so "Am\|G" becomes "Am|G" → newline, not "Am\nG" → two newlines.
    .replace(/\\/g, "")
    // ProPresenter double-bracket chord annotations: [[Am]] [[G/B]] [[]] etc.
    .replace(/\[\[[^\]]*\]\]/g, "")
    // ChordPro single-bracket chord markers: [Am] [G] [C#m7] [G/B] [Csus4] [Cadd9]
    // Explicit chord grammar: root[#b]?[quality]?[0-9]{0,2}[/bass]?
    // Qualities: maj min dim aug sus add m  — no other letter sequences allowed,
    // so [Bridge] [Chorus] [Bass] [Break] [Ending] [Coda] are never matched.
    .replace(/\[[A-G][#b]?(?:maj|min|dim|aug|sus|add|m)?[0-9]{0,2}(?:\/[A-G][#b]?)?\]/g, "")
    // " / " visual line separator (ProPresenter, various exports)
    .replace(/ \/ /g, "\n")
    // " | " visual line separator
    .replace(/ \| /g, "\n")
    // Pipe adjacent to word, with or without trailing space
    .replace(/([^\s])\|([^\s])/g, "$1\n$2")
    .replace(/([^\s])\|(\s)/g, "$1\n")
    // Collapse runs of 3+ blank lines down to a single blank line
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remove every balanced {...} group whose opening matches `openRx`. */
function removeGroups(s: string, openRx: RegExp): string {
  let out = s;
  for (let guard = 0; guard < 50; guard++) {
    const m = openRx.exec(out);
    if (!m) break;
    const start = m.index;
    let depth = 0;
    let end = -1;
    for (let i = start; i < out.length; i++) {
      const c = out[i];
      if (c === "\\") { i++; continue; } // skip escaped char
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) { out = out.slice(0, start); break; } // unbalanced — drop tail
    out = out.slice(0, start) + out.slice(end + 1);
  }
  return out;
}

/** Decode base64-encoded RTF (or plain text) to stripped plain text. */
function decodeRtfB64(b64: string): string {
  try {
    const raw = Buffer.from(b64.trim(), "base64").toString("utf8");
    if (!raw) return "";
    if (raw.startsWith("{\\rtf")) return stripRtf(raw);
    // Some exports base64 plain text (PlainText ivar) — pass through.
    return raw.replace(/\r\n?/g, "\n").trim();
  } catch {
    return "";
  }
}

type XmlNode = Record<string, unknown>;

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Extract the lyric text out of one RVTextElement node. */
function textFromTextElement(el: XmlNode): string {
  // Pro5 style: RTFData attribute (base64 RTF). Both casings observed.
  const attr = (el["@_RTFData"] as string) || (el["@_rtfData"] as string);
  if (typeof attr === "string" && attr.trim()) {
    const t = decodeRtfB64(attr);
    if (t) return t;
  }
  // Pro6 style: <NSString rvXMLIvarName="RTFData">base64</NSString>
  const strings = asArray(el.NSString as XmlNode | XmlNode[] | string | undefined);
  let plainFallback = "";
  for (const ns of strings) {
    if (typeof ns === "string") {
      const t = decodeRtfB64(ns);
      if (t) return t;
      continue;
    }
    const ivar = (ns["@_rvXMLIvarName"] as string) || "";
    const body = typeof ns["#text"] === "string" ? (ns["#text"] as string) : "";
    if (!body.trim()) continue;
    if (/RTFData/i.test(ivar)) {
      const t = decodeRtfB64(body);
      if (t) return t;
    } else if (/PlainText/i.test(ivar)) {
      plainFallback = decodeRtfB64(body);
    }
  }
  return plainFallback;
}

/** Collect RVTextElement nodes anywhere under `node` (order-preserving). */
function collectTextElements(node: unknown, out: XmlNode[]) {
  if (!node || typeof node !== "object") return;
  const obj = node as XmlNode;
  if ("RVTextElement" in obj) {
    for (const el of asArray(obj.RVTextElement as XmlNode | XmlNode[])) {
      if (el && typeof el === "object") out.push(el);
    }
  }
  for (const key of Object.keys(obj)) {
    if (key === "RVTextElement" || key.startsWith("@_")) continue;
    const child = obj[key];
    if (Array.isArray(child)) child.forEach((c) => collectTextElements(c, out));
    else if (child && typeof child === "object") collectTextElements(child, out);
  }
}

/** Collect RVDisplaySlide nodes anywhere under `node` (order-preserving). */
function collectDisplaySlides(node: unknown, out: XmlNode[]) {
  if (!node || typeof node !== "object") return;
  const obj = node as XmlNode;
  if ("RVDisplaySlide" in obj) {
    for (const sl of asArray(obj.RVDisplaySlide as XmlNode | XmlNode[])) {
      if (sl && typeof sl === "object") out.push(sl);
    }
  }
  for (const key of Object.keys(obj)) {
    if (key === "RVDisplaySlide" || key.startsWith("@_")) continue;
    const child = obj[key];
    if (Array.isArray(child)) child.forEach((c) => collectDisplaySlides(c, out));
    else if (child && typeof child === "object") collectDisplaySlides(child, out);
  }
}

/** Collect RVSlideGrouping nodes anywhere under `node` (order-preserving). */
function collectGroupings(node: unknown, out: XmlNode[]) {
  if (!node || typeof node !== "object") return;
  const obj = node as XmlNode;
  if ("RVSlideGrouping" in obj) {
    for (const g of asArray(obj.RVSlideGrouping as XmlNode | XmlNode[])) {
      if (g && typeof g === "object") out.push(g);
    }
    return; // groupings don't nest — don't descend into them again
  }
  for (const key of Object.keys(obj)) {
    if (key.startsWith("@_")) continue;
    const child = obj[key];
    if (Array.isArray(child)) child.forEach((c) => collectGroupings(c, out));
    else if (child && typeof child === "object") collectGroupings(child, out);
  }
}

function slideText(slide: XmlNode): string {
  const els: XmlNode[] = [];
  collectTextElements(slide, els);
  const parts = els.map(textFromTextElement).filter((t) => t.trim().length > 0);
  return parts.join("\n").trim();
}

/**
 * Parse a .pro6 / .pro5 XML string. Never throws on malformed content —
 * returns an empty song with warnings instead. Callers should check
 * `isPro7Binary()` first for .pro (Pro7 protobuf) files.
 */
export function parsePro6(xml: string): ParsedProSong {
  const warnings: string[] = [];
  const empty = (why: string): ParsedProSong => ({
    title: "", artist: null, ccli: null, slides: [], sections: [], warnings: [why],
  });

  if (isPro7Binary(xml)) {
    return empty("ProPresenter 7 files aren't supported yet — export as Pro6 from ProPresenter, or use the text export.");
  }

  let parsed: XmlNode;
  try {
    parsed = parser.parse(xml) as XmlNode;
  } catch {
    return empty("File is not valid XML — could not parse as a .pro6 document");
  }
  const root = (parsed.RVPresentationDocument as XmlNode) || parsed;
  if (!root || typeof root !== "object" || Object.keys(root).length === 0) {
    return empty("File is not a recognizable .pro6 document");
  }

  const title = ((root["@_CCLISongTitle"] as string) || "").trim();
  const artist =
    ((root["@_CCLIAuthor"] as string) || (root["@_CCLIArtistCredits"] as string) || "").trim() || null;
  const ccli = ((root["@_CCLISongNumber"] as string) || "").trim() || null;

  // Preferred path: structured RVSlideGrouping → RVDisplaySlide walk so we
  // keep section names (Verse 1, Chorus…) and true slide boundaries.
  const sections: ParsedProSection[] = [];
  const slides: string[] = [];
  const groupings: XmlNode[] = [];
  collectGroupings(root, groupings);

  if (groupings.length > 0) {
    groupings.forEach((g, gi) => {
      const name = ((g["@_name"] as string) || "").trim() || `Section ${gi + 1}`;
      const groupSlides: XmlNode[] = [];
      collectDisplaySlides(g, groupSlides);
      const texts = groupSlides.map(slideText).filter((t) => t.length > 0);
      sections.push({ name, slides: texts });
      slides.push(...texts);
    });
  } else {
    // Fallback: no groupings (older/odd exports) — take every display
    // slide, or failing that every text element, in document order.
    const displaySlides: XmlNode[] = [];
    collectDisplaySlides(root, displaySlides);
    if (displaySlides.length > 0) {
      const texts = displaySlides.map(slideText).filter((t) => t.length > 0);
      slides.push(...texts);
    } else {
      const els: XmlNode[] = [];
      collectTextElements(root, els);
      slides.push(...els.map(textFromTextElement).filter((t) => t.trim().length > 0));
    }
    if (slides.length > 0) sections.push({ name: "Song", slides: [...slides] });
  }

  if (slides.length === 0) {
    warnings.push("No slide text found — file may use images-only slides or an unsupported text encoding");
  }

  return { title, artist, ccli, slides, sections, warnings };
}
