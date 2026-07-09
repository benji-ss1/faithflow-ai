// MediaShout parser — STUB.
//
// MediaShout uses a proprietary .msh (script) file plus a database backend
// (SQL Server in older versions, SQLite in newer). The .msh format is
// undocumented binary. We only detect + skip with a clear message so the
// wizard remains usable and the user knows what to expect.

import type { Parser, ParseResult } from "./index";

export const mediashoutParser: Parser = {
  id: "mediashout",
  label: "MediaShout (.msh)",
  detect(files) {
    let score = 0;
    for (const f of files) {
      if (/\.msh$/i.test(f.name)) score += 0.9;
      if (/MediaShout.*\.db$/i.test(f.name)) score += 0.5;
    }
    return Math.min(1, score);
  },
  async parse(files): Promise<ParseResult> {
    const skipped: { file: string; reason: string }[] = [];
    for (const f of files) {
      if (/\.msh$/i.test(f.name)) {
        skipped.push({ file: f.name, reason: "MediaShout .msh is an undocumented proprietary binary — export songs as text or CSV and try again." });
      }
    }
    return { songs: [], media: [], skipped };
  },
};
