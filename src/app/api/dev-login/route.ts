import { NextRequest, NextResponse } from "next/server";
import { signIn, signOut } from "@/lib/auth";

/**
 * DEV-ONLY auto-login. Signs in the demo/dev account so the operator console
 * loads without the login screen while iterating locally.
 *
 * HARD-GUARDED: returns 404 unless NODE_ENV === "development" AND
 * DEV_AUTOLOGIN === "1". Credentials come from DEV_LOGIN_EMAIL /
 * DEV_LOGIN_PASSWORD in .env.local (gitignored) — never hardcoded, never
 * shipped. Sandbox branch only. Do NOT merge to main.
 */
function devEnabled() {
  return process.env.NODE_ENV === "development" && process.env.DEV_AUTOLOGIN === "1";
}

export async function GET(req: NextRequest) {
  if (!devEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });

  const email = process.env.DEV_LOGIN_EMAIL;
  const password = process.env.DEV_LOGIN_PASSWORD;
  if (!email || !password) {
    return NextResponse.json({ error: "Set DEV_LOGIN_EMAIL and DEV_LOGIN_PASSWORD in .env.local." }, { status: 500 });
  }

  const nextParam = req.nextUrl.searchParams.get("next") || "/operator";
  const dest = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/operator";

  try {
    await signOut({ redirect: false }).catch(() => {});
    await signIn("credentials", { email, password, redirect: false });
  } catch {
    return NextResponse.redirect(new URL("/login?reason=dev_login_failed", req.url));
  }
  return NextResponse.redirect(new URL(dest, req.url));
}
