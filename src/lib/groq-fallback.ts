// Groq rate-limit fallback (server-only) — pattern borrowed from FreeFlow.
//
// Model ladder (Groq ONLY — no other providers, hard project rule):
//   primary : openai/gpt-oss-120b      (strongest general model on Groq; quality.
//             2026-08-19 upgrade from llama-3.3-70b-versatile. env-overridable
//             via GROQ_MODEL. Only the LLM-assisted helper routes use this —
//             the real-time speech→scripture path is Deepgram + the
//             deterministic parser and never calls an LLM, so this does not
//             affect live-detection latency.)
//   fallback: llama-3.1-8b-instant     (fast/cheap, same OpenAI-compatible API)
//
// Behaviour:
//   • On HTTP 429 from the primary, we record the limit (retry-after header,
//     or Groq's "try again in Xs" error message, else 60s default) and retry
//     the SAME request against the fallback model immediately.
//   • While the primary is marked limited (now < resetAt), callers route
//     straight to the fallback without attempting the primary.
//   • If the fallback ALSO 429s, callers degrade the same way the
//     missing-key path does (GroqRateLimitedError → empty/null result).
//
// Persistence limitation (documented, accepted): state is a module-level
// in-memory value. It survives across requests in a long-lived Node process
// (Fly, `next start`, Fluid Compute warm instances) but is lost on serverless
// cold starts — after a cold start the first request will re-probe the
// primary, hit the 429 again, and re-learn the limit. No DB/external store
// is used for this by design.

export const GROQ_PRIMARY_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
// 2026-08-27: llama-3.1-8b-instant was ALSO decommissioned by Groq (404
// model_not_found), so the 429-fallback path would itself fail. Migrated to
// openai/gpt-oss-20b — the fast/cheap member of the same gpt-oss family that
// is still live (same OpenAI-compatible API + response_format support).
export const GROQ_FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || "openai/gpt-oss-20b";

const DEFAULT_LIMIT_MS = 60_000;
const MAX_LIMIT_MS = 60 * 60_000; // cap: never mark limited for more than 1h

export class GroqRateLimitedError extends Error {
  code = "RATE_LIMITED" as const;
  constructor(public resetAt: number | null) {
    super("Groq rate limit reached on primary and fallback models");
    this.name = "GroqRateLimitedError";
  }
}

// Module-level state (in-memory only — see header note).
let primaryResetAt: number | null = null;

/** True while the primary model is known rate-limited. Logs restore once. */
export function isGroqPrimaryLimited(now = Date.now()): boolean {
  if (primaryResetAt === null) return false;
  if (now >= primaryResetAt) {
    primaryResetAt = null;
    console.log("[groq] primary restored");
    return false;
  }
  return true;
}

/** Model to use for the next request, honoring a live primary limit. */
export function getGroqActiveModel(): string {
  return isGroqPrimaryLimited() ? GROQ_FALLBACK_MODEL : GROQ_PRIMARY_MODEL;
}

/** Parse a limit duration (ms) from a 429 response. */
function parseLimitMs(res: Response, bodyText: string): number {
  // 1) retry-after header (seconds)
  const ra = res.headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, MAX_LIMIT_MS);
  }
  // 2) Groq error JSON: "... Please try again in 7.664s." (also m/ms forms)
  const m = /try again in\s+([\d.]+)\s*(ms|s|m)\b/i.exec(bodyText);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) {
      const ms = m[2].toLowerCase() === "ms" ? n : m[2].toLowerCase() === "m" ? n * 60_000 : n * 1000;
      return Math.min(Math.max(ms, 1000), MAX_LIMIT_MS);
    }
  }
  return DEFAULT_LIMIT_MS;
}

/** Record a 429 on the primary model. Logs the transition once. */
export function markGroqPrimaryLimited(res: Response, bodyText: string): void {
  const wasLimited = primaryResetAt !== null && Date.now() < primaryResetAt;
  primaryResetAt = Date.now() + parseLimitMs(res, bodyText);
  if (!wasLimited) {
    console.warn(`[groq] primary rate-limited until ${new Date(primaryResetAt).toISOString()}, using fallback (${GROQ_FALLBACK_MODEL})`);
  }
}

/** Surface for UI/status endpoints. */
export function getGroqLimitStatus(): { primaryLimited: boolean; resetAt: number | null; activeModel: string } {
  const limited = isGroqPrimaryLimited();
  return {
    primaryLimited: limited,
    resetAt: limited ? primaryResetAt : null,
    activeModel: limited ? GROQ_FALLBACK_MODEL : GROQ_PRIMARY_MODEL,
  };
}
