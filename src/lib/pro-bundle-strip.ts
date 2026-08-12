// Shared browser-side ProPresenter bundle media-stripper.
//
// A ProPresenter .probundle / .pro7x / .zip is a zip that bundles the (tiny)
// lyric documents AND their (huge) media backgrounds. A single "song" file the
// user drags in is often a whole LIBRARY export — one real 171 MB .probundle
// held 559 songs but only 5.4 MB of lyrics; the other 158 MB was media. Uploading
// that (either base64 into a server action, or multipart to /api/imports/parse)
// blows the size limits and the import fails with a generic error.
//
// This strips media IN THE BROWSER — unzip and keep ONLY the small non-media
// documents — so the server receives KB of lyrics instead of hundreds of MB.
// PresentFlow imports lyrics only anyway (backgrounds are re-themed in-app).
// Used by BOTH import UIs (ProPresenterImportDialog server-action path and the
// Import Wizard multipart path) so neither can regress to shipping raw media.

export type StrippedDoc = { path: string; bytes: Uint8Array };

export type StripResult = {
  docs: StrippedDoc[];
  /** number of zip bundles that yielded ≥1 doc */
  expandedFrom: number;
  /** media/oversized entries skipped */
  skippedMedia: number;
  /** true if a cap (entry count / total bytes / raw input) forced truncation */
  truncated: boolean;
  /** whole files skipped (too large / unreadable) */
  skippedFiles: string[];
};

const MEDIA_EXT_RE = /\.(mp4|mov|m4v|webm|avi|mkv|jpe?g|png|gif|webp|heic|tiff?|bmp|svg|mp3|m4a|aac|wav|aiff?|caf|pdf|ttf|otf|woff2?)$/i;
const JUNK_RE = /(^|\/)\._|__MACOSX|\.DS_Store$/;
const ZIP_EXT_RE = /\.(probundle|pro7x|zip)$/i;
const MAX_DOC_BYTES = 10 * 1024 * 1024;          // a lyric doc over 10MB is not lyrics
const MAX_RAW_INPUT_BYTES = 600 * 1024 * 1024;   // refuse to buffer an absurd file
const MAX_KEPT_ENTRIES = 20000;                   // mirrors/exceeds server bundle-entry cap
const MAX_TOTAL_DECOMP_BYTES = 80 * 1024 * 1024; // cap total lyrics decompression (zip-bomb guard)

async function unzipFiltered(
  bytes: Uint8Array,
  filter: (f: { name: string; originalSize: number }) => boolean,
): Promise<Record<string, Uint8Array>> {
  const fflate = await import("fflate");
  // SYNCHRONOUS unzip on purpose. fflate's async API spawns a Web Worker from a
  // blob URL; that is fragile across the environments we actually run in
  // (packaged Electron with a strict CSP, some Node contexts) and was observed
  // to throw an uncatchable async worker error — silently defeating the whole
  // media-strip and leaving the import broken. unzipSync needs no worker and
  // runs the same everywhere. It briefly blocks the thread while decompressing
  // the (small, media-filtered) lyric docs — a one-off import behind a spinner,
  // so reliability wins over smoothness. The `filter` still runs before each
  // entry's decompression, so media is never inflated. A corrupt/non-zip input
  // throws here and is handled by the caller's try/catch.
  return fflate.unzipSync(bytes, { filter });
}

/** Expand any ProPresenter bundles among `files` into their lyrics-only docs.
 *  Bare .pro/.pro6/.pro7 files pass through unchanged. */
export async function stripProBundles(files: File[]): Promise<StripResult> {
  const docs: StrippedDoc[] = [];
  let expandedFrom = 0;
  let skippedMedia = 0;
  let truncated = false;
  const skippedFiles: string[] = [];

  for (const f of files) {
    if (!ZIP_EXT_RE.test(f.name)) {
      // Bare .pro / .pro6 / .pro7 document — already just lyrics; keep as-is.
      if (f.size > MAX_DOC_BYTES) { skippedFiles.push(f.name); continue; }
      docs.push({ path: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      continue;
    }
    if (f.size > MAX_RAW_INPUT_BYTES) { skippedFiles.push(f.name); truncated = true; continue; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    let admittedBytes = 0;
    let admittedCount = 0;
    let entries: Record<string, Uint8Array>;
    try {
      entries = await unzipFiltered(bytes, (file) => {
        if (file.name.endsWith("/") || JUNK_RE.test(file.name)) return false;
        if (MEDIA_EXT_RE.test(file.name)) { skippedMedia++; return false; }
        if (file.originalSize > MAX_DOC_BYTES) { skippedMedia++; return false; }
        if (admittedCount >= MAX_KEPT_ENTRIES) { truncated = true; return false; }
        if (admittedBytes + file.originalSize > MAX_TOTAL_DECOMP_BYTES) { truncated = true; return false; }
        admittedBytes += file.originalSize;
        admittedCount++;
        return true;
      });
    } catch {
      // Not a zip (or corrupt) — keep the raw file only if it's small enough.
      if (f.size <= MAX_DOC_BYTES) docs.push({ path: f.name, bytes });
      else skippedFiles.push(f.name);
      continue;
    }
    const bundle = f.name.replace(ZIP_EXT_RE, "");
    let kept = 0;
    for (const [name, data] of Object.entries(entries)) {
      if (!data || data.length === 0) continue;
      docs.push({ path: `${bundle}/${name}`, bytes: data });
      kept++;
    }
    if (kept > 0) expandedFrom++;
  }
  return { docs, expandedFrom, skippedMedia, truncated, skippedFiles };
}

/** Chunk stripped docs into batches whose raw byte total stays under `maxBytes`
 *  (so each upload request is comfortably under the server body limit). A single
 *  doc larger than maxBytes still gets its own (over-limit) batch rather than
 *  being dropped — callers surface that case. */
export function chunkDocsByBytes(docs: StrippedDoc[], maxBytes: number): StrippedDoc[][] {
  const batches: StrippedDoc[][] = [];
  let cur: StrippedDoc[] = [];
  let curBytes = 0;
  for (const d of docs) {
    if (cur.length > 0 && curBytes + d.bytes.length > maxBytes) {
      batches.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(d);
    curBytes += d.bytes.length;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}
