/**
 * Shared malicious-input safety utilities for the parser pipeline.
 *
 * These helpers protect against:
 *   - Zip-bombs (excessive entry count or total uncompressed size)
 *   - Zip-slip / path traversal (entryName containing `..`, `\`, or absolute)
 *   - Prototype pollution in parsed JSON payloads (`__proto__`, `constructor`,
 *     `prototype` top-level keys)
 *   - Runaway per-file parsing (timeout wrapper)
 *   - Unsafe filenames (control chars, non-ascii junk, path segments)
 *   - Bad UTF-8 payloads
 *
 * The individual parsers call these helpers and return a `skipped[]` entry
 * with a human-readable reason rather than throwing.
 */

import type AdmZip from "adm-zip";

// Zip-bomb caps
export const MAX_ZIP_ENTRIES = 2000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 500 * 1024 * 1024; // 500MB
export const PER_FILE_PARSE_TIMEOUT_MS = 10_000;

export type ZipInspection =
  | { ok: true; entries: ReturnType<AdmZip["getEntries"]> }
  | { ok: false; reason: string };

/**
 * Inspect a zip archive and return its entries if it passes all safety
 * checks. Returns `{ ok: false, reason }` for any of:
 *   - too many entries (> MAX_ZIP_ENTRIES)
 *   - total uncompressed size > MAX_ZIP_UNCOMPRESSED_BYTES
 *   - any entry name that would escape the extraction root (zip-slip)
 */
export function inspectZip(zip: AdmZip): ZipInspection {
  let entries: ReturnType<AdmZip["getEntries"]>;
  try {
    entries = zip.getEntries();
  } catch (e) {
    return { ok: false, reason: `Invalid zip archive: ${e instanceof Error ? e.message : "unknown"}` };
  }
  if (entries.length > MAX_ZIP_ENTRIES) {
    return { ok: false, reason: `Zip entry-cap exceeded: ${entries.length} > ${MAX_ZIP_ENTRIES}` };
  }
  let totalUncompressed = 0;
  for (const e of entries) {
    const name = e.entryName || "";
    if (isUnsafeEntryName(name)) {
      return { ok: false, reason: `path-traversal in zip entry: ${JSON.stringify(name)}` };
    }
    // adm-zip's per-entry uncompressed size lives on header.size
    const sz = Number(e.header?.size ?? 0);
    if (Number.isFinite(sz) && sz > 0) totalUncompressed += sz;
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      return { ok: false, reason: `Zip uncompressed-size cap exceeded (> ${MAX_ZIP_UNCOMPRESSED_BYTES} bytes) — possible zip bomb` };
    }
  }
  return { ok: true, entries };
}

/** True if the given zip entry name would escape the extraction root. */
export function isUnsafeEntryName(name: string): boolean {
  if (!name) return true;
  if (name.includes("..")) return true;
  if (name.startsWith("/")) return true;
  if (name.includes("\\")) return true;
  // Reject explicit drive letters ala Windows absolute paths
  if (/^[A-Za-z]:/.test(name)) return true;
  return false;
}

/**
 * Rejects a parsed JSON payload that contains dangerous top-level keys
 * (`__proto__`, `constructor`, `prototype`) at the root or any nested object.
 * Returns null if safe, or a string reason if not.
 */
export function detectPrototypePollution(v: unknown, depth = 0): string | null {
  if (depth > 20) return null; // depth cap; treat as safe
  if (!v || typeof v !== "object") return null;
  if (Array.isArray(v)) {
    for (const el of v) {
      const r = detectPrototypePollution(el, depth + 1);
      if (r) return r;
    }
    return null;
  }
  const keys = Object.keys(v as Record<string, unknown>);
  for (const k of keys) {
    if (k === "__proto__" || k === "prototype" || k === "constructor") {
      return `Prototype-pollution key '${k}' in JSON payload`;
    }
  }
  for (const k of keys) {
    const r = detectPrototypePollution((v as Record<string, unknown>)[k], depth + 1);
    if (r) return r;
  }
  return null;
}

/**
 * Parse JSON while rejecting prototype-pollution payloads. Uses a reviver
 * that drops dangerous keys and then re-scans the tree defensively.
 */
export function safeJsonParse(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, (key, val) => {
      if (key === "__proto__" || key === "prototype" || key === "constructor") return undefined;
      return val;
    });
  } catch (e) {
    return { ok: false, reason: `Invalid JSON: ${e instanceof Error ? e.message : "unknown"}` };
  }
  const bad = detectPrototypePollution(parsed);
  if (bad) return { ok: false, reason: bad };
  return { ok: true, value: parsed };
}

/**
 * Wrap an async operation in a hard timeout. On timeout the returned
 * promise rejects with an Error whose message is "parse exceeded {ms}ms".
 */
export function withTimeout<T>(p: Promise<T>, ms: number = PER_FILE_PARSE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`parse exceeded ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Decode a Buffer as strict UTF-8. Throws with a clear message if the
 * buffer contains invalid UTF-8 sequences.
 */
export function decodeUtf8Strict(buf: Buffer): string {
  // Node's TextDecoder with fatal:true rejects invalid utf-8.
  const dec = new TextDecoder("utf-8", { fatal: true });
  return dec.decode(buf);
}

/**
 * Normalise a user-supplied file name to a safe form:
 *   - Strip control characters
 *   - Strip any path segment (basename only)
 *   - Allow only alphanumerics + `. _ -`
 *   - Cap length to 200 characters
 */
export function sanitizeFileName(raw: string): string {
  if (!raw) return "file";
  // basename only
  const parts = raw.replace(/\\/g, "/").split("/");
  let base = parts[parts.length - 1] || "file";
  // strip control chars
  base = base.replace(/[\x00-\x1f\x7f]/g, "");
  // whitelist chars
  base = base.replace(/[^A-Za-z0-9._-]/g, "_");
  if (base.length === 0) base = "file";
  if (base.length > 200) base = base.slice(0, 200);
  return base;
}
