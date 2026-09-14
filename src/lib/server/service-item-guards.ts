// Church-scoped guards for service-item payloads that reference library rows.
// Kept OUT of actions.ts ("use server") so it is not exposed as a server action
// and can be driven directly by the adversarial test.
import { and, eq } from "drizzle-orm";
import type { getDb } from "../db/client";
import { pptxImports } from "../db/schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function validateSermonItemPayload(
  db: ReturnType<typeof getDb>,
  churchId: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (payload.songId || payload.mediaAssetId || payload.mediaAssetIds) {
    return { ok: false, error: "sermon payload must not include song/media refs" };
  }
  const pptxImportId = payload.pptxImportId;
  if (pptxImportId === undefined || pptxImportId === null || pptxImportId === "") return { ok: true };
  if (typeof pptxImportId !== "string" || !UUID_RE.test(pptxImportId)) {
    return { ok: false, error: "sermon pptxImportId must be a valid id" };
  }
  const [row] = await db.select({ id: pptxImports.id }).from(pptxImports)
    .where(and(eq(pptxImports.id, pptxImportId), eq(pptxImports.churchId, churchId))).limit(1);
  if (!row) return { ok: false, error: "PowerPoint import not found in your church" };
  return { ok: true };
}
