/**
 * Server-side duplicate-media merge (2026-09-23). Pure DB step, split out of
 * the `removeDuplicateMedia` server action so it can be adversarially tested
 * against a real database without an auth session.
 *
 * Church-scoped at every statement: rows are selected by (church_id, id) and
 * only service_items in THIS church's plans are re-pointed. Returns the
 * removed rows (for storage cleanup by the caller), or an error string.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { getDb } from "../db/client";
import { mediaAssets, songs } from "../db/schema";

type Db = ReturnType<typeof getDb>;
/** s3Key/thumbS3Key are null when a surviving row still references that object (don't delete it). */
export type RemovedMediaRow = { id: string; s3Key: string | null; thumbS3Key: string | null };

/** Mirrors the client rule in src/lib/media-sync.ts (mediaDupKey): unknown
 *  size (<=0) or an empty name is never a duplicate. */
export function serverDupKey(r: { kind: string; fileName: string; sizeBytes: number }): string | null {
  const name = (r.fileName || "").trim().toLowerCase();
  if (!name || !Number.isFinite(r.sizeBytes) || r.sizeBytes <= 0) return null;
  return `${r.kind}|${name}|${r.sizeBytes}`;
}

export async function mergeDuplicateMediaRows(
  db: Db, churchId: string, keepId: string, removeIds: string[],
): Promise<{ ok: true; removed: RemovedMediaRow[] } | { ok: false; error: string }> {
  const ids = Array.from(new Set(removeIds.filter((x) => typeof x === "string" && x && x !== keepId))).slice(0, 200);
  if (!keepId || ids.length === 0) return { ok: false, error: "Nothing to remove" };
  type Row = typeof mediaAssets.$inferSelect;
  let victims: Row[] = [];
  let error: string | null = null;

  // Everything — the read, the duplicate check and the writes — happens in ONE
  // transaction with the rows locked (FOR UPDATE). Two operators cleaning the
  // same group at once (A keeps X/drops Y while B keeps Y/drops X) serialize:
  // the second sees its "keep" row gone and aborts, so both copies can never
  // be deleted.
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(mediaAssets)
      .where(and(eq(mediaAssets.churchId, churchId), inArray(mediaAssets.id, [keepId, ...ids])))
      .for("update");
    const keep = rows.find((r) => r.id === keepId);
    if (!keep) { error = "Not found"; return; }
    const keepKey = serverDupKey(keep);
    victims = keepKey ? rows.filter((r) => r.id !== keepId && serverDupKey(r) === keepKey) : [];
    if (victims.length === 0) { error = "Those items aren't duplicates of the one you kept"; return; }
    const victimIds = victims.map((v) => v.id);
    // Explicit ARRAY[...] — drizzle expands a bare JS array param into a tuple, not a PG array.
    const victimArr = sql`ARRAY[${sql.join(victimIds.map((v) => sql`${v}`), sql`, `)}]::text[]`;

    // 1. Re-point single-asset playlist items to the kept copy.
    await tx.execute(sql`
      UPDATE service_items si
      SET payload = jsonb_set(si.payload, '{mediaAssetId}', to_jsonb(${keepId}::text))
      FROM service_plans sp
      WHERE si.service_plan_id = sp.id
        AND sp.church_id = ${churchId}
        AND si.type = 'media'
        AND si.payload->>'mediaAssetId' = ANY(${victimArr})
    `);
    // 2. Re-point media GROUP items (mediaAssetIds[]) element-wise, order kept.
    await tx.execute(sql`
      UPDATE service_items si
      SET payload = jsonb_set(si.payload, '{mediaAssetIds}', (
        SELECT COALESCE(jsonb_agg(
          CASE WHEN e #>> '{}' = ANY(${victimArr}) THEN to_jsonb(${keepId}::text) ELSE e END
          ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements(si.payload->'mediaAssetIds') WITH ORDINALITY AS t(e, ord)
      ))
      FROM service_plans sp
      WHERE si.service_plan_id = sp.id
        AND sp.church_id = ${churchId}
        AND si.type = 'media'
        AND jsonb_typeof(si.payload->'mediaAssetIds') = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(si.payload->'mediaAssetIds') x
          WHERE x = ANY(${victimArr})
        )
    `);
    // 3. Songs whose default background (ProPresenter import) is a removed copy
    //    switch to the kept copy — otherwise ON DELETE SET NULL would strip it.
    await tx.update(songs).set({ defaultBackgroundAssetId: keepId })
      .where(and(eq(songs.churchId, churchId), inArray(songs.defaultBackgroundAssetId, victimIds)));
    // 4. Direct media LINKS stored as URLs (slide objects, per-slide
    //    backgrounds in playlist payloads, song settings, themes, announcement
    //    presets). These carry the storage key inside the URL path and are
    //    re-signed from it on read, so swapping the removed copy's key for the
    //    kept copy's key re-points every such link. Own-church keys only.
    for (const v of victims) {
      if (!v.s3Key.startsWith(`${churchId}/`) || !keep.s3Key.startsWith(`${churchId}/`) || v.s3Key === keep.s3Key) continue;
      // Only JSON-safe keys (presign mints [a-z0-9/.-]); a legacy key with a quote
      // or backslash would make the text replace produce invalid JSON.
      if (!SAFE_KEY.test(v.s3Key) || !SAFE_KEY.test(keep.s3Key)) continue;
      await repointKeyText(tx, churchId, v.s3Key, keep.s3Key);
    }
    // 5. Delete the duplicate rows (church-scoped).
    await tx.delete(mediaAssets).where(and(eq(mediaAssets.churchId, churchId), inArray(mediaAssets.id, victimIds)));
  });
  if (error) return { ok: false, error };
  // Storage safety: a ProPresenter finalize can register a row that REUSES an
  // already-streamed s3Key, so two rows may share one object. Never hand back a
  // key that a surviving row still points at — deleting it would blank the copy
  // the operator chose to keep.
  const keys = Array.from(new Set(victims.flatMap((v) => [v.s3Key, v.thumbS3Key].filter((k): k is string => !!k))));
  const stillUsed = new Set<string>();
  if (keys.length) {
    const survivors = await db.select({ s3Key: mediaAssets.s3Key, thumbS3Key: mediaAssets.thumbS3Key }).from(mediaAssets)
      .where(sql`${mediaAssets.s3Key} IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)}) OR ${mediaAssets.thumbS3Key} IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`);
    for (const r of survivors) { stillUsed.add(r.s3Key); if (r.thumbS3Key) stillUsed.add(r.thumbS3Key); }
  }
  // Defence in depth: only ever hand back objects under THIS church's prefix
  // (presign mints `${churchId}/...`), so a row carrying a foreign key can
  // never cause another church's object to be deleted.
  const ownKey = (k: string | null | undefined) =>
    !!k && (k.startsWith(`${churchId}/`) || k.startsWith(`imports/${churchId}/`)) && !stillUsed.has(k);
  return {
    ok: true,
    removed: victims.map((v) => ({
      id: v.id,
      s3Key: ownKey(v.s3Key) ? v.s3Key : null,
      thumbS3Key: ownKey(v.thumbS3Key) ? v.thumbS3Key : null,
    })),
  };
}

