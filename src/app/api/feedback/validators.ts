// Pure helpers for /api/feedback. Extracted so unit tests can import them
// without triggering Next 15's route-file arbitrary-export restriction.

// Y1: reject if email is present-but-malformed. Empty/undefined stays allowed.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// R5.1: strip CR/LF/NUL/control chars from message before logging so a user
// cannot forge a fake log line via a payload like "foo\n[feedback] fake\n".
export function sanitizeForLog(s: string): string {
  return s.replace(/[\r\n\x00-\x1f\x7f]/g, " ").slice(0, 200);
}
