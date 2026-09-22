/**
 * The banner must FAIL LOUD.
 * Run: npx tsx test/environment-banner.test.ts
 *
 * The dangerous direction is asymmetric: believing you are on a test build
 * while on production is catastrophic; the reverse is merely annoying. So the
 * ONLY thing that may hide the banner is VERCEL_ENV explicitly equal to
 * "production" — anything missing, empty or unexpected must show it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { envBannerKind } from "../src/components/EnvironmentBanner";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/* ── 1. only an explicit "production" hides it ───────────────────────────── */

assert.equal(envBannerKind("production", false), null, "real production, real church: nothing");
for (const env of ["preview", "development", "staging", "", undefined, "PRODUCTION", "prod", "Production"]) {
  assert.equal(
    envBannerKind(env as string | undefined, false), "preview",
    `VERCEL_ENV=${JSON.stringify(env)} must show the banner — only an exact "production" may hide it`,
  );
}

/* ── 2. a demo church is marked even on production ───────────────────────── */

assert.equal(envBannerKind("production", true), "demo",
  "a demo church on production still needs marking — the data is not a real congregation's");
assert.equal(envBannerKind("preview", true), "preview",
  "not-production outranks demo: the build being wrong matters more than the data being fake");

/* ── 3. the colours cannot be themed away ────────────────────────────────── */

const src = read("../src/components/EnvironmentBanner.tsx");
assert.ok(!/var\(--color/.test(src),
  "the banner must NOT use theme tokens — a theme bug must not be able to hide it");
assert.ok(/#B91C1C/.test(src), "hard-coded red for the not-live state");

/* ── 4. it cannot be clicked through or covered ──────────────────────────── */

assert.ok(/pointerEvents: "none"/.test(src), "must never swallow a click meant for the app");
assert.ok(/zIndex: 2147483647/.test(src), "must sit above all app chrome");

/* ── 5. the OUTPUT surfaces are marked — the ones a congregation sees ────── */

for (const p of [
  "../src/app/live/page.tsx",
  "../src/app/stage/page.tsx",
  "../src/app/livestream/page.tsx",
  "../src/app/ndi/page.tsx",
]) {
  const page = read(p);
  assert.ok(/<OutputEnvironmentMark/.test(page),
    `${p}: an unmarked test-build projector output is how someone ends up running a real service off it`);
  assert.ok(/NEXT_PUBLIC_VERCEL_ENV/.test(page),
    `${p}: must use the PUBLIC env var — the server-only one is undefined in a client component`);
}

/* ── 6. the app shell renders it ─────────────────────────────────────────── */

const layout = read("../src/app/layout.tsx");
assert.ok(/<EnvironmentBanner/.test(layout), "the app shell must render the banner");
assert.ok(/vercelEnv=\{process\.env\.VERCEL_ENV\}/.test(layout),
  "the shell is a server component, so it uses the server env var");

/* ── 7. media deletes are production-only ────────────────────────────────── */
// Storage is shared between production and preview, and the provider (Supabase,
// via a custom S3 endpoint) has no bucket versioning — so a delete from a test
// build permanently destroys a real church's file. There is no undo.

const s3 = read("../src/lib/s3.ts");
assert.ok(/export function deletesAllowed/.test(s3), "there must be an explicit delete guard");
assert.ok(/if \(!deletesAllowed\(\)\)/.test(s3), "deleteObject must actually consult it");
assert.ok(/throw new Error\(/.test(s3.split("export async function deleteObject")[1] ?? ""),
  "a refused delete must THROW — a silent no-op would tell the operator the file was removed when it was not");

console.log("environment-banner: fail-loud guards passed");
