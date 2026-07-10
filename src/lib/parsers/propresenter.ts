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
import { parsePro6 } from "../pro6-parser";
import { decodeUtf8Strict } from "./safety";

export const propresenterParser: Parser = {
  id: "propresenter",
  label: "ProPresenter (.pro6 / .pro5)",
  detect(files) {
    let hits = 0;
    for (const f of files) {
      if (/\.pro6?$/i.test(f.name) || /\.pro5$/i.test(f.name)) hits++;
      if (/\.propresenter$/i.test(f.name)) hits += 0.25; // pro7, unsupported
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
        if (!/\.pro6?$|\.pro5$/i.test(f.name)) continue;

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
