"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser } from "./session";
import { getDb } from "./db/client";
import { songs, songSlides, mediaAssets, settings, migrationJobs } from "./db/schema";
import { runImportPipeline, type PipelineOutput } from "./importers/pipeline";
import { presignPut, isS3Configured, s3, BUCKET } from "./s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { getSongLimit, getSongUsage } from "./song-limits";

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
export async function importDrop(input: {
  drop: FileDrop[];
  applyLogo?: string; // filename of the logo the user picked, optional
}): Promise<Result<{
  added: number; skipped: number;
  mediaAdded: number;
  logoApplied: boolean;
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
  let added = 0, skipped = 0;
  // Same library-cap headroom gate as finalizeImport below — partial import
  // rather than all-or-nothing.
  let remainingHeadroom = Math.max(0, (await getSongLimit(user.churchId)) - (await getSongUsage(user.churchId)));

  for (const song of output.songs) {
    const [dup] = await db.select().from(songs)
      .where(and(eq(songs.churchId, user.churchId), eq(songs.title, song.title)))
      .limit(1);
    if (dup) { skipped++; continue; }
    if (remainingHeadroom <= 0) { skipped++; continue; }
    const [row] = await db.insert(songs).values({
      churchId: user.churchId, title: song.title, artist: song.artist, source: "imported",
    }).returning();
    if (song.slides.length > 0) {
      await db.insert(songSlides).values(song.slides.map((lyrics, i) => ({ songId: row.id, order: i, lyrics })));
    }
    added++;
    remainingHeadroom--;
  }

  // Media upload — only if S3 is configured. Anything else surfaces as a
  // warning rather than silently dropping.
  let mediaAdded = 0;
  if (output.mediaAssets.length > 0) {
    if (!isS3Configured()) {
      output.warnings.push({ file: "*", warnings: [`${output.mediaAssets.length} media file(s) not uploaded — S3 is not configured`] });
    } else {
      for (const m of output.mediaAssets) {
        try {
          const ext = m.fileName.split(".").pop() || "bin";
          const key = `${user.churchId}/media/${randomUUID()}.${ext}`;
          await putBuffer(key, m.contents, m.mimeType);
          const kind = m.mimeType.startsWith("video/") ? "video" as const : "image" as const;
          await db.insert(mediaAssets).values({
            churchId: user.churchId,
            kind,
            fileName: m.fileName,
            s3Key: key,
            mimeType: m.mimeType,
            sizeBytes: m.contents.length,
          });
          mediaAdded++;
        } catch (e) {
          output.warnings.push({ file: m.fileName, warnings: [e instanceof Error ? e.message : "Upload failed"] });
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
  let remainingHeadroom = Math.max(0, (await getSongLimit(user.churchId)) - (await getSongUsage(user.churchId)));

  let songsAdded = 0, songsSkipped = 0;
  for (const s of parsedSongs) {
    try {
      const title = (s.title || "").trim();
      if (!title || !Array.isArray(s.slides) || s.slides.length === 0) { songsSkipped++; continue; }
      const [dup] = await db.select().from(songs)
        .where(and(eq(songs.churchId, user.churchId), eq(songs.title, title)))
        .limit(1);
      if (dup) { songsSkipped++; continue; }
      if (remainingHeadroom <= 0) { songsSkipped++; continue; }
      const [row] = await db.insert(songs).values({
        churchId: user.churchId, title, artist: s.artist ?? null, source: "imported",
      }).returning();
      await db.insert(songSlides).values(s.slides.map((lyrics, i) => ({ songId: row.id, order: i, lyrics })));
      songsAdded++;
      remainingHeadroom--;
    } catch {
      songsSkipped++;
    }
  }

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
