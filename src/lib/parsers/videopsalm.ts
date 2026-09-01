/**
 * VideoPsalm parser.
 *
 * Target format:
 *   - VideoPsalm (videopsalm.org) is free church presentation software with a
 *     large installed base (esp. international / African churches). Songbooks
 *     export as `.json` (the older `.vpc` is a PASSWORD-protected ZIP we cannot
 *     open — we surface a clear "export to JSON instead" message for those).
 *
 * File shape (confirmed against OpenLP's VideoPsalm importer):
 *   { "Text": "<songbook name>", "Songs": [ {
 *       "Text": "<song title>",           // NB: the song's title, not lyrics
 *       "Author": "...", "Composer": "...",
 *       "Copyright": "...", "CCLI": "...", "Theme": "...",
 *       "Verses": [ { "Text": "<verse lyrics>" }, ... ]   // one slide per verse
 *   } ] }
 *
 * VideoPsalm writes "almost JSON": object keys are UNQUOTED and string values
 * contain RAW newlines + control chars (both invalid JSON). We normalise with a
 * quote-aware scan before JSON.parse (same fix OpenLP applies).
 *
 * CAN parse: `.json` songbooks (single or many, batched).
 * CANNOT parse: `.vpc` (encrypted archive) → skipped with export guidance.
 *
 * Safety: strict UTF-8 decode; never throws per-file (failures → skipped[]);
 * no external entities (plain JSON, no XML). Verse type tags are not needed —
 * each `Verses[]` entry is already one slide.
 */
import type { Parser, ParseResult, ParsedSong } from "./index";
import { decodeUtf8Strict } from "./safety";

/**
 * Normalise VideoPsalm's "almost JSON" to strict JSON with a single quote-aware
 * pass: escape raw newlines + control chars INSIDE string values, and wrap
 * UNQUOTED object keys in quotes (leaving true/false/null and numbers alone).
 */
export function normalizeVideoPsalmJson(raw: string): string {
  let out = "";
  let inStr = false;
  let prev = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (c === '"' && prev !== "\\") { inStr = false; out += c; prev = c; continue; }
      if (c === "\n" || c === "\r") { out += "\\n"; prev = c; continue; }
      if (c.charCodeAt(0) < 32) { out += " "; prev = c; continue; } // control char → space
      out += c; prev = c; continue;
    }
    // outside a string
    if (c === '"') { inStr = true; out += c; prev = c; continue; }
    if (/[A-Za-z_]/.test(c)) {
      // gather a bareword; quote it only if it's an object KEY (next non-space ':')
      let j = i; let word = "";
      while (j < raw.length && /[A-Za-z0-9_]/.test(raw[j])) { word += raw[j]; j++; }
      let k = j;
      while (k < raw.length && (raw[k] === " " || raw[k] === "\t")) k++;
      if (raw[k] === ":") out += `"${word}"`;   // key → quote it
      else out += word;                          // value (true/false/null/…) → leave
      i = j - 1;
      prev = raw[j - 1] ?? "";
      continue;
    }
    out += c; prev = c;
  }
  return out;
}

// Light chord strip: remove inline chord markers like [G], [Am7], [C/E] on lyric
// lines (VideoPsalm sometimes embeds them). Conservative — only chord-shaped
// brackets, never arbitrary text.
function stripChords(s: string): string {
  return s
    .replace(/\[[A-G][#b]?(?:m|maj|min|sus|dim|aug|add)?\d?(?:\/[A-G][#b]?)?\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type VpSong = { Text?: unknown; Author?: unknown; Composer?: unknown; Copyright?: unknown; CCLI?: unknown; Verses?: unknown };

export const videopsalmParser: Parser = {
  id: "videopsalm",
  label: "VideoPsalm",
  detect(files) {
    const json = files.filter((f) => /\.json$/i.test(f.name)).length;
    const vpc = files.filter((f) => /\.vpc$/i.test(f.name)).length;
    if (json === 0 && vpc === 0) return 0;
    // Moderate confidence on extension alone (Proclaim also uses .json); the
    // user picks VideoPsalm explicitly in the wizard and parse() confirms shape.
    return vpc > 0 ? 0.55 : 0.45;
  },
  async parse(files) {
    const songs: ParsedSong[] = [];
    const skipped: { file: string; reason: string }[] = [];
    for (const f of files) {
      if (/\.vpc$/i.test(f.name)) {
        skipped.push({ file: f.name, reason: "VideoPsalm .vpc files are password-protected archives we can't open. In VideoPsalm: File → Export → JSON, then import that .json here." });
        continue;
      }
      if (!/\.json$/i.test(f.name)) continue; // leave non-json for other parsers
      try {
        const text = decodeUtf8Strict(f.buffer);
        let data: { Songs?: unknown };
        try { data = JSON.parse(text); }
        catch { data = JSON.parse(normalizeVideoPsalmJson(text)); }
        const arr = data?.Songs;
        if (!Array.isArray(arr)) {
          skipped.push({ file: f.name, reason: "Not a VideoPsalm songbook (no \"Songs\" array)." });
          continue;
        }
        for (const raw of arr as VpSong[]) {
          try {
            const title = String(raw?.Text ?? "").trim() || "Untitled";
            const artist = (String(raw?.Author ?? "").trim() || String(raw?.Composer ?? "").trim()) || null;
            const verses = Array.isArray(raw?.Verses) ? (raw.Verses as { Text?: unknown }[]) : [];
            const slides = verses
              .map((v) => stripChords(String(v?.Text ?? "")))
              .filter((s) => s.length > 0);
            const warnings: string[] = [];
            if (slides.length === 0) warnings.push("No verse text found — song imported with no slides.");
            songs.push({ title, artist, slides, warnings, sourceFile: f.name });
          } catch { /* skip one bad song, keep the rest */ }
        }
      } catch (e) {
        skipped.push({ file: f.name, reason: e instanceof Error ? e.message : "Could not read this file." });
      }
    }
    return { songs, media: [], skipped };
  },
};
