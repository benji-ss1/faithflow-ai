import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

/**
 * Audio media is gated on the additive `media_kind` enum migration
 * (docs/migrations/2026-09-16-add-media-kind-audio.sql). Until it's applied an
 * INSERT with kind='audio' would throw, so every audio path asks this first and
 * degrades to a friendly "coming soon" instead of breaking.
 *
 * A positive answer is cached for the process lifetime (enum values can't be
 * removed); a negative answer is re-checked at most once a minute.
 */
export const AUDIO_NOT_READY_ERROR = "Audio needs a quick update — coming soon";

let supported = false;
let checkedAt = 0;

export async function isAudioMediaSupported(): Promise<boolean> {
  if (supported) return true;
  if (Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const res = await getDb().execute(sql`
      SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'media_kind' AND e.enumlabel = 'audio' LIMIT 1
    `);
    const rows = (res as { rows?: unknown[] }).rows ?? (Array.isArray(res) ? res : []);
    supported = rows.length > 0;
  } catch {
    supported = false;
  }
  return supported;
}
