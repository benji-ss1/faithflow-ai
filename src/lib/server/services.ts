// Server-only. Do not import from client components.
import { eq, asc, and, sql, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { sanitizeLyrics } from "../pro6-parser";
import { desc } from "drizzle-orm";
import { servicePlans, serviceItems, songs, songSlides, songGroups, songArrangements, mediaAssets, pptxImports, pptxSlides, settings, aiSuggestions, themes } from "../db/schema";
import { presignGet } from "../s3";
import type { SlidePayload } from "../broadcast";
import type { ServiceItemType } from "../db/schema";
import { projectableTextSlide } from "../broadcast";
import { expandArrangement } from "../../engine/arrangements";
import { sanitizeSlideActions } from "../../engine/slide-actions";
import { cleanRenderUrl } from "../render-url";

// Build the projectable payload for a song slide. When the slide has a designed
// object layout (saved via saveSlideObjects → objects_json), carry the objects +
// per-slide background so the live projector renders the real layout; otherwise
// fall back to the plain text block. projectableTextSlide VALIDATES every field
// and DROPS invalid objects individually (fail-open to readable text), so a
// designed slide always projects — one bad value can never no-op the slide on
// the projector (the whole-OutputState wire validator would otherwise reject it).
function projectableSongSlide(text: string, objectsJson: unknown): SlidePayload {
  const raw = objectsJson as { bgColor?: unknown; bgImageUrl?: unknown; objects?: unknown } | null | undefined;
  // Re-validate the stored per-slide background on READ with the same check the
  // write path uses (setSongSlideBackgroundImage / createSongImageSlide).
  return projectableTextSlide(text, raw?.bgColor, cleanRenderUrl(raw?.bgImageUrl) ?? undefined, raw?.objects);
}

// A legacy / hand-edited plan row can carry a non-UUID id; passing it to a uuid
// column makes Postgres throw and fails the WHOLE plan load. Skip such ids.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export type ExpandedItem = {
  id: string;
  order: number;
  type: ServiceItemType;
  title: string;
  slides: SlidePayload[];
  // For a "header" item: its section colour (#rrggbb) from payload.color.
  // Headers are non-content dividers — they always have slides: [].
  color?: string;
  pptxImportId?: string; // present for sermon items — enables /api/sermon/match
  // Phase 5D: song-editor needs the underlying song ID + raw slide rows
  // (with objectsJson) to enable per-slide object editing. Populated only
  // for song items.
  songId?: string;
  songSlideRows?: { id: string; lyrics: string; objectsJson: unknown }[];
  // Themes 2c — optional per-item theme override (a "section theme"). When set,
  // the operator resolves this theme for the item instead of the church default.
  themeId?: string;
  // For a grouped MEDIA item: the underlying asset id + name for each expanded
  // slide, in the SAME order as `slides`. Lets the playlist rename / reorder /
  // remove individual images inside a group.
  mediaMeta?: { id: string; fileName: string }[];
  // ── Groups & Arrangements — OPERATOR SHELL surface (wave 6D) ────────────────
  // Populated only for song items that actually USE groups. All optional and
  // absent for groupless songs (no-regression: those items render exactly as
  // today). Present so the operator can SEE the model: per-slide group badges,
  // the arrangement picker, and the centre arrangement strip.
  //   arrangementId  — the pinned arrangement (payload.arrangementId) when it
  //                    RESOLVED to a real arrangement; undefined for master.
  //   arrangements   — all of this song's arrangements (for the playlist picker).
  //   groups         — group meta (id/name/kind/color) for badge + chip colours.
  //   slideGroupIds  — per-slide group id, aligned 1:1 with `slides` (null =
  //                    ungrouped). Drives badges + strip block boundaries.
  arrangementId?: string;
  arrangements?: { id: string; name: string; isDefault: boolean; order: string[]; sort: number }[];
  groups?: { id: string; name: string; kind: string; color: string | null; order: number }[];
  slideGroupIds?: (string | null)[];
  // Phase 4 (Slide Actions) — per-slide attached ActionSpec[], aligned 1:1 with
  // `slides` (an empty array = no actions). Song items read `song_slides.actions`;
  // non-song items read `payload.slideActions` (a sparse { [slideIdx]: [] } map).
  // Undefined when nothing on the item has actions (no-regression line). Raw
  // (unknown[]) — consumers sanitize via engine/slide-actions before dispatch.
  slideActions?: unknown[][];
};

