import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, pgEnum, date, vector, index, numeric } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const serviceItemTypeEnum = pgEnum("service_item_type", ["song", "scripture", "media", "sermon", "blank", "logo"]);
export const mediaKindEnum = pgEnum("media_kind", ["image", "video"]);
export const pptxStatusEnum = pgEnum("pptx_status", ["pending", "converting", "ready", "failed"]);

// Phase 5 additions ---------------------------------------------------------
export const userRoleEnum = pgEnum("user_role", ["admin", "operator", "pastor"]);
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Email verification + password reset tokens, sha256-hashed at rest.
export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  kind: text("kind").notNull(), // "verify_email" | "password_reset"
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

export const servicePlans = pgTable("service_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id).notNull(),
  title: text("title").notNull(),
  scheduledFor: date("scheduled_for"),
  notes: text("notes"),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const songSlides = pgTable("song_slides", {
  id: uuid("id").primaryKey().defaultRandom(),
  songId: uuid("song_id").references(() => songs.id, { onDelete: "cascade" }).notNull(),
  order: integer("order").notNull(),
  lyrics: text("lyrics").notNull(),
  // Phase 5D — rich slide object model (nullable for backward compat).
  // When present + non-empty, this is the source of truth; when null,
  // the legacy `lyrics` string renders as a single full-canvas text object.
  objectsJson: jsonb("objects_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").references(() => churches.id).notNull(),
  kind: mediaKindEnum("kind").notNull(),
  fileName: text("file_name").notNull(),
  s3Key: text("s3_key").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  widthPx: integer("width_px"),
  heightPx: integer("height_px"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
});

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
});

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
  transcriptRetentionDays: integer("transcript_retention_days").notNull().default(90), // 0 = forever
  commandPrefix: text("command_prefix").notNull().default("faithflow"),
  // Autopilot mode — high-confidence scripture detections auto-stage AND
  // auto-send to Live without operator approval. Off by default to
  // preserve the historical safety gate.
  autoApproveEnabled: boolean("auto_approve_enabled").notNull().default(false),
  autoApproveThreshold: integer("auto_approve_threshold").notNull().default(90), // 0-100
  autoSendToLive: boolean("auto_send_to_live").notNull().default(false), // when auto-approve + this = true, skip Preview altogether
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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

export const servicePlanRelations = relations(servicePlans, ({ many }) => ({ items: many(serviceItems) }));
export const serviceItemRelations = relations(serviceItems, ({ one }) => ({ plan: one(servicePlans, { fields: [serviceItems.servicePlanId], references: [servicePlans.id] }) }));
export const songRelations = relations(songs, ({ many }) => ({ slides: many(songSlides) }));
export const songSlideRelations = relations(songSlides, ({ one }) => ({ song: one(songs, { fields: [songSlides.songId], references: [songs.id] }) }));
export const pptxImportRelations = relations(pptxImports, ({ many }) => ({ slides: many(pptxSlides) }));
export const pptxSlideRelations = relations(pptxSlides, ({ one }) => ({ import: one(pptxImports, { fields: [pptxSlides.pptxImportId], references: [pptxImports.id] }) }));
