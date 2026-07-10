/**
 * MediaShout parser — DETECTION-ONLY STUB.
 *
 * Target format:
 *   - `.msh` (MediaShout script) — proprietary binary; no public spec.
 *   - Backend database — SQL Server (older) or SQLite (newer).
 *
 * Format source: no public spec. MediaShout has never published a format
 * reference and there is no community-maintained parser we can build on.
 *
 * CAN parse: nothing.
 * CANNOT parse: `.msh`, MediaShout DB files.
 *
 * Safety: never throws; detected files are surfaced as skipped[] entries.
 * The wizard tells the user to export as CSV / plain text.
 */

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
