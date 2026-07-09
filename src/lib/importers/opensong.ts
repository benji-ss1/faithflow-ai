// OpenSong parser.
//
// OpenSong stores each song as an XML file (no extension by convention;
// content type is `application/x-opensong-song`). Structure:
//   <song>
//     <title>...</title>
//     <author>...</author>
//     <copyright>...</copyright>
//     <ccli>...</ccli>
//     <lyrics>[V1] verse text ...</lyrics>
//   </song>
//
// Lyrics use verse tags: [V1], [C1], [B], [T1] etc. Chord lines start
// with `.` (e.g. `.C  G  Am`). We strip chord lines and keep prose lines.

import { XMLParser } from "fast-xml-parser";
import type { Parser, ImportedItem, ParsedSong } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  cdataPropName: "__cdata",
});

function splitSlides(lyrics: string): string[] {
  if (!lyrics) return [];
  // Split on [V1] / [C1] / [B] / [T1] etc. Keep the delimiter as the
  // start of the next slide so verse headers are preserved.
  const parts = lyrics.split(/(\[[A-Za-z][A-Za-z0-9]*\])/);
  const slides: string[] = [];
  let current = "";
  for (const part of parts) {
    if (/^\[[A-Za-z][A-Za-z0-9]*\]$/.test(part)) {
      if (current.trim()) slides.push(cleanSlide(current));
      current = "";
    } else {
      current += part;
    }
  }
  if (current.trim()) slides.push(cleanSlide(current));
  return slides.filter((s) => s.length > 0);
}

function cleanSlide(text: string): string {
  // Drop chord lines and blank lines, collapse whitespace.
  return text.split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => !l.startsWith("."))
    .filter((l) => l.trim().length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textOf(x: unknown): string {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") {
    const obj = x as Record<string, unknown>;
    if (typeof obj.__cdata === "string") return obj.__cdata;
    if (typeof obj["#text"] === "string") return obj["#text"];
  }
  return "";
}

export const opensongParser: Parser = {
  id: "opensong",
  displayName: "OpenSong",
  match: (path) => {
    // OpenSong files have no extension; identify by XML root heuristic
    const lower = path.toLowerCase();
    if (lower.endsWith(".xml")) return true;
    if (lower.includes("/opensong/") || lower.includes("\\opensong\\")) return true;
    // Files with no extension inside a Songs/ folder are the common case
    if (/\/songs\/[^/.]+$/i.test(lower) || /\\songs\\[^\\.]+$/i.test(lower)) return true;
    return false;
  },
  parseFile: (path, contents): ImportedItem[] => {
    const text = contents.toString("utf8");
    if (!/<song[\s>]/i.test(text)) return []; // not an opensong file
    let doc: Record<string, unknown>;
    try { doc = parser.parse(text) as Record<string, unknown>; }
    catch { return []; }

    const song = (doc.song as Record<string, unknown>) || {};
    const title = textOf(song.title).trim();
    if (!title) return [];

    const parsed: ParsedSong = {
      title,
      artist: textOf(song.author).trim() || null,
      ccli: textOf(song.ccli).trim() || null,
      slides: splitSlides(textOf(song.lyrics)),
      mediaHints: [],
      sourceRef: path,
      warnings: [],
    };
    if (parsed.slides.length === 0) parsed.warnings.push("No lyrics found");
    return [{ kind: "song", song: parsed }];
  },
};