export type ExpandedPlan = {
  id: string;
  title: string;
  items: ExpandedItem[];
  logoUrl?: string;
  blankBgColor: string;
};

export async function getExpandedServicePlan(planId: string, churchId: string): Promise<ExpandedPlan | null> {
  if (!isUuid(planId)) return null; // clean not-found instead of a Postgres uuid-cast throw
  const db = getDb();
  const [plan] = await db.select().from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, churchId))).limit(1);
  if (!plan) return null;

  const items = await db.select().from(serviceItems).where(eq(serviceItems.servicePlanId, plan.id)).orderBy(asc(serviceItems.order));
  const [chSettings] = await db.select().from(settings).where(eq(settings.churchId, churchId)).limit(1);
  const logoUrl = chSettings?.logoS3Key ? await presignGet(chSettings.logoS3Key) : undefined;
  const blankBgColor = chSettings?.blankBgColor || "#000000";

  // Speed: batch-load Groups & Arrangements for every song in the plan up front
  // (two inArray queries) instead of two per-song queries inside the loop — the
  // former N+1. Keyed by the payload.songId candidates; a rare title-relinked
  // song that resolves to a DIFFERENT id (candidateSet miss) falls back to a
  // per-song fetch inside the loop. A candidate with zero groups/arrangements is
  // still a map miss but a candidateSet HIT, so it reads [] with no extra query.
  type GroupRow = typeof songGroups.$inferSelect;
  type ArrRow = typeof songArrangements.$inferSelect;
  const candidateSongIds = Array.from(new Set(
    items
      .filter((it) => it.type === "song")
      .map((it) => ((it.payload || {}) as Record<string, unknown>).songId)
      .filter(isUuid),
  ));
  const candidateSet = new Set(candidateSongIds);
  const groupsBySong = new Map<string, GroupRow[]>();
  const arrBySong = new Map<string, ArrRow[]>();
  if (candidateSongIds.length > 0) {
    // church_id filter (defence-in-depth): group/arrangement rows are tenant-owned.
    const [gRows, aRows] = await Promise.all([
      db.select().from(songGroups).where(and(inArray(songGroups.songId, candidateSongIds), eq(songGroups.churchId, churchId))).orderBy(asc(songGroups.order)),
      db.select().from(songArrangements).where(and(inArray(songArrangements.songId, candidateSongIds), eq(songArrangements.churchId, churchId))).orderBy(asc(songArrangements.sort)),
    ]);
    for (const g of gRows) { const l = groupsBySong.get(g.songId); if (l) l.push(g); else groupsBySong.set(g.songId, [g]); }
    for (const a of aRows) { const l = arrBySong.get(a.songId); if (l) l.push(a); else arrBySong.set(a.songId, [a]); }
  }

  const expanded: ExpandedItem[] = [];
  for (const it of items) {
    const payload = (it.payload || {}) as Record<string, unknown>;
    let slides: SlidePayload[] = [];
    let mediaMeta: { id: string; fileName: string }[] | undefined;

    let songId: string | undefined;
    let songSlideRows: { id: string; lyrics: string; objectsJson: unknown }[] | undefined;
    // Groups & Arrangements operator-shell surface (wave 6D). Undefined for every
    // non-song item and for groupless songs (no-regression line).
    let slideGroupIds: (string | null)[] | undefined;
    let slideActions: unknown[][] | undefined;
    let groupsMeta: { id: string; name: string; kind: string; color: string | null; order: number }[] | undefined;
    let arrangementsMeta: { id: string; name: string; isDefault: boolean; order: string[]; sort: number }[] | undefined;
    let resolvedArrangementId: string | undefined;
    if (it.type === "song" && payload.songId) {
      // C1 defense-in-depth: two-hop verify the song belongs to this
      // church before we dereference its slides. validateAddServiceItemPayload
      // in actions.ts is the first line at write; this ensures a legacy row
      // or a future direct-DB write path can't leak another church's slides.
      const candidateSongId = String(payload.songId);
      let [ownedSong]: { id: string }[] = isUuid(candidateSongId)
        ? await db.select({ id: songs.id }).from(songs)
          .where(and(eq(songs.id, candidateSongId), eq(songs.churchId, churchId))).limit(1)
        : [];
      // Resilience: a dangling payload.songId (the song was re-imported/re-synced
      // under a NEW id while the plan item still points at the old one) would
      // otherwise fall through to a single blank slide with no lyrics. Resolve
      // the song by (church, title) instead so the plan still loads and can
      // project. Church-scoped, so it can never surface another church's song.
      // Pick the title match with the MOST slides so a stray empty duplicate
      // can't win over the real song; require > 0 slides so we never "resolve"
      // to an equally-empty row.
      if (!ownedSong) {
        const titleKey = (it.title || "").trim().toLowerCase();
        if (titleKey) {
          const byTitle = await db
            .select({ id: songs.id, n: sql<number>`count(${songSlides.id})::int` })
            .from(songs)
            .leftJoin(songSlides, eq(songSlides.songId, songs.id))
            .where(and(eq(songs.churchId, churchId), sql`lower(trim(${songs.title})) = ${titleKey}`))
            .groupBy(songs.id)
            .orderBy(sql`count(${songSlides.id}) desc`)
            .limit(1);
          if (byTitle[0] && byTitle[0].n > 0) {
            ownedSong = { id: byTitle[0].id };
            console.log(`[services] re-linked stale song ref for "${it.title}" (${candidateSongId} → ${byTitle[0].id}, ${byTitle[0].n} slides)`);
          }
        }
      }
      if (ownedSong) {
        songId = ownedSong.id;
        const rows = await db.select().from(songSlides).where(eq(songSlides.songId, songId)).orderBy(asc(songSlides.order));

        // ── Groups & Arrangements model (ProPresenter §12) ───────────────────
        // Load ALL of this song's groups + arrangements ONCE. Only meaningful
        // when the song actually adopted groups; for a groupless song both are
        // empty and every operator-shell surface stays hidden (no-regression).
        let allGroups: GroupRow[];
        let allArrangements: ArrRow[];
        if (candidateSet.has(songId)) {
          // Prefetched above (empty arrays for a groupless song — a valid hit,
          // NOT a miss, so no extra query fires for the common case).
          allGroups = groupsBySong.get(songId) ?? [];
          allArrangements = arrBySong.get(songId) ?? [];
        } else {
          // Title-relinked song: resolved id wasn't in the candidate set.
          [allGroups, allArrangements] = await Promise.all([
            db.select().from(songGroups).where(and(eq(songGroups.songId, songId), eq(songGroups.churchId, churchId))).orderBy(asc(songGroups.order)),
            db.select().from(songArrangements).where(and(eq(songArrangements.songId, songId), eq(songArrangements.churchId, churchId))).orderBy(asc(songArrangements.sort)),
          ]);
        }
        // Wave 6G: carry groups + arrangements meta for EVERY song item — even a
        // groupless one — so the operator shell can render the arrangement strip
        // (with an honest empty state) and manage sections inline for any song,
        // not only the one that already had groups seeded. Empty arrays for a
        // brand-new song. No-regression: the SlideGrid badge chips and the strip
        // both hide themselves when `groups.length === 0`, so a groupless song is
        // visually byte-identical to before (only extra, unused meta is carried).
        groupsMeta = allGroups.map((g) => ({ id: g.id, name: g.name, kind: g.kind, color: g.color, order: g.order }));
        arrangementsMeta = allArrangements.map((a) => ({ id: a.id, name: a.name, isDefault: a.isDefault, sort: a.sort, order: Array.isArray(a.order) ? (a.order as unknown[]).filter((x): x is string => typeof x === "string") : [] }));

        // ── Arrangements (ProPresenter §12) ──────────────────────────────────
        // A playlist item may PIN an arrangement via payload.arrangementId. When
        // present + resolvable, expand the song through that arrangement's group
        // order (groups repeatable, edit-once). When ABSENT/unresolvable, fall
        // through to the legacy slideOrder path — the no-regression line: a song
        // with no pinned arrangement produces byte-identical slides to today.
        const arrangementId = typeof payload.arrangementId === "string" && payload.arrangementId ? payload.arrangementId : null;
        if (arrangementId) {
          const arrRow = allArrangements.find((a) => a.id === arrangementId);
          if (arrRow && allGroups.length > 0) {
            const arranged = expandArrangement<{ id: string; lyrics: string; objectsJson: unknown }>(
              {
                songId,
                slides: rows.map((r) => ({ id: r.id, groupId: r.groupId, lyrics: r.lyrics, objectsJson: r.objectsJson })),
                groups: allGroups.map((g) => ({ id: g.id, name: g.name, kind: g.kind, color: g.color, order: g.order })),
                arrangements: [{ id: arrRow.id, name: arrRow.name, isDefault: arrRow.isDefault, sort: arrRow.sort, order: Array.isArray(arrRow.order) ? (arrRow.order as unknown[]).filter((x): x is string => typeof x === "string") : [] }],
              },
              arrangementId,
            );
            resolvedArrangementId = arrangementId;
            slideGroupIds = arranged.map((r) => r.groupId);
            const actByRowArr = new Map(rows.map((r) => [r.id, sanitizeSlideActions(r.actions) as unknown[]]));
            slideActions = arranged.map((r) => actByRowArr.get(r.id) ?? []);
            songSlideRows = arranged.map((r) => ({ id: r.id, lyrics: sanitizeLyrics(r.lyrics), objectsJson: r.objectsJson }));
            slides = arranged.map((r) => projectableSongSlide(sanitizeLyrics(r.lyrics), r.objectsJson));
            expanded.push({ id: it.id, order: it.order, type: it.type, title: it.title, slides: slides.length ? slides : [{ kind: "blank", bgColor: blankBgColor }], songId, songSlideRows, mediaMeta, arrangementId: resolvedArrangementId, arrangements: arrangementsMeta, groups: groupsMeta, slideGroupIds, slideActions });
            continue;
          }
          // Pinned arrangement no longer resolves (deleted, or groups removed) →
          // fall through to the legacy natural/slideOrder path (never a dead-end).
        }

        // Task C: apply per-plan slideOrder override if present. The override
        // is an array of songSlide IDs in the desired order — church-scoped
        // via the containing plan. Rows not present in the override fall to
        // the end in their original order (defensive against stale override
        // arrays that predate a slide add).
        const overrideRaw = payload.slideOrder;
        const override = Array.isArray(overrideRaw)
          ? (overrideRaw as unknown[]).filter((x): x is string => typeof x === "string")
          : null;
        let orderedRows = rows;
        if (override && override.length > 0) {
          const byId = new Map(rows.map((r) => [r.id, r]));
          const seen = new Set<string>();
          const front: typeof rows = [];
          for (const id of override) {
            const r = byId.get(id);
            if (r && !seen.has(id)) { front.push(r); seen.add(id); }
          }
          const tail = rows.filter((r) => !seen.has(r.id));
          orderedRows = [...front, ...tail];
        }
        songSlideRows = orderedRows.map((r) => ({ id: r.id, lyrics: sanitizeLyrics(r.lyrics), objectsJson: r.objectsJson }));
        slides = orderedRows.map((r) => projectableSongSlide(sanitizeLyrics(r.lyrics), r.objectsJson));
        // Master (natural / slideOrder) order — carry per-slide group ids aligned
        // to the final slide order so the operator sees badges + strip and can
        // assign sections per-slide. Always carried for song items (all-null for a
        // groupless song); the SlideGrid/strip only render chrome when groups exist.
        slideGroupIds = orderedRows.map((r) => r.groupId);
        // Sanitize on READ too (whitelist rebuild, guarded dropped, caps) so a
        // legacy / direct-DB row can never hand the operator an unvetted spec.
        slideActions = orderedRows.map((r) => sanitizeSlideActions(r.actions) as unknown[]);
      }
    } else if (it.type === "scripture") {
      // 2026-07-25 field bug fix — the client (BibleMode.addVerseToPlaylist)
      // stores `{reference, verses: [{verse, text}]}` in the payload but this
      // reader previously only looked at `payload.slides` or `payload.text`.
      // Result: every Bible verse added to the playlist landed as a blank
      // fallback slide (line ~115) and clicking it in the sidebar showed an
      // empty grid. Now: prefer `verses` (build verse-numbered slides with the
      // reference label appended, mirroring BibleMode.cardToSlide's output),
      // fall back to `slides` and `text` for older/imported payload shapes.
      // Filter null / non-object entries (a legacy verses:[null] row used to throw).
      const versesRaw = Array.isArray(payload.verses)
        ? (payload.verses as unknown[]).filter((v): v is { verse?: number; text?: string } => !!v && typeof v === "object")
        : [];
      const reference = typeof payload.reference === "string" ? payload.reference : it.title;
      if (versesRaw.length > 0) {
        slides = versesRaw
          .filter((v) => typeof v.text === "string" && v.text.length > 0)
          .map((v) => ({
            kind: "text" as const,
            text: `${typeof v.verse === "number" ? `${v.verse} ` : ""}${v.text ?? ""}\n\n${reference}`,
          }));
      } else {
        const scriptureSlides = Array.isArray(payload.slides)
          ? (payload.slides as unknown[]).filter((s): s is { text: string } => !!s && typeof s === "object" && typeof (s as { text?: unknown }).text === "string")
          : [];
        slides = scriptureSlides.map((s) => ({ kind: "text" as const, text: s.text }));
        if (slides.length === 0 && typeof payload.text === "string") slides = [{ kind: "text", text: payload.text as string }];
      }
    } else if (it.type === "media" && Array.isArray(payload.mediaAssetIds)) {
      // Grouped media: one collapsible playlist item expands to N image/video
      // slides. C1 defense-in-depth: scope by churchId; preserve the stored id
      // order; silently skip any id that isn't this church's (never leaks, never
      // throws on a stale id).
      const ids = (payload.mediaAssetIds as unknown[]).filter(isUuid);
      const fit = (payload.fitMode === "cover" ? "cover" : "contain") as "cover" | "contain";
      if (ids.length > 0) {
        const rows = await db.select().from(mediaAssets)
          .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.churchId, churchId)));
        const byId = new Map(rows.map((r) => [r.id, r]));
        const out: SlidePayload[] = [];
        const meta: { id: string; fileName: string }[] = [];
        for (const id of ids) {
          const asset = byId.get(id);
          if (!asset) continue;
          const url = await presignGet(asset.s3Key);
          out.push(asset.kind === "video" ? { kind: "video", url, fit } : { kind: "image", url, fit });
          meta.push({ id: asset.id, fileName: asset.fileName });
        }
        slides = out;
        mediaMeta = meta;
      }
    } else if (it.type === "media" && isUuid(payload.mediaAssetId)) {
      // C1 defense-in-depth: scope mediaAssets lookup by churchId.
      const [asset] = await db.select().from(mediaAssets)
        .where(and(eq(mediaAssets.id, String(payload.mediaAssetId)), eq(mediaAssets.churchId, churchId)))
        .limit(1);
      if (asset) {
        const url = await presignGet(asset.s3Key);
        const fit = (payload.fitMode === "cover" ? "cover" : "contain") as "cover" | "contain";
        slides = [asset.kind === "video" ? { kind: "video", url, fit } : { kind: "image", url, fit }];
        // Carry mediaMeta for single images too (was group-only) so the "Edit
        // image" button + double-click-to-edit can resolve the assetId.
        mediaMeta = [{ id: asset.id, fileName: asset.fileName }];
      }
    } else if (it.type === "sermon" && isUuid(payload.pptxImportId)) {
      // C1 defense-in-depth: two-hop verify the pptx_import belongs to
      // this church, then pull its slides. Without the join, a foreign
      // payload.pptxImportId would fetch another church's slide PNGs and
      // return signed URLs.
      const [ownedImport] = await db.select({ id: pptxImports.id }).from(pptxImports)
        .where(and(eq(pptxImports.id, String(payload.pptxImportId)), eq(pptxImports.churchId, churchId)))
        .limit(1);
      if (ownedImport) {
        const rows = await db.select().from(pptxSlides).where(eq(pptxSlides.pptxImportId, ownedImport.id)).orderBy(asc(pptxSlides.order));
        // Apply a per-plan reorder override (payload.pptxSlideOrder) if the
        // operator reordered these slides — pptxSlides.order is church-global, so
        // the order lives on the plan item, not the shared slides.
        const override = Array.isArray(payload.pptxSlideOrder)
          ? (payload.pptxSlideOrder as unknown[]).filter((x): x is string => typeof x === "string")
          : [];
        const ordered = override.length === rows.length && override.every((id) => rows.some((r) => r.id === id))
          ? override.map((id) => rows.find((r) => r.id === id)!)
          : rows;
        slides = await Promise.all(ordered.map(async (r) => ({ kind: "image" as const, url: await presignGet(r.imageS3Key), fit: "contain" as const })));
      }
    } else if (it.type === "blank") {
      slides = [{ kind: "blank", bgColor: blankBgColor }];
    } else if (it.type === "logo") {
      slides = [{ kind: "logo", url: logoUrl }];
    }

    // A "header" is a non-content section divider: never synthesise a blank
    // slide for it (that would make it projectable). It stays slides: [] and
    // carries its colour so the playlist can render it as a coloured band.
    const extra: { pptxImportId?: string; themeId?: string; color?: string } = {};
    if (it.type === "header") {
      if (typeof payload.color === "string" && /^#[0-9a-fA-F]{6}$/.test(payload.color)) extra.color = payload.color;
      expanded.push({ id: it.id, order: it.order, type: it.type, title: it.title, slides: [], ...extra, songId, songSlideRows, mediaMeta });
      continue;
    }
    // ── Generic per-item slide backgrounds + appended image slides (wave 6C
    // decoupling) ─────────────────────────────────────────────────────────────
    // Backgrounds and full-screen image slides are NOT song-only. Non-song items
    // (scripture / media / sermon) build their slides from the payload each load,
    // so a dropped background is stored as an additive override map
    // (`slideBackgrounds: { [index]: url }`) and appended image slides as a list
    // (`extraImageSlides: url[]`) — both re-applied here. Pure-additive: an item
    // carrying neither key is byte-identical to before. Songs never reach this
    // tail (they push earlier via their durable songSlides path), so this only
    // decouples the NON-song item types. Applied BEFORE the empty→blank fallback
    // so an item whose only content is an appended image slide still projects.
    // Re-validate every stored URL on READ with the SAME scheme/length check
    // the write path uses (cleanRenderUrl) — a URL that reached the DB via a
    // legacy row or a direct-DB write can never render an off-scheme/oversized
    // value into the projector. Invalid entries are dropped, not rendered.
    const extraImgs = Array.isArray(payload.extraImageSlides)
      ? (payload.extraImageSlides as unknown[])
          .map((u) => cleanRenderUrl(u))
          .filter((u): u is string => u !== null)
      : [];
    const bgMap = (payload.slideBackgrounds && typeof payload.slideBackgrounds === "object" && !Array.isArray(payload.slideBackgrounds))
      ? (payload.slideBackgrounds as Record<string, unknown>) : null;
    if (bgMap) {
      slides = slides.map((s, i) => {
        const u = cleanRenderUrl(bgMap[String(i)]);
        // Only a TEXT slide has a layer to sit behind; an image/video/blank slide
        // IS its own visual, so a per-slide "background" there is a no-op (honest).
        if (!u || s.kind !== "text") return s;
        return { ...s, bgImageUrl: u };
      });
    }
    if (extraImgs.length > 0) {
      slides = [...slides, ...extraImgs.map((u) => projectableSongSlide("", { bgColor: "#000000", bgImageUrl: u, objects: [] }))];
    }
    if (slides.length === 0) slides = [{ kind: "blank", bgColor: blankBgColor }];
    if (it.type === "sermon" && typeof payload.pptxImportId === "string") extra.pptxImportId = payload.pptxImportId;
    if (typeof payload.themeId === "string" && payload.themeId) extra.themeId = payload.themeId;
    // Non-song items carry their per-slide actions in payload.slideActions (a
    // sparse { [slideIdx]: ActionSpec[] } map). Align to the final slides array.
    if (slideActions === undefined) {
      const saMap = (payload.slideActions && typeof payload.slideActions === "object" && !Array.isArray(payload.slideActions))
        ? (payload.slideActions as Record<string, unknown>) : null;
      if (saMap) slideActions = slides.map((_, i) => sanitizeSlideActions(saMap[String(i)]) as unknown[]);
    }
    expanded.push({ id: it.id, order: it.order, type: it.type, title: it.title, slides, ...extra, songId, songSlideRows, mediaMeta, arrangementId: resolvedArrangementId, arrangements: arrangementsMeta, groups: groupsMeta, slideGroupIds, slideActions });
  }

  return { id: plan.id, title: plan.title, items: expanded, logoUrl, blankBgColor };
}

