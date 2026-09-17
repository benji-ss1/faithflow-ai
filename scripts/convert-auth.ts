/**
 * Converter shared-secret check (server-only: uses node:crypto, so it lives
 * apart from convert-lib.ts, which the browser bundle imports via pptx-import).
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time shared-secret check. Empty server secret = deny (fail closed);
 *  array/duplicated headers are rejected. Hashing first equalises lengths. */
export function secretMatches(provided: unknown, secret: string): boolean {
  if (!secret || typeof provided !== "string" || !provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
