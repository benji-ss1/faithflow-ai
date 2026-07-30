/**
 * Typed localStorage schema for PresentFlow.
 *
 * WHY THIS EXISTS:
 *   ~75 raw localStorage keys were scattered across the codebase with no
 *   central registry, no type enforcement, and no migration path. A single
 *   key rename broke saved state silently for all users.
 *
 * HOW TO USE:
 *   import { pfs } from "@/lib/localStorage-schema";
 *   pfs.get("operator.leftPanelWidth")      // → number | undefined
 *   pfs.set("operator.leftPanelWidth", 250) // type-safe
 *   pfs.remove("operator.leftPanelWidth")
 *
 * ADDING A NEW KEY:
 *   1. Add it to the `PresentFlowStorage` interface below.
 *   2. Add its default to DEFAULTS.
 *   3. If you're RENAMING an existing key, add a migration in MIGRATIONS.
 *
 * MIGRATION SYSTEM:
 *   On first load (once per browser session), the schema version stored in
 *   localStorage is compared to SCHEMA_VERSION. If it's lower, all
 *   registered migrations are run in order. Migrations copy/rename values so
 *   users don't lose their settings between releases.
 */

// ── Schema version ────────────────────────────────────────────────────────────
// Bump this integer whenever you rename/remove a key (add a migration too).
const SCHEMA_VERSION = 1;
const SCHEMA_VERSION_KEY = "presentflow.__schemaVersion";

// ── Registry ──────────────────────────────────────────────────────────────────
// Every key used anywhere in the app should be listed here with its type and
// default value. Unknown keys used via raw localStorage remain untracked but
// won't break — this is opt-in, not a lock-out.

export interface PresentFlowStorage {
  // Operator console layout
  "operator.leftPanelWidth": number;
  "operator.transcriptHeight": number;
  "operator.transcriptMinimized": boolean;
  "operator.slideSize": "sm" | "md" | "lg";
  "operator.safeMode": boolean;
  "operator.centerMode": "slides" | "bible" | "songs" | "media";

  // Audio & capture
  "audio.captureMode": string;
  "audio.deviceId": string;
  "audio.gain": number;

  // AI & autopilot
  "autopilot.mode": "auto" | "manual";
  "autopilot.bibleTranslation": string;
  "autopilot.songConfidence": number;

  // Theme & UI
  "ui.theme": "dark" | "light" | "system";
  "ui.leftPanelOpen": boolean;
  "ui.mediaStripOpen": boolean;

  // Session
  "session.lastSeenVersion": string;
  "session.churchId": string;

  // Practice mode
  "practice.replaySpeed": number;
}

type StorageKey = keyof PresentFlowStorage;

const DEFAULTS: Partial<{ [K in StorageKey]: PresentFlowStorage[K] }> = {
  "operator.leftPanelWidth": 250,
  "operator.transcriptMinimized": false,
  "operator.slideSize": "md",
  "operator.safeMode": false,
  "operator.centerMode": "slides",
  "audio.gain": 1,
  "autopilot.mode": "auto",
  "autopilot.bibleTranslation": "KJV",
  "autopilot.songConfidence": 70,
  "ui.theme": "dark",
  "ui.leftPanelOpen": true,
  "ui.mediaStripOpen": true,
  "practice.replaySpeed": 1,
};

// ── Migrations ────────────────────────────────────────────────────────────────
// Each migration is a function that runs once during schema upgrade.
// It receives the raw localStorage object (read-write) so it can rename keys.
// Return void — side effects only.

type Migration = (storage: Storage) => void;

const MIGRATIONS: Record<number, Migration> = {
  // Version 1: initial schema — no migrations needed, just baseline.
  1: () => { /* baseline — no renames from v0 */ },
};

// ── Prefix ────────────────────────────────────────────────────────────────────
// All keys are stored as `presentflow.<key>` to avoid collisions.
const PREFIX = "presentflow.";
const rawKey = (k: StorageKey) => `${PREFIX}${k}`;

// ── Guard for SSR ─────────────────────────────────────────────────────────────
const canUseStorage = typeof window !== "undefined" && typeof window.localStorage !== "undefined";

// ── Migration runner ──────────────────────────────────────────────────────────
let migrated = false;

function runMigrationsIfNeeded(): void {
  if (!canUseStorage || migrated) return;
  migrated = true;

  const stored = parseInt(localStorage.getItem(SCHEMA_VERSION_KEY) ?? "0", 10);
  if (stored >= SCHEMA_VERSION) return;

  console.log(`[pf-storage] migrating schema v${stored} → v${SCHEMA_VERSION}`);
  for (let v = stored + 1; v <= SCHEMA_VERSION; v++) {
    try {
      MIGRATIONS[v]?.(localStorage);
    } catch (e) {
      console.warn(`[pf-storage] migration v${v} failed (non-fatal):`, e);
    }
  }
  localStorage.setItem(SCHEMA_VERSION_KEY, String(SCHEMA_VERSION));
}

// ── Typed accessors ───────────────────────────────────────────────────────────
function get<K extends StorageKey>(key: K): PresentFlowStorage[K] | undefined {
  runMigrationsIfNeeded();
  if (!canUseStorage) return DEFAULTS[key] as PresentFlowStorage[K] | undefined;
  const raw = localStorage.getItem(rawKey(key));
  if (raw === null) return DEFAULTS[key] as PresentFlowStorage[K] | undefined;
  try {
    return JSON.parse(raw) as PresentFlowStorage[K];
  } catch {
    // Corrupt value — return default and clean up
    localStorage.removeItem(rawKey(key));
    return DEFAULTS[key] as PresentFlowStorage[K] | undefined;
  }
}

function set<K extends StorageKey>(key: K, value: PresentFlowStorage[K]): void {
  runMigrationsIfNeeded();
  if (!canUseStorage) return;
  try {
    localStorage.setItem(rawKey(key), JSON.stringify(value));
  } catch (e) {
    // QuotaExceededError — log and move on; never crash the operator
    console.warn("[pf-storage] localStorage write failed:", e);
  }
}

function remove(key: StorageKey): void {
  if (!canUseStorage) return;
  localStorage.removeItem(rawKey(key));
}

/**
 * Get the raw legacy key value (for components not yet migrated to the schema).
 * Use this as a bridge while migrating existing raw localStorage calls.
 */
function getRaw(legacyKey: string): string | null {
  if (!canUseStorage) return null;
  return localStorage.getItem(legacyKey);
}

// ── Public API ────────────────────────────────────────────────────────────────
export const pfs = { get, set, remove, getRaw };
