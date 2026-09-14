import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth, signIn } from "@/lib/auth";
import { isTopLevelNavigation } from "@/lib/fetch-metadata";
import { consumeAuthToken, peekAuthTokenUser } from "@/lib/auth-tokens";
import {
  ANON_CONFIRM_SUBJECT,
  PAIR_MARKER_COOKIE,
  decideExchange,
  isSameOriginPost,
  signExchangeConfirm,
  verifyExchangeConfirm,
  verifyPairExchangeMarker,
} from "@/lib/desktop-auth-core";
import { getDb } from "@/lib/db/client";
import { churches, users } from "@/lib/db/schema";

/**
 * Desktop-app auto-login handoff. The Electron shell navigates its
 * BrowserWindow here after a presentflow://auth?token=... deep link, and the
 * in-app pairing flow navigates here after approval. Exchanging server-side
 * means the session cookie lands in the Electron window's own cookie jar.
 * Only ever forwards to same-origin /operator or /login.
 *
 * GET decision (decideExchange):
 *   - no session + pairing marker cookie (the window that polled) → exchange
 *   - no session, no marker (deep link / forwarded URL) → "Sign in as <email>
 *     (<church>)?" confirm page (login-CSRF protection)
 *   - same user signed in   → burn the token, go to /operator (no-op)
 *   - DIFFERENT user        → "Switch this computer?" confirm page
 *   - invalid/expired token → /login?reason=device_link_invalid
 * Both confirm pages POST back same-origin with a CSRF token bound to
 * (session user | "anon", token).
 */

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function accountFor(userId: string): Promise<{ email: string; church: string | null } | null> {
  const [row] = await getDb()
    .select({ email: users.email, church: churches.name })
    .from(users)
    .leftJoin(churches, eq(churches.id, users.churchId))
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

async function currentUserId(): Promise<string | null> {
  const session = await auth().catch(() => null);
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

function clearMarker(res: NextResponse): NextResponse {
  res.cookies.set(PAIR_MARKER_COOKIE, "", { path: "/api/auth/device-exchange", maxAge: 0, httpOnly: true, sameSite: "strict" });
  return res;
}

async function exchange(req: NextRequest, token: string): Promise<NextResponse> {
  // Validate BEFORE touching the current session: a dead token must never
  // leave an already-signed-in user signed out. No explicit signOut — signIn
  // replaces the JWT cookie only when the device-token authorize() succeeds
  // (it atomically consumes the token), so a failure keeps the old session.
  if (!(await peekAuthTokenUser(token, "device_link"))) {
    return clearMarker(NextResponse.redirect(new URL("/login?reason=device_link_invalid", req.url), 303));
  }
  try {
    await signIn("device-token", { token, redirect: false });
  } catch {
    return clearMarker(NextResponse.redirect(new URL("/login?reason=device_link_invalid", req.url), 303));
  }
  return clearMarker(NextResponse.redirect(new URL("/operator", req.url), 303));
}

function page(title: string, body: string, token: string, csrf: string, cancelHref: string, cancelLabel: string, submitLabel: string): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#fff;font:15px/1.5 system-ui,sans-serif;padding:24px 16px}
.card{max-width:460px;width:100%;background:#151515;border:1px solid #2a2a2a;border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 12px}.e{font-family:ui-monospace,Menlo,monospace;color:#ffb861;word-break:break-all}
.row{display:flex;gap:10px;margin-top:22px;flex-wrap:wrap}button,a{flex:1;text-align:center;padding:11px 16px;border-radius:9px;font:600 14px system-ui;cursor:pointer;text-decoration:none}
button{border:0;background:linear-gradient(90deg,#ffb861,#e8501a);color:#0a0a0a}a{border:1px solid #444;color:#fff}</style></head>
<body><div class="card"><h1>${esc(title)}</h1>${body}
<p style="opacity:.7;font-size:13px">Only continue if you started this yourself, on this computer, just now.</p>
<form method="post" action="/api/auth/device-exchange"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="csrf" value="${esc(csrf)}">
<div class="row"><a href="${cancelHref}">${esc(cancelLabel)}</a><button type="submit">${esc(submitLabel)}</button></div></form></div></body></html>`;
  return new NextResponse(html, { status: 200, headers: PAGE_HEADERS });
}

function describe(a: { email: string; church: string | null } | null, fallback: string): string {
  if (!a) return `<span class="e">${esc(fallback)}</span>`;
  return `<span class="e">${esc(a.email)}</span>${a.church ? ` (${esc(a.church)})` : ""}`;
}

export async function GET(req: NextRequest) {
  // Only act on a TOP-LEVEL NAVIGATION — a subresource GET (<img>, fetch,
  // iframe) must never swap or create a session. See isTopLevelNavigation.
  if (!isTopLevelNavigation(req.headers)) {
    return NextResponse.json({ error: "navigation required" }, { status: 400 });
  }
  const token = req.nextUrl.searchParams.get("token");
  if (!token || token.length > 256) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const current = await currentUserId();
  const tokenUserId = await peekAuthTokenUser(token, "device_link");
  const pairMarkerValid = verifyPairExchangeMarker(req.cookies.get(PAIR_MARKER_COOKIE)?.value, token);
  const decision = decideExchange(current, tokenUserId, { pairMarkerValid });

  if (decision === "invalid") {
    return NextResponse.redirect(new URL(current ? "/operator" : "/login?reason=device_link_invalid", req.url));
  }
  if (decision === "exchange") return exchange(req, token);
  if (decision === "same-user") {
    await consumeAuthToken(token, "device_link").catch(() => null);
    return clearMarker(NextResponse.redirect(new URL("/operator", req.url)));
  }

  if (decision === "confirm-signin") {
    const to = await accountFor(tokenUserId!);
    return page(
      "Sign in to PresentFlow?",
      `<p>This computer will be signed in as ${describe(to, "a PresentFlow account")}.</p>`,
      token,
      signExchangeConfirm(ANON_CONFIRM_SUBJECT, token),
      "/login",
      "Cancel",
      "Sign in",
    );
  }

  // decision === "confirm": never swap silently.
  const [from, to] = await Promise.all([accountFor(current!), accountFor(tokenUserId!)]);
  return page(
    "Switch this computer to a different account?",
    `<p>This computer is signed in as ${describe(from, "another account")}.</p><p>The link you opened would sign it in as ${describe(to, "a different account")} instead.</p>`,
    token,
    signExchangeConfirm(current!, token),
    "/operator",
    "Keep current account",
    "Switch account",
  );
}

export async function POST(req: NextRequest) {
  if (!isSameOriginPost(req.headers)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let token = "";
  let csrf = "";
  try {
    const form = await req.formData();
    token = String(form.get("token") ?? "");
    csrf = String(form.get("csrf") ?? "");
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!token || token.length > 256) return NextResponse.redirect(new URL("/login?reason=device_link_invalid", req.url), 303);
  // CSRF token is bound to the subject that was shown the confirm page: the
  // signed-in user, or "anon" for the no-session sign-in confirm. A session
  // that differs from what was shown → refuse.
  const current = await currentUserId();
  if (!verifyExchangeConfirm(csrf, current ?? ANON_CONFIRM_SUBJECT, token)) {
    return NextResponse.json({ error: "confirmation expired — open the link again" }, { status: 403 });
  }
  return exchange(req, token);
}
