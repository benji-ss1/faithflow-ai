import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { createLimiter } from "@/lib/rate-limit";
import { getDb } from "@/lib/db/client";
import { feedback } from "@/lib/db/schema";

/**
 * POST /api/feedback — accept bug reports / feature requests from Settings.
 *
 * Auth-gated. Rate-limited to 3 requests per user per hour, plus a per-user
 * 1/day cap on blocker=true submissions.
 *
 * Persists to the `feedback` table so triage does not rely on log retention.
 * A truncated + sanitized single-line log is still emitted for operator
 * visibility, but the durable record is the DB row.
 *
 * Body: { type: "problem" | "feature", email?: string, message: string, blocker?: boolean }
 */

const feedbackLimiter = createLimiter("feedback", 3, 60 * 60 * 1000);
const feedbackBlockerLimiter = createLimiter("feedback-blocker", 1, 24 * 60 * 60 * 1000);

// Y1: reject if email is present-but-malformed. Empty/undefined stays allowed.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// R5.1: strip CR/LF/NUL/control chars from message before logging so a user
// cannot forge a fake log line via a payload like "foo\n[feedback] fake\n".
function sanitizeForLog(s: string): string {
  return s.replace(/[\r\n\x00-\x1f\x7f]/g, " ").slice(0, 200);
}

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const allowed = await feedbackLimiter(user.id);
  if (!allowed) {
    return NextResponse.json({ error: "Too many feedback submissions. Try again later." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const type = b.type === "feature" ? "feature" : "problem";
  const rawEmail = typeof b.email === "string" ? b.email.trim().slice(0, 200) : "";
  const email = rawEmail || undefined;
  const rawMessage = typeof b.message === "string" ? b.message.trim().slice(0, 4000) : "";
  const blocker = Boolean(b.blocker);

  // Optional screenshot: accept image data URLs up to ~6 MB base64. No S3
  // upload for attachments yet — record presence + size in the message so
  // triage sees it, and log the size. Oversize/malformed payloads are
  // silently dropped rather than 400'd; text feedback is the primary signal.
  const rawScreenshot = typeof b.screenshot === "string" ? b.screenshot : "";
  const screenshotName = typeof b.screenshotName === "string" ? b.screenshotName.slice(0, 200) : "";
  let screenshotNote = "";
  let screenshotBytes = 0;
  if (rawScreenshot.startsWith("data:image/") && rawScreenshot.length < 6 * 1024 * 1024) {
    screenshotBytes = Math.floor((rawScreenshot.length * 3) / 4);
    screenshotNote = `\n\n[screenshot attached: ${screenshotName || "image"}, ~${Math.round(screenshotBytes / 1024)} KB]`;
  }
  const message = (rawMessage + screenshotNote).slice(0, 4200);

  if (!rawMessage) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  // Y2: per-user 1/day cap on blocker submissions, in addition to the
  // general 3/hour cap already enforced above.
  if (blocker) {
    const blockerOk = await feedbackBlockerLimiter(user.id);
    if (!blockerOk) {
      return NextResponse.json(
        { error: "You can only report one blocker per day. Contact support for anything more urgent." },
        { status: 429 },
      );
    }
  }

  // R5.2: persist to DB. If insert fails we still 200 the user — the log
  // line remains as a fallback signal so we don't drop feedback silently.
  let persisted = false;
  try {
    const db = getDb();
    await db.insert(feedback).values({
      churchId: user.churchId,
      userId: user.id,
      type,
      message,
      blocker,
      email: email ?? null,
    });
    persisted = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[feedback] persist failed:", err instanceof Error ? err.message : String(err));
  }

  // Sanitized single-line log — safe against CRLF injection, truncated.
  // eslint-disable-next-line no-console
  console.log("[feedback]", JSON.stringify({
    userId: user.id,
    churchId: user.churchId,
    type,
    hasEmail: Boolean(email),
    blocker,
    persisted,
    messageLength: message.length,
    messagePreview: sanitizeForLog(message),
    screenshotKB: screenshotBytes > 0 ? Math.round(screenshotBytes / 1024) : 0,
  }));

  return NextResponse.json({ ok: true });
}

// Exported for test-only import; unit tests exercise the validator without
// spinning up the route.
export const __test = { sanitizeForLog, EMAIL_RE };
