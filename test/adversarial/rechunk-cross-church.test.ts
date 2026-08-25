// Adversarial: the song re-chunk core (A2) must be church-scoped — it can NEVER
// touch another church's song, and it must clear a plan's stale slide-order
// override in its OWN church only. CLAUDE.md rule 5 mandate for new write paths.
//
// RUN: npx tsx --env-file=.env.local test/adversarial/rechunk-cross-church.test.ts
// (Requires a Postgres connection; skipped implicitly where none is configured.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, asc, inArray } from "drizzle-orm";
import { getDb } from "../../src/lib/db/client";
import { churches, songs, songSlides, servicePlans, serviceItems } from "../../src/lib/db/schema";
import { reChunkSongCore } from "../../src/lib/server/song-rechunk";

// One clunky slide (6 lines in a single slide) → re-chunk should split it.
const CLUNKY = "Line one here\nLine two here\nLine three here\nLine four here\nLine five here\nLine six here";

test("reChunkSongCore is church-scoped and clears only same-church plan overrides", async () => {
  const db = getDb();
  const [chA] = await db.insert(churches).values({ name: "ReChunk A", timezone: "UTC" }).returning();
  const [chB] = await db.insert(churches).values({ name: "ReChunk B", timezone: "UTC" }).returning();
  const cleanup = async () => { await db.delete(churches).where(inArray(churches.id, [chA.id, chB.id])); };

  try {
    // Church B owns a clunky song, referenced by a B service plan with a custom
    // slideOrder override (the dangling-UUID blast radius).
    const [songB] = await db.insert(songs).values({ churchId: chB.id, title: "B Song", source: "church" }).returning();
    const [slideB] = await db.insert(songSlides).values({ songId: songB.id, order: 0, lyrics: CLUNKY }).returning();
    const [planB] = await db.insert(servicePlans).values({ churchId: chB.id, title: "B Service" }).returning();
    const [itemB] = await db.insert(serviceItems).values({
      servicePlanId: planB.id, type: "song", title: "B Song",
      payload: { songId: songB.id, slideOrder: [slideB.id] }, order: 0,
    }).returning();

    // 1) Cross-church: Church A CANNOT re-chunk Church B's song.
    const asA = await reChunkSongCore(db, chA.id, songB.id);
    assert.equal(asA, null, "church A must not find church B's song");
    const afterCross = await db.select().from(songSlides).where(eq(songSlides.songId, songB.id));
    assert.equal(afterCross.length, 1, "church B's slides must be untouched by church A");
    assert.equal(afterCross[0].lyrics, CLUNKY, "church B's slide text must be unchanged");

    // 2) Same-church: Church B CAN re-chunk its own song → the clunky slide splits.
    const asB = await reChunkSongCore(db, chB.id, songB.id);
    assert.ok(asB && !asB.skipped, "church B re-chunk should apply");
    const rechunked = await db.select().from(songSlides).where(eq(songSlides.songId, songB.id)).orderBy(asc(songSlides.order));
    assert.ok(rechunked.length > 1, "clunky single slide should split into several");

    // 3) Rule 4: the B plan's stale slideOrder override (pointing at the deleted
    // slide UUID) was cleared in the same transaction — no dangling refs.
    const [itemAfter] = await db.select().from(serviceItems).where(eq(serviceItems.id, itemB.id));
    assert.ok(!(itemAfter.payload as Record<string, unknown>).slideOrder, "stale slideOrder override must be cleared");
  } finally {
    await cleanup();
  }
});
