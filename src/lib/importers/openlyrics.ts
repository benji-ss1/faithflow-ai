// OpenLyrics parser (used by OpenLP, OpenSong newer versions, and many
// other open source song libraries).
//
// Open standard from openlyrics.info. Structure:
//   <song xmlns="http://openlyrics.info/namespace/2009/song">
//     <properties>
//       <titles><title>...</title></titles>
//       <authors><author>...</author></authors>
//       <copyright>...</copyright>
//       <ccliNo>...</ccliNo>
//     </properties>
//     <lyrics>
//       <verse name="v1"><lines>...<br/>...</lines></verse>
//       <verse name="c1"><lines>...</lines></verse>
//     </lyrics>
//   </song>

import { XMLParser } from "fast-xml-parser";
import type { Parser, ImportedItem, ParsedSong } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: false,
  parseAttributeValue: false,
  cdataPropName: "__cdata",
});

function stringifyLines(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(stringifyLines).join("\n");
  const obj = node as Record<string, unknown>;
  if (typeof obj["#text"] === "string") return obj["#text"];
  if (typeof obj.__cdata === "string") return obj.__cdata;
  // <br/> tags become newlines; <chord> tags are stripped
  const parts: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (key === "chord") continue;
    if (key === "br") { parts.push("\n"); continue; }
    if (key === "#text") { parts.push(String(val)); continue; }
    if (key.startsWith("@_")) continue;
    parts.push(stringifyLines(val));
  }
  return parts.join("");
}

function extractTitle(root: Record<string, unknown>): string {
  const props = root.properties as Record<string, unknown> | undefined;
  if (!props) return "";
  const titles = props.titles as Record<string, unknown> | undefined;
  const t = titles?.title;
  if (typeof t === "string") return t.trim();
  if (Array.isArray(t)) {
    const first = t[0];
    if (typeof first === "string") return first.trim();
    if (first && typeof first === "object") return String((first as Record<string, string>)["#text"] || "").trim();
  }
  if (t && typeof t === "object") {
    const obj = t as Record<string, unknown>;
    return String(obj["#text"] || obj.__cdata || "").trim();
  }
  return "";
}

function extractAuthor(root: Record<string, unknown>): string | null {
  const props = root.properties as Record<string, unknown> | undefined;
  if (!props) return null;
  const authors = props.authors as Record<string, unknown> | undefined;
  const a = authors?.author;
  if (typeof a === "string") return a.trim() || null;
  if (Array.isArray(a)) {
    return a.map((x) => typeof x === "string" ? x : (x as Record<string, string>)?.["#text"] || "").filter(Boolean).join(", ") || null;
  }
  if (a && typeof a === "object") {
    return String((a as Record<string, string>)["#text"] || "").trim() || null;
  }
  return null;
}

export const openlyricsParser: Parser = {
  id: "openlyrics",
  displayName: "OpenLyrics (OpenLP + others)",
  match: (path) => /\.(xml|openlyrics)$/i.test(path),
  parseFile: (path, contents): ImportedItem[] => {
    const text = contents.toString("utf8");
    if (!/openlyrics\.info|<song[\s>][^<]*<properties/i.test(text) && !/<lyrics[^>]*>[\s\S]*<verse/i.test(text)) return [];
    let doc: Record<string, unknown>;
    try { doc = parser.parse(text) as Record<string, unknown>; }
    catch { return []; }

    const song = (doc.song as Record<string, unknown>) || {};
    const title = extractTitle(song);
    if (!title) return [];

    const lyricsNode = song.lyrics as Record<string, unknown> | undefined;
    const verses = lyricsNode?.verse;
    const verseArr = Array.isArray(verses) ? verses : verses ? [verses] : [];

    const slides = verseArr.map((v) => stringifyLines((v as Record<string, unknown>).lines))
      .map((s) => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim())
      .filter((s) => s.length > 0);

    const props = song.properties as Record<string, unknown> | undefined;
    const ccli = props?.ccliNo ? String((props.ccliNo as Record<string, string>)["#text"] || props.ccliNo) : null;

    const parsed: ParsedSong = {
      title,
      artist: extractAuthor(song),
      ccli: typeof ccli === "string" ? ccli.trim() || null : null,
      slides,
      mediaHints: [],
      sourceRef: path,
      warnings: slides.length === 0 ? ["No lyrics found"] : [],
    };
    return [{ kind: "song", song: parsed }];
  },
};
