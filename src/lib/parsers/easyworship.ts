// EasyWorship parser — STUB with detection.
//
// EasyWorship 6 and 7 store their song library in a SQLite database
// (`SongsDB.db` alongside `MediaDB.db` and `SchedulesDB.db`). EasyWorship
// 2009 used a proprietary `.ews` schedule format. Neither is trivially
// parseable without either:
//   - A native SQLite reader (better-sqlite3, currently NOT a dependency),
//     which we deliberately do not add in this phase.
//   - Reverse-engineered .ews binary layout (undocumented).
//
// So this parser only detects the format and returns a helpful skipped
// message. It never crashes the wizard.

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
        skipped.push({ file: f.name, reason: "EasyWorship .ews binary format not yet supported" });
      } else if (/\.db$/i.test(f.name)) {
        skipped.push({
          file: f.name,
          reason: "EasyWorship uses SQLite — requires a SQLite reader (planned integration, not shipped in this phase).",
        });
      }
    }
    return { songs: [], media: [], skipped };
  },
};
