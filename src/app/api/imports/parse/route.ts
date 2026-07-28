// POST /api/imports/parse?source=<parser-id>
//
// Streams NDJSON progress events to the client while parsing multi-file
// imports. Response body is a series of `\n`-terminated JSON events:
//
//   {"type":"stage","stage":"parsing","total":<N>,"processed":0}
//   {"type":"progress","processed":1,"currentFile":"…"}
//   ...
//   {"type":"stage","stage":"uploading-media","total":<M>,"processed":0}
//   {"type":"progress","processed":1,"currentFile":"…"}
//   ...
//   {"type":"done","migrationJobId":"…","status":"ready","summary":{…}}
//   -- OR on early error --
//   {"type":"error","error":"…"}
//
// The client uses fetch().body.getReader() + a TextDecoder + split-by-\n
// to consume events without needing SSE. See WizardClient.tsx.
//
// Existing guardrails preserved:
//   - Each single file <= 100 MB (rejected with 413)
//   - Total request cap 250 MB
//   - Every file name is sanitised
//   - Every per-file parse wrapped in a 10s timeout
//   - Parser-level safety in ./parsers/safety.ts
//   - No file bytes returned to client — only parse summary + media metadata
//
// NEW in this pass:
//   - Real per-file progress events (was: aggregate-only JSON response)
//   - Pre-parse duplicate detection against existing church-scoped song
//     titles, surfaced in summary.duplicates so the review step can show
//     admins exactly which titles will be skipped (not just a count)

import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { getEntitlement, canUseAI } from "@/lib/server/entitlement";
import { createLimiter } from "@/lib/rate-limit";
import { getDb } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { migrationJobs, songs } from "@/lib/db/schema";
import { getParser, type ParseResult } from "@/lib/parsers";
import { sanitizeFileName, withTimeout, PER_FILE_PARSE_TIMEOUT_MS } from "@/lib/parsers/safety";
import { putBuffer, isS3Configured } from "@/lib/s3";
import { decideTerminalStatus } from "@/lib/parsers/terminal-status";

// Bulk parsing hits S3 + parser CPU + potentially external libs. 10/hour/church
// covers legitimate multi-file uploads while capping abuse.
const importsLimiter = createLimiter("imports-parse", 10, 60 * 60 * 1000);

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;

// Map parser id → migrationSourceEnum (only 5 values on the enum right now).
// Other parser ids bucket into "csv" for accounting — the parser id itself
// is preserved in summaryJson.parserId.
function mapEnum(id: string): "propresenter" | "easyworship" | "proclaim" | "csv" | "none" {
  if (id === "propresenter" || id === "easyworship" || id === "proclaim" || id === "csv") return id;
  return "none";
}

export const runtime = "nodejs";

