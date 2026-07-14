import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { createLimiter } from "@/lib/rate-limit";

/**
 * POST /api/feedback — accept bug reports / feature requests from Settings.
 *
 * Auth-gated. Rate-limited to 3 requests per user per hour.
 *
 * For the pilot we log server-side and return 200. A dedicated `feedback`
 * table + support email delivery can be layered on later without changing
 * the client contract.
 *
 * Body: { type: "problem" | "feature", email?: string, message: string, blocker?: boolean }
 */

const feedbackLimiter = createLimiter("feedback", 3, 60 * 60 * 1000);

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
  const email = typeof b.email === "string" ? b.email.slice(0, 200) : undefined;
  const message = typeof b.message === "string" ? b.message.trim().slice(0, 4000) : "";
  const blocker = Boolean(b.blocker);

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  // Server-side log — captured by Vercel logs.
  // eslint-disable-next-line no-console
  console.log("[feedback]", JSON.stringify({
    userId: user.id,
    churchId: user.churchId,
    type,
    email,
    blocker,
    messageLength: message.length,
    message,
  }));

  return NextResponse.json({ ok: true });
}
