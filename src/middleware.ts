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
// PropPresenter-style single-view rebuild: the desktop shell renders only the
// operator surface. Library, setup wizards, tutorials, help pages, dashboard,
// full settings pages are web-only. Requests for those from a desktop shell
// redirect to /operator (see the redirect below). Kept live on the web build.
// `/services/[id]/operate` remains explicitly allowed so operators can jump
// straight into a specific plan (identical layout, plan-scoped).
// Y1 (reviewer): /onboarding removed — it hosts org creation, team invite,
// and billing surfaces which are admin-only on the web build. Desktop shell
// assumes an already-onboarded org (see DECISIONS.md).
const DESKTOP_ALLOWED_PAGE_PREFIXES = [
  "/operator",
  "/_next",
  "/favicon",
];
// Only these `/services/*` subpaths are allowed in desktop. Everything else
// under `/services` (index list, `/services/[id]` detail, `/services/new`)
// redirects to /operator.
const DESKTOP_ALLOWED_SERVICE_SUFFIX = /^\/services\/[^/]+\/operate(?:$|\/)/;

// R1 (reviewer): Exact API allowlist for the desktop shell — replaces the
// prior prefix matcher that inadvertently allowed anything under /api/services,
// /api/library, /api/realtime, etc. Every route here is verified to exist and
// to be a legitimate operator inline call (see src/app/api/**/route.ts).
//
// Anything NOT in the exact set AND NOT under a listed narrow prefix (auth
// callbacks only) returns a JSON 403. Admin-only APIs stay off desktop by
// default.
const DESKTOP_ALLOWED_API_EXACT = new Set<string>([
  "/api/health",
  "/api/health/db",
  "/api/health/storage",
  "/api/ai/lookup-song-metadata",
  "/api/announcements/presets",
  "/api/audio/ticket",
  "/api/autopilot/history",
  "/api/bible/books",
  "/api/bible/chapter",
  "/api/bible/lookup",
  "/api/bible/search",
  "/api/bible/translations",
  "/api/imports/list",
  "/api/imports/parse",
  "/api/media/list",
  "/api/media/presign",
  "/api/pptx/convert",
  "/api/search",
  "/api/sermon/match",
  "/api/songs/library",
  "/api/songs/list",
  "/api/themes",
]);

// Narrow prefixes for dynamic-segment routes that the operator legitimately
// hits. Every entry corresponds to a `[param]` route file. NextAuth needs a
// prefix for /api/auth/callback/[provider], /api/auth/signin, etc.
const DESKTOP_ALLOWED_API_PREFIXES: string[] = [
  "/api/auth/",              // NextAuth dynamic handler (public regardless)
  "/api/ai/helpers/",        // /api/ai/helpers/[action]/route.ts
  "/api/songs/",             // /api/songs/[id]/slides
];

// Regex list for routes that must be checked structurally, not by prefix
// (e.g. dynamic segment mid-path). Each pattern is anchored to full pathname.
const DESKTOP_ALLOWED_API_REGEX: RegExp[] = [
  /^\/api\/songs\/[^/]+\/slides$/,
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
    if (DESKTOP_ALLOWED_API_EXACT.has(pathname)) return true;
    if (DESKTOP_ALLOWED_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;
    if (DESKTOP_ALLOWED_API_REGEX.some((re) => re.test(pathname))) return true;
    return false;
  }
  if (DESKTOP_ALLOWED_SERVICE_SUFFIX.test(pathname)) return true;
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
    if (setShellCookie) res.cookies.set("pf_shell", "desktop", {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
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
    if (setShellCookie) res.cookies.set("pf_shell", "desktop", {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    return res;
  }

  const res = NextResponse.next();
  if (setShellCookie) res.cookies.set("pf_shell", "desktop", {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|mp4)$).*)"] };
