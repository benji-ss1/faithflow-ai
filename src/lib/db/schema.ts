import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, pgEnum, date, vector, index, uniqueIndex, numeric, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const serviceItemTypeEnum = pgEnum("service_item_type", ["song", "scripture", "media", "sermon", "blank", "logo", "header"]);
// Single source of truth for the service-item type union (Y4). Derived from the
// pgEnum so the DB enum and every TS annotation can never drift. type-only import
// downstream ⇒ zero runtime/bundle cost in client components.
export type ServiceItemType = (typeof serviceItemTypeEnum.enumValues)[number];
// "audio" added 2026-09-16 (docs/migrations/2026-09-16-add-media-kind-audio.sql). Code gates
// every audio write on isAudioMediaSupported() so it is safe before the migration.
export const mediaKindEnum = pgEnum("media_kind", ["image", "video", "audio"]);
export const pptxStatusEnum = pgEnum("pptx_status", ["pending", "converting", "ready", "failed"]);

// Phase 5 additions ---------------------------------------------------------
// Role hierarchy (most → least privileged):
//   admin     — church settings + user management + everything an operator can do
//   operator  — run services + edit playlists + upload media + edit songs library
//   volunteer — run services + view library, but CANNOT edit songs / upload media / change themes
//   pastor    — read-only view of the sermon archive
//   viewer    — read-only view of services, songs, and archive (broader than pastor)
export const userRoleEnum = pgEnum("user_role", ["admin", "operator", "volunteer", "pastor", "viewer"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["pilot", "trialing", "active", "past_due", "canceled"]);
export const subscriptionTierEnum = pgEnum("subscription_tier", ["pilot", "starter", "pro", "enterprise"]);
export const migrationSourceEnum = pgEnum("migration_source", ["propresenter", "easyworship", "proclaim", "csv", "none"]);
export const onboardingStatusEnum = pgEnum("onboarding_status", ["pending", "in_progress", "complete", "skipped"]);
export const importJobStatusEnum = pgEnum("import_job_status", ["pending", "processing", "ready", "failed"]);

export const churches = pgTable("churches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  city: text("city"),
  country: text("country"),
  timezone: text("timezone").notNull().default("UTC"),
  congregationSize: integer("congregation_size"), // approximate
  denomination: text("denomination"),
  logoS3Key: text("logo_s3_key"),
  onboardingStatus: onboardingStatusEnum("onboarding_status").notNull().default("pending"),
  // Explicit demo/real flag set at onboarding. Demo rows can be filtered
  // from analytics + get a banner in the shell; real rows are treated as
  // production tenants. Defaults false so pre-flag rows stay classified as real.
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable so a user can exist during sign-up before their church row is
  // created in the onboarding wizard. Every access path still enforces a
  // valid churchId via requireUser() (redirect to onboarding if null).
  churchId: uuid("church_id").references(() => churches.id),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull().default("operator"),
  jobTitle: text("job_title"),                // "pastor", "media team lead", "volunteer operator" etc
  emailVerifiedAt: timestamp("email_verified_at"),
  tutorialCompletedAt: timestamp("tutorial_completed_at"),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  // Bumped by middleware on every authenticated request (throttled ~5min per
  // user so we don't hot-write on every RSC prefetch). Surfaces on the Team
  // page so admins can see who's been active recently.
  lastActiveAt: timestamp("last_active_at"),
  // Embedded in the session JWT at sign-in; bumped by "sign out all devices"
  // and password reset. The jwt refresh ends any session whose copy differs.
  // docs/migrations/2026-09-14-desktop-signin-hardening.sql
  sessionVersion: integer("session_version").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Email verification + password reset tokens, sha256-hashed at rest.
export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  kind: text("kind").notNull(), // "verify_email" | "password_reset" | "device_link" | "device_pair"
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Desktop pairing requests (one per code shown on a desktop). Records the
// requesting device so the approver sees what they're approving, and gives an
// atomic first-approver-wins claim. Server-only; RLS deny-all.
// docs/migrations/2026-09-14-desktop-signin-hardening.sql
export const devicePairRequests = pgTable("device_pair_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeHash: text("code_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  country: text("country"),
  city: text("city"),
  claimedByUserId: uuid("claimed_by_user_id").references(() => users.id, { onDelete: "cascade" }),
  claimedAt: timestamp("claimed_at"),
  consumedAt: timestamp("consumed_at"),
}, (t) => [
  uniqueIndex("device_pair_requests_code_hash_uq").on(t.codeHash),
  index("device_pair_requests_expires_idx").on(t.expiresAt),
]);

// Invitations: admin adds a teammate → email with a signed invite link.
export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  invitedByUserId: uuid("invited_by_user_id").references(() => users.id).notNull(),
  email: text("email").notNull(),
  role: userRoleEnum("role").notNull().default("operator"),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Subscription (billing scaffold; no live charges yet).
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull().unique(),
  tier: subscriptionTierEnum("tier").notNull().default("pilot"),
  status: subscriptionStatusEnum("status").notNull().default("pilot"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  currentPeriodEnd: timestamp("current_period_end"),
  trialEnd: timestamp("trial_end"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Append-only ledger of one-time song-bundle purchases. Total purchased
// credits for a church is always SUM(songsGranted) WHERE churchId = X —
// no running counter to keep in sync, and it doubles as purchase history
// (receipts, support debugging) for free. `stripeCheckoutSessionId` is
// UNIQUE — the idempotency key that stops a Stripe webhook redelivery from
// double-crediting the same purchase.
export const songBundlePurchases = pgTable("song_bundle_purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull().unique(),
  bundleId: text("bundle_id").notNull(),
  songsGranted: integer("songs_granted").notNull(),
  amountPaidCents: integer("amount_paid_cents").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Migration job — tracks a bulk import of songs/media from another system.
export const migrationJobs = pgTable("migration_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  source: migrationSourceEnum("source").notNull(),
  status: importJobStatusEnum("status").notNull().default("pending"),
  sourceFileName: text("source_file_name"),
  sourceS3Key: text("source_s3_key"),
  summaryJson: jsonb("summary_json").notNull().default({}), // { total, added, skipped, errors: [] }
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// ProPresenter parity (Phase 3.6) — named content libraries per church.
// Content (songs, media) references a library via a nullable library_id;
// NULL = unassigned, surfaced as the built-in "Default" library in the UI.
export const libraries = pgTable("libraries", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id).notNull(),
  name: text("name").notNull(),
  order: integer("order").notNull().default(0),
  // Wave 3 (item 3b): optional #rrggbb colour label, rendered as a dot/accent
  // on the rail row. NULL = no label. Validated on write like header colours.
  color: text("color"),
  // Smart Folders (2026-09-22): 'manual' = drag-and-drop membership via
  // songs.library_id / media_assets.library_id (the original behaviour, and
  // the default so every existing row is unchanged). 'smart' = membership is
  // derived from `rules` at query time and NOTHING is ever written to a
  // content row's library_id. DB CHECK constraint guards the domain.
  kind: text("kind").notNull().default("manual"),
  // SmartRules json ({match, rules[]}) — see src/lib/smart-folders.ts.
  // Always `{}` for a manual library.
  rules: jsonb("rules").notNull().default({}),
  // Watched folders (2026-09-25): when kind='watched', the folder on the
  // operator's computer that this library mirrors. NULL for every other kind.
  // Its own column rather than smuggled into `rules`, which is typed and
  // validated as SmartRules.
  watchPath: text("watch_path"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_libraries_church").on(t.churchId, t.order),
  // Declared HERE, not only in the hand-written migration, so the constraint
  // exists in every environment. CI builds its schema with `drizzle-kit push`,
  // which never sees docs/migrations/*.sql — so the adversarial test asserting
  // the DB rejects an unknown kind passed locally and failed in CI. The schema
  // is the source of truth; the migration mirrors it for production.
  check("libraries_kind_check", sql`${t.kind} in ('manual', 'smart', 'watched')`),
]);

export const servicePlans = pgTable("service_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id).notNull(),
  title: text("title").notNull(),
  scheduledFor: date("scheduled_for"),
  notes: text("notes"),
  // Smart Playlists (2026-09-22): 'manual' = hand-built from service_items
  // (the original behaviour, and the default so every existing plan is
  // unchanged). 'smart' = the item list is DERIVED from `rules` at read time
  // and the plan owns no service_items rows at all.
  kind: text("kind").notNull().default("manual"),
  // SmartRules json ({match, rules[]}) — see src/lib/smart-folders.ts.
  rules: jsonb("rules").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const serviceItems = pgTable("service_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  servicePlanId: uuid("service_plan_id").references(() => servicePlans.id, { onDelete: "cascade" }).notNull(),
  order: integer("order").notNull(),
  type: serviceItemTypeEnum("type").notNull(),
  title: text("title").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const songSourceEnum = pgEnum("song_source", ["public_domain", "church", "imported"]);

export const songs = pgTable("songs", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id).notNull(),
  title: text("title").notNull(),
  artist: text("artist"),
  source: songSourceEnum("source").notNull().default("church"),
  // Phase 5D-2: per-song settings (default transition, applied theme id, etc)
  settings: jsonb("settings").notNull().default({}),
  // ProPresenter migration (2026-07-29): default background rendered behind
  // every slide unless a per-slide media override is set. FK targets
  // mediaAssets.id; nullable + ON DELETE SET NULL so removing a media asset
  // never orphans a song.
  defaultBackgroundAssetId: uuid("default_background_asset_id"),
  // ProPresenter parity (Phase 3.6): optional library membership. Nullable +
  // ON DELETE SET NULL so a deleted library never orphans a song (falls back
  // to the "Default" bucket). Tolerant reads treat NULL as unassigned.
  libraryId: uuid("library_id").references(() => libraries.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_songs_library").on(t.libraryId),
  // Serves every dup-check (WHERE church_id = ? AND title = ?, used by all
  // 4 import paths) and every song-count query (getSongUsage) — previously
  // a full table scan on both. Had no index at all beyond the primary key.
  index("idx_songs_church_title").on(t.churchId, t.title),
]);

export const songSlides = pgTable("song_slides", {
  id: uuid("id").primaryKey().defaultRandom(),
  songId: uuid("song_id").references(() => songs.id, { onDelete: "cascade" }).notNull(),
  order: integer("order").notNull(),
  lyrics: text("lyrics").notNull(),
  // Phase 5D — rich slide object model (nullable for backward compat).
  // When present + non-empty, this is the source of truth; when null,
  // the legacy `lyrics` string renders as a single full-canvas text object.
  objectsJson: jsonb("objects_json"),
  // ProPresenter parity (§12): group membership. NULL = ungrouped (no-regression
  // line — a song with no groups projects byte-identically to today). ON DELETE
  // SET NULL so deleting a group never orphans its slides.
  groupId: uuid("group_id").references((): AnyPgColumn => songGroups.id, { onDelete: "set null" }),
  // Phase 4 (Slide Actions / P8) — serializable ActionSpec[] fired when this
  // slide goes live (validated NON-destructive: no blank/kill/clear_all). NULL/[]
  // = no attached actions (no-regression line). See src/engine/slide-actions.
  actions: jsonb("actions").notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  // The FK to songs does NOT auto-index song_id in Postgres, yet every slide
  // read + the re-chunk delete filters on it. Invisible at demo scale, a
  // table-scan storm when re-chunking across a library (A2, Speed fold §3a-5).
  index("idx_song_slides_song").on(t.songId),
  index("idx_song_slides_group").on(t.groupId),
]);

// ProPresenter parity (§12 / MVP §9) — named, colour-coded sections of ONE song.
// See docs/migrations/2026-09-08-add-song-groups-and-arrangements.sql for the
// data-model rationale (relational, not JSONB, so edit-once-update-everywhere is
// free). church_id is defence-in-depth; every read still two-hop verifies via
// songs.church_id.
export const songGroups = pgTable("song_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id).notNull(),
  songId: uuid("song_id").references(() => songs.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("custom"), // verse|chorus|bridge|intro|blank|tag|custom
  color: text("color"), // #rrggbb; null = palette default by kind
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_song_groups_song").on(t.songId, t.order),
  index("idx_song_groups_church").on(t.churchId),
]);

// Named orderings of group references, per song. `order` is a string[] of
// songGroups.id, repeatable (Chorus x3). Absence of any arrangement == today's
// natural slide order (the no-regression line).
export const songArrangements = pgTable("song_arrangements", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id).notNull(),
  songId: uuid("song_id").references(() => songs.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  order: jsonb("order").notNull().default([]),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_song_arrangements_song").on(t.songId, t.sort),
  index("idx_song_arrangements_church").on(t.churchId),
]);

export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id).notNull(),
  kind: mediaKindEnum("kind").notNull(),
  fileName: text("file_name").notNull(),
  s3Key: text("s3_key").notNull(),
  // 320x180 JPEG thumbnail rendered at upload time so browsers/grids don't
  // pay the full-image cost. Nullable — pre-migration media has none.
  thumbS3Key: text("thumb_s3_key"),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  widthPx: integer("width_px"),
  heightPx: integer("height_px"),
  durationMs: integer("duration_ms"),
  // ProPresenter parity (Phase 3.6): optional library membership (see songs).
  libraryId: uuid("library_id").references(() => libraries.id, { onDelete: "set null" }),
  // Watched folders (2026-09-25): path relative to the watched folder this
  // file was synced from ("backgrounds/sunrise.jpg"). The reconcile IDENTITY —
  // it survives an in-app rename and distinguishes two files that share a
  // basename in different sub-folders. NULL for anything not synced.
  sourceRelPath: text("source_rel_path"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_media_assets_library").on(t.libraryId),
  index("idx_media_assets_library_source").on(t.libraryId, t.sourceRelPath),
  // 2026-08-31 media-library speed: listMedia does
  // where(church_id).orderBy(created_at) on every panel open — this composite
  // index turns the seq-scan + sort into an index range scan (matches the
  // song_slides pattern above). Migration:
  // docs/migrations/2026-08-31-add-media-assets-church-created-index.sql
  index("idx_media_assets_church_created").on(t.churchId, t.createdAt),
]);

export const pptxImports = pgTable("pptx_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id).notNull(),
  originalFileName: text("original_file_name").notNull(),
  sourceS3Key: text("source_s3_key").notNull(),
  status: pptxStatusEnum("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const pptxSlides = pgTable("pptx_slides", {
  id: uuid("id").primaryKey().defaultRandom(),
  pptxImportId: uuid("pptx_import_id").references(() => pptxImports.id, { onDelete: "cascade" }).notNull(),
  order: integer("order").notNull(),
  imageS3Key: text("image_s3_key").notNull(),
  widthPx: integer("width_px"),
  heightPx: integer("height_px"),
  // Phase 6: text-layer extraction for transcript-to-slide matching. Both
  // are NULL for image-only slides; extraction failure never fails the
  // conversion pipeline.
  slideText: text("slide_text"),
  notesText: text("notes_text"),
  embedding: vector("embedding", { dimensions: 384 }),
}, (t) => [
  index("idx_pptx_slides_embedding").using("hnsw", t.embedding.op("vector_cosine_ops")),
]);

// Phase 6: sermon deck metadata — one row per pptx import.
export const sermonMetadata = pgTable("sermon_metadata", {
  id: uuid("id").primaryKey().defaultRandom(),
  pptxImportId: uuid("pptx_import_id").references(() => pptxImports.id, { onDelete: "cascade" }).notNull().unique(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  sermonTitle: text("sermon_title"),
  speakerName: text("speaker_name"),
  series: text("series"),
  mainScripture: text("main_scripture"),
  notes: text("notes"),
  serviceDate: date("service_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const settings = pgTable("settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id).notNull().unique(),
  logoS3Key: text("logo_s3_key"),
  blankBgColor: text("blank_bg_color").notNull().default("#000000"),
  fontFamily: text("font_family").notNull().default("Helvetica Neue"),
  ccliNumber: text("ccli_number"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Phase 2 -------------------------------------------------------------------
export const detectedStatusEnum = pgEnum("detected_status", ["pending", "approved", "rejected"]);
export const aiSuggestionTypeEnum = pgEnum("ai_suggestion_type", ["scripture", "song", "action"]);
export const suggestionActionEnum = pgEnum("suggestion_action", ["auto_approved", "manual_approved", "rejected", "edited"]);

export const bibleTranslations = pgTable("bible_translations", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isPublicDomain: boolean("is_public_domain").notNull().default(true),
  licenseRequired: boolean("license_required").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const bibleVerses = pgTable("bible_verses", {
  id: uuid("id").primaryKey().defaultRandom(),
  translationId: uuid("translation_id").references(() => bibleTranslations.id, { onDelete: "cascade" }).notNull(),
  book: text("book").notNull(),
  bookOrder: integer("book_order").notNull(),
  chapter: integer("chapter").notNull(),
  verse: integer("verse").notNull(),
  text: text("text").notNull(),
  embedding: vector("embedding", { dimensions: 384 }),
}, (t) => [
  index("idx_bible_verses_embedding").using("hnsw", t.embedding.op("vector_cosine_ops")),
  // Canonical ordered lookup — powers listBooks/getChapter and canonical scans.
  index("idx_bible_verses_lookup").on(t.translationId, t.bookOrder, t.chapter, t.verse),
  // Case-insensitive book lookup — powers lookupReference (LOWER(book) match).
  index("idx_bible_verses_book_lower").on(sql`LOWER(${t.book})`, t.chapter, t.verse),
  // lookupReference's actual WHERE clause filters translation_id first, then
  // LOWER(book)/chapter/verse — idx_bible_verses_book_lower above doesn't
  // lead with translation_id, so with 3+ translations sharing this table
  // every multi-verse/whole-chapter lookup (fetchChapterCached fetches verse
  // 1..200 in one query) scans matching book/chapter rows across ALL
  // translations before filtering down. This index serves that exact query
  // shape directly.
  index("idx_bible_verses_translation_book_chapter").on(t.translationId, sql`LOWER(${t.book})`, t.chapter, t.verse),
]);

export const transcriptSegments = pgTable("transcript_segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  servicePlanId: uuid("service_plan_id").references(() => servicePlans.id, { onDelete: "cascade" }).notNull(),
  ts: timestamp("ts").defaultNow().notNull(),
  text: text("text").notNull(),
}, (t) => [
  // 2026-09-21 scale hardening. This is the fastest-growing table in the
  // schema — the Fly bridge writes one row per finalized utterance for EVERY
  // church, continuously, through every service. It had no index at all.
  // Postgres does not auto-index foreign keys (the same pitfall is documented
  // on song_slides above), so every sermon-summary JOIN, every plan read and
  // every retention DELETE was a sequential scan that gets worse each week.
  // (service_plan_id, ts) serves both the per-plan reads and the retention
  // prune's "this plan, older than N days" range in one index.
  index("idx_transcript_segments_plan_ts").on(t.servicePlanId, t.ts),
]);

// Fine-grained, chunk-level RAG over a service's full transcript — distinct
// from sermonSummaries (one embedded high-level summary per service). Each
// row is one semantically-sized, overlapping chunk of the raw transcript,
// embedded so an operator's free-text question can retrieve the exact
// moments/quotes it actually needs, not just a summary. churchId is
// denormalized here (also reachable via servicePlanId) so every query can
// be scoped directly without a join, per the mandatory church_id rule.
export const sermonChunks = pgTable("sermon_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  servicePlanId: uuid("service_plan_id").references(() => servicePlans.id, { onDelete: "cascade" }).notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  embedding: vector("embedding", { dimensions: 384 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_sermon_chunks_church").on(t.churchId),
  index("idx_sermon_chunks_service").on(t.servicePlanId),
  index("idx_sermon_chunks_embedding").using("hnsw", t.embedding.op("vector_cosine_ops")),
  // Closes a TOCTOU race: two near-simultaneous "session ended" events for
  // the same service (e.g. a quick reconnect) could both pass the
  // existence-check in ingestServiceTranscript before either finishes
  // inserting, producing duplicate chunks. This constraint + the insert's
  // onConflictDoNothing makes a duplicate attempt a safe no-op instead.
  uniqueIndex("idx_sermon_chunks_plan_chunk_unique").on(t.servicePlanId, t.chunkIndex),
]);

export const detectedReferences = pgTable("detected_references", {
  id: uuid("id").primaryKey().defaultRandom(),
  transcriptSegmentId: uuid("transcript_segment_id").references(() => transcriptSegments.id, { onDelete: "cascade" }).notNull(),
  book: text("book").notNull(),
  chapter: integer("chapter").notNull(),
  verseStart: integer("verse_start").notNull(),
  verseEnd: integer("verse_end").notNull(),
  confidence: integer("confidence").notNull(), // 0-100
  status: detectedStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  // Unindexed until 2026-09-21. This FK carries ON DELETE CASCADE, so without
  // it the retention prune was the worst-scaling path in the whole schema:
  // deleting one transcript_segments row made Postgres seq-scan the entire
  // detected_references table to find its children — O(deleted x table).
  index("idx_detected_references_segment").on(t.transcriptSegmentId),
]);

export const aiSuggestions = pgTable("ai_suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  servicePlanId: uuid("service_plan_id").references(() => servicePlans.id, { onDelete: "cascade" }).notNull(),
  type: aiSuggestionTypeEnum("type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  confidence: integer("confidence").notNull(),
  status: detectedStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Autopilot history (Phase 5) — resolvedAt is null while pending.
  actionTaken: suggestionActionEnum("action_taken"),
  reason: text("reason"),                              // human-readable transition reason
  editedPayload: jsonb("edited_payload"),              // present iff actionTaken='edited'
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: uuid("resolved_by").references(() => users.id),
});

// Aggregated per-church service patterns (Phase 5x). Stored aggregate data,
// NOT raw surveillance. Recomputed by a background job after a service ends.
export const churchServicePatterns = pgTable("church_service_patterns", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull().unique(),
  servicesAnalyzed: integer("services_analyzed").notNull().default(0),
  avgItemCount: integer("avg_item_count").notNull().default(0),
  typicalItemOrder: jsonb("typical_item_order").notNull().default([]), // string[]
  topSongs: jsonb("top_songs").notNull().default([]),           // { title, count }[]
  topScriptures: jsonb("top_scriptures").notNull().default([]), // { book, chapter, count }[]
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Extend settings with Phase 2 fields
export const churchPreferences = pgTable("church_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id).notNull().unique(),
  defaultTranslationId: uuid("default_translation_id").references(() => bibleTranslations.id),
  aiListeningDefault: boolean("ai_listening_default").notNull().default(false),
  audioInputDeviceLabel: text("audio_input_device_label"),
  detectionConfidenceThreshold: integer("detection_confidence_threshold").notNull().default(60),
  productionMode: boolean("production_mode").notNull().default(false),
  // 2026-09-21 (owner directive): 7 days, not 90. Raw transcripts are a
  // short-lived working artefact — a church that wants its sermon text has a
  // week to take it. What churches actually keep long-term (sermon summaries
  // and the searchable sermon index) is stored separately and is NOT pruned,
  // so shortening this does not cost them sermon search. 0 = keep forever.
  transcriptRetentionDays: integer("transcript_retention_days").notNull().default(7),
  commandPrefix: text("command_prefix").notNull().default("faithflow"),
  // Autopilot mode — high-confidence scripture detections auto-stage AND
  // auto-send to Live without operator approval. Off by default to
  // preserve the historical safety gate.
  autoApproveEnabled: boolean("auto_approve_enabled").notNull().default(false),
  autoApproveThreshold: integer("auto_approve_threshold").notNull().default(90), // 0-100
  autoSendToLive: boolean("auto_send_to_live").notNull().default(false), // when auto-approve + this = true, skip Preview altogether
  // Decoupling Phase 3 (2026-09-08): per-church opt-in for the layers/output
  // engine (operator Layers Panel + render-from-layers). Gated ALSO by the
  // global NEXT_PUBLIC_LAYERS_V2 kill-switch. Default false: no church path
  // changes until it is deliberately enabled + projector-verified.
  // NOTE: because operate/operator select ALL columns via db.select(), the
  // matching migration MUST be applied to the DB BEFORE this code deploys, or
  // those pages error on the missing column. Migration-first is REQUIRED (the
  // app-code `?? false` only covers the no-row case, not an absent column).
  layersV2: boolean("layers_v2").notNull().default(true),
  // Scenes (2026-09-16): per-church opt-in for the Scenes UI (Scene Rail +
  // Scene Builder). Gated ALSO by the NEXT_PUBLIC_SCENES_V1 kill-switch.
  // Default false ⇒ applying the migration changes nothing for any church.
  // The RENDER path is data-gated (OutputState.scene presence), not flag-gated,
  // so an already-published scene still renders on every output surface.
  // Same migration-first requirement as layersV2 above.
  scenesEnabled: boolean("scenes_enabled").notNull().default(false),
  // Per-church styles (2026-09-17, docs/migrations/2026-09-17-add-church-preferences-styles.sql).
  // Written ONLY by setScriptureStyle / setContentTypeStyles (never updatePreferences).
  // Same migration-first requirement as layersV2 above.
  contentTypeStyles: jsonb("content_type_styles").notNull().default({}), // { song?: themeId, scripture?: themeId }
  scriptureStyle: jsonb("scripture_style"),                               // ScriptureDesign | null
  scriptureStyleUpdatedAt: timestamp("scripture_style_updated_at", { withTimezone: true }),
  contentTypeStylesUpdatedAt: timestamp("content_type_styles_updated_at", { withTimezone: true }), // null = never set
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Phase 5x additions: licensed translation configuration ------------------
export const licensedTranslationProviderEnum = pgEnum("licensed_translation_provider", ["api_bible", "biblegateway", "other"]);

// Each row = one licensed translation a church has connected via their own
// API key. No text is ever imported from a licensed source; verses are
// fetched on demand and served through the same lookupReference interface.
export const licensedTranslations = pgTable("licensed_translations", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  provider: licensedTranslationProviderEnum("provider").notNull(),
  displayCode: text("display_code").notNull(),           // e.g. "NIV"
  displayName: text("display_name").notNull(),           // e.g. "New International Version"
  providerBibleId: text("provider_bible_id").notNull(),  // provider's opaque id
  apiKeyEncrypted: text("api_key_encrypted"),            // AES-256-GCM at rest (TODO wire)
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Phase 3 -------------------------------------------------------------------
export const sermonSummaries = pgTable("sermon_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  servicePlanId: uuid("service_plan_id").references(() => servicePlans.id, { onDelete: "cascade" }).notNull().unique(),
  title: text("title").notNull(),
  overview: text("overview").notNull(),
  keyPoints: jsonb("key_points").notNull().default([]),      // string[]
  scriptureList: jsonb("scripture_list").notNull().default([]), // { book,chapter,vs,ve }[]
  notableQuotes: jsonb("notable_quotes").notNull().default([]), // string[]
  actionPoints: jsonb("action_points").notNull().default([]),   // string[]
  wordCount: integer("word_count").notNull().default(0),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  model: text("model"),
  embedding: vector("embedding", { dimensions: 384 }),
}, (t) => [
  index("idx_sermon_summaries_embedding").using("hnsw", t.embedding.op("vector_cosine_ops")),
]);

// Phase 5D-2: announcements, themes, effects presets --------------------------
export const announcementPositionEnum = pgEnum("announcement_position", [
  "lower_third", "top_banner", "ticker", "center_card",
]);
export const announcementAlignEnum = pgEnum("announcement_align", ["left", "center", "right"]);

export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  line1: text("line1").notNull(),
  line2: text("line2"),
  position: announcementPositionEnum("position").notNull().default("lower_third"),
  fontFamily: text("font_family").notNull().default("Inter"),
  fontSizePx: integer("font_size_px").notNull().default(32),
  fontWeight: integer("font_weight").notNull().default(600),
  textColor: text("text_color").notNull().default("#ffffff"),
  bgColor: text("bg_color").notNull().default("#000000"),
  bgOpacity: integer("bg_opacity").notNull().default(70),
  padding: integer("padding").notNull().default(20),
  borderRadius: integer("border_radius").notNull().default(8),
  align: announcementAlignEnum("align").notNull().default("left"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const announcementPresets = pgTable("announcement_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const themes = pgTable("themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  config: jsonb("config").notNull().default({}),
  // Marks the church's default theme — at most one per church, enforced
  // via a transactional `setDefaultTheme` action (unsets prior default,
  // then sets new one). Nullable/false is the "no default" state.
  isDefault: boolean("is_default").notNull().default(false),
  // Manual ordering for the /library/themes list. Lower value = earlier.
  // Ties broken by name alphabetically. Never referenced by the operator
  // projector — display-only.
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Wave 7 — multi-timer + message templates -----------------------------------
// Church-persisted timer DEFINITIONS (the operator's saved timers): a name, a
// type, and a duration (for countdown) or a target clock (for countdown_to).
// Runtime state (running/remaining/shown) is NEVER persisted here — it lives in
// the operator session so a fresh Sunday never resurrects last week's countdown.
export const timerTypeEnum = pgEnum("timer_type", ["countdown", "countdown_to", "elapsed"]);
// ProPresenter's "Countdown to Time" offers AM / PM / 24-hour. `countdown_to`
// above ALREADY is that timer type (it stores a wall-clock target), so this is
// a NEW enum TYPE for the period only — deliberately NOT a new value added to
// timer_type, which Postgres cannot cleanly drop. A new type is reversible
// (DROP TYPE), so this migration has a real rollback. 2026-09-21.
export const timerPeriodEnum = pgEnum("timer_period", ["am", "pm", "24_hour"]);

export const timerDefinitions = pgTable("timer_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  type: timerTypeEnum("type").notNull().default("countdown"),
  // Seconds to count down from (countdown). Ignored for elapsed / countdown_to.
  durationSec: integer("duration_sec").notNull().default(300),
  // Wall-clock target "HH:MM" (24h) for countdown_to. Null otherwise; resolved
  // to today's epoch on load.
  targetClock: text("target_clock"),
  // ── ProPresenter parity (2026-09-21). All additive + defaulted, so existing
  // rows keep behaving exactly as before. ────────────────────────────────────
  // PP "Allows Overrun": run past the endpoint (countdowns go negative).
  // Default FALSE — ProPresenter's own default. PresentFlow timers always
  // overran before this existed, so this DOES change existing behaviour: a
  // countdown now STOPS at 0:00 unless the operator ticks Allows Overrun.
  // That change is deliberate and user-directed — ProPresenter is the base
  // layer and its default wins over ours (CLAUDE.md rule 0a,
  // docs/PRODUCT_DOCTRINE.md). Announced in the changelog.
  allowsOverrun: boolean("allows_overrun").notNull().default(false),
  // PP "Countdown to Time" period. NULL = interpret target_clock as 24h, which
  // is exactly how every existing row already behaves.
  period: timerPeriodEnum("period"),
  // PP "Elapsed Time" start / end. end NULL = "unlimited end time" (PP's words).
  elapsedStartSec: integer("elapsed_start_sec"),
  elapsedEndSec: integer("elapsed_end_sec"),
  // PP stage-layout `oCl` — colour once past zero. NULL = renderer default.
  overrunColor: text("overrun_color"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_timer_definitions_church").on(t.churchId, t.sortOrder),
]);

// ── Stage Layouts (ProPresenter 1:1, 2026-09-21, user-directed) ─────────────
// A named, reusable confidence-monitor design — ProPresenter's Screens > Edit
// Layouts (Ctrl+4) list. `config` holds the StageLayout shape from
// src/engine/stage (widgets + placement + colour triggers), sanitised on read
// AND write, so the layout model can evolve without a migration per field.
// Built-in layouts live in CODE (src/engine/stage/presets.ts), never as rows —
// same pattern as BUILT_IN_SCENES. A church customises by DUPLICATING one.
export const stageLayouts = pgTable("stage_layouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  config: jsonb("config").notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_stage_layouts_church").on(t.churchId, t.sortOrder),
]);

// One row per physical stage screen, so a church can run several confidence
// monitors each showing a DIFFERENT layout — ProPresenter assigns a layout per
// stage screen independently. `layoutId` is a built-in id (text, e.g.
// "builtin-timer-only") OR a stage_layouts uuid; kept as TEXT precisely so a
// built-in can be assigned without first materialising it as a row.
export const stageScreens = pgTable("stage_screens", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  layoutId: text("layout_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_stage_screens_church").on(t.churchId, t.sortOrder),
]);

// Church-persisted MESSAGE TEMPLATES: a reusable name + text + position preset +
// style basics + an optional bound timer (config jsonb). The {{timer}} token in
// the text renders the bound timer's live value.
export const messageTemplates = pgTable("message_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  text: text("text").notNull().default(""),
  // OverlayPosition string ("lower-third", "top-right", …).
  position: text("position").notNull().default("lower-third"),
  // { scroll?, scrollDir?, scrollSec?, allowWeb?, dismiss?, timerId? } — style +
  // behaviour basics + optional {{timer}} binding. jsonb for additive growth.
  config: jsonb("config").notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_message_templates_church").on(t.churchId, t.sortOrder),
]);

// ProPresenter parity (§21.2 Automation domain) — Automations (macros): a
// church-persisted, named list of serializable ActionSpec[] fired in sequence.
// Caps enforced in the server action (≤50/church, ≤20 actions each). Guarded
// (destructive) actions ARE allowed here but fire behind an in-panel confirm.
export const macros = pgTable("macros", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  // ActionSpec[] — validated + sanitized on write (no macro-in-macro recursion).
  actions: jsonb("actions").notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_macros_church").on(t.churchId, t.sortOrder),
]);

// ProPresenter parity (spec §2/§22.2 "Looks") — SCENES: a church-persisted,
// named [screen × layer] routing matrix plus an optional per-screen theme.
// A scene stores ROUTING ONLY — which layers each screen shows — never live
// content; switching one changes what each screen SHOWS of whatever is playing.
// The 5 built-ins (Worship/Teaching/Announcement/Offering/Pre-Service) live in
// code (src/lib/scenes.ts), NOT as rows, so there is nothing to seed and a user
// can never delete them. Caps enforced in the server action (≤50/church).
// NOTE: migration-first is REQUIRED (docs/migrations/2026-09-16-add-scenes.sql)
// — db.select() lists every column, so the table must exist before this deploys.
export const scenes = pgTable("scenes", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  // SceneConfig — { screens: { main|stage|livestream|ndi: { layers?, opacity?,
  // themeId? } } }, whitelist-rebuilt on write (sanitizeSceneConfig).
  config: jsonb("config").notNull().default({}),
  // Reserved: a church-owned COPY of a built-in stays false. Built-ins are code.
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_scenes_church").on(t.churchId, t.sortOrder),
]);

// Networked projector sync — device pairings.
// Each row is a short-lived pair code that authorises a projector/stage/stream
// surface to subscribe to a Supabase Realtime channel scoped by that code.
// The pair code (never the plan/church UUID) is the shared secret on the wire.
export const devicePairScreenKindEnum = pgEnum("device_pair_screen_kind", [
  "projector",
  "stage",
  "stream",
  "operator",
]);

export const devicePairs = pgTable("device_pairs", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  planId: uuid("plan_id").references(() => servicePlans.id, { onDelete: "cascade" }),
  pairCode: text("pair_code").notNull().unique(),
  label: text("label"),
  screenKind: devicePairScreenKindEnum("screen_kind").notNull().default("projector"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
});

// Feedback — bug reports / feature requests submitted from the Settings tab.
// Stored so support can triage without relying on log retention. Rows are NOT
// automatically deleted; the operator/admin is responsible for purging PII.
export const feedbackTypeEnum = pgEnum("feedback_type", ["problem", "feature"]);
export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  type: feedbackTypeEnum("type").notNull().default("problem"),
  message: text("message").notNull(),
  blocker: boolean("blocker").notNull().default(false),
  email: text("email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Task 14: audio session metrics. One row per operator listening session,
// finalized on WS close. Fed by /api/audio/session-metrics.
export const audioSessions = pgTable("audio_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // R3: client-generated dedupe key. StrictMode + keepalive:true retries can
  // POST the same session's metrics twice; unique + onConflictDoNothing keeps
  // the table honest.
  sessionId: text("session_id").unique(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  planId: uuid("plan_id").references(() => servicePlans.id, { onDelete: "cascade" }).notNull(),
  durationSec: integer("duration_sec").notNull(),
  reconnects: integer("reconnects").notNull(),
  avgConfidence: numeric("avg_confidence", { precision: 3, scale: 2 }).notNull(),
  wordsHigh: integer("words_high").notNull(),
  wordsLow: integer("words_low").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Roadmap #4 — per-preacher/per-church learned Deepgram keyterms. Terms
// consistently mistranscribed on a given church's services get added here
// from end-of-session client submissions; loadKeyterms() merges rows with
// active=true into the effective keyterm list that biases the model on the
// next connection. Bounded per church (see MAX_LEARNED_TERMS_PER_CHURCH in
// deepgram-keyterms.ts) so we stay under Deepgram's 100-per-connection cap.
// Church_id is denormalized here per the mandatory scoping rule.
export const churchLearnedKeyterms = pgTable("church_learned_keyterms", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull(),
  // Lowercased canonical form of the token — the trigger for adding it.
  // NOT what Deepgram sees; the effective keyterm sent to Deepgram is
  // derived from `displayTerm` (below) to preserve casing.
  normalizedTerm: text("normalized_term").notNull(),
  // Cased form actually sent to Deepgram as the keyterm bias (e.g.
  // "Habakkuk" not "habakkuk"). First-seen version wins.
  displayTerm: text("display_term").notNull(),
  // "manual" = admin/operator hand-added; "learned" = auto-mined from
  // low-confidence occurrences on this church's services.
  source: text("source").notNull().default("learned"),
  // How many times this token has appeared with low confidence across
  // this church's finalized sessions.
  occurrences: integer("occurrences").notNull().default(1),
  // Rolling average confidence (0..1) of low-conf mentions of this term.
  avgConfidence: numeric("avg_confidence", { precision: 3, scale: 2 }).notNull().default("0.5"),
  // Only rows with active=true feed the effective keyterm list. New terms
  // start inactive and are promoted by the /api/cron/mine-keyterms job
  // once occurrences ≥ MIN_OCCURRENCES_TO_PROMOTE. Operator can force-
  // deactivate a bad learned term from settings later.
  active: boolean("active").notNull().default(false),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  promotedAt: timestamp("promoted_at", { withTimezone: true }),
}, (t) => [
  index("idx_church_learned_keyterms_church").on(t.churchId),
  index("idx_church_learned_keyterms_active").on(t.churchId, t.active),
  uniqueIndex("idx_church_learned_keyterms_unique").on(t.churchId, t.normalizedTerm),
]);

// Public beta-application capture. NOT church-scoped — this is a platform-level
// lead table written by the unauthenticated marketing Apply flow. It exists so
// that a church's application is durably stored the instant it's submitted,
// BEFORE any email is attempted — email delivery can silently fail (spam,
// quarantine, unmonitored inbox) and must never be the only record of a lead.
export const betaApplications = pgTable("beta_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchName: text("church_name"),
  contactEmail: text("contact_email"),
  answers: jsonb("answers").notNull(), // [{ question, answer }]
  notified: boolean("notified").notNull().default(false), // team-notification email accepted by Resend
  confirmed: boolean("confirmed").notNull().default(false), // applicant confirmation accepted
  emailError: text("email_error"), // last email failure detail, if any
  userAgent: text("user_agent"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_beta_applications_created").on(t.createdAt),
]);

// Sarah audio setup (2026-09-15) — per-church audio setup profile: what the
// church told Sarah (desk, OS, connection), which application it was confirmed
// against, corrections, and connection routes that FAILED (so they're skipped
// next time). Separate table on purpose: church_preferences is select-all'd on
// hot paths. docs/migrations/2026-09-15-add-church-audio-profiles.sql
export const churchAudioProfiles = pgTable("church_audio_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id, { onDelete: "cascade" }).notNull().unique(),
  profile: jsonb("profile").notNull().default({}),
  confirmedApplicationId: uuid("confirmed_application_id"),
  updatedByUserId: uuid("updated_by_user_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// OpenFlow conversations (Increment A2) — church-scoped chat history for the
// in-app assistant. Messages are stored as a JSONB array on the row (a
// conversation is small + always read whole, so no separate messages table /
// join is needed). `messages` = [{ role, content, cards? }]. `mode` is the
// composer mode the conversation was last in (chat/service_builder/…).
export const openFlowConversations = pgTable("openflow_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id).notNull(),
  // Nullable: who started it (session user). Kept for future per-user filtering;
  // A2 lists per-church so the whole team sees shared history.
  createdByUserId: uuid("created_by_user_id"),
  title: text("title").notNull().default("New conversation"),
  mode: text("mode").notNull().default("chat"),
  messages: jsonb("messages").notNull().default([]),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // Every list query is WHERE church_id = ? ORDER BY pinned DESC, updated_at DESC.
  index("idx_openflow_conv_church_updated").on(t.churchId, t.updatedAt),
]);

export const servicePlanRelations = relations(servicePlans, ({ many }) => ({ items: many(serviceItems) }));
export const serviceItemRelations = relations(serviceItems, ({ one }) => ({ plan: one(servicePlans, { fields: [serviceItems.servicePlanId], references: [servicePlans.id] }) }));
export const songRelations = relations(songs, ({ many }) => ({ slides: many(songSlides), groups: many(songGroups), arrangements: many(songArrangements) }));
export const songSlideRelations = relations(songSlides, ({ one }) => ({ song: one(songs, { fields: [songSlides.songId], references: [songs.id] }), group: one(songGroups, { fields: [songSlides.groupId], references: [songGroups.id] }) }));
export const songGroupRelations = relations(songGroups, ({ one, many }) => ({ song: one(songs, { fields: [songGroups.songId], references: [songs.id] }), slides: many(songSlides) }));
export const songArrangementRelations = relations(songArrangements, ({ one }) => ({ song: one(songs, { fields: [songArrangements.songId], references: [songs.id] }) }));
export const pptxImportRelations = relations(pptxImports, ({ many }) => ({ slides: many(pptxSlides) }));
export const pptxSlideRelations = relations(pptxSlides, ({ one }) => ({ import: one(pptxImports, { fields: [pptxSlides.pptxImportId], references: [pptxImports.id] }) }));
