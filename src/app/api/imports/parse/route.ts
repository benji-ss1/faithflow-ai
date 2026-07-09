// POST /api/imports/parse?source=<parser-id>
//
// Accepts multipart form-data with any number of `files` parts. Auth via
// `apiUser` (returns 401 unauthenticated). Creates a `migrationJobs` row,
// runs the selected parser, stores the ParseResult in `summaryJson`, and
// returns { migrationJobId, summary }.
//
// Guardrails:
//   - Each single file must be <= 100 MB (rejected with 413 otherwise).
//   - Total request cap 250 MB (soft — Next.js enforces its own body limit;
//     we double-check by summing sizes).
//   - Parsers are pure functions run server-side. No file bytes are ever
//     sent back to the client — only the ParseResult (which we sanitize to
//     omit Buffer contents).

import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { migrationJobs } from "@/lib/db/schema";
import { getParser, type ParseResult } from "@/lib/parsers";

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;

// Map parser id → migrationSourceEnum (only 5 values are allowed on the
// enum right now: propresenter, easyworship, proclaim, csv, none). Others
// bucket into "csv" for accounting — the parser id itself is preserved in
// summaryJson.parserId.
function mapEnum(id: string): "propresenter" | "easyworship" | "proclaim" | "csv" | "none" {
  if (id === "propresenter" || id === "easyworship" || id === "proclaim" || id === "csv") return id;
  return "none";
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
      return NextResponse.json({ error: `File '${f.name}' exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB limit` }, { status: 413 });
    }
    total += f.size;
  }
  if (total > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: `Total upload size exceeds ${MAX_TOTAL_BYTES / 1024 / 1024} MB` }, { status: 413 });
  }

  const files: { name: string; buffer: Buffer }[] = [];
  for (const f of raw) {
    files.push({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) });
  }

  const db = getDb();
  const [job] = await db.insert(migrationJobs).values({
    churchId: user.churchId,
    userId: user.id,
    source: mapEnum(parser.id),
    status: "processing",
    sourceFileName: raw.length === 1 ? raw[0].name : `${raw.length} files`,
    summaryJson: { parserId: parser.id },
  }).returning();

  let result: ParseResult;
  try {
    result = await parser.parse(files);
  } catch (e) {
    await db.update(migrationJobs)
      .set({ status: "failed", errorMessage: e instanceof Error ? e.message : "Parse failed", completedAt: new Date() })
      .where((await import("drizzle-orm")).eq(migrationJobs.id, job.id));
    return NextResponse.json({ error: "Parser threw", detail: String(e) }, { status: 500 });
  }

  // Persist the parse result. Media buffers are stored inline as base64 so
  // the finalize step can round-trip them into S3. This is intentional —
  // migrationJobs is short-lived and per-import, and it lets the review UI
  // present exact counts before the user commits.
  const summary = {
    parserId: parser.id,
    counts: {
      songs: result.songs.length,
      media: result.media.length,
      skipped: result.skipped.length,
    },
    songs: result.songs.map((s) => ({
      title: s.title,
      artist: s.artist ?? null,
      slideCount: s.slides.length,
      slides: s.slides,
      warnings: s.warnings,
      sourceFile: s.sourceFile,
    })),
    media: result.media.map((m) => ({
      fileName: m.fileName,
      mimeType: m.mimeType,
      sizeBytes: m.buffer.length,
      b64: m.buffer.toString("base64"),
      sourceFile: m.sourceFile,
    })),
    skipped: result.skipped,
  };

  const { eq } = await import("drizzle-orm");
  await db.update(migrationJobs)
    .set({ status: "ready", summaryJson: summary })
    .where(eq(migrationJobs.id, job.id));

  // Client-facing summary omits the base64 media blobs so the review page
  // doesn't get hit with a huge payload.
  return NextResponse.json({
    migrationJobId: job.id,
    summary: {
      parserId: summary.parserId,
      counts: summary.counts,
      songs: summary.songs.map((s) => ({ title: s.title, artist: s.artist, slideCount: s.slideCount, sourceFile: s.sourceFile })),
      media: summary.media.map((m) => ({ fileName: m.fileName, mimeType: m.mimeType, sizeBytes: m.sizeBytes })),
      skipped: summary.skipped,
    },
  });
}
