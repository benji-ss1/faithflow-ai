// Server-only. Do not import from client components.
//
// AES-256-GCM symmetric encryption for secrets stored at rest (e.g. licensed
// translation API keys). Uses the ENCRYPTION_KEY env variable (32-byte hex).
//
// Format of encrypted output (all base64url, colon-delimited):
//   <iv_b64url>:<authTag_b64url>:<ciphertext_b64url>
//
// When ENCRYPTION_KEY is absent (local dev without the env), encrypt returns
// "[unencrypted]:<plaintext>" and decrypt tries to unwrap that sentinel so
// dev flows still work. Never allow the sentinel in production — validate
// ENCRYPTION_KEY at startup in critical paths if needed.

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY env variable must be a 64-character hex string (32 bytes). " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): string {
  let key: Buffer;
  try {
    key = getKey();
  } catch {
    // Dev fallback — sentinel so decrypt can recover the plaintext.
    return `[unencrypted]:${plaintext}`;
  }
  const iv = crypto.randomBytes(12); // 96-bit IV is the GCM standard
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decrypt(encrypted: string): string {
  if (encrypted.startsWith("[unencrypted]:")) {
    return encrypted.slice("[unencrypted]:".length);
  }
  const key = getKey();
  const parts = encrypted.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted payload format");
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const authTag = Buffer.from(tagB64, "base64url");
  const ciphertext = Buffer.from(ctB64, "base64url");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
