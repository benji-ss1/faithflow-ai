import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = [
  "/login", "/signup", "/verify-email", "/forgot-password", "/reset-password", "/accept-invite",
  "/live", "/stage", "/livestream", "/api/auth", "/api/health", "/api/stripe",
];

// Non-API surfaces the desktop shell is allowed to render. Admin surfaces
// (dashboard, organization, analytics, subscriptions, applications, products,
// team, profile, archive, invitations) stay off the desktop even though they
// exist in the codebase for the Vercel web build.
const DESKTOP_ALLOWED_PAGE_PREFIXES = [
  "/operator",
  "/services",           // includes /services/[id]/operate
  "/library",            // songs, bible, media, imports, themes
  "/setup",              // projector, audio, diagnostics
  "/tutorial",
  "/help",               // first-sunday playbook etc.
  "/settings",           // gated by page-level shell scoping
  "/onboarding",
  "/_next",
  "/favicon",
];

// API prefixes the desktop shell is allowed to call. Explicit, not `/api`.
// Every prefix here must correspond to an operator-inline surface (content,
// media, real-time detection helpers, health/diagnostics). Admin-only APIs
// (billing, team, org, analytics, invitations, subscriptions, onboarding org
// mutations) must NOT appear here — they return 403 to a desktop shell.
//
// /api/auth and /api/health are also in PUBLIC_PATHS but re-listed here so
// the intent is explicit and doesn't rely on public-path ordering.
const DESKTOP_ALLOWED_API_PREFIXES = [
  "/api/auth",         // NextAuth handler
  "/api/health",       // diagnostics
  "/api/ai",           // detection helpers used inline by operator
  "/api/audio",        // audio streaming/bridge
  "/api/autopilot",    // operator autopilot toggles
  "/api/bible",        // scripture lookups
  "/api/imports",      // parse endpoints
  "/api/library",      // (defensive — not currently present)
  "/api/media",        // uploads used by import surfaces
  "/api/pptx",         // pptx parse
  "/api/realtime",     // (defensive — not currently present)
  "/api/search",       // song/scripture search
  "/api/sermon",       // sermon/match helpers
  "/api/services",     // (defensive — not currently present)
  "/api/songs",        // song lookup
  "/api/themes",       // theme metadata
];

// Operator "live plan" routes we want to preserve across session expiry so
// re-auth returns the operator right where they were.
const OPERATOR_ROUTE_MATCH = /^\/(operator|services\/[^/]+\/operate)(?:$|\/)/;

function isDesktopShell(req: NextRequest): boolean {
  if (req.headers.get("x-pf-shell") === "desktop") return true;
  if (req.cookies.get("pf_shell")?.value === "desktop") return true;
  return false;
}

function desktopPathAllowed(pathname: string): boolean {
  if (pathname === "/operator") return true;
  if (pathname.startsWith("/api/")) {
    return DESKTOP_ALLOWED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  }
  return DESKTOP_ALLOWED_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // Persist the shell marker as a cookie the first time we see the query
  // param from Electron's initial loadURL. Once set, cookie + header both
  // signal desktop for the rest of the session.
  const setShellCookie = searchParams.get("ff_shell") === "desktop";

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    const res = NextResponse.next();
    if (setShellCookie) res.cookies.set("pf_shell", "desktop", { path: "/", sameSite: "lax" });
    return res;
  }

  // Auth.js v5 renamed the cookie. Must pass salt + cookieName + secureCookie
  // explicitly for getToken to read the correct one in production.
  const secureCookie = req.nextUrl.protocol === "https:";
  const cookieName = secureCookie ? "__Secure-authjs.session-token" : "authjs.session-token";
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    salt: cookieName,
    cookieName,
    secureCookie,
  });
  const desktop = isDesktopShell(req) || setShellCookie;

  if (!token) {
    // Desktop-shell session expiry mid-service: preserve the operator route
    // so re-auth lands them back on the same live plan.
    if (desktop && OPERATOR_ROUTE_MATCH.test(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(pathname)}&reason=session_expired`;
      return NextResponse.redirect(url);
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (desktop && !desktopPathAllowed(pathname)) {
    // API surfaces get a JSON 403 so client fetches surface a clear error
    // rather than the HTML of the operator landing page.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "not available in desktop shell" }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/operator";
    url.search = "";
    const res = NextResponse.redirect(url);
    if (setShellCookie) res.cookies.set("pf_shell", "desktop", { path: "/", sameSite: "lax" });
    return res;
  }

  const res = NextResponse.next();
  if (setShellCookie) res.cookies.set("pf_shell", "desktop", { path: "/", sameSite: "lax" });
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|mp4)$).*)"] };
