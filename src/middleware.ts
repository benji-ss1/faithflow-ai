import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = [
  "/login", "/signup", "/verify-email", "/forgot-password", "/reset-password", "/accept-invite",
  "/live", "/stage", "/livestream", "/api/auth", "/api/health", "/api/stripe",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
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
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|mp4)$).*)"] };
