/**
 * EasyWorship parser — DETECTION-ONLY STUB.
 *
 * Target format:
 *   - EasyWorship 6/7: Firebird / SQLite-style databases named
 *     `SongsDB.db`, `MediaDB.db`, `SchedulesDB.db`. These are NOT plain
 *     SQLite — modern EasyWorship uses an embedded Firebird engine
 *     (community reverse-engineering; no public schema).
 *   - EasyWorship 2009: `.ews` schedule files (undocumented binary).
 *
 * Format source: no public spec. Community forum posts (softchalk / CCLI
 * forums) suggest Firebird 2.5; requires a native driver we do not ship.
 *
 * CAN parse:
 *   - Nothing yet. Detection only.
 *
 * CANNOT parse:
 *   - `.db` files (requires Firebird driver — not in dependency set)
 *   - `.ews` files (undocumented binary layout)
 *
 * Safety:
 *   - Never throws. Detected files are added to skipped[] with a
 *     human-readable reason so the wizard can guide the user to export
 *     as CSV/plain text instead.
 */

import type { Parser, ParseResult } from "./index";

export const easyworshipParser: Parser = {
  id: "easyworship",
  label: "EasyWorship (.ews / SongsDB.db)",
  detect(files) {
    let score = 0;
    for (const f of files) {
      if (/\.ews$/i.test(f.name)) score += 0.5;
      if (/SongsDB\.db$/i.test(f.name)) score += 0.9;
      if (/MediaDB\.db$/i.test(f.name)) score += 0.2;
      if (/SchedulesDB\.db$/i.test(f.name)) score += 0.2;
    }
    return Math.min(1, score);
  },
  async parse(files): Promise<ParseResult> {
    const skipped: { file: string; reason: string }[] = [];
    for (const f of files) {
      if (/\.ews$/i.test(f.name)) {
        skipped.push({ file: f.name, reason: "EasyWorship .ews binary format is undocumented — please export as CSV or plain text." });
      } else if (/\.db$/i.test(f.name)) {
        skipped.push({
          file: f.name,
          reason: "EasyWorship uses Firebird — requires a native driver not shipped in this phase. Export songs as CSV/plain text instead.",
        });
      }
    }
    return { songs: [], media: [], skipped };
  },
};
