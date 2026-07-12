import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = [
  "/login", "/signup", "/verify-email", "/forgot-password", "/reset-password", "/accept-invite",
  "/live", "/stage", "/livestream", "/api/auth", "/api/health", "/api/stripe",
];

// Routes the desktop shell is allowed to render. Anything not on this list
// (and not a public path) gets sent to /operator so admin surfaces stay
// exclusive to the web portal on Vercel.
const DESKTOP_ALLOWED_PREFIXES = [
  "/operator",
  "/services",           // includes /services/[id]/operate
  "/library",            // songs, bible, media, imports, themes
  "/setup",              // projector, audio, diagnostics
  "/tutorial",
  "/help",               // first-sunday playbook etc.
  "/settings",           // gated by page-level shell scoping
  "/onboarding",
  "/api",                // server actions + api routes
  "/_next",
  "/favicon",
];

function isDesktopShell(req: NextRequest): boolean {
  if (req.headers.get("x-pf-shell") === "desktop") return true;
  if (req.cookies.get("pf_shell")?.value === "desktop") return true;
  return false;
}

function desktopPathAllowed(pathname: string): boolean {
  if (pathname === "/operator") return true;
  return DESKTOP_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
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
  if (!token) return NextResponse.redirect(new URL("/login", req.url));

  const desktop = isDesktopShell(req) || setShellCookie;
  if (desktop && !desktopPathAllowed(pathname)) {
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
