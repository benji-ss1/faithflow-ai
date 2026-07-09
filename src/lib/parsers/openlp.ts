// OpenLP parser.
//
// OpenLP stores its library in a SQLite database (`songs.sqlite`) but also
// exports individual songs / bundles as OpenLyrics XML wrapped inside an
// .osz archive (which is just a ZIP with .xml files inside). We handle:
//   - .osz  → unzip → parse internal .xml as OpenLyrics
//   - .xml  (top level) → parse as OpenLyrics
//   - .sqlite → STUB (would need better-sqlite3, not shipped)
//
// OpenLyrics is a well-documented open standard used by OpenLP, VideoPsalm,
// Quelea, and OpenSong. Format: <song><properties><titles><title>…</title>
// </titles>…</properties><lyrics><verse><lines>…</lines></verse>…</lyrics>
// </song>.

import type { Parser, ParseResult, ParsedSong } from "./index";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false });

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
        if (/\.osz$/i.test(f.name)) {
          const zip = new AdmZip(f.buffer);
          const entries = zip.getEntries();
          let parsedAny = false;
          for (const e of entries) {
            if (e.isDirectory) continue;
            if (!/\.xml$/i.test(e.entryName)) continue;
            try {
              const parsed = parseOpenLyricsXml(e.getData().toString("utf8"), `${f.name}:${e.entryName}`);
              if (parsed) { songs.push(parsed); parsedAny = true; }
            } catch {
              skipped.push({ file: `${f.name}:${e.entryName}`, reason: "Invalid OpenLyrics XML" });
            }
          }
          if (!parsedAny) skipped.push({ file: f.name, reason: "No OpenLyrics songs found inside archive" });
          continue;
        }
        if (/\.xml$/i.test(f.name)) {
          const parsed = parseOpenLyricsXml(f.buffer.toString("utf8"), f.name);
          if (parsed) songs.push(parsed);
          else skipped.push({ file: f.name, reason: "XML did not match OpenLyrics shape" });
        }
      } catch (e) {
        skipped.push({ file: f.name, reason: e instanceof Error ? e.message : "Parse failed" });
      }
    }
    return { songs, media: [], skipped };
  },
};
