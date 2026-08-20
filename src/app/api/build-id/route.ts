import { NextResponse } from "next/server";

// Per-deploy build identifier. Vercel sets VERCEL_GIT_COMMIT_SHA at build time,
// so this string changes on every deploy. The client (UpdatePrompt) polls it and
// offers a one-click reload when it changes — so operators pick up new builds
// without hunting for the "clear cache" menu. `dev` in local dev (stable, so no
// prompt fires locally).
export const dynamic = "force-dynamic";

const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_BUILD_ID ||
  "dev";

export function GET() {
  return NextResponse.json(
    { id: BUILD_ID },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
