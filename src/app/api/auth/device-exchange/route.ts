import { NextRequest, NextResponse } from "next/server";
import { signIn, signOut } from "@/lib/auth";

/**
 * Desktop-app auto-login handoff. The Electron shell navigates its
 * BrowserWindow here (never a raw redirect target for arbitrary content —
 * this route only ever forwards to same-origin /operator or /login) after
 * receiving a presentflow://auth?token=... deep link. Exchanging the token
 * server-side here means the session cookie lands in the Electron window's
 * own cookie jar, exactly as if the user had typed a password in it.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  try {
    // Clear any existing session first — this route can be hit while a
    // different user's session is already active in the Electron window
    // (e.g. a second-instance deep link on a shared kiosk machine). Without
    // this, signIn() would layer a new cookie on top rather than cleanly
    // replacing the old identity.
    await signOut({ redirect: false }).catch(() => { /* no prior session is fine */ });
    await signIn("device-token", { token, redirect: false });
  } catch {
    return NextResponse.redirect(new URL("/login?reason=device_link_invalid", req.url));
  }
  return NextResponse.redirect(new URL("/operator", req.url));
}