export async function listServicePlans(churchId: string) {
  const db = getDb();
  return db.select().from(servicePlans).where(eq(servicePlans.churchId, churchId)).orderBy(asc(servicePlans.createdAt));
}

// ProPresenter parity (Phase 3.6): an optional `libraryFilter` scopes the list
// to one library. `undefined` = all content (unchanged legacy behaviour, so
// every existing caller is a no-op); `null` = the implicit "Default" bucket
// (library_id IS NULL); a string = that library's content.
export async function listSongs(churchId: string, libraryFilter?: string | null) {
  const db = getDb();
  const where = libraryFilter === undefined
    ? eq(songs.churchId, churchId)
    : and(eq(songs.churchId, churchId), libraryFilter === null ? sql`${songs.libraryId} IS NULL` : eq(songs.libraryId, libraryFilter));
  return db.select().from(songs).where(where).orderBy(asc(songs.title));
}

export async function listMedia(churchId: string, libraryFilter?: string | null, opts?: { includeAudio?: boolean }) {
  const db = getDb();
  const base = libraryFilter === undefined
    ? eq(mediaAssets.churchId, churchId)
    : and(eq(mediaAssets.churchId, churchId), libraryFilter === null ? sql`${mediaAssets.libraryId} IS NULL` : eq(mediaAssets.libraryId, libraryFilter));
  // Audio assets are OUT of every surface by default (no output can play them:
  // send-live / backgrounds / slides assume image|video). Only the Media Bin
  // opts in. `kind::text` so this is valid before the enum migration too.
  const where = opts?.includeAudio ? base : and(base, sql`${mediaAssets.kind}::text <> 'audio'`);
  return db.select().from(mediaAssets).where(where).orderBy(asc(mediaAssets.createdAt));
}

