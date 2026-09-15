// Adversarial: the desktop/web API gate in `src/middleware.ts`.
//
// Two invariants, both enforced by the same allowlists:
//   1. The desktop shell must NOT reach admin-only API routes (JSON 403).
//   2. A plain browser must NOT reach the live-show surface (operator console,
//      output windows, operator-time APIs) — the web/desktop split.
// Plus: the universal API set (build-id / tier / bible-full / imports-parse /
// media backfill-thumbnails) must work in BOTH shells — those are the five
// paths that were 403ing inside the Electron app (2026-09-16 fix).
//
// We exercise the real middleware with a fake NextRequest; auth is stubbed by
// monkeypatching getToken. No server is started.
//
// RUN
//   npx tsx --env-file=.env.local test/adversarial/desktop-api-gate.test.ts

import { NextRequest } from "next/server";

import { encode } from "next-auth/jwt";
import { middleware } from "../../src/middleware";

// The middleware's auth check runs BEFORE the desktop/web gate, so every case
// needs a valid session or we'd only ever measure the /login redirect. We mint
// a REAL Auth.js v5 session cookie with the local AUTH_SECRET (the module
// namespace is getter-only, so getToken cannot be monkeypatched) using the same
// cookieName-as-salt convention as src/middleware.ts.
const COOKIE_NAME = "authjs.session-token"; // http:// → non-secure variant

async function sessionCookie(): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET missing — run with --env-file=.env.local");
  const jwt = await encode({
    token: { sub: "test-user", email: "test@example.com" },
    secret,
    salt: COOKIE_NAME,
    maxAge: 60 * 60,
  });
  return `${COOKIE_NAME}=${jwt}`;
}

type Shell = "desktop" | "web";
type Expect = "blocked" | "allowed";
type Case = { path: string; shell: Shell; expect: Expect; label: string };

const UNIVERSAL_APIS = [
  "/api/build-id",
  "/api/tier",
  "/api/bible/full",
  "/api/imports/parse",
  "/api/media/backfill-thumbnails",
];

const cases: Case[] = [
  // --- The five universal APIs: must work in the desktop shell ------------
  ...UNIVERSAL_APIS.map<Case>((path) => ({
    path,
    shell: "desktop",
    expect: "allowed",
    label: `desktop ${path}`,
  })),
  // --- ...and must still work in a plain browser (no shell header) --------
  ...UNIVERSAL_APIS.map<Case>((path) => ({
    path,
    shell: "web",
    expect: "allowed",
    label: `web ${path}`,
  })),

  // --- Admin surfaces stay blocked on desktop ----------------------------
  { path: "/api/archive/abc123/export", shell: "desktop", expect: "blocked", label: "desktop archive export (admin)" },
  { path: "/api/search", shell: "desktop", expect: "blocked", label: "desktop global search (admin)" },

  // --- Web/desktop split intact: live-show surface stays off the browser --
  { path: "/api/bible/lookup", shell: "web", expect: "blocked", label: "web bible lookup (desktop-only)" },
  { path: "/operator", shell: "web", expect: "blocked", label: "web /operator (desktop-only)" },

  // --- Desktop keeps its own surface -------------------------------------
  { path: "/operator", shell: "desktop", expect: "allowed", label: "desktop /operator" },
  { path: "/live", shell: "desktop", expect: "allowed", label: "desktop /live" },
  { path: "/stage", shell: "desktop", expect: "allowed", label: "desktop /stage" },
  { path: "/livestream", shell: "desktop", expect: "allowed", label: "desktop /livestream" },
];

/**
 * "Blocked" means the gate rejected the request: a JSON 403 for /api/*, or a
 * redirect away from the requested path for pages (browser → /settings/outputs,
 * desktop → /operator). A pass-through (NextResponse.next(), status 200) or a
 * response that isn't a gate rejection counts as allowed.
 */
function isBlocked(res: Response | undefined, path: string): boolean {
  if (!res) return false;
  if (res.status === 403) return true;
  if (path.startsWith("/api/")) return false;
  // Page gate: 3xx redirect to a different path.
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") || "";
    try {
      return new URL(loc, "http://localhost").pathname !== path;
    } catch {
      return true;
    }
  }
  return false;
}

async function run() {
  let failed = 0;
  const cookie = await sessionCookie();
  for (const c of cases) {
    const headers: Record<string, string> = { cookie };
    if (c.shell === "desktop") headers["x-pf-shell"] = "desktop";
    const req = new NextRequest(new URL(`http://localhost${c.path}`), { headers });
    const res = (await middleware(req)) as Response | undefined;
    const blocked = isBlocked(res, c.path);
    const ok = c.expect === "blocked" ? blocked : !blocked;
    if (ok) {
      console.log(`PASS ${c.label} -> ${c.expect} (${res?.status ?? "next()"})`);
    } else {
      console.error(
        `FAIL ${c.label} expected ${c.expect} got ${blocked ? "blocked" : "allowed"} (${res?.status ?? "next()"})`,
      );
      failed++;
    }
  }
  if (failed) {
    console.error(`\n${failed} case(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} desktop-api-gate cases passed`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
