/**
 * Proclaim (Faithlife) parser.
 *
 * Target format:
 *   - Extensions: `.json` (per-item), `.proclaim` or `.zip` (bulk archive)
 *   - Container: ZIP archives typically contain a `manifest.json` and
 *     one JSON file per service item.
 *   - Encoding: UTF-8 JSON.
 *
 * Format source: Faithlife has not published an official schema for the
 * Proclaim export JSON. Our field mapping is derived from real exports
 * shared by community users (title/name, author/artist, stanzas[]/slides[],
 * type=="song"). All mapping is best-effort.
 *
 * CAN parse:
 *   - Single `.json` files whose top-level type is a song (or that expose
 *     a `stanzas[]` / `slides[]` / `content` payload).
 *   - `.zip` / `.proclaim` archives — every internal `.json` is inspected
 *     and merged into the result.
 *
 * CANNOT parse:
 *   - Media assets (extracted separately by the wizard).
 *   - Non-song service items (announcements, videos) — silently ignored.
 *
 * Field verification:
 *   - title, slides: best-effort (not verified against an official schema).
 *   - artist: best-effort (falls back to null).
 *
 * Safety:
 *   - Every zip passes through `inspectZip` (entry cap, uncompressed cap,
 *     path traversal).
 *   - JSON is decoded via `safeJsonParse` which rejects prototype-pollution
 *     payloads (`__proto__`, `constructor`, `prototype` keys).
 *   - Strict UTF-8 decoding.
 *   - Never throws; per-entry failures land in skipped[].
 */

import type { Parser, ParseResult, ParsedSong } from "./index";
import AdmZip from "adm-zip";
import { inspectZip, safeJsonParse, decodeUtf8Strict } from "./safety";

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
          let zip: AdmZip;
          try {
            zip = new AdmZip(f.buffer);
          } catch (e) {
            skipped.push({ file: f.name, reason: `Invalid zip: ${e instanceof Error ? e.message : "unknown"}` });
            continue;
          }
          const inspect = inspectZip(zip);
          if (!inspect.ok) {
            skipped.push({ file: f.name, reason: inspect.reason });
            continue;
          }
          let parsedAny = false;
          for (const e of inspect.entries) {
            if (e.isDirectory) continue;
            if (!/\.json$/i.test(e.entryName)) continue;
            let text: string;
            try {
              text = decodeUtf8Strict(e.getData());
            } catch {
              skipped.push({ file: `${f.name}:${e.entryName}`, reason: "Entry is not valid UTF-8" });
              continue;
            }
            const parsedJson = safeJsonParse(text);
            if (!parsedJson.ok) {
              skipped.push({ file: `${f.name}:${e.entryName}`, reason: parsedJson.reason });
              continue;
            }
            const song = extractSong(parsedJson.value, `${f.name}:${e.entryName}`);
            if (song) { songs.push(song); parsedAny = true; }
          }
          if (!parsedAny) {
            skipped.push({ file: f.name, reason: "No song JSON entries recognized inside archive" });
          }
        } else if (/\.json$/i.test(f.name)) {
          let text: string;
          try {
            text = decodeUtf8Strict(f.buffer);
          } catch {
            skipped.push({ file: f.name, reason: "File is not valid UTF-8" });
            continue;
          }
          const parsedJson = safeJsonParse(text);
          if (!parsedJson.ok) {
            skipped.push({ file: f.name, reason: parsedJson.reason });
            continue;
          }
          const song = extractSong(parsedJson.value, f.name);
          if (song) songs.push(song);
          else skipped.push({ file: f.name, reason: "JSON did not match Proclaim song shape" });
        }
      } catch (e) {
        skipped.push({ file: f.name, reason: e instanceof Error ? e.message : "Parse failed" });
      }
    }
    return { songs, media: [], skipped };
  },
};