export type SuggestionHistoryRow = {
  id: string;
  type: "scripture" | "song" | "action";
  payload: Record<string, unknown>;
  editedPayload: Record<string, unknown> | null;
  confidence: number;
  status: "pending" | "approved" | "rejected";
  actionTaken: "auto_approved" | "manual_approved" | "rejected" | "edited" | null;
  reason: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

export async function listSuggestionHistory(planId: string, churchId: string, limit = 50): Promise<SuggestionHistoryRow[] | null> {
  const db = getDb();
  const [plan] = await db.select({ id: servicePlans.id })
    .from(servicePlans)
    .where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, churchId)))
    .limit(1);
  // Return null (not empty array) to let callers distinguish "cross-church access"
  // from "own plan with zero history" — the API route surfaces this as 404.
  if (!plan) return null;
  const rows = await db.select().from(aiSuggestions)
    .where(eq(aiSuggestions.servicePlanId, planId))
    .orderBy(desc(aiSuggestions.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: (r.payload as Record<string, unknown>) ?? {},
    editedPayload: (r.editedPayload as Record<string, unknown> | null) ?? null,
    confidence: r.confidence,
    status: r.status,
    actionTaken: r.actionTaken,
    reason: r.reason,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  }));
}

export async function listPptxImports(churchId: string) {
  const db = getDb();
  return db.select().from(pptxImports).where(eq(pptxImports.churchId, churchId)).orderBy(asc(pptxImports.createdAt));
}

export async function listThemes(churchId: string) {
  const db = getDb();
  return db.select().from(themes).where(eq(themes.churchId, churchId)).orderBy(asc(themes.sortOrder), asc(themes.name));
}
