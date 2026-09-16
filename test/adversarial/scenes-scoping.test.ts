// Adversarial SCENES scoping test (2026-09-16).
//
// PURPOSE
//   Prove the `scenes` table can never leak across churches: a Church-A-scoped
//   read never returns Church B's scene, and an update/delete aimed at B's row
//   while scoped to A affects ZERO rows (the church predicate IS the
//   authorization — a cross-church id must be indistinguishable from not-found).
//
// WHEN TO RUN
//   Before shipping Scenes, and before every release after. Any FAIL = a
//   scoping regression = STOP.
//
// RUN
//   npx tsx --env-file=.env.local test/adversarial/scenes-scoping.test.ts
//
// CLEANUP
//   Both ephemeral churches (and their scenes, via FK cascade + an explicit
//   reverse delete) are removed at the end, even on failure.
import { and, eq } from "drizzle-orm";
import { getDb } from "../../src/lib/db/client";
import { churches, scenes } from "../../src/lib/db/schema";
import { sanitizeSceneConfig } from "../../src/lib/scenes";

const MARKER_B = "MARKER_B_SCENE_FINGERPRINT_BRAVO456";

let pass = 0, fail = 0;
function record(name: string, ok: boolean, detail = "") {
  if (ok) { console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ""}`); pass++; }
  else { console.error(`[FAIL] ${name}${detail ? ` — ${detail}` : ""}`); fail++; }
}
function containsMarkerB(x: unknown): boolean {
  try { return JSON.stringify(x ?? "").includes(MARKER_B); } catch { return false; }
}

async function main() {
  const db = getDb();
  const [churchA] = await db.insert(churches).values({ name: `ZZ Scenes A ${Date.now()}` }).returning({ id: churches.id });
  const [churchB] = await db.insert(churches).values({ name: `ZZ Scenes B ${Date.now()}` }).returning({ id: churches.id });

  try {
    const [sceneA] = await db.insert(scenes).values({
      churchId: churchA.id, name: "A Worship", config: sanitizeSceneConfig({ screens: { stage: { layers: { background: false } } } }) as unknown as Record<string, unknown>,
    }).returning({ id: scenes.id });
    const [sceneB] = await db.insert(scenes).values({
      churchId: churchB.id, name: MARKER_B, config: { screens: { main: { themeId: MARKER_B } } },
    }).returning({ id: scenes.id });

    // 1. A church-scoped list never sees B.
    const listedForA = await db.select().from(scenes).where(eq(scenes.churchId, churchA.id));
    record("list(scenes, church A) excludes church B", !containsMarkerB(listedForA), `rows=${listedForA.length}`);
    record("list(scenes, church A) returns A's own scene", listedForA.some((r) => r.id === sceneA.id));

    // 2. Reading B's row BY ID while scoped to A finds nothing.
    const stolen = await db.select().from(scenes).where(and(eq(scenes.id, sceneB.id), eq(scenes.churchId, churchA.id)));
    record("get(B's scene id, scoped to A) is empty", stolen.length === 0 && !containsMarkerB(stolen));

    // 3. Update aimed at B's row while scoped to A touches nothing.
    const upd = await db.update(scenes).set({ name: "HIJACKED" })
      .where(and(eq(scenes.id, sceneB.id), eq(scenes.churchId, churchA.id)));
    const bAfter = await db.select().from(scenes).where(eq(scenes.id, sceneB.id));
    record("update(B's scene, scoped to A) affects 0 rows", ((upd as { rowCount?: number }).rowCount ?? 0) === 0);
    record("B's scene is unchanged after the attempt", bAfter[0]?.name === MARKER_B, `name=${bAfter[0]?.name}`);

    // 4. Delete aimed at B's row while scoped to A deletes nothing.
    const del = await db.delete(scenes).where(and(eq(scenes.id, sceneB.id), eq(scenes.churchId, churchA.id)));
    const bStill = await db.select().from(scenes).where(eq(scenes.id, sceneB.id));
    record("delete(B's scene, scoped to A) affects 0 rows", ((del as { rowCount?: number }).rowCount ?? 0) === 0);
    record("B's scene still exists after the attempt", bStill.length === 1);

    // 5. A hostile config is whitelist-rebuilt on the way in (no arbitrary jsonb).
    const dirty = sanitizeSceneConfig({ screens: { main: { layers: { slide: false }, evil: MARKER_B }, lobby: { layers: { slide: false } } } });
    record("sanitizeSceneConfig drops unknown screens/keys", !containsMarkerB(dirty) && !("lobby" in dirty.screens));
  } finally {
    await db.delete(scenes).where(eq(scenes.churchId, churchA.id));
    await db.delete(scenes).where(eq(scenes.churchId, churchB.id));
    await db.delete(churches).where(eq(churches.id, churchA.id));
    await db.delete(churches).where(eq(churches.id, churchB.id));
  }

  console.log(`\nScenes scoping: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
