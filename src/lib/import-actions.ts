"use server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser } from "./session";
import { getDb } from "./db/client";
import { mediaAssets, settings, migrationJobs, songs } from "./db/schema";
import { runImportPipeline, type PipelineOutput } from "./importers/pipeline";
import { presignPut, isS3Configured, s3, BUCKET } from "./s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { getSongUsage } from "./song-limits";
import { getEffectiveSongLimit } from "./server/song-limits-server";
import { bulkInsertSongs } from "./song-bulk-insert";
import { generateImageThumbnail } from "./media-thumbnail";

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const MAX_TOTAL_BYTES = 250 * 1024 * 1024; // 250 MB total drop

export type FileDrop = { path: string; b64: string };

async function putBuffer(key: string, body: Buffer, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: BUCKET(), Key: key, Body: body, ContentType: contentType }));
}

/**
 * Bulk-import from a batch of files (client already unzipped folders /
 * flattened the drop). All files are base64 to survive server-action
 * transport. This action never fails the whole batch on one bad file —
 * it collects warnings and reports them.
 */
/**
 * Preview-only pass over the drop — parses everything, uploads nothing,
 * writes nothing. Powers the 4-step ProPresenter import dialog's preview
 * step so the user sees exactly what they're about to bring in (songs,
 * duplicates, background thumbnails) before committing.
 *
 * Duplicate detection is church-scoped: we compare parsed titles against
 * existing songs.title for this church so the UI can pre-uncheck rows the
 * user would otherwise import twice.
 */
export async function previewImportDrop(input: { drop: FileDrop[] }): Promise<Result<{
  songs: {
    title: string;
    artist: string | null;
    ccli: string | null;
    slidesPreview: string[]; // first 2 slides only — enough for the expandable preview
    slideCount: number;
    mediaHints: string[];
    isDuplicate: boolean;
    sourceRef?: string;
  }[];
  mediaCount: number;
  mediaSample: { fileName: string; kind: "image" | "video"; sizeBytes: number }[];
  warnings: { file: string; warnings: string[] }[];
  perParser: Record<string, { examined: number; imported: number; skipped: number }>;
}>> {
  const user = await requireUser();

  const total = input.drop.reduce((sum, f) => sum + Math.ceil(f.b64.length * 0.75), 0);
  if (total > MAX_TOTAL_BYTES) {
    return { ok: false, error: `Drop is too large (${Math.round(total / 1024 / 1024)} MB). Split into smaller batches.` };
  }
  if (input.drop.length === 0) return { ok: false, error: "No files provided" };
  if (input.drop.length > 5000) return { ok: false, error: "Too many files in one drop (max 5000)" };

  const buffers = input.drop.map((f) => ({ path: f.path, contents: Buffer.from(f.b64, "base64") }));
  const output: PipelineOutput = runImportPipeline(buffers);

  const db = getDb();
  const existingTitles = new Set(
    (await db.select({ title: songs.title }).from(songs).where(eq(songs.churchId, user.churchId))).map((r) => r.title.trim().toLowerCase()),
  );

  return {
    ok: true,
    data: {
      songs: output.songs.map((s) => ({
        title: s.title,
        artist: s.artist,
        ccli: s.ccli,
        slidesPreview: s.slides.slice(0, 2),
        slideCount: s.slides.length,
        mediaHints: s.mediaHints,
        isDuplicate: existingTitles.has(s.title.trim().toLowerCase()),
        sourceRef: s.sourceRef,
      })),
      mediaCount: output.mediaAssets.length,
      mediaSample: output.mediaAssets.slice(0, 20).map((m) => ({
        fileName: m.fileName,
        kind: m.mimeType.startsWith("video/") ? "video" as const : "image" as const,
        sizeBytes: m.contents.length,
      })),
      warnings: output.warnings,
      perParser: output.byParser,
    },
  };
}

