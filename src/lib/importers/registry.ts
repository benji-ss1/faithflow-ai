// Central registry of every parser. Add new parsers here — nothing else
// in the pipeline needs to change.

import type { Parser } from "./types";
import { propresenterParser } from "./propresenter";
import { opensongParser } from "./opensong";
import { openlyricsParser } from "./openlyrics";

export const PARSERS: Parser[] = [
  propresenterParser,
  opensongParser,
  openlyricsParser,
];

/** Find the first parser willing to handle a given file. */
export function parserFor(path: string): Parser | null {
  for (const p of PARSERS) {
    if (p.match(path)) return p;
  }
  return null;
}
