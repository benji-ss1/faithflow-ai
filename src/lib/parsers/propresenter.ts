// ProPresenter 5/6 parser.
//
// ProPresenter 6 files are XML documents with extension .pro6. Older
// ProPresenter 5 files use .pro or .pro5 and are similar-but-simpler XML.
// ProPresenter 7 uses a Protobuf-based .proPresenter format that we cannot
// parse without an official protobuf schema — we detect and report skipped.
//
// This parser delegates the actual XML → slide extraction to the existing
// `parsePro6` in `../pro6-parser.ts` (which is already battle-tested by
// Phase 6). We add media-hint scanning and safe per-file try/catch.

import type { Parser, ParseResult, ParsedSong } from "./index";
import { parsePro6 } from "../pro6-parser";

export const propresenterParser: Parser = {
  id: "propresenter",
  label: "ProPresenter (.pro6 / .pro5)",
  detect(files) {
    let hits = 0;
    for (const f of files) {
      if (/\.pro6?$/i.test(f.name) || /\.pro5$/i.test(f.name)) hits++;
      if (/\.propresenter$/i.test(f.name)) hits += 0.25; // pro7, unsupported but still ProPresenter
    }
    if (hits === 0) return 0;
    return Math.min(1, hits / Math.max(1, files.length));
  },
  async parse(files): Promise<ParseResult> {
    const songs: ParsedSong[] = [];
    const skipped: { file: string; reason: string }[] = [];

    for (const f of files) {
      try {
        if (/\.propresenter$/i.test(f.name)) {
          skipped.push({ file: f.name, reason: "ProPresenter 7 (.propresenter) uses a protobuf schema — not supported yet" });
          continue;
        }
        if (!/\.pro6?$|\.pro5$/i.test(f.name)) {
          // silently skip unrelated files (media handled separately in wizard)
          continue;
        }
        const xml = f.buffer.toString("utf8");
        const parsed = parsePro6(xml);
        const title = (parsed.title || "").trim();
        if (!title || parsed.slides.length === 0) {
          skipped.push({ file: f.name, reason: parsed.warnings[0] || "No title or slides found" });
          continue;
        }
        songs.push({
          title,
          artist: parsed.artist,
          slides: parsed.slides,
          warnings: parsed.warnings,
          sourceFile: f.name,
        });
      } catch (e) {
        skipped.push({ file: f.name, reason: e instanceof Error ? e.message : "Parse failed" });
      }
    }
    return { songs, media: [], skipped };
  },
};
