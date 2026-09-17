/**
 * Pure helpers shared by /api/pptx/to-pdf and the MediaImportWizard PowerPoint
 * path. No I/O — unit-tested in test/pptx-convert.test.ts.
 */
import { CONVERT_MESSAGES, type ConvertErrorCode } from "../../scripts/convert-lib";

/** Cap on a PowerPoint source (mirrors MAX_BYTES.pptx + the converter). */
export const PPTX_MAX_BYTES = 150 * 1024 * 1024;
/** Route's total budget for talking to the converter (maxDuration is 300). */
export const CONVERT_ROUTE_BUDGET_MS = 270_000;
/** Client gives up on /api/pptx/to-pdf after this. */
export const CONVERT_CLIENT_TIMEOUT_MS = 290_000;

export const GENERIC_CONVERT_ERROR = CONVERT_MESSAGES.failed;

/** Is the converter's reply the PDF itself (old converter) or JSON (new)? */
export function responseKind(contentType: string | null | undefined): "pdf" | "json" {
  return /application\/pdf/i.test(contentType || "") ? "pdf" : "json";
}

/** Statuses that mean "try again shortly": busy machine, Fly proxy cold start. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503;
}

/** Backoff before retry `attempt` (0-based): 2s, 4s, 8s, then every 15s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(2000 * 2 ** attempt, 15_000);
}

/** Whether another attempt fits in the remaining budget (needs ≥30s to be useful). */
export function canRetry(attempt: number, maxRetries: number, elapsedMs: number, budgetMs = CONVERT_ROUTE_BUDGET_MS): boolean {
  return attempt < maxRetries && elapsedMs + retryDelayMs(attempt) + 30_000 < budgetMs;
}

const KNOWN = new Set(Object.keys(CONVERT_MESSAGES));

/**
 * Operator-facing message for a failed conversion. Only messages keyed by a
 * code the NEW converter defines are passed through; anything else (including
 * the OLD converter's raw error strings) becomes a plain generic message.
 */
export function operatorConvertError(status: number, detail: { error?: unknown; code?: unknown } | null | undefined): string {
  const code = typeof detail?.code === "string" && KNOWN.has(detail.code) ? (detail.code as ConvertErrorCode) : null;
  if (code === "busy" || (!code && status === 429)) return "The converter is busy with other presentations. Please try again in a minute.";
  if (code) return CONVERT_MESSAGES[code];
  if (status === 504) return CONVERT_MESSAGES.timeout;
  return GENERIC_CONVERT_ERROR;
}

/** The converted PDF lives at `${churchId}/pptx/<uuid>.pdf`. */
export function isChurchPptxTempKey(key: unknown, churchId: string): key is string {
  if (typeof key !== "string" || !churchId || key.length > 300) return false;
  const esc = churchId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc}/pptx/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(pptx|ppt|pdf)$`, "i").test(key);
}

export type DeckStage =
  | { kind: "upload-source"; fraction: number }
  | { kind: "convert"; elapsedSec: number }
  | { kind: "download-pdf" }
  | { kind: "prepare"; index: number; total: number }
  | { kind: "upload-slides"; done: number; total: number };

/** Plain-language progress line shown under a deck in the import list. */
export function deckStageLabel(s: DeckStage): string {
  switch (s.kind) {
    case "upload-source": return `Uploading deck ${Math.max(0, Math.min(100, Math.round(s.fraction * 100)))}%`;
    case "convert": {
      const t = Math.max(0, Math.floor(s.elapsedSec));
      return t >= 20 ? `Converting… ${t}s (big decks can take a minute)` : `Converting… ${t}s`;
    }
    case "download-pdf": return "Converting… almost done";
    case "prepare": return `Preparing slide ${s.index}/${s.total}`;
    case "upload-slides": return `Uploading slide ${s.done}/${s.total}`;
  }
}

/** True when every queued file is a slide deck (PowerPoint or PDF). */
export function isDeckOnlyQueue(items: Array<{ deck?: boolean; tag?: string }>): boolean {
  return items.length > 0 && items.every((i) => i.tag !== "pro" && i.deck === true);
}
