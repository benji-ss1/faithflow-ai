import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth, signIn, signOut } from "@/lib/auth";
import { isTopLevelNavigation } from "@/lib/fetch-metadata";
import { consumeAuthToken, peekAuthTokenUser } from "@/lib/auth-tokens";
import { decideExchange, isSameOriginPost, signExchangeConfirm, verifyExchangeConfirm } from "@/lib/desktop-auth-core";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

/**
 * Desktop-app auto-login handoff. The Electron shell navigates its
 * BrowserWindow here after a presentflow://auth?token=... deep link, and the
 * in-app pairing flow navigates here after approval. Exchanging server-side
 * means the session cookie lands in the Electron window's own cookie jar.
 * Only ever forwards to same-origin /operator or /login.
 *
 * GET decision (decideExchange):
 *   - no session            → exchange immediately (as before)
 *   - same user signed in   → burn the token, go to /operator (no-op)
 *   - DIFFERENT user        → render a "Switch this computer?" page; the token
 *                             is only consumed by a same-origin POST carrying
 *                             a CSRF token bound to (session user, token)
 *   - invalid/expired token → /login?reason=device_link_invalid
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

async function emailFor(userId: string): Promise<string | null> {
  const [row] = await getDb().select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.email ?? null;
}

async function currentUserId(): Promise<string | null> {
  const session = await auth().catch(() => null);
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

async function exchange(req: NextRequest, token: string): Promise<NextResponse> {
  try {
    // Clear any existing session first so signIn cleanly replaces identity.
    await signOut({ redirect: false }).catch(() => { /* no prior session is fine */ });
    await signIn("device-token", { token, redirect: false });
  } catch {
    return NextResponse.redirect(new URL("/login?reason=device_link_invalid", req.url), 303);
  }
  return NextResponse.redirect(new URL("/operator", req.url), 303);
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
  const decision = decideExchange(current, tokenUserId);

  if (decision === "invalid") {
    return NextResponse.redirect(new URL(current ? "/operator" : "/login?reason=device_link_invalid", req.url));
  }
  if (decision === "exchange") return exchange(req, token);
  if (decision === "same-user") {
    await consumeAuthToken(token, "device_link").catch(() => null);
    return NextResponse.redirect(new URL("/operator", req.url));
  }

  // decision === "confirm": never swap silently.
  const [fromEmail, toEmail] = await Promise.all([emailFor(current!), emailFor(tokenUserId!)]);
  const csrf = signExchangeConfirm(current!, token);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Switch account?</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#fff;font:15px/1.5 system-ui,sans-serif;padding:24px 16px}
.card{max-width:460px;width:100%;background:#151515;border:1px solid #2a2a2a;border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 12px}.e{font-family:ui-monospace,Menlo,monospace;color:#ffb861;word-break:break-all}
.row{display:flex;gap:10px;margin-top:22px;flex-wrap:wrap}button,a{flex:1;text-align:center;padding:11px 16px;border-radius:9px;font:600 14px system-ui;cursor:pointer;text-decoration:none}
button{border:0;background:linear-gradient(90deg,#ffb861,#e8501a);color:#0a0a0a}a{border:1px solid #444;color:#fff}</style></head>
<body><div class="card"><h1>Switch this computer to a different account?</h1>
<p>This computer is signed in as <span class="e">${esc(fromEmail ?? "another account")}</span>.</p>
<p>The link you opened would sign it in as <span class="e">${esc(toEmail ?? "a different account")}</span> instead.</p>
<p style="opacity:.7;font-size:13px">Only continue if you started this yourself.</p>
<form method="post" action="/api/auth/device-exchange"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="csrf" value="${esc(csrf)}">
<div class="row"><a href="/operator">Keep current account</a><button type="submit">Switch account</button></div></form></div></body></html>`;
  return new NextResponse(html, { status: 200, headers: PAGE_HEADERS });
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
  // CSRF token is bound to the user who was shown the confirm page. No session
  // (or a different one) means the page wasn't shown to this session → refuse.
  const current = await currentUserId();
  if (!current || !verifyExchangeConfirm(csrf, current, token)) {
    return NextResponse.json({ error: "confirmation expired — open the link again" }, { status: 403 });
  }
  return exchange(req, token);
}