// Helper: encode a JSON object + newline into a Uint8Array chunk.
function ev(encoder: TextEncoder, event: Record<string, unknown>): Uint8Array {
  return encoder.encode(JSON.stringify(event) + "\n");
}

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

  // Form parsing has to complete BEFORE we can start streaming — we can't
  // stream a response body until we've received the request body. The heavy
  // work (parsing + S3 uploads) is what benefits from streaming; form-read
  // is quick relative to that.
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

  // Materialize buffers before opening the stream — File.arrayBuffer() is
  // async and we want the stream to be a clean sequence of progress events
  // rather than interleaving IO waits.
  const files: { name: string; buffer: Buffer }[] = [];
  for (const f of raw) {
    files.push({
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Stage 1: parse each file, streaming per-file progress.
        controller.enqueue(ev(encoder, { type: "stage", stage: "parsing", total: files.length, processed: 0 }));
        const aggregate: ParseResult = { songs: [], media: [], skipped: [] };
        let anyParserRan = false;
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          controller.enqueue(ev(encoder, { type: "progress", stage: "parsing", processed: i, total: files.length, currentFile: f.name }));
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
        controller.enqueue(ev(encoder, { type: "progress", stage: "parsing", processed: files.length, total: files.length }));

        // Stage 2: upload media to S3 (if any).
        const uploadedMedia: { s3Key: string; fileName: string; mimeType: string; sizeBytes: number; sourceFile: string }[] = [];
        const s3Ready = isS3Configured();
        if (aggregate.media.length > 0) {
          controller.enqueue(ev(encoder, { type: "stage", stage: "uploading-media", total: aggregate.media.length, processed: 0 }));
          for (let i = 0; i < aggregate.media.length; i++) {
            const m = aggregate.media[i];
            const fileName = sanitizeFileName(m.fileName);
            controller.enqueue(ev(encoder, { type: "progress", stage: "uploading-media", processed: i, total: aggregate.media.length, currentFile: fileName }));
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
          controller.enqueue(ev(encoder, { type: "progress", stage: "uploading-media", processed: aggregate.media.length, total: aggregate.media.length }));
        }

        // Stage 3: pre-parse duplicate detection. Query existing song titles
        // ONCE, then mark each parsed song with alreadyExists:boolean. Review
        // step surfaces this so admins know which songs will be silently
        // skipped by finalizeImport → bulkInsertSongs.
        controller.enqueue(ev(encoder, { type: "stage", stage: "checking-duplicates", total: aggregate.songs.length, processed: 0 }));
        const existingTitles = new Set(
          (await db.select({ title: songs.title }).from(songs).where(eq(songs.churchId, user.churchId))).map((r) => r.title.trim()),
        );
        const duplicateTitles: string[] = [];
        const markedSongs = aggregate.songs.map((s) => {
          const already = existingTitles.has(s.title.trim());
          if (already) duplicateTitles.push(s.title.trim());
          return { ...s, alreadyExists: already };
        });
        controller.enqueue(ev(encoder, { type: "progress", stage: "checking-duplicates", processed: aggregate.songs.length, total: aggregate.songs.length }));

        // Terminal status decision — unchanged from prior contract.
        const { status: terminalStatus, errorMessage } = decideTerminalStatus({
          parserId: parser.id,
          fileCount: files.length,
          anyParserRan,
          songsProduced: aggregate.songs.length,
          mediaProduced: uploadedMedia.length,
          skipped: aggregate.skipped,
        });

        const uniqueTitles = new Set<string>();
        for (const s of markedSongs) uniqueTitles.add(s.title.trim());
        const summary = {
          parserId: parser.id,
          counts: {
            songs: aggregate.songs.length,
            media: uploadedMedia.length,
            skipped: aggregate.skipped.length,
            duplicates: duplicateTitles.length,
          },
          songs: markedSongs.map((s) => ({
            title: s.title,
            artist: s.artist ?? null,
            slideCount: s.slides.length,
            slides: s.slides,
            warnings: s.warnings,
            sourceFile: s.sourceFile,
            alreadyExists: s.alreadyExists,
          })),
          media: uploadedMedia,
          skipped: aggregate.skipped,
          duplicates: duplicateTitles,
          ...(errorMessage ? { errorMessage } : {}),
        };

        await db.update(migrationJobs)
          .set({ status: terminalStatus, summaryJson: summary, ...(errorMessage ? { errorMessage } : {}) })
          .where(eq(migrationJobs.id, job.id));

        // Client-facing summary omits the media buffers and the full slide
        // arrays (only counts + titles / sample metadata needed for review).
        controller.enqueue(ev(encoder, {
          type: "done",
          migrationJobId: job.id,
          status: terminalStatus,
          summary: {
            parserId: summary.parserId,
            counts: summary.counts,
            songs: summary.songs.map((s) => ({
              title: s.title,
              artist: s.artist,
              slideCount: s.slideCount,
              sourceFile: s.sourceFile,
              alreadyExists: s.alreadyExists,
            })),
            media: summary.media.map((m) => ({ fileName: m.fileName, mimeType: m.mimeType, sizeBytes: m.sizeBytes })),
            skipped: summary.skipped,
            duplicates: summary.duplicates,
            ...(errorMessage ? { errorMessage } : {}),
          },
        }));
        controller.close();
      } catch (e) {
        controller.enqueue(ev(encoder, { type: "error", error: e instanceof Error ? e.message : "unknown" }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      // NDJSON — one JSON object per line, terminated with \n. Not standard
      // SSE (which would need "data:" prefixes + "\n\n" separators); this
      // is a plainer contract that the client parses with a simple split.
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
