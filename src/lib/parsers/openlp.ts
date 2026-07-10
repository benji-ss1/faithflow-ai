/**
 * OpenLP parser (OpenLyrics format).
 *
 * Target format:
 *   - Extension: `.osz` (ZIP container) or `.xml` (raw OpenLyrics)
 *   - Container: `.osz` is a ZIP holding one or more `.xml` files that
 *     conform to the OpenLyrics schema
 *     (`<song xmlns="http://openlyrics.info/namespace/2009/song">`).
 *   - OpenLP also stores its live library in `songs.sqlite`, which we
 *     do NOT parse (no SQLite reader in the dependency set for this phase).
 *
 * Format source: OpenLyrics is a well-documented open standard
 * (https://openlyrics.org) used by OpenLP, VideoPsalm, Quelea, OpenSong.
 * The `<properties><titles><title>` and `<lyrics><verse><lines>` shape is
 * defined in the spec.
 *
 * CAN parse:
 *   - `.osz` archives containing OpenLyrics XML files.
 *   - Standalone OpenLyrics `.xml` files.
 *   - Multiple `<title>` and `<author>` nodes (uses the first of each).
 *
 * CANNOT parse:
 *   - `songs.sqlite` (OpenLP database) — stubbed to skipped[] with reason.
 *   - Rich formatting inside `<lines>` beyond `<br/>` (dropped silently).
 *
 * Field verification:
 *   - title, slides: verified against OpenLyrics 0.9 spec examples.
 *   - artist: best-effort (first `<author>` node text).
 *
 * Safety:
 *   - XML is parsed with `processEntities: false` (XXE-safe).
 *   - Every zip is passed through `inspectZip` (entry-count, uncompressed
 *     total, path-traversal).
 *   - Strict UTF-8 decoding.
 *   - Never throws; per-entry failures land in skipped[].
 */

import type { Parser, ParseResult, ParsedSong } from "./index";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import { inspectZip, decodeUtf8Strict } from "./safety";

// XXE-safe: processEntities:false prevents external / expanded entity
// resolution. attributeNamePrefix keeps attributes namespaced.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  processEntities: false,
});

function parseOpenLyricsXml(xml: string, sourceFile: string): ParsedSong | null {
  const doc = xmlParser.parse(xml) as Record<string, unknown>;
  const song = (doc.song as Record<string, unknown>) || doc;
  if (!song || typeof song !== "object") return null;
  const props = (song.properties as Record<string, unknown>) || {};
  const titles = (props.titles as Record<string, unknown>) || {};
  let title = "";
  const titleNode = titles.title;
  if (typeof titleNode === "string") title = titleNode;
  else if (Array.isArray(titleNode)) title = String((titleNode[0] as Record<string, unknown>)?.["#text"] ?? titleNode[0] ?? "");
  else if (titleNode && typeof titleNode === "object") title = String((titleNode as Record<string, unknown>)["#text"] ?? "");
  title = title.trim();
  if (!title) return null;

  const authors = (props.authors as Record<string, unknown>) || {};
  let artist: string | null = null;
  const authorNode = authors.author;
  if (typeof authorNode === "string") artist = authorNode;
  else if (Array.isArray(authorNode)) artist = String((authorNode[0] as Record<string, unknown>)?.["#text"] ?? authorNode[0] ?? "");
  else if (authorNode && typeof authorNode === "object") artist = String((authorNode as Record<string, unknown>)["#text"] ?? "");

  const lyrics = (song.lyrics as Record<string, unknown>) || {};
  const verses = Array.isArray(lyrics.verse) ? lyrics.verse : lyrics.verse ? [lyrics.verse] : [];
  const slides: string[] = [];
  for (const v of verses as Record<string, unknown>[]) {
    const lineNode = v.lines;
    const lineArr = Array.isArray(lineNode) ? lineNode : lineNode ? [lineNode] : [];
    for (const l of lineArr) {
      let txt = "";
      if (typeof l === "string") txt = l;
      else if (l && typeof l === "object") txt = String((l as Record<string, unknown>)["#text"] ?? "");
      txt = txt.replace(/<br\s*\/?>/gi, "\n").trim();
      if (txt) slides.push(txt);
    }
  }
  if (slides.length === 0) return null;
  return { title, artist: artist || null, slides, warnings: [], sourceFile };
}

export const openlpParser: Parser = {
  id: "openlp",
  label: "OpenLP (.osz / OpenLyrics)",
  detect(files) {
    let score = 0;
    for (const f of files) {
      if (/\.osz$/i.test(f.name)) score += 0.9;
      if (/songs\.sqlite$/i.test(f.name)) score += 0.7;
      if (/openlyrics.*\.xml$/i.test(f.name)) score += 0.4;
    }
    return Math.min(1, score);
  },
  async parse(files): Promise<ParseResult> {
    const songs: ParsedSong[] = [];
    const skipped: { file: string; reason: string }[] = [];

    for (const f of files) {
      try {
        if (/\.sqlite$/i.test(f.name)) {
          skipped.push({ file: f.name, reason: "OpenLP SQLite database requires a SQLite reader (not shipped in this phase)." });
          continue;
        }
        if (/\.osz$|\.zip$/i.test(f.name)) {
          let zip: AdmZip;
          try {
            zip = new AdmZip(f.buffer);
          } catch (e) {
            skipped.push({ file: f.name, reason: `Invalid zip: ${e instanceof Error ? e.message : "unknown"}` });
            continue;
          }
          const inspect = inspectZip(zip);
          if (!inspect.ok) {
            skipped.push({ file: f.name, reason: inspect.reason });
            continue;
          }
          let parsedAny = false;
          for (const e of inspect.entries) {
            if (e.isDirectory) continue;
            if (!/\.xml$/i.test(e.entryName)) continue;
            try {
              const text = decodeUtf8Strict(e.getData());
              const parsed = parseOpenLyricsXml(text, `${f.name}:${e.entryName}`);
              if (parsed) { songs.push(parsed); parsedAny = true; }
              else skipped.push({ file: `${f.name}:${e.entryName}`, reason: "XML did not match OpenLyrics shape" });
            } catch (err) {
              skipped.push({ file: `${f.name}:${e.entryName}`, reason: `Invalid OpenLyrics XML: ${err instanceof Error ? err.message : "parse failed"}` });
            }
          }
          if (!parsedAny) skipped.push({ file: f.name, reason: "No OpenLyrics songs found inside archive" });
          continue;
        }
        if (/\.xml$/i.test(f.name)) {
          let text: string;
          try {
            text = decodeUtf8Strict(f.buffer);
          } catch {
            skipped.push({ file: f.name, reason: "File is not valid UTF-8" });
            continue;
          }
          try {
            const parsed = parseOpenLyricsXml(text, f.name);
            if (parsed) songs.push(parsed);
            else skipped.push({ file: f.name, reason: "XML did not match OpenLyrics shape" });
          } catch (err) {
            skipped.push({ file: f.name, reason: `Invalid XML: ${err instanceof Error ? err.message : "parse failed"}` });
          }
        }
      } catch (e) {
        skipped.push({ file: f.name, reason: e instanceof Error ? e.message : "Parse failed" });
      }
    }
    return { songs, media: [], skipped };
  },
};
