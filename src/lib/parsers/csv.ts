// CSV / plain-text parser.
//
// Supports the same two shapes as `importSongsCsv` in ../actions.ts:
//   1) CSV: title,artist,slide1,slide2,...
//   2) Plain text: sections separated by lines of "---" or "===";
//      first non-blank line is title; second (if it starts with "by ")
//      is artist; rest is split into slides on blank lines.

import type { Parser, ParseResult, ParsedSong } from "./index";

function parseOne(text: string, sourceFile: string): ParsedSong[] {
  const src = text.replace(/\r/g, "").trim();
  if (!src) return [];
  const out: ParsedSong[] = [];

  if (src.split("\n")[0].includes(",") && !src.startsWith("#")) {
    for (const line of src.split("\n")) {
      if (!line.trim()) continue;
      const cells = line.split(",").map((c) => c.trim());
      const [title, artist, ...slides] = cells;
      if (!title) continue;
      out.push({ title, artist: artist || null, slides: slides.filter(Boolean), warnings: [], sourceFile });
    }
  } else {
    const blocks = src.split(/\n\s*(?:---|===)\s*\n/);
    for (const block of blocks) {
      const lines = block.split("\n");
      let title = "";
      let artist: string | null = null;
      const rest: string[] = [];
      let sawTitle = false;
      for (const raw of lines) {
        const line = raw.trim();
        if (!sawTitle) {
          if (!line) continue;
          title = line;
          sawTitle = true;
          continue;
        }
        if (!artist && /^by\s+/i.test(line)) { artist = line.replace(/^by\s+/i, "").trim(); continue; }
        rest.push(raw);
      }
      if (!title) continue;
      const slides = rest.join("\n").split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
      out.push({ title, artist, slides, warnings: [], sourceFile });
    }
  }
  return out;
}

export const csvParser: Parser = {
  id: "csv",
  label: "CSV / plain text",
  detect(files) {
    let score = 0;
    for (const f of files) {
      if (/\.csv$/i.test(f.name)) score += 0.8;
      if (/\.txt$/i.test(f.name)) score += 0.4;
    }
    return Math.min(1, score);
  },
  async parse(files): Promise<ParseResult> {
    const songs: ParsedSong[] = [];
    const skipped: { file: string; reason: string }[] = [];
    for (const f of files) {
      try {
        if (!/\.(csv|txt)$/i.test(f.name)) continue;
        const parsed = parseOne(f.buffer.toString("utf8"), f.name);
        if (parsed.length === 0) {
          skipped.push({ file: f.name, reason: "No songs recognized in file" });
        } else {
          songs.push(...parsed);
        }
      } catch (e) {
        skipped.push({ file: f.name, reason: e instanceof Error ? e.message : "Parse failed" });
      }
    }
    return { songs, media: [], skipped };
  },
};
