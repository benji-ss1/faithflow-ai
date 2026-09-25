/**
 * Watched media folders — the pure reconcile logic.
 *
 * A watched library mirrors a folder on the operator's computer (ProPresenter
 * calls this a "Smart Playlist"). Reconciling is deliberately a DIFF, not an
 * event stream: we list the folder, compare it with what the library already
 * holds, and emit the actions. That is self-healing — a missed event, a sleep,
 * a USB drive reconnecting all resolve on the next pass, where an event-based
 * watcher would silently drift.
 *
 * This module is pure and has no DB, filesystem or Electron imports, so the
 * decision rules are unit-testable in isolation. See
 * `docs/WATCHED_MEDIA_FOLDERS.md` for why the design is shaped this way.
 */

/** A file seen on disk, as `fs:readDirRecursive` returns it. */
export type DiskFile = {
  /** Absolute path — used only to read the bytes. */
  absPath: string;
  /** Path relative to the watched folder. The reconcile IDENTITY. */
  relPath: string;
  size: number;
};

/** A media asset already in the watched library. */
export type LibraryAsset = {
  id: string;
  fileName: string;
  sizeBytes: number;
  /** Where it came from; null for anything not synced from this folder. */
  sourceRelPath: string | null;
};

export type ReconcilePlan = {
  /** On disk, not in the library yet → upload. */
  toUpload: DiskFile[];
  /**
   * In the library but no longer on disk → un-file (library_id = NULL).
   * NEVER delete: see the deletion note below.
   */
  toUnfile: LibraryAsset[];
  /** Present and unchanged — reported so the UI can say "nothing to do". */
  unchanged: number;
};

/**
 * Media we will sync. Kept in step with the server-side allowlist in
 * `/api/media/presign`; anything else in the folder is ignored rather than
 * rejected, because a watched folder legitimately contains other files
 * (.DS_Store, project files, notes).
 *
 * Audio is excluded: `listMedia` already filters audio out of every surface
 * except the Media Bin, so syncing it would produce assets that mostly cannot
 * be used. Revisit alongside the Audio Bin.
 */
export const WATCHED_EXTENSIONS = [
  "jpg", "jpeg", "png", "webp", "gif", "avif",
  "mp4", "webm", "mov",
] as const;

/** Files an OS scatters through folders that must never become media. */
const IGNORED_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

/** True if this on-disk file is one we should sync. */
export function isSyncableFile(relPath: string): boolean {
  const name = relPath.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (!name || name.startsWith(".")) return false;      // dotfiles + resource forks
  if (IGNORED_NAMES.has(name)) return false;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return (WATCHED_EXTENSIONS as readonly string[]).includes(ext);
}

/** Normalise a relative path for DISPLAY/STORAGE (separators only). */
export function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/**
 * The key two paths are COMPARED on.
 *
 * Two corrections that were each re-uploading the same file on every single
 * sync until a review caught them:
 *
 *  - **Unicode form.** macOS stores filenames decomposed (NFD): "café.jpg" is
 *    `cafe` + a combining accent. The same name from the database or another
 *    API is usually composed (NFC). Those strings are NOT equal in JS, so the
 *    file looked new forever. Normalising to NFC makes both forms one key.
 *  - **Case.** macOS and Windows filesystems are case-insensitive, so renaming
 *    "photo.jpg" to "Photo.JPG" is the SAME file — but a case-sensitive compare
 *    saw a new one and duplicated it. We ship only mac and Windows desktop
 *    builds, so comparing case-insensitively is correct here. (It would be
 *    wrong on Linux, where those are genuinely two files — noted deliberately
 *    in case a Linux build ever happens.)
 *
 * The ORIGINAL casing is still what we store and display; only the comparison
 * is folded.
 */
export function relPathKey(relPath: string): string {
  return normalizeRelPath(relPath).normalize("NFC").toLowerCase();
}

/**
 * Decide what to do, given the folder contents and the library contents.
 *
 * Identity is the RELATIVE PATH, not the file name: two files can share a
 * basename in different sub-folders, and a display name can be edited in-app
 * without breaking the link to its source.
 *
 * A file whose SIZE changed is deliberately NOT re-uploaded. Re-uploading
 * would mint a second asset while the first is still referenced by service
 * plans, themes and slides — replacing content under a live plan is a bigger
 * decision than a folder sync should make on its own. It stays as it is.
 */
export function reconcile(disk: DiskFile[], library: LibraryAsset[]): ReconcilePlan {
  const onDisk = new Map<string, DiskFile>();
  for (const f of disk) {
    const rel = normalizeRelPath(f.relPath);
    if (!rel || !isSyncableFile(rel)) continue;
    // Keyed case/unicode-insensitively, but the STORED relPath keeps the real
    // spelling so the operator sees their own filename.
    const key = relPathKey(rel);
    if (!onDisk.has(key)) onDisk.set(key, { ...f, relPath: rel });
  }

  const known = new Set<string>();
  const toUnfile: LibraryAsset[] = [];
  let unchanged = 0;

  for (const asset of library) {
    // An asset with no source path was added by hand (dragged in before the
    // folder was watched). It is not ours to un-file.
    if (!asset.sourceRelPath) continue;
    const rel = relPathKey(asset.sourceRelPath);
    if (onDisk.has(rel)) {
      known.add(rel);
      unchanged++;
    } else {
      toUnfile.push(asset);
    }
  }

  const toUpload: DiskFile[] = [];
  for (const [key, f] of onDisk) if (!known.has(key)) toUpload.push(f);
  // Stable, human order so progress reads sensibly and tests are deterministic.
  toUpload.sort((a, b) => a.relPath.localeCompare(b.relPath));

  return { toUpload, toUnfile, unchanged };
}

/** One-line summary for the operator. Honest when nothing happened. */
export function describePlan(plan: ReconcilePlan): string {
  const bits: string[] = [];
  if (plan.toUpload.length) bits.push(`${plan.toUpload.length} to add`);
  if (plan.toUnfile.length) bits.push(`${plan.toUnfile.length} no longer in the folder`);
  if (bits.length === 0) return `Up to date — ${plan.unchanged} file${plan.unchanged === 1 ? "" : "s"}`;
  return bits.join(", ");
}