export async function importDrop(input: {
  drop: FileDrop[];
  applyLogo?: string; // filename of the logo the user picked, optional
  /** Whitelist of song titles to actually insert. If omitted, all parsed songs are inserted. */
  onlyTitles?: string[];
}): Promise<Result<{
  added: number; skipped: number;
  mediaAdded: number;
  logoApplied: boolean;
  backgroundsLinked: number;
  logoCandidates: { fileName: string; confidence: number }[];
  warnings: { file: string; warnings: string[] }[];
  perParser: Record<string, { examined: number; imported: number; skipped: number }>;
}>> {
  const user = await requireUser();

  const total = input.drop.reduce((sum, f) => sum + Math.ceil(f.b64.length * 0.75), 0);
  if (total > MAX_TOTAL_BYTES) {
    return { ok: false, error: `Drop is too large (${Math.round(total / 1024 / 1024)} MB). Split into smaller batches.` };
  }
  if (input.drop.length === 0) return { ok: false, error: "No files provided" };
  if (input.drop.length > 5000) return { ok: false, error: "Too many files in one drop (max 5000)" };

  const buffers = input.drop.map((f) => ({ path: f.path, contents: Buffer.from(f.b64, "base64") }));
  const output: PipelineOutput = runImportPipeline(buffers);
  const db = getDb();

  // Same library-cap headroom gate as finalizeImport below — partial import
  // rather than all-or-nothing.
  const [__limit, __usage] = await Promise.all([getEffectiveSongLimit(user.churchId), getSongUsage(user.churchId)]);
  const remainingHeadroom = Math.max(0, __limit - __usage);

  // If the caller passed a whitelist (from the preview UI's per-song
  // checkboxes), keep only those titles. Empty whitelist = import nothing.
  const titleWhitelist = input.onlyTitles
    ? new Set(input.onlyTitles.map((t) => t.trim().toLowerCase()))
    : null;
  const songsToInsert = titleWhitelist
    ? output.songs.filter((s) => titleWhitelist.has(s.title.trim().toLowerCase()))
    : output.songs;

  const { added, skipped, limitSkipped } = await bulkInsertSongs(
    user.churchId,
    songsToInsert.map((s) => ({ title: s.title, artist: s.artist, slides: s.slides, source: "imported" as const })),
    remainingHeadroom,
  );
  // Never let a song-limit block be silent again (the old 50-song cap made a
  // full-library import report "0 imported" with no reason). Surface it.
  if (limitSkipped > 0) {
    output.warnings.push({ file: "Song limit", warnings: [`${limitSkipped} song(s) skipped — your song library limit (${__limit}) was reached. Remove songs or add a bundle, then re-import.`] });
  }

  // Media upload — only if S3 is configured. Anything else surfaces as a
  // warning rather than silently dropping. Every image also gets a 320x180
  // JPEG thumbnail uploaded next to it so the Media Browser + song row
  // previews don't fetch the full-size image. Videos ship without a
  // thumbnail (see media-thumbnail.ts for the rationale).
  //
  // We track fileName → mediaAssetId here so the linking pass below can
  // resolve ProPresenter's `mediaHints` (which are filenames, not paths)
  // back to the newly-inserted DB row.
  let mediaAdded = 0;
  const mediaByFileName = new Map<string, string>();
  if (output.mediaAssets.length > 0) {
    if (!isS3Configured()) {
      output.warnings.push({ file: "*", warnings: [`${output.mediaAssets.length} media file(s) not uploaded — S3 is not configured`] });
    } else {
      for (const m of output.mediaAssets) {
        try {
          const ext = m.fileName.split(".").pop() || "bin";
          const uuid = randomUUID();
          const key = `${user.churchId}/media/${uuid}.${ext}`;
          await putBuffer(key, m.contents, m.mimeType);
          const kind = m.mimeType.startsWith("video/") ? "video" as const : "image" as const;
          // Thumbnail (images only). Best-effort — a failed thumb never
          // fails the import; the browser will render the full image.
          let thumbS3Key: string | null = null;
          if (kind === "image") {
            const thumb = await generateImageThumbnail(m.contents, m.mimeType);
            if (thumb) {
              const thumbKey = `${user.churchId}/media/${uuid}_thumb.jpg`;
              try {
                await putBuffer(thumbKey, thumb.buffer, thumb.mimeType);
                thumbS3Key = thumbKey;
              } catch { /* keep going without a thumb */ }
            }
          }
          const [row] = await db.insert(mediaAssets).values({
            churchId: user.churchId,
            kind,
            fileName: m.fileName,
            s3Key: key,
            thumbS3Key,
            mimeType: m.mimeType,
            sizeBytes: m.contents.length,
          }).returning({ id: mediaAssets.id });
          if (row) mediaByFileName.set(m.fileName.toLowerCase(), row.id);
          mediaAdded++;
        } catch (e) {
          output.warnings.push({ file: m.fileName, warnings: [e instanceof Error ? e.message : "Upload failed"] });
        }
      }
    }
  }

  // Song ↔ background linking. For each imported song whose parser reported
  // media hints (filenames referenced from within the .pro/.pro6 source),
  // pick the first hint that matches an image asset we just uploaded and
  // set it as the song's default background. Videos are skipped for the
  // default — background videos are opt-in via the per-slide editor.
  let backgroundsLinked = 0;
  if (added > 0 && mediaByFileName.size > 0 && songsToInsert.length > 0) {
    const insertedTitles = songsToInsert.map((s) => s.title.trim()).filter(Boolean);
    if (insertedTitles.length > 0) {
      // Church-scoped fetch: only look at rows we could have written.
      const rows = await db
        .select({ id: songs.id, title: songs.title })
        .from(songs)
        .where(and(eq(songs.churchId, user.churchId), inArray(songs.title, insertedTitles)));
      const idByTitle = new Map(rows.map((r) => [r.title, r.id]));
      for (const parsed of songsToInsert) {
        const songId = idByTitle.get(parsed.title.trim());
        if (!songId) continue;
        for (const hint of parsed.mediaHints) {
          const matched = mediaByFileName.get(hint.toLowerCase());
          if (!matched) continue;
          try {
            await db.update(songs)
              .set({ defaultBackgroundAssetId: matched })
              .where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId)));
            backgroundsLinked++;
          } catch { /* one bad link never fails the batch */ }
          break; // first matching hint wins
        }
      }
    }
  }

  // Logo application — only if user picked one AND S3 is configured
  let logoApplied = false;
  if (input.applyLogo && isS3Configured()) {
    const logo = output.logoCandidates.find((l) => l.fileName === input.applyLogo);
    if (logo) {
      try {
        const ext = logo.fileName.split(".").pop() || "png";
        const key = `${user.churchId}/branding/logo.${ext}`;
        await putBuffer(key, logo.contents, logo.mimeType);
        // Upsert into settings
        const [existing] = await db.select().from(settings).where(eq(settings.churchId, user.churchId)).limit(1);
        if (existing) {
          await db.update(settings).set({ logoS3Key: key, updatedAt: new Date() }).where(eq(settings.id, existing.id));
        } else {
          await db.insert(settings).values({ churchId: user.churchId, logoS3Key: key });
        }
        logoApplied = true;
      } catch (e) {
        output.warnings.push({ file: logo.fileName, warnings: [e instanceof Error ? e.message : "Logo upload failed"] });
      }
    }
  }

  revalidatePath("/library/songs");
  revalidatePath("/library/media");
  revalidatePath("/settings");
  return {
    ok: true,
    data: {
      added, skipped, mediaAdded, logoApplied,
      backgroundsLinked,
      logoCandidates: output.logoCandidates.map((l) => ({ fileName: l.fileName, confidence: l.confidence })),
      warnings: output.warnings,
      perParser: output.byParser,
    },
  };
}

