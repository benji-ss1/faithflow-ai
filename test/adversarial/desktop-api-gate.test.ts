// Adversarial: desktop shell must not be able to call admin API routes.
//
// This test exercises `src/middleware.ts` in a lightweight, dependency-free
// way — we spin up a fake NextRequest per prefix, run the middleware, and
// assert that admin-surface APIs return the JSON 403 for a desktop-shell
// request while operator-safe APIs pass through (auth is stubbed by omitting
// AUTH_SECRET checks — see runWithFakeToken).
//
// RUN
//   npx tsx --env-file=.env.local test/adversarial/desktop-api-gate.test.ts

import { NextRequest } from "next/server";
import { middleware } from "../../src/middleware";

// We monkeypatch getToken to always return a session token, sidestepping the
// real AUTH_SECRET check for this isolation test.
import * as jwtModule from "next-auth/jwt";
(jwtModule as any).getToken = async () => ({ sub: "test-user" });

type Case = { path: string; expectedStatus: number; label: string };

const cases: Case[] = [
  // Admin surfaces — must be JSON 403
  { path: "/api/announcements/presets", expectedStatus: 403, label: "announcements (admin)" },
  { path: "/api/archive/abc", expectedStatus: 403, label: "archive (admin)" },
  // Operator-safe — should NOT be 403 (either pass through to next() or a
  // redirect to /operator only happens for pages, not /api/*)
  { path: "/api/ai/detect", expectedStatus: -1, label: "ai (operator inline)" },
  { path: "/api/bible/lookup", expectedStatus: -1, label: "bible (operator)" },
  { path: "/api/songs/search", expectedStatus: -1, label: "songs (operator)" },
];

async function run() {
  let failed = 0;
  for (const c of cases) {
    const req = new NextRequest(new URL(`http://localhost${c.path}`), {
      headers: { "x-pf-shell": "desktop" },
    });
    const res = await middleware(req);
    const gotStatus = res?.status ?? -1;
    if (c.expectedStatus === 403) {
      if (gotStatus === 403) {
        console.log(`PASS ${c.label} -> 403`);
      } else {
        console.error(`FAIL ${c.label} expected 403 got ${gotStatus}`);
        failed++;
      }
    } else {
      // Must NOT be 403
      if (gotStatus === 403) {
        console.error(`FAIL ${c.label} unexpectedly got 403`);
        failed++;
      } else {
        console.log(`PASS ${c.label} -> ${gotStatus}`);
      }
    }
  }
  if (failed) {
    console.error(`\n${failed} case(s) failed`);
    process.exit(1);
  }
  console.log("\nAll desktop-api-gate cases passed");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
