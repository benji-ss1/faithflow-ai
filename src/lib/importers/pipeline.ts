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
import { parsePlaylistManifest, orderByManifest, type ParsedManifest } from "../propresenter-manifest";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per song file
// NOTE (2026-09-22 scaling audit): this is a LOCAL safety cap for the
// in-process unzip, NOT an achievable upload size. The platform refuses a
// request body far smaller than this, so a 500 MB bundle can never arrive
// here in one piece — the client strips and CHUNKS first (see
// WizardClient's MAX_UPLOAD_BYTES). Kept generous because the Electron
// desktop path can hand us a large local bundle directly.
const MAX_BUNDLE_BYTES = 500 * 1024 * 1024;
const MAX_BUNDLE_ENTRIES = 8000; // guard against zip bombs; fits a full ~6600-song ProPresenter library with headroom

export type PipelineInput = { path: string; contents: Buffer }[];

export type PipelineOutput = {
  songs: ParsedSong[];
  logoCandidates: { fileName: string; contents: Buffer; mimeType: string; confidence: number }[];
  mediaAssets: { fileName: string; contents: Buffer; mimeType: string }[];
  byParser: Record<string, { examined: number; imported: number; skipped: number }>;
  warnings: { file: string; warnings: string[] }[];
  /**
   * Playlist name + service order, when the container carried a `data`
   * manifest we could read. `songs` is already sorted to match. Null for a
   * loose file drop or an unreadable manifest — callers must treat this as
   * optional enrichment, never a requirement.
   */
  playlist: { name: string | null; itemCount: number } | null;
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

/**
 * ProPresenter ZIP-container extensions.
 *
 * ProPresenter exports several different archives that are all plain ZIPs
 * holding `.pro` documents plus a protobuf manifest:
 *   - `.proBundle`   — a presentation + its media
 *   - `.proPlaylist` — a service/playlist export (verified against a real
 *     Kings Court "Sept 20.proPlaylist": 7 `.pro` docs + `data` manifest +
 *     empty `Media/` and `PDF/` folders)
 *   - `.prolib` / `.proLibrary` — a whole library export
 *   - `.protheme` / `.proThemeBundle` — theme exports
 *
 * Before this list existed only `.proBundle` and `.zip` were unzipped, so a
 * `.proPlaylist` fell through to the per-file parsers, matched none of them,
 * and imported ZERO songs. The parsers themselves were always fine — the
 * same file renamed to `.zip` imported all 7 songs correctly.
 */
const PRO_CONTAINER_RX = /\.(proBundle|proPlaylist|prolib|proLibrary|protheme|proThemeBundle)$/i;

/** True if the file is a ProPresenter bundle we should try to unzip. */
function isProBundleFile(path: string, buf: Buffer): boolean {
  if (PRO_CONTAINER_RX.test(path)) return isZipBuffer(buf);
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
      const bundleName = (f.path.split(/[/\\]/).pop() || f.path).replace(PRO_CONTAINER_RX, "").replace(/\.zip$/i, "");
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
    playlist: null,
  };
  const seenTitles = new Map<string, ParsedSong>(); // dedupe by title within batch

  // Expand .proBundle ZIPs into their member files first. Non-bundle files
  // pass through unchanged. Bundle-level warnings (corrupt zip, oversize)
  // are attached to the aggregate output.
  const expansion = expandProBundles(input);
  if (expansion.warnings.length) output.warnings.push(...expansion.warnings);
  const files = expansion.files;

  // A ProPresenter container carries its playlist order in a protobuf file
  // literally named `data`. Read it first so we can re-sort the songs into
  // SERVICE order at the end; ZIP entry order is alphabetical, which is not
  // the order the worship team planned.
  //
  // Scoped PER CONTAINER (keyed by the folder prefix `expandProBundles` adds),
  // because dropping two playlists at once must not reorder one by the other's
  // manifest — that silently scrambled the second service.
  const manifests = new Map<string, ParsedManifest>();
  for (const file of files) {
    const parts = file.path.split(/[/\\]/);
    if (parts[parts.length - 1] !== "data") continue;
    const prefix = parts.slice(0, -1).join("/");
    if (manifests.has(prefix)) continue;
    const m = parsePlaylistManifest(file.contents);
    if (m.items.length > 0) manifests.set(prefix, m);
  }

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

  // Re-sort into playlist order, per container.
  //
  // Songs keep their container grouping (a song is only ranked by the manifest
  // of the bundle it came from), and anything a manifest doesn't mention is
  // appended in its original order — so this can only ever REORDER, never lose
  // or duplicate, a song.
  if (manifests.size > 0) {
    const containerOf = (song: ParsedSong) => {
      const parts = (song.sourceRef || "").split(/[/\\]/);
      return parts.slice(0, -1).join("/");
    };
    const basenameOf = (song: ParsedSong) => {
      const base = (song.sourceRef || song.title).split(/[/\\]/).pop() || song.title;
      return base.replace(/\.(pro|pro6|pro5|pro7|pro7x)$/i, "");
    };
    // Preserve the order the containers themselves first appeared.
    const order: string[] = [];
    const groups = new Map<string, ParsedSong[]>();
    for (const song of output.songs) {
      const key = containerOf(song);
      if (!groups.has(key)) { groups.set(key, []); order.push(key); }
      groups.get(key)!.push(song);
    }
    const resorted: ParsedSong[] = [];
    for (const key of order) {
      const group = groups.get(key)!;
      const m = manifests.get(key);
      resorted.push(...(m ? orderByManifest(group, m, basenameOf) : group));
    }
    output.songs = resorted;

    // Report the playlist only when the batch is ONE container — naming a
    // multi-playlist drop after whichever came first would be a lie.
    if (manifests.size === 1) {
      const only = manifests.values().next().value as ParsedManifest;
      output.playlist = { name: only.name, itemCount: only.items.length };
    }
    for (const m of manifests.values()) {
      if (m.warnings.length) output.warnings.push({ file: "data", warnings: m.warnings });
    }
  }
  return output;
}
