// Pipeline runner. Feeds a batch of files through every parser in the
// registry, aggregates results, dedupes songs on title within the batch,
// and returns a structured report.
//
// SECURITY: Files come from user uploads and can be adversarial. Every
// parser is expected to be a pure function that never throws on bad
// input. The pipeline additionally caps per-file size to protect against
// zip-bomb-style attacks (10 MB per file is generous for a song XML —
// exports typically live under 200 KB).

import type { ImportedItem, Parser, ParsedSong } from "./types";
import { PARSERS } from "./registry";
import AdmZip from "adm-zip";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per song file
const MAX_BUNDLE_BYTES = 500 * 1024 * 1024; // 500 MB per .proBundle
const MAX_BUNDLE_ENTRIES = 5000; // guard against zip bombs

export type PipelineInput = { path: string; contents: Buffer }[];

export type PipelineOutput = {
  songs: ParsedSong[];
  logoCandidates: { fileName: string; contents: Buffer; mimeType: string; confidence: number }[];
  mediaAssets: { fileName: string; contents: Buffer; mimeType: string }[];
  byParser: Record<string, { examined: number; imported: number; skipped: number }>;
  warnings: { file: string; warnings: string[] }[];
};

const LOGO_PATTERNS = [
  /logo/i, /brand/i, /church.*mark/i, /wordmark/i, /header/i, /favicon/i,
];

function detectLogoConfidence(path: string): number {
  const lower = path.toLowerCase();
  const name = lower.split(/[/\\]/).pop() || "";
  const dir = lower.slice(0, -name.length);
  let score = 0;
  for (const rx of LOGO_PATTERNS) if (rx.test(name)) score += 60;
  // In a "branding", "logos", "brand" folder → strong signal
  if (/(^|\/|\\)(branding|logos?|brand|assets\/logos?)(\/|\\)/.test(dir)) score += 30;
  // Small file size (< 500 KB) + png/svg is more logo-like than a 4MB photo
  return Math.min(100, score);
}

function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  return "application/octet-stream";
}

function isImage(name: string): boolean { return /\.(png|jpe?g|svg|webp|gif)$/i.test(name); }
function isVideo(name: string): boolean { return /\.(mp4|webm|mov)$/i.test(name); }

/** ZIP magic bytes — every valid ZIP (including .proBundle) starts with these. */
function isZipBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/** True if the file is a ProPresenter bundle we should try to unzip. */
function isProBundleFile(path: string, buf: Buffer): boolean {
  if (/\.proBundle$/i.test(path)) return isZipBuffer(buf);
  // Also treat any generic .zip that contains .pro/.pro6 as a proBundle.
  if (/\.zip$/i.test(path) && isZipBuffer(buf)) return true;
  return false;
}

type BundleExpansionResult = {
  files: { path: string; contents: Buffer }[];
  warnings: { file: string; warnings: string[] }[];
};

/**
 * Expand every .proBundle in the input to its member files. Non-bundle
 * files pass through unchanged. Errors and oversize entries are logged
 * as warnings instead of throwing — one bad bundle never fails the batch.
 */
