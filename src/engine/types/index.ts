/**
 * src/engine/types — Phase 0 (P0) of the Engine Integration blueprint.
 *
 * Pure TypeScript. No React, no side effects at module scope. Provides:
 *   1. Branded ID types (zero-runtime, type-safe wrappers over string).
 *   2. Re-exports of the EXISTING wire/domain types so engine consumers import
 *      them from one place (`@/engine/types`) instead of reaching across the
 *      codebase. Only types that actually exist today are re-exported.
 *   3. Const-object domain enums mirroring the real string unions.
 *
 * BLUEPRINT CORRECTIONS (verified against the live repo, 2026-09-08):
 *   - `SlideObjectWire` IS exported from `@/lib/broadcast` (kept).
 *   - `AutopilotMode` lives in OperatorConsole and is `"manual" | "suggestion"
 *     | "armed" | "active"` — matches the blueprint's AutopilotModeEnum values.
 *     `ServiceMode` ("auto" | "worship" | "preacher") also lives there and is
 *     re-exported (blueprint omitted it).
 *   - The blueprint's `CenterMode` union ("slides"|"bible"|"songs"|"media") has
 *     NO single source-of-truth type in the repo today, so it is provided here
 *     as an engine-local enum only (documented, not re-exported from elsewhere).
 *   - Item "kind" in the plan is really `ServiceItemType` on `ExpandedItem.type`
 *     (values: song | scripture | media | sermon | blank | logo | header), NOT
 *     a `kind` field. Re-exported as `ServiceItemType` and mirrored by the
 *     `ItemType` enum below. `header` items are non-content dividers (slides:[]).
 */

// ── 1. Branded IDs ────────────────────────────────────────────────────────
export type ChurchId = string & { readonly __brand: "ChurchId" };
export type PlanId = string & { readonly __brand: "PlanId" };
export type ItemId = string & { readonly __brand: "ItemId" };
export type SlideId = string & { readonly __brand: "SlideId" };
export type SongId = string & { readonly __brand: "SongId" };
export type ThemeId = string & { readonly __brand: "ThemeId" };
export type MacroId = string & { readonly __brand: "MacroId" };
export type TimerId = string & { readonly __brand: "TimerId" };
export type PropId = string & { readonly __brand: "PropId" };
export type LookId = string & { readonly __brand: "LookId" };
export type LayerId = string & { readonly __brand: "LayerId" };

/** Cast any string to a branded id. Zero runtime cost (identity). */
export const asId = <T extends string>(s: string): T => s as T;

// ── 2. Re-exports of EXISTING types (verified present) ────────────────────
export type {
  SlidePayload,
  OutputState,
  ThemeAppearance,
  TransitionSpec,
  AnnouncementPayload,
  VideoInputState,
  MessageOverlay,
  TimerOverlay,
  SlideObjectWire,
  BackgroundSpec,
  LayerWire,
  LayerKind,
  LayerZone,
} from "@/lib/broadcast";

export type { ProjectionZone, ProjectionZoneProfile } from "@/lib/projection-zone";
export type { OperatorShellCtx } from "@/components/operator/shell/types";
export type { AutopilotMode, ServiceMode } from "@/components/operator/OperatorConsole";
export type {
  Detection,
  SongSuggestion,
  CommandSuggestion,
  UnifiedSuggestion,
  AudioStreamState,
} from "@/components/operator/useAudioStream";
export type { ExpandedPlan, ExpandedItem } from "@/lib/server/services";
export type { ServiceItemType } from "@/lib/db/schema";

// ── 3. Domain enums (const-object pattern, mirror the real string unions) ──

/** SlidePayload discriminants — verified against broadcast.ts `SlidePayload`. */
export const SlideKind = {
  Text: "text",
  Image: "image",
  Video: "video",
  Blank: "blank",
  Logo: "logo",
  Empty: "empty",
} as const;
export type SlideKind = (typeof SlideKind)[keyof typeof SlideKind];

/** Plan item types — verified against `serviceItemTypeEnum` in db/schema.ts.
 *  `Header` items are non-content section dividers (always slides:[]). */
export const ItemType = {
  Song: "song",
  Scripture: "scripture",
  Media: "media",
  Sermon: "sermon",
  Blank: "blank",
  Logo: "logo",
  Header: "header",
} as const;
export type ItemType = (typeof ItemType)[keyof typeof ItemType];

/** Operator autopilot modes — mirror `AutopilotMode` in OperatorConsole. */
export const AutopilotModeEnum = {
  Manual: "manual",
  Suggestion: "suggestion",
  Armed: "armed",
  Active: "active",
} as const;
export type AutopilotModeEnum = (typeof AutopilotModeEnum)[keyof typeof AutopilotModeEnum];

/** Service-mode detection bias — mirror `ServiceMode` in OperatorConsole. */
export const ServiceModeEnum = {
  Auto: "auto",
  Worship: "worship",
  Preacher: "preacher",
} as const;
export type ServiceModeEnum = (typeof ServiceModeEnum)[keyof typeof ServiceModeEnum];

/** Engine-local center-mode enum. No single repo type exists for this today;
 *  provided for engine consumers that want a stable set of center views. */
export const CenterMode = {
  Slides: "slides",
  Bible: "bible",
  Songs: "songs",
  Media: "media",
} as const;
export type CenterMode = (typeof CenterMode)[keyof typeof CenterMode];
