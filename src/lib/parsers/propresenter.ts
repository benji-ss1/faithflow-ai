/**
 * ProPresenter 5/6 parser.
 *
 * Target format:
 *   - Extension: `.pro6` (ProPresenter 6) and `.pro5` / `.pro` (ProPresenter 5)
 *   - Container: single plain-text XML file (root: `RVPresentationDocument`)
 *   - Encoding: UTF-8
 *
 * Format source: Renewed Vision has never published an official schema, but
 * the XML is human-readable and has been reverse-engineered by the community
 * (see the `pro6-parser.ts` module and the openlyrics-tools repo). Slide
 * text lives inside `<RVTextElement>` nodes as either an rtfData attribute
 * (base64-encoded RTF) or, in some exports, a `plainTextData` payload.
 *
 * CAN parse:
 *   - .pro6 XML documents produced by ProPresenter 6.x
 *   - Older .pro5 documents that share the same XML shape
 *   - Extracts title, artist, CCLI (best-effort), and per-slide text
 *
 * CANNOT parse:
 *   - `.propresenter` (ProPresenter 7) — protobuf-encoded binary, no public
 *     schema. Detected and reported to skipped[] with a clear reason.
 *   - Media bundles (.pro6plb) — treated as unsupported.
 *
 * Field verification:
 *   - title, slides: verified against real-world .pro6 exports in Phase 6.
 *   - artist / CCLI: best-effort (falls back to null when absent).
 *
 * Safety:
 *   - Every per-file parse is wrapped in try/catch and never throws.
 *   - XML is parsed with `processEntities: false` (see pro6-parser.ts) to
 *     prevent XXE / entity-expansion attacks.
 *   - UTF-8 decoding is strict (rejects on invalid bytes).
 */

import type { Parser, ParseResult, ParsedSong } from "./index";
import { parsePro6, isPro7Binary } from "../pro6-parser";
import { parsePro7 } from "../pro7-parser";
import { decodeUtf8Strict } from "./safety";

export const propresenterParser: Parser = {
  id: "propresenter",
  label: "ProPresenter (.pro6 / .pro5)",
  detect(files) {
    let hits = 0;
    for (const f of files) {
      // .pro7/.pro7x and protobuf .pro are now supported (see parse()).
      if (/\.(pro6?|pro5|pro7x?)$/i.test(f.name)) hits++;
    }
    if (hits === 0) return 0;
    return Math.min(1, hits / Math.max(1, files.length));
  },
  async parse(files): Promise<ParseResult> {
    const songs: ParsedSong[] = [];
    const skipped: { file: string; reason: string }[] = [];

    for (const f of files) {
      try {
        if (!/\.(pro6?|pro5|pro7x?)$/i.test(f.name)) continue;

        const titleFallback = () => f.name.split(/[/\\]/).pop()!.replace(/\.(pro6|pro5|pro7x?|pro)$/i, "").trim();

        // ProPresenter 7 (.pro / .pro7 / .pro7x) documents are binary protobuf.
        // A real .probundle library is almost entirely these. Detect the
        // protobuf shape and route to the dedicated Pro7 string extractor —
        // mirrors the dialog import path (src/lib/importers/propresenter.ts).
        // Without this, bare pro7 docs hit the XML path below, fail UTF-8
        // decode, and every song is skipped (0 imported).
        if (isPro7Binary(f.buffer, f.name)) {
          let parsed;
          try {
            parsed = parsePro7(f.buffer, f.name);
          } catch (e) {
            skipped.push({ file: f.name, reason: `ProPresenter 7 parse failed: ${e instanceof Error ? e.message : "unknown"}` });
            continue;
          }
          const title = (parsed.title || "").trim() || titleFallback();
          if (!title || parsed.slides.length === 0) {
            skipped.push({ file: f.name, reason: parsed.warnings[0] || "Pro7 file had no readable lyric text" });
            continue;
          }
          songs.push({ title, artist: parsed.artist, slides: parsed.slides, warnings: parsed.warnings, sourceFile: f.name });
          continue;
        }

        let xml: string;
        try {
          xml = decodeUtf8Strict(f.buffer);
        } catch {
          skipped.push({ file: f.name, reason: "File is not valid UTF-8" });
          continue;
        }

        let parsed;
        try {
          parsed = parsePro6(xml);
        } catch (e) {
          skipped.push({ file: f.name, reason: `Malformed ProPresenter XML: ${e instanceof Error ? e.message : "parse failed"}` });
          continue;
        }

        // Many real exports omit CCLISongTitle — fall back to the filename.
        const title = (parsed.title || "").trim() || titleFallback();
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