const SAFE_KEY = /^[A-Za-z0-9/_.-]+$/;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Exec = Pick<Db, "execute"> | Tx;

/** Replace every occurrence of `fromKey` with `toKey` inside this church's
 *  stored JSON that can hold a media URL. `fromKey` is a UUID-based storage key
 *  (`<church>/<purpose>/<uuid>.<ext>`), so a plain text replace can't collide
 *  with anything else. */
async function repointKeyText(tx: Exec, churchId: string, fromKey: string, toKey: string) {
  const like = `%${fromKey}%`;
  await tx.execute(sql`
    UPDATE service_items si SET payload = replace(si.payload::text, ${fromKey}, ${toKey})::jsonb
    FROM service_plans sp
    WHERE si.service_plan_id = sp.id AND sp.church_id = ${churchId} AND si.payload::text LIKE ${like}`);
  await tx.execute(sql`
    UPDATE song_slides ss SET objects_json = replace(ss.objects_json::text, ${fromKey}, ${toKey})::jsonb
    FROM songs s
    WHERE ss.song_id = s.id AND s.church_id = ${churchId} AND ss.objects_json::text LIKE ${like}`);
  await tx.execute(sql`
    UPDATE songs SET settings = replace(settings::text, ${fromKey}, ${toKey})::jsonb
    WHERE church_id = ${churchId} AND settings::text LIKE ${like}`);
  await tx.execute(sql`
    UPDATE themes SET config = replace(config::text, ${fromKey}, ${toKey})::jsonb
    WHERE church_id = ${churchId} AND config::text LIKE ${like}`);
  await tx.execute(sql`
    UPDATE announcement_presets SET config = replace(config::text, ${fromKey}, ${toKey})::jsonb
    WHERE church_id = ${churchId} AND config::text LIKE ${like}`);
}

export type MediaUsage = { playlistItems: number; songs: number; slides: number; themes: number; presets: number };

/** Where an asset is still used in this church — shown in the delete confirm so
 *  the operator knows what will lose its picture/video. Read-only. */
export async function countMediaUsage(db: Db, churchId: string, assetId: string): Promise<MediaUsage | null> {
  const [row] = await db.select().from(mediaAssets)
    .where(and(eq(mediaAssets.churchId, churchId), eq(mediaAssets.id, assetId))).limit(1);
  if (!row) return null;
  const like = `%${row.s3Key}%`;
  const n = (r: unknown) => Number(((r as { rows?: Array<{ n: unknown }> }).rows ?? (r as Array<{ n: unknown }>))[0]?.n ?? 0);
  const [pi, so, sl, th, pr] = await Promise.all([
    db.execute(sql`SELECT count(*)::int AS n FROM service_items si JOIN service_plans sp ON sp.id = si.service_plan_id
      WHERE sp.church_id = ${churchId} AND (si.payload->>'mediaAssetId' = ${assetId} OR si.payload->'mediaAssetIds' ? ${assetId} OR si.payload::text LIKE ${like})`),
    db.execute(sql`SELECT count(*)::int AS n FROM songs WHERE church_id = ${churchId} AND (default_background_asset_id = ${assetId}::uuid OR settings::text LIKE ${like})`),
    db.execute(sql`SELECT count(*)::int AS n FROM song_slides ss JOIN songs s ON s.id = ss.song_id WHERE s.church_id = ${churchId} AND ss.objects_json::text LIKE ${like}`),
    db.execute(sql`SELECT count(*)::int AS n FROM themes WHERE church_id = ${churchId} AND config::text LIKE ${like}`),
    db.execute(sql`SELECT count(*)::int AS n FROM announcement_presets WHERE church_id = ${churchId} AND config::text LIKE ${like}`),
  ]);
  return { playlistItems: n(pi), songs: n(so), slides: n(sl), themes: n(th), presets: n(pr) };
}