export function expandProBundles(input: PipelineInput): BundleExpansionResult {
  const files: { path: string; contents: Buffer }[] = [];
  const warnings: { file: string; warnings: string[] }[] = [];

  for (const f of input) {
    if (!isProBundleFile(f.path, f.contents)) {
      files.push(f);
      continue;
    }
    if (f.contents.length > MAX_BUNDLE_BYTES) {
      warnings.push({ file: f.path, warnings: [`Bundle exceeds ${MAX_BUNDLE_BYTES / 1024 / 1024} MB size cap`] });
      continue;
    }
    try {
      const zip = new AdmZip(f.contents);
      const entries = zip.getEntries();
      if (entries.length > MAX_BUNDLE_ENTRIES) {
        warnings.push({ file: f.path, warnings: [`Bundle contains ${entries.length} entries (max ${MAX_BUNDLE_ENTRIES}) — skipped`] });
        continue;
      }
      const bundleName = (f.path.split(/[/\\]/).pop() || f.path).replace(/\.(proBundle|zip)$/i, "");
      let added = 0;
      for (const e of entries) {
        if (e.isDirectory) continue;
        // Skip Apple resource forks + hidden metadata files.
        if (/(^|\/)\._/.test(e.entryName) || /__MACOSX/.test(e.entryName) || /\.DS_Store$/.test(e.entryName)) continue;
        try {
          const data = e.getData();
          if (!data || data.length === 0) continue;
          if (data.length > MAX_FILE_BYTES && !/\.(mp4|mov|webm|jpe?g|png|gif|webp)$/i.test(e.entryName)) {
            // Non-media entries over 10MB are almost certainly not lyric docs.
            warnings.push({ file: `${bundleName}/${e.entryName}`, warnings: [`Entry too large — skipped`] });
            continue;
          }
          files.push({ path: `${bundleName}/${e.entryName}`, contents: data });
          added++;
        } catch (entryErr) {
          warnings.push({
            file: `${bundleName}/${e.entryName}`,
            warnings: [`Could not extract entry: ${entryErr instanceof Error ? entryErr.message : "unknown error"}`],
          });
        }
      }
      if (added === 0) {
        warnings.push({ file: f.path, warnings: ["Bundle contained no usable entries"] });
      }
    } catch (err) {
      warnings.push({
        file: f.path,
        warnings: [`Bundle appears damaged — try re-exporting from ProPresenter (${err instanceof Error ? err.message : "unknown error"})`],
      });
    }
  }
  return { files, warnings };
}

export function runImportPipeline(input: PipelineInput): PipelineOutput {
  const output: PipelineOutput = {
    songs: [],
    logoCandidates: [],
    mediaAssets: [],
    byParser: Object.fromEntries(PARSERS.map((p) => [p.id, { examined: 0, imported: 0, skipped: 0 }])),
    warnings: [],
  };
  const seenTitles = new Map<string, ParsedSong>(); // dedupe by title within batch

  // Expand .proBundle ZIPs into their member files first. Non-bundle files
  // pass through unchanged. Bundle-level warnings (corrupt zip, oversize)
  // are attached to the aggregate output.
  const expansion = expandProBundles(input);
  if (expansion.warnings.length) output.warnings.push(...expansion.warnings);
  const files = expansion.files;

  for (const file of files) {
    if (file.contents.length > MAX_FILE_BYTES) {
      output.warnings.push({ file: file.path, warnings: [`Skipped: file exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB size cap`] });
      continue;
    }

    // Media / logo detection — happens independent of song parsers
    if (isImage(file.path)) {
      const conf = detectLogoConfidence(file.path);
      const name = file.path.split(/[/\\]/).pop() || file.path;
      if (conf >= 60) {
        output.logoCandidates.push({ fileName: name, contents: file.contents, mimeType: guessMime(name), confidence: conf });
      } else {
        output.mediaAssets.push({ fileName: name, contents: file.contents, mimeType: guessMime(name) });
      }
      continue;
    }
    if (isVideo(file.path)) {
      const name = file.path.split(/[/\\]/).pop() || file.path;
      output.mediaAssets.push({ fileName: name, contents: file.contents, mimeType: guessMime(name) });
      continue;
    }

    // Song parsers
    let parsedByAny = false;
    for (const parser of PARSERS) {
      if (!parser.match(file.path)) continue;
      const acc = output.byParser[parser.id]!;
      acc.examined++;
      const items = parser.parseFile(file.path, file.contents);
      if (items.length === 0) { acc.skipped++; continue; }
      for (const item of items) {
        if (item.kind === "skip") {
          acc.skipped++;
          output.warnings.push({ file: file.path, warnings: item.warnings });
          parsedByAny = true; // parser handled the file, just couldn't import it
          continue;
        }
        if (item.kind !== "song") continue;
        parsedByAny = true;
        const key = item.song.title.trim().toLowerCase();
        if (seenTitles.has(key)) {
          acc.skipped++;
          output.warnings.push({ file: file.path, warnings: [`Duplicate of "${item.song.title}" already parsed in this batch`] });
          continue;
        }
        seenTitles.set(key, item.song);
        output.songs.push(item.song);
        acc.imported++;
        if (item.song.warnings.length) output.warnings.push({ file: file.path, warnings: item.song.warnings });
      }
      break; // first matching parser wins per file
    }
    if (!parsedByAny) {
      // Might just be a metadata file (playlists.xml, index.json, etc)
      // — silently ignore unless requested to log
    }
  }
  return output;
}
