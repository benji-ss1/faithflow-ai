// Proclaim (Faithlife) parser.
//
// Proclaim exports individual service items as JSON files, or bulk-exports
// whole presentations as .zip archives containing a `manifest.json`. This
// parser handles both:
//   - Raw .json with `type === "song"` (or nested `kind: "song"`) is parsed
//     for `title`, `author`, and slides in `stanzas[]` / `slides[]` / `content`.
//   - .zip archives are unpacked and each internal .json is parsed the same way.
//
// The Proclaim JSON schema is not officially published, so we best-effort
// map common fields and record everything else as a warning. Bad files are
// skipped (never crash).

import type { Parser, ParseResult, ParsedSong } from "./index";
import AdmZip from "adm-zip";

type LooseSong = {
  type?: string;
  kind?: string;
  title?: string;
  name?: string;
  author?: string;
  artist?: string;
  stanzas?: Array<{ text?: string; lyrics?: string; content?: string }>;
  slides?: Array<{ text?: string; content?: string; body?: string }>;
  content?: string;
  lyrics?: string;
};

function extractSong(raw: unknown, sourceFile: string): ParsedSong | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as LooseSong;
  const type = (obj.type || obj.kind || "").toString().toLowerCase();
  if (type && !/(song|lyric|hymn)/.test(type)) return null;

  const title = (obj.title || obj.name || "").toString().trim();
  if (!title) return null;

  const artist = (obj.author || obj.artist || null) as string | null;
  const slides: string[] = [];
  if (Array.isArray(obj.stanzas)) {
    for (const s of obj.stanzas) {
      const t = (s.text || s.lyrics || s.content || "").toString().trim();
      if (t) slides.push(t);
    }
  }
  if (slides.length === 0 && Array.isArray(obj.slides)) {
    for (const s of obj.slides) {
      const t = (s.text || s.content || s.body || "").toString().trim();
      if (t) slides.push(t);
    }
  }
  if (slides.length === 0) {
    const bulk = (obj.content || obj.lyrics || "").toString().trim();
    if (bulk) {
      for (const block of bulk.split(/\n\s*\n+/)) {
        const t = block.trim();
        if (t) slides.push(t);
      }
    }
  }
  if (slides.length === 0) return null;

  return { title, artist, slides, warnings: [], sourceFile };
}

export const proclaimParser: Parser = {
  id: "proclaim",
  label: "Proclaim (Faithlife)",
  detect(files) {
    let score = 0;
    for (const f of files) {
      if (/manifest\.json$/i.test(f.name)) score += 0.6;
      if (/\.proclaim$/i.test(f.name)) score += 0.9;
      if (/\.json$/i.test(f.name)) score += 0.05;
    }
    return Math.min(1, score);
  },
  async parse(files): Promise<ParseResult> {
    const songs: ParsedSong[] = [];
    const skipped: { file: string; reason: string }[] = [];

    for (const f of files) {
      try {
        if (/\.zip$|\.proclaim$/i.test(f.name)) {
          // Attempt to unzip and read internal .json files.
          const zip = new AdmZip(f.buffer);
          const entries = zip.getEntries();
          let parsedAny = false;
          for (const e of entries) {
            if (e.isDirectory) continue;
            if (!/\.json$/i.test(e.entryName)) continue;
            try {
              const text = e.getData().toString("utf8");
              const parsed = JSON.parse(text);
              const song = extractSong(parsed, `${f.name}:${e.entryName}`);
              if (song) { songs.push(song); parsedAny = true; }
            } catch {
              skipped.push({ file: `${f.name}:${e.entryName}`, reason: "Invalid JSON inside archive" });
            }
          }
          if (!parsedAny) {
            skipped.push({ file: f.name, reason: "No song JSON entries recognized inside archive" });
          }
        } else if (/\.json$/i.test(f.name)) {
          const parsed = JSON.parse(f.buffer.toString("utf8"));
          const song = extractSong(parsed, f.name);
          if (song) songs.push(song);
          else skipped.push({ file: f.name, reason: "JSON did not match Proclaim song shape" });
        } else {
          // Non-JSON, non-zip — silently ignore
        }
      } catch (e) {
        skipped.push({ file: f.name, reason: e instanceof Error ? e.message : "Parse failed" });
      }
    }
    return { songs, media: [], skipped };
  },
};
