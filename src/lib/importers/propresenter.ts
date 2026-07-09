import type { Parser, ImportedItem, ParsedSong } from "./types";
import { parsePro6 } from "../pro6-parser";

export const propresenterParser: Parser = {
  id: "propresenter",
  displayName: "ProPresenter (.pro6)",
  match: (path) => /\.pro6?$/i.test(path),
  parseFile: (path, contents): ImportedItem[] => {
    const text = contents.toString("utf8");
    let parsed;
    try { parsed = parsePro6(text); }
    catch (e) {
      return [];
    }
    if (!parsed.title.trim() && parsed.slides.length === 0) return [];

    const song: ParsedSong = {
      title: parsed.title.trim(),
      artist: parsed.artist,
      ccli: parsed.ccli,
      slides: parsed.slides,
      mediaHints: extractMediaHints(text),
      sourceRef: path,
      warnings: parsed.warnings,
    };
    return [{ kind: "song", song }];
  },
};

/** Look for media file references inside a .pro6 XML. */
function extractMediaHints(xml: string): string[] {
  const hints: string[] = [];
  // <RVMediaElement source="..."/> or <RVMediaBaseElement source="...">
  const rx = /source\s*=\s*"([^"]+\.(?:png|jpg|jpeg|mp4|mov|webm|gif))"/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(xml)) !== null) {
    // Strip URL paths, keep just the filename
    const name = m[1].split(/[/\\]/).pop();
    if (name) hints.push(name);
  }
  return Array.from(new Set(hints));
}
