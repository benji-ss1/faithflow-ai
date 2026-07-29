import type { Parser, ImportedItem, ParsedSong } from "./types";
import { parsePro6, isPro7Binary } from "../pro6-parser";

/** Filename (minus extension) as title fallback — many .pro6 exports omit CCLISongTitle. */
function titleFromPath(path: string): string {
  const base = path.split(/[/\\]/).pop() || path;
  return base.replace(/\.(pro6|pro5|pro)$/i, "").trim();
}

export const propresenterParser: Parser = {
  id: "propresenter",
  displayName: "ProPresenter (.pro6 / .pro5)",
  match: (path) => /\.(pro6|pro5|pro)$/i.test(path),
  parseFile: (path, contents): ImportedItem[] => {
    // ProPresenter 7 (.pro) is binary protobuf, not XML — report honestly
    // per-file instead of failing the batch or emitting garbage.
    if (isPro7Binary(contents, path)) {
      return [{ kind: "skip", warnings: [
        "ProPresenter 7 files aren't supported yet — export as Pro6 from ProPresenter, or use the text export.",
      ] }];
    }
    const text = contents.toString("utf8");
    let parsed;
    try { parsed = parsePro6(text); }
    catch {
      return [{ kind: "skip", warnings: ["Malformed ProPresenter XML — could not parse"] }];
    }
    if (parsed.slides.length === 0) {
      return [{ kind: "skip", warnings: parsed.warnings.length ? parsed.warnings : ["No slide text found"] }];
    }

    const song: ParsedSong = {
      title: parsed.title.trim() || titleFromPath(path),
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
