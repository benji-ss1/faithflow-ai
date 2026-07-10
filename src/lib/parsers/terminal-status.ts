/**
 * Pure decision helper for `/api/imports/parse` — determines whether the
 * `migrationJobs` row should end in status `ready` or `failed`, and what
 * `errorMessage` to attach.
 *
 * Extracted from the route module so it can be unit-tested without spinning
 * up Next / the DB.
 *
 * Rules:
 *   - If NO file was successfully handed to the parser (parser threw on every
 *     invocation) → `failed`.
 *   - If the parser produced zero songs AND zero media AND every skipped entry
 *     came from an outer-catch "Parse failed" / "parse exceeded" reason → the
 *     parser also effectively failed on every file → `failed`.
 *   - Otherwise → `ready` (even if some files were skipped for benign reasons
 *     like unsupported-format or path-traversal, the job as a whole is usable).
 */

export type TerminalStatusInput = {
  parserId: string;
  fileCount: number;
  anyParserRan: boolean;
  songsProduced: number;
  mediaProduced: number;
  skipped: { file: string; reason: string }[];
};

export type TerminalStatusResult = {
  status: "ready" | "failed";
  errorMessage: string | null;
};

export function decideTerminalStatus(input: TerminalStatusInput): TerminalStatusResult {
  const { parserId, fileCount, anyParserRan, songsProduced, mediaProduced, skipped } = input;
  const producedAny = songsProduced > 0 || mediaProduced > 0;
  const allSkippedAreThrows = skipped.length > 0
    && skipped.every((s) => /Parse failed|parse exceeded/i.test(s.reason));
  const failed = !anyParserRan || (!producedAny && allSkippedAreThrows);
  if (failed) {
    return {
      status: "failed",
      errorMessage: `Parser '${parserId}' failed for all ${fileCount} file(s). See summary.skipped for details.`,
    };
  }
  return { status: "ready", errorMessage: null };
}
