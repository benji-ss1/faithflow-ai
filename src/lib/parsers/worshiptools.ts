// WorshipTools / Worship Extreme parser — STUB.
//
// WorshipTools (worshiptools.com) — SongShow / Worship Extreme — uses
// .wtx or .wtt files, undocumented proprietary format. This parser only
// detects and reports; the user should export as CSV/plain text.

import type { Parser, ParseResult } from "./index";

export const worshiptoolsParser: Parser = {
  id: "worshiptools",
  label: "WorshipTools / Worship Extreme (.wtx / .wtt)",
  detect(files) {
    let score = 0;
    for (const f of files) {
      if (/\.(wtx|wtt)$/i.test(f.name)) score += 0.9;
    }
    return Math.min(1, score);
  },
  async parse(files): Promise<ParseResult> {
    const skipped: { file: string; reason: string }[] = [];
    for (const f of files) {
      if (/\.(wtx|wtt)$/i.test(f.name)) {
        skipped.push({ file: f.name, reason: "WorshipTools .wtx/.wtt is undocumented — export songs as CSV or plain text." });
      }
    }
    return { songs: [], media: [], skipped };
  },
};
