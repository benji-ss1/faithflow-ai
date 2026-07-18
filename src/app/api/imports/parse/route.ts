// POST /api/imports/parse?source=<parser-id>
//
// Accepts multipart form-data with any number of `files` parts. Auth via
// `apiUser` (returns 401 unauthenticated). Creates a `migrationJobs` row
// owned by the caller's church, runs the selected parser (per-file, with
// a 10s timeout), stores the ParseResult in `summaryJson`, and returns
// { migrationJobId, summary }.
//
// Guardrails:
//   - Each single file <= 100 MB (rejected with 413).
//   - Total request cap 250 MB (soft — Next.js enforces its own body limit).
//   - Every file name is sanitised to alphanumerics + `. _ -` (200 char cap).
//   - Every per-file parse is wrapped in a 10s Promise.race timeout.
//   - Parser-level safety (zip-bomb caps, path-traversal, JSON prototype
//     pollution, UTF-8 strict decode, XXE-safe XML) is enforced inside each
//     parser via ./parsers/safety.ts.
//   - No file bytes are ever sent back to the client — only the ParseResult
//     (media buffers are base64-embedded in summaryJson only for finalize).

import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { getEntitlement, canUseAI } from "@/lib/server/entitlement";
import { createLimiter } from "@/lib/rate-limit";
import { getDb } from "@/lib/db/client";

// Bulk parsing hits S3 + parser CPU + potentially external libs. 10/hour/church
// covers legitimate multi-file uploads while capping abuse.
const importsLimiter = createLimiter("imports-parse", 10, 60 * 60 * 1000);
import { migrationJobs } from "@/lib/db/schema";
import { getParser, type ParseResult } from "@/lib/parsers";
import { sanitizeFileName, withTimeout, PER_FILE_PARSE_TIMEOUT_MS } from "@/lib/parsers/safety";
import { putBuffer, isS3Configured } from "@/lib/s3";
import { decideTerminalStatus } from "@/lib/parsers/terminal-status";

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;