/**
 * Finalize a migration job produced by POST /api/imports/parse. Reads the
 * stored ParseResult from `summaryJson`, writes songs + slides to the DB
 * (dedupe by title within the church), uploads media buffers to S3, and
 * marks the migrationJob complete.
 */
export async function finalizeImport(migrationJobId: string): Promise<Result<{
  added: { songs: number; media: number };
  skipped: number;
}>> {
  const user = await requireUser();
  const db = getDb();

  const [job] = await db.select().from(migrationJobs)
    .where(and(eq(migrationJobs.id, migrationJobId), eq(migrationJobs.churchId, user.churchId)))
    .limit(1);
  if (!job) return { ok: false, error: "Migration job not found" };
  if (job.status !== "ready") return { ok: false, error: `Job is ${job.status}, not ready to finalize` };

  const summary = (job.summaryJson || {}) as {
    songs?: { title: string; artist?: string | null; slides: string[] }[];
    // Media is stored as S3 metadata ONLY — buffers live in S3 under s3Key.
    // Legacy `b64` payloads are still accepted for jobs created before the
    // CP1 fix pass, but new jobs never write b64 into summaryJson.
    media?: { fileName: string; mimeType: string; sizeBytes?: number; s3Key?: string; b64?: string }[];
  };
  const parsedSongs = Array.isArray(summary.songs) ? summary.songs : [];
  const parsedMedia = Array.isArray(summary.media) ? summary.media : [];

  // Library-cap headroom: allow up to whatever room remains, reject the rest
  // as "skipped" rather than blocking the whole batch or silently inserting
  // past the limit — a partial import (some added, rest reported skipped)
  // is more useful than an all-or-nothing failure here.
  const [__limit, __usage] = await Promise.all([getEffectiveSongLimit(user.churchId), getSongUsage(user.churchId)]);
  const remainingHeadroom = Math.max(0, __limit - __usage);

  const validSongs = parsedSongs.filter((s) => (s.title || "").trim() && Array.isArray(s.slides) && s.slides.length > 0);
  const invalidCount = parsedSongs.length - validSongs.length;
  const { added: songsAdded, skipped: bulkSkipped } = await bulkInsertSongs(
    user.churchId,
    validSongs.map((s) => ({ title: (s.title || "").trim(), artist: s.artist ?? null, slides: s.slides, source: "imported" as const })),
    remainingHeadroom,
  );
  const songsSkipped = invalidCount + bulkSkipped;

  let mediaAdded = 0;
  if (parsedMedia.length > 0 && isS3Configured()) {
    for (const m of parsedMedia) {
      try {
        const kind = m.mimeType.startsWith("video/") ? "video" as const : "image" as const;
        // New path: media was already streamed to S3 during parse. We just
        // reference the same s3Key from the mediaAssets row — no re-upload,
        // no re-encoding. Simplest safe path.
        if (m.s3Key) {
          await db.insert(mediaAssets).values({
            churchId: user.churchId, kind, fileName: m.fileName, s3Key: m.s3Key,
            mimeType: m.mimeType, sizeBytes: m.sizeBytes ?? 0,
          });
          mediaAdded++;
          continue;
        }
        // Legacy path: pre-CP1-fix summaries embedded b64.
        if (m.b64) {
          const buf = Buffer.from(m.b64, "base64");
          const ext = m.fileName.split(".").pop() || "bin";
          const key = `${user.churchId}/media/${randomUUID()}.${ext}`;
          await putBuffer(key, buf, m.mimeType);
          await db.insert(mediaAssets).values({
            churchId: user.churchId, kind, fileName: m.fileName, s3Key: key,
            mimeType: m.mimeType, sizeBytes: buf.length,
          });
          mediaAdded++;
        }
      } catch { /* per-file media failures don't fail the whole import */ }
    }
  }

  await db.update(migrationJobs)
    .set({ status: "ready", completedAt: new Date(), summaryJson: {
      ...(job.summaryJson as Record<string, unknown>),
      finalized: { songsAdded, songsSkipped, mediaAdded, at: new Date().toISOString() },
    } })
    .where(eq(migrationJobs.id, migrationJobId));

  revalidatePath("/library/songs");
  revalidatePath("/library/media");
  return { ok: true, data: { added: { songs: songsAdded, media: mediaAdded }, skipped: songsSkipped } };
}

