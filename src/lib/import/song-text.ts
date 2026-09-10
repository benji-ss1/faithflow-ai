// Plain-text song importer — the "guided export" format for EasyWorship AND
// ProPresenter/generic text exports. Shape (all parts optional except lyrics):
//
//   Title: Let Praises Rise          ← optional header; ".pro"/".txt" suffix stripped
//   Author: Some Writer              ← optional (Author/Artist/By)
//                                    ← blank line ends the header
//   <verse 1 lines>
//                                    ← one-or-more blank lines = a slide break
//   <verse 2 lines>
//
// If there's no Title: header, the file name is used as the title and the whole
// file is treated as lyrics. Blank-line gaps split verses into slides (same rule
// as the paste-import), so an EasyWorship user just exports each song to .txt.
import type { ParsedSong } from "./videopsalm";
export type { ParsedSong };

export function parseSongText(raw: string, fileName?: string): ParsedSong {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  let title = "";
  let artist: string | null = null;
  let i = 0;
  // Consume a leading header block: Title:/Author: lines (in any order), ending at
  // the first blank line OR the first line that is clearly lyrics (no known header).
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    const t = /^\s*title:\s*(.+)$/i.exec(l);
    if (t) { title = t[1]!.trim(); continue; }
    const a = /^\s*(?:author|artist|by):\s*(.+)$/i.exec(l);
    if (a) { artist = (a[1] ?? "").trim() || null; continue; }
    if (l.trim() === "") {
      // A blank line after we saw a header ends the header block; otherwise skip
      // leading blank lines before a header-less body.
      if (title || artist) { i++; break; }
      continue;
    }
    break; // first non-blank, non-header line → body starts here
  }

  // Strip a trailing export extension a Title may carry (e.g. "let praises rise .pro").
  if (title) title = title.replace(/\s*\.(pro\d?|txt|ews|xml|json|pptx?|song)\s*$/i, "").trim();
  if (!title && fileName) title = fileName.replace(/\.[^.]+$/, "").trim();

  const slides = lines.slice(i).join("\n")
    .split(/\n[ \t]*\n+/)         // one-or-more blank lines = slide break
    .map((s) => s.replace(/\s+$/g, "").replace(/^\n+/, "").trim())
    .filter((s) => s.length > 0);

  return { title: title || "Untitled song", artist, slides };
}