// Map parser id → migrationSourceEnum (only 5 values on the enum right now:
// propresenter, easyworship, proclaim, csv, none). Others bucket into "csv"
// for accounting — the parser id itself is preserved in summaryJson.parserId.
function mapEnum(id: string): "propresenter" | "easyworship" | "proclaim" | "csv" | "none" {
  if (id === "propresenter" || id === "easyworship" || id === "proclaim" || id === "csv") return id;
  return "none";
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ent = await getEntitlement(user.churchId);
  if (!canUseAI(ent)) return NextResponse.json({ error: "Import parsing requires an active subscription" }, { status: 402 });
  if (!(await importsLimiter(user.churchId))) {
    return NextResponse.json({ error: "Hourly import limit reached — try again shortly" }, { status: 429 });
  }

  const url = new URL(req.url);
  const sourceId = url.searchParams.get("source") || "";
  const parser = getParser(sourceId);
  if (!parser) return NextResponse.json({ error: `Unknown source '${sourceId}'` }, { status: 400 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const raw = form.getAll("files").filter((v): v is File => v instanceof File);
  if (raw.length === 0) return NextResponse.json({ error: "No files provided" }, { status: 400 });

  let total = 0;
  for (const f of raw) {
    if (f.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `File '${sanitizeFileName(f.name)}' exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB limit` }, { status: 413 });
    }
    total += f.size;
  }
  if (total > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: `Total upload size exceeds ${MAX_TOTAL_BYTES / 1024 / 1024} MB` }, { status: 413 });
  }

  const files: { name: string; buffer: Buffer }[] = [];
  for (const f of raw) {
    files.push({
      // Preserve extension shape but strip control chars / path parts.
      name: sanitizeFileName(f.name),
      buffer: Buffer.from(await f.arrayBuffer()),
    });
  }

  const db = getDb();
  const [job] = await db.insert(migrationJobs).values({
    churchId: user.churchId,
    userId: user.id,
    source: mapEnum(parser.id),
    status: "processing",
    sourceFileName: raw.length === 1 ? sanitizeFileName(raw[0].name) : `${raw.length} files`,
    summaryJson: { parserId: parser.id },
  }).returning();

  // Per-file parse with a hard 10s timeout. If a file times out, we record
  // it in skipped[] with a clear reason and keep going.
  const aggregate: ParseResult = { songs: [], media: [], skipped: [] };
  let anyParserRan = false;
  for (const f of files) {
    try {
      const perFile = await withTimeout(parser.parse([f]), PER_FILE_PARSE_TIMEOUT_MS);
      aggregate.songs.push(...perFile.songs);
      aggregate.media.push(...perFile.media);
      aggregate.skipped.push(...perFile.skipped);
      anyParserRan = true;
    } catch (e) {
      const reason = e instanceof Error && e.message.includes("parse exceeded")
        ? e.message
        : `Parse failed: ${e instanceof Error ? e.message : "unknown"}`;
      aggregate.skipped.push({ file: f.name, reason });
    }
  }

  // Stream media buffers to S3 immediately — NEVER embed buffers in summaryJson.
  // Failing to upload a media asset does NOT fail the whole parse (it's added
  // to skipped[]), but every successful upload is recorded as metadata only.
  const { eq } = await import("drizzle-orm");
  const uploadedMedia: { s3Key: string; fileName: string; mimeType: string; sizeBytes: number; sourceFile: string }[] = [];
  const s3Ready = isS3Configured();
  for (const m of aggregate.media) {
    const fileName = sanitizeFileName(m.fileName);
    const s3Key = `imports/${user.churchId}/${job.id}/${fileName}`;
    if (!s3Ready) {
      aggregate.skipped.push({ file: fileName, reason: "S3 not configured — media asset dropped rather than embedded in JSONB" });
      continue;
    }
    try {
      await putBuffer(s3Key, m.buffer, m.mimeType);
      uploadedMedia.push({ s3Key, fileName, mimeType: m.mimeType, sizeBytes: m.buffer.length, sourceFile: m.sourceFile });
    } catch (e) {
      aggregate.skipped.push({ file: fileName, reason: `Media upload failed: ${e instanceof Error ? e.message : "unknown"}` });
    }
  }

  // Determine terminal status: parser ran and produced at least one song or
  // media OR skipped[] contains parser-level info → status "ready". If every
  // file blew up (no successful parse output) → status "failed".
  const { status: terminalStatus, errorMessage } = decideTerminalStatus({
    parserId: parser.id,
    fileCount: files.length,
    anyParserRan,
    songsProduced: aggregate.songs.length,
    mediaProduced: uploadedMedia.length,
    skipped: aggregate.skipped,
  });

  const summary = {
    parserId: parser.id,
    counts: {
      songs: aggregate.songs.length,
      media: uploadedMedia.length,
      skipped: aggregate.skipped.length,
    },
    songs: aggregate.songs.map((s) => ({
      title: s.title,
      artist: s.artist ?? null,
      slideCount: s.slides.length,
      slides: s.slides,
      warnings: s.warnings,
      sourceFile: s.sourceFile,
    })),
    // Metadata ONLY — no buffers, no base64. Media bytes live in S3.
    media: uploadedMedia,
    skipped: aggregate.skipped,
    ...(errorMessage ? { errorMessage } : {}),
  };

  await db.update(migrationJobs)
    .set({ status: terminalStatus, summaryJson: summary, ...(errorMessage ? { errorMessage } : {}) })
    .where(eq(migrationJobs.id, job.id));

  // Client-facing summary omits the base64 media blobs so the review page
  // doesn't get hit with a huge payload.
  return NextResponse.json({
    migrationJobId: job.id,
    status: terminalStatus,
    summary: {
      parserId: summary.parserId,
      counts: summary.counts,
      songs: summary.songs.map((s) => ({ title: s.title, artist: s.artist, slideCount: s.slideCount, sourceFile: s.sourceFile })),
      media: summary.media.map((m) => ({ fileName: m.fileName, mimeType: m.mimeType, sizeBytes: m.sizeBytes })),
      skipped: summary.skipped,
      ...(errorMessage ? { errorMessage } : {}),
    },
  });
}