/**
 * Extract background images/videos from ProPresenter files and upload them
 * to S3. Returns presigned GET URLs for each background so the caller can
 * create themes from them without a second round-trip.
 *
 * This is the server-side half of the "Import from ProPresenter" flow in the
 * ThemeImportDialog — it intentionally SKIPS song insertion so the dialog is
 * purely about backgrounds/themes, not lyrics.
 */
export async function extractThemeBackgrounds(input: { drop: FileDrop[] }): Promise<Result<{
  backgrounds: {
    fileName: string;
    kind: "image" | "video";
    url: string;       // 6-hour presigned GET URL ready to use in a theme config
    sizeBytes: number;
  }[];
  warnings: { file: string; warnings: string[] }[];
}>> {
  const user = await requireUser();

  const total = input.drop.reduce((sum, f) => sum + Math.ceil(f.b64.length * 0.75), 0);
  if (total > MAX_TOTAL_BYTES) {
    return { ok: false, error: `Drop too large (${Math.round(total / 1024 / 1024)} MB). Use smaller batches.` };
  }
  if (input.drop.length === 0) return { ok: false, error: "No files provided" };

  const buffers = input.drop.map((f) => ({ path: f.path, contents: Buffer.from(f.b64, "base64") }));
  const output: PipelineOutput = runImportPipeline(buffers);

  if (output.mediaAssets.length === 0) {
    return {
      ok: true,
      data: {
        backgrounds: [],
        warnings: [
          ...output.warnings,
          { file: "*", warnings: ["No background images or videos were found in the provided file(s)."] },
        ],
      },
    };
  }

  if (!isS3Configured()) {
    return { ok: false, error: "S3 is not configured on this deployment — background upload is unavailable." };
  }

  const { presignGet } = await import("./s3");
  const backgrounds: { fileName: string; kind: "image" | "video"; url: string; sizeBytes: number }[] = [];

  for (const m of output.mediaAssets.slice(0, 50)) { // cap at 50 per batch
    try {
      const ext = m.fileName.split(".").pop() || "bin";
      const uuid = randomUUID();
      const key = `${user.churchId}/media/${uuid}.${ext}`;
      await putBuffer(key, m.contents, m.mimeType);
      const url = await presignGet(key, 6 * 3600);
      const kind = m.mimeType.startsWith("video/") ? "video" as const : "image" as const;
      backgrounds.push({ fileName: m.fileName, kind, url, sizeBytes: m.contents.length });
    } catch (e) {
      output.warnings.push({ file: m.fileName, warnings: [e instanceof Error ? e.message : "Upload failed"] });
    }
  }

  return { ok: true, data: { backgrounds, warnings: output.warnings } };
}
