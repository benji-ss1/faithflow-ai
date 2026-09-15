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
type Case = {
  path: string;
  shell: Shell;
  expect: Expect;
  label: string;
  method?: "GET" | "POST";
  origin?: string;
};

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

  // --- NEGATIVE: the universal set is EXACT, never a prefix ---------------
  // These siblings would all start passing if someone swapped the Set.has
  // lookup for a startsWith matcher — the whole point of the exact match.
  { path: "/api/build-id/x", shell: "desktop", expect: "blocked", label: "desktop /api/build-id/x (sibling)" },
  { path: "/api/tier/secret", shell: "desktop", expect: "blocked", label: "desktop /api/tier/secret (sibling)" },
  { path: "/api/bible/full/extra", shell: "desktop", expect: "blocked", label: "desktop /api/bible/full/extra (sibling)" },
  { path: "/api/imports/list-all", shell: "desktop", expect: "blocked", label: "desktop /api/imports/list-all (prefix graze)" },
  { path: "/api/imports/parse/all", shell: "desktop", expect: "blocked", label: "desktop /api/imports/parse/all (sibling)" },
  { path: "/api/media/backfill-thumbnails/all", shell: "desktop", expect: "blocked", label: "desktop backfill-thumbnails/all (sibling)" },
  // Trailing slash and case variants are NOT the allowlisted path.
  { path: "/api/tier/", shell: "desktop", expect: "blocked", label: "desktop /api/tier/ (trailing slash)" },
  { path: "/api/Tier", shell: "desktop", expect: "blocked", label: "desktop /api/Tier (case variant)" },

  // --- CSRF branch still guards the state-changing universal POSTs --------
  // The CSRF check runs before the shell gate, so a foreign Origin is rejected
  // even on an allowlisted path; a same-origin POST passes both.
  {
    path: "/api/imports/parse", shell: "desktop", method: "POST",
    origin: "https://evil.example", expect: "blocked",
    label: "desktop POST imports/parse foreign Origin (CSRF)",
  },
  {
    path: "/api/media/backfill-thumbnails", shell: "desktop", method: "POST",
    origin: "https://evil.example", expect: "blocked",
    label: "desktop POST backfill-thumbnails foreign Origin (CSRF)",
  },
  {
    path: "/api/imports/parse", shell: "desktop", method: "POST",
    origin: "http://localhost", expect: "allowed",
    label: "desktop POST imports/parse same-origin",
  },

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
    if (c.origin) headers["origin"] = c.origin;
    const req = new NextRequest(new URL(`http://localhost${c.path}`), {
      headers,
      method: c.method ?? "GET",
    });
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
  // --- Role gate on the import WRITE path ---------------------------------
  // The middleware knows nothing about roles (the session role is resolved in
  // the route via apiUser()), so this can't be an HTTP-level case here. Assert
  // the capability mapping that src/app/api/imports/parse/route.ts now gates
  // on instead: only admin/operator hold edit_library.
  const { hasCap } = require("../../src/lib/session") as {
    hasCap: (role: string, cap: string) => boolean;
  };
  const roleCases: Array<[string, boolean]> = [
    ["admin", true],
    ["operator", true],
    ["volunteer", false],
    ["pastor", false],
    ["viewer", false],
  ];
  for (const [role, expected] of roleCases) {
    const got = hasCap(role, "edit_library");
    if (got === expected) {
      console.log(`PASS role ${role} edit_library=${got} (import entry points ${expected ? "allowed" : "rejected"})`);
    } else {
      console.error(`FAIL role ${role} edit_library expected ${expected} got ${got}`);
      failed++;
    }
  }

  // ...and assert every IMPORT WRITE entry point actually carries that gate.
  // These all land songs / media / S3 objects in the church library, so a
  // volunteer / pastor / viewer must be rejected at each one — gating only the
  // parse route would leave the commit half open (2026-09-16 review).
  // previewImportDrop is deliberately NOT here: it is read-only (parse in
  // memory + duplicate lookup, no insert, no upload).
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const entryPoints: Array<{ file: string; fn: string; gate: RegExp }> = [
    { file: "src/lib/import-actions.ts", fn: "export async function importDrop", gate: /requireCap\("edit_library"\)/ },
    { file: "src/lib/import-actions.ts", fn: "export async function finalizeImport", gate: /requireCap\("edit_library"\)/ },
    { file: "src/lib/import-actions.ts", fn: "export async function extractThemeBackgrounds", gate: /requireCap\("edit_library"\)/ },
    { file: "src/lib/actions.ts", fn: "export async function importPro6Files", gate: /requireCap\("edit_library"\)/ },
    { file: "src/lib/actions.ts", fn: "export async function importSongsCsv", gate: /requireCap\("edit_library"\)/ },
    { file: "src/lib/actions.ts", fn: "export async function importParsedSongs", gate: /requireCap\("edit_library"\)/ },
    { file: "src/app/api/imports/parse/route.ts", fn: "export async function POST", gate: /hasCap\(user\.role, "edit_library"\)/ },
  ];
  for (const ep of entryPoints) {
    const src = fs.readFileSync(path.join(__dirname, "../..", ep.file), "utf8");
    const at = src.indexOf(ep.fn);
    // Gate must appear in the function's opening lines, before any DB/S3 work.
    const head = at === -1 ? "" : src.slice(at, at + 1400);
    if (at !== -1 && ep.gate.test(head)) {
      console.log(`PASS gate ${ep.file} :: ${ep.fn.replace("export async function ", "")}`);
    } else {
      console.error(`FAIL gate MISSING on ${ep.file} :: ${ep.fn} — import writes must require edit_library`);
      failed++;
    }
  }

  if (failed) {
    console.error(`\n${failed} case(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length + roleCases.length + entryPoints.length} desktop-api-gate cases passed`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
