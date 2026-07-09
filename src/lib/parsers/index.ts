// Pluggable parser registry for the Phase 7 migration wizard.
//
// Each parser owns one legacy worship platform format. New parsers should
// implement the `Parser` interface below and be added to `PARSERS`.
//
// This is intentionally distinct from `../importers/` which is the older
// path-based single-file matcher used by `runImportPipeline`. The new
// contract is batch-oriented so a parser can inspect multiple files
// together (needed for OSZ/ZIP-based exports and manifest-style formats).

export type ParsedSong = {
  title: string;
  artist?: string | null;
  slides: string[];
  warnings: string[];
  sourceFile: string;
};

export type ParsedMedia = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  sourceFile: string;
};

export type ParseResult = {
  songs: ParsedSong[];
  media: ParsedMedia[];
  skipped: { file: string; reason: string }[];
};

export type ParserId =
  | "propresenter"
  | "easyworship"
  | "proclaim"
  | "openlp"
  | "mediashout"
  | "worshiptools"
  | "csv";

export interface Parser {
  id: ParserId;
  label: string;
  /**
   * 0..1 confidence that this parser can handle the given batch of files.
   * Higher = more confident. Called on file listing only (no bodies).
   */
  detect(files: { name: string; size: number }[]): number;
  /**
   * Parse a batch of files. Must NEVER throw for a single bad file — wrap
   * every per-file operation in try/catch and add to `skipped[]`.
   */
  parse(files: { name: string; buffer: Buffer }[]): Promise<ParseResult>;
}

import { propresenterParser } from "./propresenter";
import { easyworshipParser } from "./easyworship";
import { proclaimParser } from "./proclaim";
import { openlpParser } from "./openlp";
import { mediashoutParser } from "./mediashout";
import { worshiptoolsParser } from "./worshiptools";
import { csvParser } from "./csv";

export const PARSERS: Parser[] = [
  propresenterParser,
  easyworshipParser,
  proclaimParser,
  openlpParser,
  mediashoutParser,
  worshiptoolsParser,
  csvParser,
];

export function getParser(id: string): Parser | null {
  return PARSERS.find((p) => p.id === id) ?? null;
}

export function autoDetect(files: { name: string; size: number }[]): Parser | null {
  let best: { p: Parser; s: number } | null = null;
  for (const p of PARSERS) {
    const s = p.detect(files);
    if (s > 0 && (!best || s > best.s)) best = { p, s };
  }
  return best?.p ?? null;
}

export function emptyResult(): ParseResult {
  return { songs: [], media: [], skipped: [] };
}
