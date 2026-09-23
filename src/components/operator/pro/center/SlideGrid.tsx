"use client";
import { useShortcutLabel } from "@/lib/usePlatformLabel";
import { useEffect, useMemo, useRef, useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { ThemedSlideCard } from "./ThemedSlideCard";
import { MediaLibraryPicker } from "@/components/library/MediaLibraryPicker";
import type { BackgroundSpec } from "@/lib/broadcast";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload, ThemeAppearance } from "@/lib/broadcast";
import { useSlideClipboard, setSlideClipboard, getSlideClipboard, setTextClipboard, useTextClipboard, getTextClipboard } from "@/lib/slide-clipboard";
import { pasteInsertIndex, pasteDisabledReason } from "@/lib/slide-paste";
import { syncBackgroundForAppliedTheme } from "@/lib/theme-apply-client";
import { updateSongSlides, deleteSongSlide, updateSongSlideText, setSongSlideBackgroundImage, createSongImageSlide, setServiceItemSlideBackground, addServiceItemImageSlide, assignSlidesToGroup, createSongGroup, setSongSlideActions, setServiceItemSlideActions,clearSongSlideBackgroundImage, clearAllSongSlideBackgrounds, setAllSongSlidesBackgroundImage, applyThemeToSong, revertSongTheme, applyThemeToSongSlides, removeThemeFromSongSlide } from "@/lib/actions";
import { anyOverlayOpen } from "@/hooks/useOperatorHotkeys";
import { nextSlideSelection, stripVideoDecor, consumeSelectionEscape } from "@/lib/slide-selection";
import { BUILTIN_THEMES } from "@/lib/builtin-themes";
import { BUILT_IN_BACKGROUNDS } from "@/backgrounds/presets/defaultTemplates";
import { setActiveBackgroundId } from "@/backgrounds/store/backgroundStore";
import { useBackgroundState } from "@/backgrounds/hooks/useBackgroundState";
import { sanitizeSlideActions } from "@/engine/slide-actions";
import { SLIDE_SAFE_PALETTE } from "@/engine/actions/palette";
import type { ActionSpec } from "@/engine/actions/spec";
import { parseMediaDropPayload, isImageAsset, resolveMediaDrop, MEDIA_DROP_MIME } from "@/lib/media-drop";
import { applyTextToSlide, projectableTextSlide } from "@/lib/broadcast";
import { loadMediaFrame, buildMediaFrameSlide, MEDIA_FRAME_CHANGED_EVENT } from "./mediaFrame";
import { resolveFramedBackground, hasBakeableFrame } from "./mediaFrameBake";
import { useRouter } from "next/navigation";
import { X, Pencil, LayoutGrid, GripVertical, GripHorizontal, ChevronRight, Check, Layers, Zap, Image as ImageIcon, Palette, Timer, MessageSquare, Sparkles, Captions, Workflow, Trash2 } from "lucide-react";
import { describeSpec, specKey } from "@/engine/actions/describe";
import { macroHasGuardedAction } from "@/engine/macros";
import { DotGridBackground } from "../DotGridBackground";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { groupColor } from "@/engine/arrangements";

type ViewMode = "grid" | "list" | "text";
const VIEW_MODE_KEY = "presentflow.operator.slideViewMode";

// A1/A2 (2026-09-09): the per-slide Actions submenu holds only attach-style
// actions that actually reach the projector by default. Timer/message moved to the
// Automations editor; set_background/clear_layer were SILENT NO-OPS on slides
// (they need the dormant LAYERS_V2 engine) and are replaced by the working
// "Background" submenu (setActiveBackgroundId → OutputState.background → /live).
// Render-invariant, so computed once at module scope.
const SLIDE_MENU_PALETTE = SLIDE_SAFE_PALETTE.filter((e) => {
  const t = e.make().type;
  return t !== "timer" && t !== "show_message" && t !== "clear_message"
    && t !== "set_background" && t !== "clear_layer";
});


// Standard song sections offered in the per-slide "Section →" quick menu (wave
// 6G). Each maps to a group KIND so a freshly-created section gets a sensible
// colour without the operator touching the colour picker.
const STANDARD_SECTIONS: { name: string; kind: string }[] = [
  { name: "Verse 1", kind: "verse" },
  { name: "Verse 2", kind: "verse" },
  { name: "Verse 3", kind: "verse" },
  { name: "Chorus", kind: "chorus" },
  { name: "Pre-Chorus", kind: "chorus" },
  { name: "Bridge", kind: "bridge" },
  { name: "Intro", kind: "intro" },
  { name: "Tag", kind: "tag" },
  { name: "Ending", kind: "custom" },
];

// Section menu wiring passed to each slide card (null for non-editable items).
type SectionMenu = {
  groups: { id: string; name: string; kind: string; color: string | null }[];
  currentGroupId: string | null;
  onAssign: (groupId: string | null) => void;
  onQuickCreate: (name: string, kind: string) => void;
};
type SlideActionsMenu = {
  palette: { label: string; make: () => ActionSpec }[];
  current: ActionSpec[];
  onToggle: (spec: ActionSpec) => void;
  /** Remove the attached action at index i (works for legacy timer/message too). */
  onRemoveAt: (i: number) => void;
  onClearAll: () => void;
  /** Human label for an attached spec (macro names resolved when loaded). */
  describe: (spec: ActionSpec) => string;
  /** Enabled, NON-guarded Automations offered under "Run automation →". */
  automations: { id: string; name: string }[];
};

// Badge icon per attached action type (up to 3 shown, then "+N").
function actionTypeIcon(t: ActionSpec["type"]) {
  switch (t) {
    case "timer": return Timer;
    case "show_message": case "clear_message": return MessageSquare;
    case "logo": return Sparkles;
    case "send_lower_third": case "clear_lower_third": return Captions;
    case "macro": return Workflow;
    case "set_background": case "set_background_media": return ImageIcon;
    case "clear_layer": return Layers;
    default: return Zap;
  }
}

// Open a trigger's Radix context menu from the keyboard / a click by synthesising
// a contextmenu event at the element's centre (Radix listens for onContextMenu).
function openContextMenuAt(el: HTMLElement | null) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
}
// Background submenu — IMAGE controls only (user model 2026-09-09): add via
// drag-from-media-bin, use this slide's image on all slides, or clear one/all.
type BgMenu = {
  thisImageUrl?: string;
  /** 2026-09-20: pick a background from the media library. Until now the ONLY way to
   *  give a song slide a background was to drag one out of the Media bin, which no
   *  button advertised — so it looked like the whole theme had to be edited. */
  onChooseImage: () => void;
  onUseOnAll: () => void;
  onRemove: () => void;
  onRemoveAll: () => void;
  canEdit: boolean;
  hasGlobalBg: boolean;
  onClearGlobal: () => void;
};
// Theme submenu — the named LOOKS (Gentle Waves, Holy Fire…) shown with a colour
// preview, applied to the live projector instantly; plus any saved DB themes
// (font/colour styling) applied to all slides of the song.
type ThemeMenu = {
  activeLookId: string;
  onSwitchLook: (id: string) => void;
  looks: { id: string; name: string; c1?: string; c2?: string }[];
  dbThemes: { id: string; name: string }[];
  onApplyDb: (themeId: string) => void;
  onRemoveDb: () => void;
  // Per-slide theme override (apply/remove a theme on THIS slide only).
  onApplyDbThisSlide: (themeId: string) => void;
  onRemoveDbThisSlide: () => void;
  canApplyDb: boolean;
  // Multi-select (cmd/ctrl/shift-click): apply to every selected slide.
  selectedCount: number;
  onApplyDbSelected: (themeId: string) => void;
  // Built-in themes are materialized into a church theme, then applied.
  builtins: { id: string; name: string }[];
};
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Safe Mode toggle. User-directive polish pass: default is OFF — single-click
// sends live. When ON: single-click selects, double-click sends live. Persisted
// per-machine in localStorage.
const SAFE_MODE_KEY = "presentflow.operator.safeMode";
function safeMode() {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(SAFE_MODE_KEY);
  return raw === "1"; // default OFF
}

// Debounce accidental fast repeat clicks / trackpad noise (250ms).
// 2026-07-27 field fix: the old debounce was GLOBAL — clicking slide 1 then
// slide 2 within 250ms silently swallowed slide 2 ("clicked but didn't go
// live" at a live service). Now keyed per-slide: only a repeat click on the
// SAME slide is suppressed; a click on a different slide always fires
// (latest-wins — the send path is idempotent).
let __lastLiveKey = "";
let __lastLiveFire = 0;
function fireLive(key: string, fn: () => void) {
  const now = Date.now();
  if (key === __lastLiveKey && now - __lastLiveFire < 250) {
    console.log("[click] slide live suppressed (same-slide repeat <250ms)", { key });
    return;
  }
  __lastLiveKey = key;
  __lastLiveFire = now;
  fn();
}

export function SlideGrid({ ctx, slideSize, onOpenEditor }: { ctx: OperatorShellCtx; slideSize: number; onOpenEditor?: () => void }) {
  const saveKey = useShortcutLabel({ mod: true, key: "↵" });
  const router = useRouter();
  const item = ctx.plan.items[ctx.previewItemIdx];
  // PR 2: thumbnails use the theme THIS item projects with (boxes + decor).
  // `?? ctx.appearance` is the last-resort belt: appearanceForItem can still
  // return null (no item theme, no content-type style, no church default), and a
  // null here paints every card black over its opaque base. Matches SongsBrowser,
  // which already falls back this way.
  const rawItemAppearance = (ctx.appearanceForItem ? ctx.appearanceForItem(ctx.previewItemIdx) : null) ?? ctx.appearance;
  // Grid thumbnails never decode theme video decor (same rule as the popover).
  const itemAppearance = useMemo(() => stripVideoDecor(rawItemAppearance), [rawItemAppearance]);
  const slides: SlidePayload[] = item?.slides ?? [];
  // Song auto-switch guard: every send of a song item's slide declares its origin.
  const itemSendOpts = item?.type === "song" ? { origin: { kind: "song" as const, songId: (item as { songId?: string }).songId } } : undefined;
  // Frame-aware DISPLAY slides — media images are rendered (and projected) through
  // their saved frame (crop / pan / zoom / blur-fill) so the grid preview is 1:1
  // with what goes live. Non-media / un-framed slides pass through unchanged.
  // Optimistic per-slide background overrides keyed by slide index — set the INSTANT
  // a media image is dropped on ONE slide, so that slide's card updates immediately
  // (no wait for the server round-trip + router.refresh). Cleared automatically once
  // the real slide data catches up (the effect below), so it never masks a change.
  const [optimisticBg, setOptimisticBg] = useState<Record<number, string>>({});
  // Bumped when the image editor saves/clears a frame, so the cards re-read the
  // saved framing immediately (localStorage writes don't re-render anything).
  const [frameVersion, setFrameVersion] = useState(0);
  useEffect(() => {
    const onChanged = () => setFrameVersion((v) => v + 1);
    window.addEventListener(MEDIA_FRAME_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(MEDIA_FRAME_CHANGED_EVENT, onChanged);
  }, []);
  const displaySlides: SlidePayload[] = useMemo(() => {
    return slides.map((s, i) => {
      let base = s;
      if (item?.type === "media" && s.kind === "image") {
        const assetId = item.mediaMeta?.[i]?.id;
        const frame = assetId ? loadMediaFrame(ctx.churchId, assetId) : null;
        if (frame) {
          const { bgColor, objects } = buildMediaFrameSlide(frame, s.url);
          base = projectableTextSlide("", bgColor, undefined, objects);
        }
      }
      // "" is the CLEARED sentinel (remove), a url is a set — so drag, use-on-all
      // AND remove all update the card instantly, just like a Theme change.
      // SONG items only: songs persist bgImageUrl in songSlides.objectsJson (the
      // clear-effect reconciles against that). Non-song items persist per-item and
      // wouldn't reconcile here, so we don't fold an optimistic override onto them.
      const ob = optimisticBg[i];
      if (ob !== undefined && base.kind === "text" && item?.type === "song") return { ...base, bgImageUrl: ob === "" ? undefined : ob };
      return base;
    });
    // ctx.churchId + item identity drive this; slides is derived from item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, item, ctx.churchId, optimisticBg, frameVersion]);
  // Drop an optimistic override once the real slide reflects it (post-refresh).
  useEffect(() => {
    setOptimisticBg((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      let changed = false;
      const next: Record<number, string> = {};
      for (const [k, url] of Object.entries(prev)) {
        const i = Number(k);
        const real = (slides[i] as { bgImageUrl?: string } | undefined)?.bgImageUrl;
        const want = url === "" ? undefined : url;
        if (real === want) { changed = true; continue; }
        next[i] = url;
      }
      return changed ? next : prev;
    });
  }, [slides]);
  // Re-send the CURRENTLY-LIVE slide of this item with a new/removed per-slide
  // background, instantly (used by remove + use-on-all so /live tracks the change).
  const reSendLiveWithBg = (bgImageUrl: string | undefined) => {
    if (ctx.previewItemIdx !== ctx.liveItemIdx) return;
    const live = ctx.liveSlide;
    if (!live || live.kind !== "text") return;
    ctx.onSendSlideToLive({ ...(live as Extract<SlidePayload, { kind: "text" }>), bgImageUrl }, null, { instant: true, carryLiveOrigin: true });
  };
  // The index (within THIS item) of the slide currently on the projector, by FULL
  // identity (not just lyric text) — so a single-slide background change only
  // touches /live when it's genuinely the live slide. -1 when this item isn't live
  // or the slide isn't found. This is what prevents a duplicate-lyric off-screen
  // slide from repainting the live projector (a live-service hazard).
  const liveSlideIdx = useMemo(() => {
    if (ctx.previewItemIdx !== ctx.liveItemIdx) return -1;
    let key: string | null = null;
    try { key = JSON.stringify(ctx.liveSlide); } catch { key = null; }
    if (!key) return -1;
    return slides.findIndex((s) => { try { return JSON.stringify(s) === key; } catch { return false; } });
  }, [ctx.previewItemIdx, ctx.liveItemIdx, ctx.liveSlide, slides]);
  const lastDragEndRef = useRef(0);

  // Groups & Arrangements (wave 6D): per-slide group badge chips. Additive chrome
  // — read from the expanded item's `slideGroupIds` + `groups` meta which the
  // loader carries ONLY for songs that use groups. Groupless songs → empty map →
  // no chips render (byte-identical to today).
  const groupChips = useMemo(() => {
    const ids = item?.slideGroupIds;
    const groups = item?.groups;
    if (!ids || !groups || groups.length === 0) return null;
    const byId = new Map(groups.map((g) => [g.id, g]));
    return ids.map((gid) => {
      if (!gid) return null;
      const g = byId.get(gid);
      if (!g) return null;
      return { label: g.name || g.kind, color: groupColor({ kind: g.kind, color: g.color, name: g.name }) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  // ── Per-slide section (group) assignment (wave 6G) ────────────────────────
  // Right-click a slide → "Section →" to tag it with a group (Verse 1, Chorus,
  // Bridge…) WITHOUT leaving the shell. Assigns via the existing church-scoped
  // actions; the badge + strip refresh live. Only armed for editable song items.
  const sectionSongId = item?.type === "song" ? (item as { songId?: string }).songId : undefined;
  const songGroups = item?.groups ?? [];
  const slideGroupIds = item?.slideGroupIds;
  const assignSlideSection = (idx: number, groupId: string | null) => {
    const slideId = item?.type === "song" ? item.songSlideRows?.[idx]?.id : undefined;
    if (!sectionSongId || !slideId) return;
    void (async () => {
      const { toast } = await import("sonner");
      const res = await assignSlidesToGroup(sectionSongId, [slideId], groupId);
      if (!res.ok) { toast.error(res.error ?? "Couldn't set the section"); return; }
      router.refresh();
    })();
  };
  // Create a standard-named group (if it doesn't exist yet) and assign this slide
  // to it — the "make this the bridge" one-tap. Matches an existing group by
  // (case-insensitive) name so repeated taps reuse the same group.
  const quickCreateSectionAndAssign = (idx: number, name: string, kind: string) => {
    const slideId = item?.type === "song" ? item.songSlideRows?.[idx]?.id : undefined;
    if (!sectionSongId || !slideId) return;
    const existing = songGroups.find((g) => g.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (existing) { assignSlideSection(idx, existing.id); return; }
    void (async () => {
      const { toast } = await import("sonner");
      const created = await createSongGroup(sectionSongId, name, kind);
      if (!created.ok) { toast.error(created.error ?? "Couldn't create the section"); return; }
      if (!created.data) { toast.error("Couldn't create the section"); return; }
      const res = await assignSlidesToGroup(sectionSongId, [slideId], created.data.id);
      if (!res.ok) { toast.error(res.error ?? "Couldn't set the section"); return; }
      toast.success(`Added section “${name}”`);
      router.refresh();
    })();
  };

  // ── Slide Actions (Phase 4) ─────────────────────────────────────────────────
  // Per-slide attached actions (NON-destructive). Song slides persist to
  // song_slides.actions via setSongSlideActions. Badges + a right-click palette to
  // add/remove. Guarded actions are never offered here (enforced at save + dispatch).
  const slideActionSpecs = useMemo(() => {
    const raw = item?.slideActions;
    if (!Array.isArray(raw)) return null;
    return raw.map((arr) => sanitizeSlideActions(arr));
  }, [item?.slideActions]);
  // Non-song items persist to service_items.payload.slideActions[slideIdx] via
  // setServiceItemSlideActions (fired by the same fireSlideActions path). Scripture
  // is EXCLUDED: its slides re-expand on translation/split changes, so a slide
  // index isn't stable and an action could drift onto a different verse. Header
  // dividers hold no slide content.
  const nonSongActionItemId = item && (item.type === "media" || item.type === "sermon" || item.type === "blank" || item.type === "logo")
    ? item.id : undefined;
  const canEditSlideActions = (item?.type === "song" && !!sectionSongId) || !!nonSongActionItemId;
  // Non-destructive palette offered on a slide — SLIDE_MENU_PALETTE (module const)
  // is the background-focused subset (timer/message filtered out; see A1 above).
  const saveSlideActions = (idx: number, next: ActionSpec[], okMsg: string) => {
    const slideId = item?.type === "song" ? item.songSlideRows?.[idx]?.id : undefined;
    const songSave = !!sectionSongId && !!slideId;
    if (!songSave && !nonSongActionItemId) return;
    void (async () => {
      const { toast } = await import("sonner");
      const res = songSave
        ? await setSongSlideActions(slideId!, next)
        : await setServiceItemSlideActions(nonSongActionItemId!, idx, next);
      if (!res.ok) { toast.error(res.error ?? "Couldn't set slide action"); return; }
      toast.success(okMsg);
      router.refresh();
    })();
  };
  const toggleSlideAction = (idx: number, spec: ActionSpec) => {
    const current = slideActionSpecs?.[idx] ?? [];
    const key = specKey(spec);
    const exists = current.some((s) => specKey(s) === key);
    const next = exists ? current.filter((s) => specKey(s) !== key) : [...current, spec];
    saveSlideActions(idx, next, exists ? "Removed slide action" : "Attached slide action");
  };
  const removeSlideActionAt = (idx: number, i: number) => {
    const current = slideActionSpecs?.[idx] ?? [];
    if (i < 0 || i >= current.length) return;
    saveSlideActions(idx, current.filter((_, j) => j !== i), "Removed slide action");
  };
  const clearSlideActions = (idx: number) => saveSlideActions(idx, [], "Removed all slide actions");

  // Church Automations — for naming attached `macro` actions and the
  // "Run automation →" submenu. Only loaded for editable song items; refreshed
  // when the Automations panel changes. A failure just leaves ids unresolved.
  const [churchMacros, setChurchMacros] = useState<{ id: string; name: string; enabled: boolean; guarded: boolean }[]>([]);
  useEffect(() => {
    if (!canEditSlideActions) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { listMacros } = await import("@/lib/actions");
        const res = await listMacros();
        if (cancelled || !res.ok || !res.data) return;
        setChurchMacros(res.data.map((m) => ({
          id: m.id, name: m.name, enabled: m.enabled,
          guarded: macroHasGuardedAction({ id: m.id, churchId: "", name: m.name, actions: m.actions as ActionSpec[], enabled: m.enabled }),
        })));
      } catch { /* optional */ }
    };
    void load();
    const onChanged = () => { void load(); };
    window.addEventListener("presentflow:macros-changed", onChanged);
    return () => { cancelled = true; window.removeEventListener("presentflow:macros-changed", onChanged); };
  }, [canEditSlideActions]);
  const describeSlideSpec = (spec: ActionSpec) =>
    describeSpec(spec, spec.type === "macro" ? churchMacros.find((m) => m.id === spec.macroId)?.name : undefined);
  const runnableAutomations = useMemo(
    () => churchMacros.filter((m) => m.enabled && !m.guarded).map((m) => ({ id: m.id, name: m.name })),
    [churchMacros],
  );

  // View mode is toggled by the BottomBar (fires "presentflow:slide-view-mode").
  // Persist per-machine so operators keep their preferred layout across launches.
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEW_MODE_KEY);
      if (raw === "list" || raw === "text" || raw === "grid") setViewMode(raw);
    } catch { /* noop */ }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ViewMode>).detail;
      if (detail === "grid" || detail === "list" || detail === "text") {
        setViewMode(detail);
        try { window.localStorage.setItem(VIEW_MODE_KEY, detail); } catch { /* noop */ }
      }
    };
    window.addEventListener("presentflow:slide-view-mode", handler);
    return () => window.removeEventListener("presentflow:slide-view-mode", handler);
  }, []);

  // Quick Edit — floating panel for inline slide text editing.
  // quickEdit.text is the FROZEN text at open (kept stable so the in-place
  // AutoFitText caret + fit don't jump mid-type); the LIVE typed value lives in
  // editedTextRef (a ref, so keystrokes don't re-render the editable node).
  // slideId is the STABLE per-slide id captured at open — Save targets it
  // directly so a grid reorder/delete/paste while the (non-modal) editor is
  // open can't make the array index resolve to a different slide. slideIdx is
  // kept only for the live-preview render + focus re-keying.
  const [quickEdit, setQuickEdit] = useState<{ slideIdx: number; slideId?: string; text: string } | null>(null);
  const [qeSaving, setQeSaving] = useState(false);
  const editedTextRef = useRef("");
  const qeSendingRef = useRef(false); // "Send this slide live" in flight (save → send)
  // Last persisted text for the open Quick Edit (seeded at open, advanced on a
  // successful save). Typed text !== this → unsaved changes.
  const qeBaselineRef = useRef("");
  const { confirm: confirmQe, dialog: qeConfirmDialog } = useConfirm();
  const qeDirty = () => quickEdit !== null && editedTextRef.current !== qeBaselineRef.current;
  // Close/switch guard: ask before silently dropping typed, unsaved text.
  const confirmDiscardQe = async (): Promise<boolean> => {
    if (!qeDirty()) return true;
    return confirmQe({ title: "Discard unsaved changes?", description: "Your typed text on this slide hasn't been saved.", confirmLabel: "Discard", danger: true });
  };
  const closeQuickEdit = async () => { if (await confirmDiscardQe()) setQuickEdit(null); };
  // Quick Edit is DRAGGABLE so it never blocks the slides behind it. Offset is
  // held in a ref and applied directly to the panel's transform, so dragging
  // never re-renders (and can't disturb the in-place caret).
  const qePanelRef = useRef<HTMLDivElement | null>(null);
  const qeOffset = useRef({ x: 0, y: 0 });
  const qeDrag = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null);
  const applyQeTransform = () => {
    const el = qePanelRef.current;
    if (el) el.style.transform = `translate(calc(-50% + ${qeOffset.current.x}px), ${qeOffset.current.y}px)`;
  };
  const onQeDragStart = (e: React.PointerEvent) => {
    qeDrag.current = { sx: e.clientX, sy: e.clientY, bx: qeOffset.current.x, by: qeOffset.current.y };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onQeDragMove = (e: React.PointerEvent) => {
    const d = qeDrag.current;
    if (!d) return;
    // Clamp so the drag handle can NEVER leave the viewport — otherwise a
    // non-modal box dragged off-screen would be unrecoverable (✕ + keys gone).
    const maxX = Math.max(40, window.innerWidth / 2 - 60);
    const minY = -Math.round(window.innerHeight * 0.14) + 8; // don't rise above the top
    const maxY = Math.max(0, window.innerHeight - 160);
    const rawX = d.bx + (e.clientX - d.sx);
    const rawY = d.by + (e.clientY - d.sy);
    qeOffset.current = {
      x: Math.min(maxX, Math.max(-maxX, rawX)),
      y: Math.min(maxY, Math.max(minY, rawY)),
    };
    applyQeTransform();
  };
  const onQeDragEnd = (e: React.PointerEvent) => {
    qeDrag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  // App-level clipboard for cut/copy/paste within the grid
  const clipboardSlide = useSlideClipboard();
  // Grid root — used to scope the Cmd/Ctrl+V paste shortcut to "focus is in the
  // slide grid" so it never fires while the operator is typing elsewhere.
  const gridRootRef = useRef<HTMLDivElement | null>(null);

  // Data-loss guard: the grid's Quick Edit / Duplicate / Delete / Paste rewrite
  // the WHOLE song from lyrics only (updateSongSlides), which drops every slide's
  // designed object layout. For a song that HAS designed slides, steer those
  // actions to the full editor (which preserves objects via the granular
  // create/save/reorder actions). Plain lyric songs are unaffected.
  const songHasObjects = item?.type === "song" && slides.some(
    (s) => s.kind === "text" && Array.isArray((s as { objects?: unknown[] }).objects) && ((s as { objects?: unknown[] }).objects!.length > 0),
  );
  const guardObjectSong = (): boolean => {
    if (songHasObjects) {
      void import("sonner").then(({ toast }) => toast.error("This song has designed slides — open the slide editor to keep the layout."));
      onOpenEditor?.();
      return true;
    }
    return false;
  };

  // Paste the clipboard slide at a chosen position (insertIdx). Shared by the
  // per-slide "Paste after" and the empty-space "Paste at end" menus, so the
  // operator can decide WHERE the copied slide lands.
  const isEditableSong = item?.type === "song" && !!(item as { songId?: string }).songId;
  const canPasteHere = !!clipboardSlide && isEditableSong;
  // Honest, operator-facing reason paste is unavailable (null when it IS). Drives
  // a DISABLED "Paste slide" menu item with a tooltip instead of hiding it — the
  // field complaint was silence reading as "I don't have any editing access".
  const pasteReason = pasteDisabledReason(!!clipboardSlide, isEditableSong);
  // C1: text clipboard — "Copy Text" fills it; "Paste Text" drops it onto ANOTHER
  // slide, preserving that slide's design (updateSongSlideText swaps only the text).
  const textClipboard = useTextClipboard();
  const canPasteText = !!textClipboard && isEditableSong;
  const pasteTextOnto = (idx: number) => {
    const text = getTextClipboard();
    void (async () => {
      const { toast } = await import("sonner");
      if (!text) { toast.error("No copied text to paste"); return; }
      const slideId = item?.type === "song" ? item.songSlideRows?.[idx]?.id : undefined;
      if (!slideId) { toast.error("Couldn't find that slide"); return; }
      const res = await updateSongSlideText(slideId, text);
      if (!res.ok) { toast.error(res.error ?? "Paste failed"); return; }
      toast.success("Text pasted");
      router.refresh();
    })();
  };

  // ── Theme (looks) & Background (images) controls ────────────────────────────
  // THEME = the named LOOKS (Gentle Waves, Holy Fire…). Applying one switches the
  // LIVE projector background instantly via the Background-Templates store — the
  // path that works in the default config (setActiveBackgroundId →
  // useBackgroundState → OutputState.background → /live). Reactive so the ✓ tracks
  // the live look even when changed elsewhere.
  const activeBackgroundId = useBackgroundState().active.id;
  const switchLook = (id: string) => {
    setActiveBackgroundId(id);
    const name = BUILT_IN_BACKGROUNDS.find((b) => b.id === id)?.name ?? "look";
    void import("sonner").then(({ toast }) =>
      toast.success(id === "none" ? "Look cleared" : `Look: ${name}`));
  };
  // Set the optimistic override for EVERY slide index at once (used by the
  // all-slides operations so all cards update instantly, like a Theme change).
  const setOptimisticAll = (value: string) => {
    setOptimisticBg(() => { const n: Record<number, string> = {}; slides.forEach((_, i) => { n[i] = value; }); return n; });
  };
  // BACKGROUND = per-slide IMAGE. Use this slide's image on every slide of the song.
  const useImageOnAllSlides = (url?: string) => {
    const songId = item?.type === "song" ? (item as { songId?: string }).songId : undefined;
    if (!songId || !url) { void import("sonner").then(({ toast }) => toast.error(!url ? "This slide has no image to use" : "Only songs can do this")); return; }
    setOptimisticAll(url);          // INSTANT: every card shows the image now
    reSendLiveWithBg(url);          // INSTANT: /live updates if a slide of this item is live
    void (async () => {
      const { toast } = await import("sonner");
      const res = await setAllSongSlidesBackgroundImage(songId, url);
      if (!res.ok) { toast.error(res.error ?? "Couldn't set image"); setOptimisticBg({}); return; }
      toast.success(`Image set on ${res.data?.count ?? 0} slide${(res.data?.count ?? 0) === 1 ? "" : "s"}`);
      router.refresh();
    })();
  };
  // Clear the LIVE projector background (the global "Worship background" / look) —
  // the thing the operator actually sees behind every slide. Separate from a
  // per-slide image, so it can be cleared distinctly.
  const clearProjectorBackground = () => {
    if (activeBackgroundId && activeBackgroundId !== "none") { setActiveBackgroundId("none"); return true; }
    return false;
  };
  // Remove the per-slide background IMAGE from THIS slide (instant, like Theme).
  const removeSlideBackground = (idx: number) => {
    const slideId = item?.type === "song" ? item.songSlideRows?.[idx]?.id : undefined;
    if (!slideId) { void import("sonner").then(({ toast }) => toast.error("Couldn't find that slide")); return; }
    setOptimisticBg((m) => ({ ...m, [idx]: "" }));  // INSTANT: this card clears now
    if (idx === liveSlideIdx) {
      reSendLiveWithBg(undefined);                   // INSTANT: /live clears ONLY if THIS exact slide is live
    }
    void (async () => {
      const { toast } = await import("sonner");
      const res = await clearSongSlideBackgroundImage(slideId);
      if (!res.ok) { toast.error(res.error ?? "Couldn't remove background"); setOptimisticBg((m) => { const n = { ...m }; delete n[idx]; return n; }); return; }
      toast.success(res.data?.cleared ? "Background removed from slide" : "This slide had no background image");
      router.refresh();
    })();
  };
  // A4: remove the per-slide background image from EVERY slide (instant, like Theme).
  const removeAllSlideBackgrounds = () => {
    const songId = item?.type === "song" ? (item as { songId?: string }).songId : undefined;
    if (!songId) { void import("sonner").then(({ toast }) => toast.error("Only songs can do this")); return; }
    setOptimisticAll("");            // INSTANT: every card clears now
    reSendLiveWithBg(undefined);     // INSTANT: /live clears if a slide of this item is live
    void (async () => {
      const { toast } = await import("sonner");
      const res = await clearAllSongSlideBackgrounds(songId);
      if (!res.ok) { toast.error(res.error ?? "Couldn't remove backgrounds"); setOptimisticBg({}); return; }
      const n = res.data?.count ?? 0;
      toast.success(n > 0 ? `Removed the image from ${n} slide${n === 1 ? "" : "s"}` : "No slides had their own image");
      router.refresh();
    })();
  };

  // A5: themes — fetched once for the "Theme" submenu. Apply/remove operate on the
  // whole song (all slides) via the existing church-scoped actions.
  // `config` is kept (not just id/name) so applying a theme can tell whether it
  // carries its OWN background and therefore must switch off an active
  // Background Template — see syncBackgroundForAppliedTheme.
  const [themes, setThemes] = useState<{ id: string; name: string; config?: unknown }[]>([]);
  useEffect(() => {
    let alive = true;
    void fetch("/api/themes").then((r) => r.json()).then((d) => {
      if (!alive) return;
      const list = Array.isArray(d?.themes) ? d.themes : [];
      setThemes(list.map((t: { id: string; name: string; config?: unknown }) => ({ id: t.id, name: t.name, config: t.config })));
    }).catch(() => { /* themes optional */ });
    return () => { alive = false; };
  }, []);
  const applyThemeAll = (themeId: string) => {
    void (async () => {
      const { toast } = await import("sonner");
      const songId = item?.type === "song" ? (item as { songId?: string }).songId : undefined;
      if (!songId) { toast.error("Only songs can take a theme"); return; }
      const res = await applyThemeToSong(themeId, songId);
      if (!res.ok) { toast.error(res.error ?? "Couldn't apply theme"); return; }
      // A theme carrying its own background must turn OFF any active Background
      // Template, or the template keeps out-ranking it and the operator sees
      // "Theme applied" with no visible change (field report 2026-09-22).
      const cfg = themes.find((t) => t.id === themeId)?.config;
      if (cfg) await syncBackgroundForAppliedTheme(cfg);
      toast.success("Theme applied — re-send a slide to update the screen");
      router.refresh();
    })();
  };
  const removeThemeAll = () => {
    void (async () => {
      const { toast } = await import("sonner");
      const songId = item?.type === "song" ? (item as { songId?: string }).songId : undefined;
      if (!songId) { toast.error("Only songs can do this"); return; }
      const res = await revertSongTheme(songId);
      if (!res.ok) { toast.error(res.error ?? "Couldn't remove theme"); return; }
      toast.success("Theme removed — re-send a slide to update the screen");
      router.refresh();
    })();
  };
  // A built-in theme id ("builtin:…") is materialized into this church's theme
  // first; a real theme id passes through.
  const resolveThemeId = async (themeId: string): Promise<string | null> => {
    if (!themeId.startsWith("builtin:")) return themeId;
    const { materializeBuiltinClient } = await import("../ThemePopover");
    const t = await materializeBuiltinClient(themeId);
    return t?.id ?? null;
  };
  const applyThemeAllResolved = (themeId: string) => {
    void (async () => { const id = await resolveThemeId(themeId); if (id) applyThemeAll(id); })();
  };
  // Per-slide theme override (Victor: "individually select the theme for each slide").
  // One batch action for one slide or a multi-selection.
  const applyThemeToSlides = (themeId: string, slideIdsToTheme: (string | undefined)[]) => {
    void (async () => {
      const { toast } = await import("sonner");
      const songId = item?.type === "song" ? (item as { songId?: string }).songId : undefined;
      const idsClean = slideIdsToTheme.filter((x): x is string => !!x);
      if (!songId || idsClean.length === 0) { toast.error("Only a song slide can take a theme"); return; }
      const resolved = await resolveThemeId(themeId);
      if (!resolved) return;
      const res = await applyThemeToSongSlides(resolved, songId, idsClean);
      if (!res.ok) { toast.error(res.error ?? "Couldn't theme this slide"); return; }
      const n = res.data?.slidesUpdated ?? idsClean.length;
      toast.success(n === 1 ? "Theme applied to this slide — re-send it to update the screen" : `Theme applied to ${n} slides — re-send to update the screen`);
      router.refresh();
    })();
  };
  const applyThemeThisSlide = (themeId: string, slideId: string | undefined) => applyThemeToSlides(themeId, [slideId]);

  // ── Multi-select (ProPresenter-style): cmd/ctrl toggles, shift ranges from the
  // previewed slide, Esc clears. Song slides only (ids = song_slides row ids).
  const [selectedSlideIds, setSelectedSlideIds] = useState<string[]>([]);
  const itemKey = `${ctx.previewItemIdx}:${(item as { id?: string } | undefined)?.id ?? ""}`;
  useEffect(() => { setSelectedSlideIds([]); }, [itemKey]);
  useEffect(() => {
    if (selectedSlideIds.length === 0) return;
    // Capture phase + stopImmediatePropagation: Esc clears the selection ONLY —
    // the global Esc = kill-live hotkey (bubble listeners) must not also fire.
    const onKey = (e: KeyboardEvent) => {
      consumeSelectionEscape(e, selectedSlideIds.length, document.activeElement as HTMLElement | null, () => setSelectedSlideIds([]), anyOverlayOpen());
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selectedSlideIds.length]);
  const removeThemeThisSlide = (slideId: string | undefined) => {
    void (async () => {
      const { toast } = await import("sonner");
      const songId = item?.type === "song" ? (item as { songId?: string }).songId : undefined;
      if (!songId || !slideId) { toast.error("Only a song slide can do this"); return; }
      const res = await removeThemeFromSongSlide(songId, slideId);
      if (!res.ok) { toast.error(res.error ?? "Couldn't remove this slide's theme"); return; }
      toast.success("This slide's theme removed");
      router.refresh();
    })();
  };

  const pasteSlideAt = (insertIdx: number) => {
    if (guardObjectSong()) return;
    const copied = getSlideClipboard();
    if (!copied) { void import("sonner").then(({ toast }) => toast.error("Nothing to paste")); return; }
    const songId = (item as { songId?: string })?.songId;
    if (item?.type !== "song" || !songId) return;
    void (async () => {
      const at = pasteInsertIndex(insertIdx, slides.length);
      const newSlides = [...slides];
      newSlides.splice(at, 0, copied);
      const updatedSlides = newSlides.map((sl) => ({ lyrics: sl.kind === "text" ? ((sl as { text?: string }).text ?? "") : "" }));
      const res = await updateSongSlides(songId, updatedSlides);
      const { toast } = await import("sonner");
      if (!res.ok) toast.error(res.error ?? "Paste failed"); else toast.success("Slide pasted");
    })();
  };

  // Cmd/Ctrl+V pastes the copied slide when the grid has focus (a slide is
  // selected / the grid was clicked). Scoped to the grid so it never hijacks
  // paste in a text field, and it inserts AFTER the currently-selected slide.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "v" && e.key !== "V") return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const root = gridRootRef.current;
      const active = document.activeElement;
      if (!root || !active || !root.contains(active)) return;
      // Never steal a genuine text paste (Quick Edit box, rename inputs, etc.).
      const tag = (active as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (active as HTMLElement).isContentEditable) return;
      if (!canPasteHere) return;
      e.preventDefault();
      pasteSlideAt(ctx.previewSlideIdx + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPasteHere, ctx.previewSlideIdx, slides.length, item]);

  // Returns true only when the text was persisted.
  const handleQuickEditSave = async (newText: string): Promise<boolean> => {
    if (!quickEdit) return false;
    const trimmed = newText.trim();
    if (!trimmed) {
      const { toast } = await import("sonner");
      toast.error("Slide text can't be empty");
      return false;
    }
    if (item?.type !== "song" || !(item as { songId?: string }).songId) return false;
    // Prefer the STABLE id captured at open; fall back to the index lookup for
    // safety. This survives a grid reorder while the non-modal editor is open.
    const slideId = quickEdit.slideId ?? item.songSlideRows?.[quickEdit.slideIdx]?.id;
    if (!slideId) {
      const { toast } = await import("sonner");
      toast.error("Couldn't find that slide to save");
      return false;
    }
    setQeSaving(true);
    try {
      // Persist ONLY this slide's text, PRESERVING its designed layout
      // (updateSongSlideText loads objectsJson and swaps the first text object) —
      // no more flatten-to-plain. Works for plain AND designed songs.
      const res = await updateSongSlideText(slideId, trimmed);
      const { toast } = await import("sonner");
      if (!res.ok) { toast.error(res.error ?? "Save failed"); return false; }
      qeBaselineRef.current = newText; // no longer dirty
      // Save ONLY persists + updates the slide — it does NOT push to the projector
      // (user directive 2026-08-26). "Send this slide live" is the separate,
      // explicit action; saving and sending live are independent choices. The
      // editor stays open so the operator can then Send Live if they want to.
      toast.success("Slide updated");
      // Keep the song tracker cache fresh (same event the add-slide paths fire).
      // keepLiveTracking: text-only edit — don't drop live-song tracking (see
      // src/lib/song-slides-changed.ts).
      try { window.dispatchEvent(new CustomEvent("presentflow:song-slides-changed", { detail: { songId: (item as { songId?: string }).songId, keepLiveTracking: true } })); } catch { /* noop */ }
      router.refresh(); // grid reflects the saved text; editor stays open
      return true;
    } finally {
      setQeSaving(false);
    }
  };

  // Task C: derive stable per-slide IDs for dnd + server call. For song
  // items we have real songSlide IDs on songSlideRows; for other item
  // types the reorder validator accepts stringified indices.
  const slideIds: string[] = slides.map((_, i) => {
    if (item?.type === "song" && item.songSlideRows?.[i]?.id) return item.songSlideRows[i].id;
    return `slide-${i}`;
  });

  // 2026-07-27 field fix: distance raised 6 → 8px. A shaky mouse/trackpad
  // press that drifts >6px turned the click into a drag activation and the
  // click never fired (classic dnd-kit click-swallow at live services).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    // dnd-kit can let a trailing click through after a drop — record the drop
    // time so onSelect can ignore that ghost click (prevents an accidental
    // go-live right after reordering slides).
    lastDragEndRef.current = Date.now();
    // Fix-loop 2026-07-27: reordering changes which slide sits behind each
    // key/index — a stale dedupe key could wrongly suppress (or allow) the
    // next go-live. Reset so post-drag clicks always evaluate fresh.
    __lastLiveKey = "";
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = slideIds.indexOf(String(active.id));
    const newIdx = slideIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const nextOrder = arrayMove(slideIds, oldIdx, newIdx);
    ctx.onReorderSlidesInItem?.(ctx.previewItemIdx, nextOrder);
  };

  // ── Media-bin drag/drop (field fix wave 6A) ──────────────────────────────
  // A media thumbnail dragged from the Media Bin carries MEDIA_DROP_MIME. Two
  // behaviours, decided by resolveMediaDrop (pure, unit-tested): drop ONTO a
  // slide sets that slide's per-slide background; drop into empty grid space
  // creates a new full-screen image slide.
  //
  // DECOUPLING (field fix 6C): backgrounds + image slides are NOT song-only.
  // Songs use their durable per-slide DB path; scripture / media / sermon items
  // use the additive per-item payload path (setServiceItemSlideBackground /
  // addServiceItemImageSlide). Non-content dividers (header / blank / logo) can't
  // hold slide content, so the affordance stays OFF for them (honest — no silent
  // gate: the drop targets simply don't arm rather than arming then failing).
  const editableSongId = item?.type === "song" ? (item as { songId?: string }).songId : undefined;
  const itemId = item?.id;
  const canAcceptMediaDrop = !!item && (
    item.type === "song" ? !!editableSongId : (item.type === "scripture" || item.type === "media" || item.type === "sermon")
  );
  // Which slide index is currently a background drop target (ring highlight),
  // and whether the empty grid area is an active new-slide target (caret).
  const [bgDropIdx, setBgDropIdx] = useState<number | null>(null);
  const [newDropActive, setNewDropActive] = useState(false);
  // Read the media payload off a drag event (null if it isn't a media drag).
  const readMediaDrag = (e: React.DragEvent) => parseMediaDropPayload(e.dataTransfer.getData(MEDIA_DROP_MIME));
  // dragover types don't expose getData on some browsers — presence of the MIME
  // in types is the cross-OS signal that a media drag is in progress.
  const isMediaDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(MEDIA_DROP_MIME);

  // Apply a background image chosen from the media library to ONE slide. Same
  // optimistic-paint + instant-live-resend + persist path the Media-bin drop uses; no
  // frame baking, because a library pick is already the picture the operator chose.
  const applyChosenBackground = (idx: number, url: string) => {
    void (async () => {
      const { toast } = await import("sonner");
      if (!canAcceptMediaDrop) { toast.error("This item can't take a slide background"); return; }
      setOptimisticBg((m) => ({ ...m, [idx]: url }));
      const base = displaySlides[idx] ?? slides[idx];
      if (idx === liveSlideIdx && base) {
        ctx.onSendSlideToLive({ ...(base as Extract<SlidePayload, { kind: "text" }>), bgImageUrl: url }, null, { instant: true, carryLiveOrigin: true });
      }
      const revert = () => setOptimisticBg((m) => { const n = { ...m }; delete n[idx]; return n; });
      if (editableSongId) {
        const slideId = item?.type === "song" ? item.songSlideRows?.[idx]?.id : undefined;
        if (!slideId) { toast.error("Couldn't find that slide"); revert(); return; }
        const res = await setSongSlideBackgroundImage(slideId, url);
        if (!res.ok) { toast.error(res.error ?? "Couldn't set background"); revert(); return; }
      } else {
        if (!itemId) { toast.error("Couldn't find that item"); revert(); return; }
        const res = await setServiceItemSlideBackground(itemId, idx, url);
        if (!res.ok) { toast.error(res.error ?? "Couldn't set background"); revert(); return; }
      }
      toast.success("Background set on this slide");
    })();
  };

  const [bgPickIdx, setBgPickIdx] = useState<number | null>(null);

  const dropMediaOnSlide = (idx: number, e: React.DragEvent) => {
    const payload = readMediaDrag(e);
    if (!payload) return;
    e.preventDefault();
    e.stopPropagation();
    setBgDropIdx(null);
    setNewDropActive(false);
    // An image the operator cropped / blurred / framed in the media editor must drop as
    // THAT picture, not the original file — so it is baked first (a moment, then cached).
    const needsBake = canAcceptMediaDrop && isImageAsset(payload) && hasBakeableFrame(ctx.churchId, payload.id);
    let bgUrl = payload.url;
    // INSTANT PREVIEW: paint the new background on the card immediately, before any
    // server round-trip, so the drop feels instant (D1). Cleared once real data lands.
    // (Skipped when a frame must be baked — painting the original would flash the wrong image.)
    if (canAcceptMediaDrop && isImageAsset(payload) && !needsBake) {
      setOptimisticBg((m) => ({ ...m, [idx]: payload.url }));
      // INSTANT LIVE: if this exact slide is what's currently on the projector,
      // re-send it with the new background right away so /live updates instantly too.
      const base = displaySlides[idx] ?? slides[idx];
      if (idx === liveSlideIdx && base) {
        ctx.onSendSlideToLive({ ...(base as Extract<SlidePayload, { kind: "text" }>), bgImageUrl: payload.url }, null, { instant: true, carryLiveOrigin: true });
      }
    }
    void (async () => {
      const { toast } = await import("sonner");
      if (!canAcceptMediaDrop) { toast.error("This item can't take a slide background"); setOptimisticBg((m) => { const n = { ...m }; delete n[idx]; return n; }); return; }
      if (!isImageAsset(payload)) { toast.error("Only images can be used as a slide background"); return; }
      if (needsBake) {
        const fb = await resolveFramedBackground(ctx.churchId, { id: payload.id, url: payload.url, fileName: payload.title });
        if (fb.failed) toast.error("Couldn't apply your edit to the background — used the original image");
        bgUrl = fb.url;
        setOptimisticBg((m) => ({ ...m, [idx]: bgUrl }));
        const base = displaySlides[idx] ?? slides[idx];
        if (idx === liveSlideIdx && base) {
          ctx.onSendSlideToLive({ ...(base as Extract<SlidePayload, { kind: "text" }>), bgImageUrl: bgUrl }, null, { instant: true, carryLiveOrigin: true });
        }
      }
      if (editableSongId) {
        const slideId = item?.type === "song" ? item.songSlideRows?.[idx]?.id : undefined;
        if (!slideId) { toast.error("Couldn't find that slide"); setOptimisticBg((m) => { const n = { ...m }; delete n[idx]; return n; }); return; }
        const res = await setSongSlideBackgroundImage(slideId, bgUrl);
        if (!res.ok) { toast.error(res.error ?? "Couldn't set background"); setOptimisticBg((m) => { const n = { ...m }; delete n[idx]; return n; }); return; }
      } else {
        if (!itemId) { toast.error("Couldn't find that item"); setOptimisticBg((m) => { const n = { ...m }; delete n[idx]; return n; }); return; }
        const res = await setServiceItemSlideBackground(itemId, idx, bgUrl);
        if (!res.ok) { toast.error(res.error ?? "Couldn't set background"); setOptimisticBg((m) => { const n = { ...m }; delete n[idx]; return n; }); return; }
      }
      toast.success(`Background set on slide ${idx + 1} only — use “BG” for every slide`);
      router.refresh();
    })();
  };

  const dropMediaOnEmpty = (e: React.DragEvent) => {
    const payload = readMediaDrag(e);
    if (!payload) return;
    e.preventDefault();
    setBgDropIdx(null);
    setNewDropActive(false);
    const decision = resolveMediaDrop({ over: "empty", insertIndex: slides.length });
    const insertIndex = decision.action === "new-image-slide" ? decision.insertIndex : slides.length;
    void (async () => {
      const { toast } = await import("sonner");
      if (!canAcceptMediaDrop) { toast.error("Image slides can't be added to this item"); return; }
      if (!isImageAsset(payload)) { toast.error("Only images can be added as a slide"); return; }
      // Use the operator's edited (cropped / blurred / framed) picture, not the original file.
      const fb = await resolveFramedBackground(ctx.churchId, { id: payload.id, url: payload.url, fileName: payload.title });
      if (fb.failed) toast.error("Couldn't apply your edit to the slide — used the original image");
      if (editableSongId) {
        const res = await createSongImageSlide(editableSongId, insertIndex, fb.url);
        if (!res.ok) { toast.error(res.error ?? "Couldn't add the slide"); return; }
      } else {
        if (!itemId) { toast.error("Couldn't find that item"); return; }
        const res = await addServiceItemImageSlide(itemId, fb.url);
        if (!res.ok) { toast.error(res.error ?? "Couldn't add the slide"); return; }
      }
      toast.success("Added a full-screen image slide");
      router.refresh();
    })();
  };

  return (
    <div ref={gridRootRef} className="p-2 flex flex-col gap-6">
      {/* Main slide grid — Task B: 6px gutter. Y10: semantic grid + gridcell roles. */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={slideIds} strategy={rectSortingStrategy}>
          <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
          <div
            role="grid"
            aria-label="Slides"
            // min-h so the empty area below the cards is part of the grid and can
            // be right-clicked to paste a copied slide at the end.
            // Media-bin drop: dragging over empty grid space arms the "add a new
            // image slide" affordance; a card's own dragover stops propagation so
            // this only lights when NOT over a slide.
            onDragOver={(e) => { if (isMediaDrag(e) && canAcceptMediaDrop) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setBgDropIdx(null); setNewDropActive(true); } }}
            onDragLeave={(e) => { if (e.currentTarget === e.target) setNewDropActive(false); }}
            onDrop={(e) => { if (isMediaDrag(e)) dropMediaOnEmpty(e); }}
            className={cn("relative isolate", viewMode === "text" ? "flex flex-col" : "grid", "min-h-[45vh]",
              newDropActive && "outline-2 outline-dashed outline-[var(--color-brand)] outline-offset-[-6px] rounded-lg")}
            style={viewMode === "text"
              ? { gap: 4 }
              // alignContent:start packs rows at the top so a wrapped row (e.g.
              // slide 6 under slides 1-5) sits directly below the first row
              // instead of the grid stretching rows to fill the 45vh min-height.
              : viewMode === "list"
                ? { gap: 6, alignContent: "start", gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(slideSize * 2, 220)}px, 1fr))` }
                : { gap: 6, alignContent: "start", gridTemplateColumns: `repeat(auto-fill, minmax(${slideSize}px, 1fr))` }
            }
          >
            <DotGridBackground />
            {newDropActive && (
              <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
                <div className="px-3 py-1.5 rounded-full bg-[var(--color-brand)] text-black text-[11px] font-semibold shadow-lg">
                  Drop to add a full-screen image slide
                </div>
              </div>
            )}
            {slides.length === 0 && (
              <div className="col-span-full relative flex flex-col items-center justify-center gap-3 py-20 text-center">
                <div className="w-12 h-12 rounded-xl grid place-items-center surface-elev">
                  <LayoutGrid className="w-5 h-5 text-[var(--color-muted-foreground)]" />
                </div>
                <div className="text-[13px] font-semibold text-[var(--color-foreground)]">No slides yet</div>
                <div className="text-[11px] text-[var(--color-muted-foreground)] max-w-[280px] leading-relaxed">
                  Use <span className="text-[var(--color-foreground)]">Add slide</span> above to create one — or click any slide to send it live. Enable Safe Mode in Settings to require a double-click.
                </div>
              </div>
            )}
            {slides.map((s, idx) => (
              <SortableSlideCard
                key={slideIds[idx]}
                id={slideIds[idx]}
                slide={displaySlides[idx] ?? s}
                index={idx + 1}
                groupChip={groupChips?.[idx] ?? null}
                actionCount={slideActionSpecs?.[idx]?.length ?? 0}
                actionTypes={slideActionSpecs?.[idx]?.map((a) => a.type)}
                actionsMenu={canEditSlideActions ? {
                  palette: SLIDE_MENU_PALETTE,
                  current: slideActionSpecs?.[idx] ?? [],
                  onToggle: (spec: ActionSpec) => toggleSlideAction(idx, spec),
                  onRemoveAt: (i: number) => removeSlideActionAt(idx, i),
                  onClearAll: () => clearSlideActions(idx),
                  describe: describeSlideSpec,
                  automations: runnableAutomations,
                } : null}
                sectionMenu={sectionSongId ? {
                  groups: songGroups,
                  currentGroupId: slideGroupIds?.[idx] ?? null,
                  onAssign: (gid) => assignSlideSection(idx, gid),
                  onQuickCreate: (name, kind) => quickCreateSectionAndAssign(idx, name, kind),
                } : null}
                bgMenu={{
                  thisImageUrl: ((displaySlides[idx] ?? s) as { bgImageUrl?: string }).bgImageUrl,
                  onChooseImage: () => setBgPickIdx(idx),
                  onUseOnAll: () => useImageOnAllSlides(((displaySlides[idx] ?? s) as { bgImageUrl?: string }).bgImageUrl),
                  onRemove: () => removeSlideBackground(idx),
                  onRemoveAll: removeAllSlideBackgrounds,
                  canEdit: item?.type === "song" && !!(item as { songId?: string }).songId,
                  hasGlobalBg: activeBackgroundId !== "none",
                  onClearGlobal: () => { if (clearProjectorBackground()) void import("sonner").then(({ toast }) => toast.success("Projector background cleared (all screens)")); },
                }}
                themeMenu={{
                  activeLookId: activeBackgroundId,
                  onSwitchLook: switchLook,
                  looks: BUILT_IN_BACKGROUNDS.map((b) => ({ id: b.id, name: b.name, c1: (b as { shaderPrimaryColor?: string }).shaderPrimaryColor, c2: (b as { shaderSecondaryColor?: string }).shaderSecondaryColor })),
                  dbThemes: themes,
                  onRemoveDb: removeThemeAll,
                  onApplyDbThisSlide: (themeId) => applyThemeThisSlide(themeId, item?.type === "song" ? item.songSlideRows?.[idx]?.id : undefined),
                  onRemoveDbThisSlide: () => removeThemeThisSlide(item?.type === "song" ? item.songSlideRows?.[idx]?.id : undefined),
                  canApplyDb: item?.type === "song" && !!(item as { songId?: string }).songId,
                  selectedCount: selectedSlideIds.length,
                  onApplyDbSelected: (themeId) => applyThemeToSlides(themeId, selectedSlideIds),
                  builtins: BUILTIN_THEMES.map((b) => ({ id: b.id, name: b.name })),
                  onApplyDb: applyThemeAllResolved,
                }}
                appearance={itemAppearance ?? undefined}
                background={ctx.background}
                selected={idx === ctx.previewSlideIdx}
                multiSelected={item?.type === "song" && !!item.songSlideRows?.[idx]?.id && selectedSlideIds.includes(item.songSlideRows[idx].id)}
                canQuickEdit={item?.type === "song" && !!(item as { songId?: string }).songId}
                onSendLive={() => {
                  fireLive(`${ctx.previewItemIdx}:${slideIds[idx]}`, () => { ctx.onSendSlideToLive(displaySlides[idx] ?? s, undefined, { ...(itemSendOpts ?? {}), sourceItemIdx: ctx.previewItemIdx }); ctx.fireSlideActions(ctx.previewItemIdx, idx); });
                }}
                onSelect={(mods) => {
                  // cmd/ctrl/shift-click builds a multi-selection (song slides
                  // only) — never previews or fires live.
                  const rowIds = item?.type === "song" ? (item.songSlideRows ?? []).map((r) => r?.id ?? "") : [];
                  if (mods && (mods.toggle || mods.range) && rowIds[idx]) {
                    setSelectedSlideIds((prev) => nextSlideSelection(prev, rowIds, idx, ctx.previewSlideIdx, mods));
                    return;
                  }
                  if (selectedSlideIds.length > 0) setSelectedSlideIds([]);
                  console.log("[click] slide", { id: slideIds[idx], idx, safeMode: safeMode() });
                  // Ignore the ghost click dnd-kit lets through right after a
                  // drag-drop — otherwise reordering could fire a slide live.
                  // Fix-loop 2026-07-27: the guard suppresses ONLY the go-live
                  // fire; preview selection still happens (window 200 → 120ms).
                  const justDragged = Date.now() - lastDragEndRef.current < 120;
                  ctx.onJumpSlide(ctx.previewItemIdx, idx);
                  if (justDragged) {
                    console.log("[click] slide live suppressed (just finished drag)", { id: slideIds[idx] });
                    return;
                  }
                  if (!safeMode()) {
                    // Fix-loop 2026-07-27: dedupe key includes the playlist
                    // item — the `slide-${i}` fallback collides across items
                    // and across reorders.
                    fireLive(`${ctx.previewItemIdx}:${slideIds[idx]}`, () => { ctx.onSendSlideToLive(displaySlides[idx] ?? s, undefined, { ...(itemSendOpts ?? {}), sourceItemIdx: ctx.previewItemIdx }); ctx.fireSlideActions(ctx.previewItemIdx, idx); });
                  }
                }}
                onDouble={() => {
                  console.log("[click] slide double", { id: slideIds[idx], idx });
                  // Double-click is the natural "edit" gesture. For editable song
                  // slides, open the full slide editor (Quick Edit remains on the
                  // right-click menu for fast text-only tweaks). Non-editable
                  // slides keep the fire-to-live-in-safe-mode behaviour.
                  const editable = item?.type === "song" && !!(item as { songId?: string }).songId;
                  if (editable && onOpenEditor) {
                    ctx.onJumpSlide(ctx.previewItemIdx, idx); // select the slide first
                    onOpenEditor();
                    return;
                  }
                  // Media image → open the crop/frame/blur editor (same gesture as
                  // the Media library thumbnails).
                  if (item?.type === "media" && s.kind === "image") {
                    const meta = item.mediaMeta?.[idx];
                    if (meta?.id && s.url) {
                      ctx.onJumpSlide(ctx.previewItemIdx, idx);
                      window.dispatchEvent(new CustomEvent("presentflow:edit-media-image", { detail: { id: meta.id, url: s.url, fileName: meta.fileName || "Image" } }));
                      return;
                    }
                  }
                  if (safeMode()) fireLive(`${ctx.previewItemIdx}:${slideIds[idx]}`, () => ctx.onSendSlideToLive(displaySlides[idx] ?? s, undefined, { ...(itemSendOpts ?? {}), sourceItemIdx: ctx.previewItemIdx }));
                }}
                onDelete={() => {
                  // Delete THIS slide immediately by its DB id (works for designed
                  // songs too — no guard redirect, no rewriting other slides), then
                  // refresh so the grid updates. 2026-08-19: previously used a
                  // rewrite-all update with no refresh, so the deletion never showed.
                  void (async () => {
                    const { toast } = await import("sonner");
                    if (item?.type !== "song" || !(item as { songId?: string }).songId) {
                      toast.error("Only song slides can be deleted here");
                      return;
                    }
                    if (slides.length <= 1) {
                      toast.error("A song needs at least one slide");
                      return;
                    }
                    const slideId = item.songSlideRows?.[idx]?.id;
                    if (!slideId) { toast.error("Couldn't find that slide to delete"); return; }
                    const res = await deleteSongSlide(slideId);
                    if (!res.ok) { toast.error(res.error ?? "Delete failed"); return; }
                    // Neutral (not green): a delete is an acknowledgment, not a
                    // "saved" success; red is reserved for failures.
                    toast("Slide deleted");
                    router.refresh();
                  })();
                }}
                onQuickEdit={() => {
                  // Quick Edit now works "no matter the design" — the save path
                  // (updateSongSlideText) preserves the slide's objectsJson layout
                  // and only swaps the FIRST text object, so designed songs no
                  // longer redirect to the full editor. Seed the box from that SAME
                  // first text object (not the flattened lyrics) so a multi-text
                  // slide's other objects can't be duplicated into the first on save.
                  // Falls back to the flat text for plain-lyric slides.
                  let text = s.kind === "text" ? ((s as { text?: string }).text ?? "") : "";
                  const objs = s.kind === "text" ? (s as { objects?: Array<{ kind?: string; text?: string; hidden?: boolean }> }).objects : undefined;
                  if (Array.isArray(objs)) {
                    // In-place edit only works for a single text object (the
                    // soleText render path); a multi-object custom layout renders
                    // via SlideObjectsLayer which has no contentEditable, so the
                    // panel would open dead. Guard with an honest message.
                    const visible = objs.filter((o) => !o?.hidden);
                    const soleEditable = visible.length === 1 && visible[0]?.kind === "text";
                    if (!soleEditable) {
                      void import("sonner").then(({ toast }) => toast.info(
                        "This slide has a custom layout — open it in the slide editor to change its text.",
                        onOpenEditor
                          ? { action: { label: "Open editor", onClick: () => { ctx.onJumpSlide(ctx.previewItemIdx, idx); onOpenEditor(); } } }
                          : undefined,
                      ));
                      return;
                    }
                    const firstText = objs.find((o) => o?.kind === "text");
                    if (firstText && typeof firstText.text === "string") text = firstText.text;
                  }
                  // Capture the STABLE slide id now so Save can't be misdirected
                  // by a later reorder/delete while the editor stays open.
                  const slideId = item?.type === "song" ? item.songSlideRows?.[idx]?.id : undefined;
                  void (async () => {
                    // Switching target with unsaved typed text → ask first.
                    if (!(await confirmDiscardQe())) return;
                    editedTextRef.current = text; // seed the live-edit ref
                    qeBaselineRef.current = text;
                    qeOffset.current = { x: 0, y: 0 }; // open centred each time
                    applyQeTransform(); // recenter even if the panel is already mounted (target switch)
                    setQuickEdit({ slideIdx: idx, slideId, text });
                  })();
                }}
                onDuplicate={() => {
                  if (guardObjectSong()) return;
                  void (async () => {
                    if (item?.type === "song" && (item as { songId?: string }).songId) {
                      const songId = (item as { songId?: string }).songId!;
                      const newSlides = [...slides];
                      newSlides.splice(idx + 1, 0, s);
                      const updatedSlides = newSlides.map((sl) => ({
                        lyrics: sl.kind === "text" ? ((sl as { text?: string }).text ?? "") : "",
                      }));
                      const res = await updateSongSlides(songId, updatedSlides);
                      if (!res.ok) {
                        const { toast } = await import("sonner");
                        toast.error(res.error ?? "Duplicate failed");
                      } else {
                        const { toast } = await import("sonner");
                        toast.success("Slide duplicated");
                        router.refresh();
                      }
                    }
                  })();
                }}
                onCopyText={() => {
                  const text = s.kind === "text" ? ((s as { text?: string }).text ?? "") : "";
                  if (text) {
                    // In-app text clipboard powers "Paste Text" onto another slide;
                    // also mirror to the OS clipboard for paste outside the app.
                    setTextClipboard(text);
                    navigator.clipboard.writeText(text).then(() => {
                      void import("sonner").then(({ toast }) => toast.success("Copied to clipboard"));
                    }).catch(() => {
                      // In-app copy already succeeded (Paste Text works); the OS
                      // clipboard mirror failed — report honestly, not as success.
                      void import("sonner").then(({ toast }) => toast("Copied in app (system clipboard unavailable)"));
                    });
                  }
                }}
                canPasteText={canPasteText && s.kind === "text"}
                onPasteText={() => pasteTextOnto(idx)}
                onCopySlide={() => {
                  setSlideClipboard(s);
                  void import("sonner").then(({ toast }) => toast.success("Slide copied"));
                }}
                canPaste={canPasteHere}
                pasteReason={pasteReason}
                onPasteSlide={() => pasteSlideAt(idx + 1)}
                bgDropActive={bgDropIdx === idx}
                onMediaDragOver={(e) => {
                  if (!isMediaDrag(e) || !canAcceptMediaDrop) return;
                  e.preventDefault();
                  e.stopPropagation(); // keep the empty-area new-slide affordance off while over a card
                  e.dataTransfer.dropEffect = "copy";
                  setNewDropActive(false);
                  setBgDropIdx(idx);
                }}
                onMediaDragLeave={() => setBgDropIdx((cur) => (cur === idx ? null : cur))}
                onMediaDrop={(e) => dropMediaOnSlide(idx, e)}
              />
            ))}
          </div>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content collisionPadding={8} className="max-h-[min(420px,var(--radix-context-menu-content-available-height))] overflow-y-auto min-w-[180px] rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-xl z-50">
              <ContextMenu.Item disabled={!canPasteHere} onSelect={() => pasteSlideAt(slides.length)}
                title={pasteReason ?? undefined}
                className={cn("px-3 py-1.5 rounded outline-none cursor-pointer", canPasteHere ? "hover:bg-[var(--color-panel)] text-[var(--color-foreground)]" : "opacity-40 cursor-not-allowed")}>
                {canPasteHere ? "Paste slide (at end)" : "Paste slide"}
              </ContextMenu.Item>
              {!canPasteHere && pasteReason && (
                <div className="px-3 pb-1 pt-0.5 text-[10px] leading-snug text-[var(--color-muted-foreground)] max-w-[220px]">
                  {pasteReason}
                </div>
              )}
            </ContextMenu.Content>
          </ContextMenu.Portal>
          </ContextMenu.Root>
        </SortableContext>
      </DndContext>

      {/* Stage row (half-size mirror) */}
      {slides.length > 0 && (
        <div>
          <div className="eyebrow mb-2">Stage</div>
          <div
            className="grid"
            style={{
              gap: 6,
              gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(slideSize / 1.6)}px, 1fr))`,
            }}
          >
            {slides.map((s, idx) => (
              <div
                key={idx}
                className="relative aspect-video rounded-md border border-[var(--color-border)] overflow-hidden opacity-70"
              >
                {/* Fit text down to a small floor so the half-size stage mirror
                    doesn't clip long lyrics (matches the main grid's textMinPx). */}
                <ThemedSlideCard slide={displaySlides[idx] ?? s} textMinPx={8} appearance={itemAppearance ?? undefined} background={ctx.background} />
                <div className="absolute bottom-1 right-1 text-[8px] font-mono uppercase tracking-wider text-white/55 bg-black/60 px-1 py-px rounded-sm pointer-events-none">
                  Stage
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Edit — ProPresenter-style NON-MODAL floating editor. The selected
          slide pops out ~2x larger as the REAL slide (its own styling/background),
          editable in place. Crucially it is NOT a modal: no overlay, no focus
          trap — the operator can still click other slides in the grid and push
          them LIVE mid-service while a quick edit is open. Small ✕ at top-left. */}
      {qeConfirmDialog}
      {quickEdit !== null && (() => {
        const current = slides[quickEdit.slideIdx];
        const preview = current
          ? applyTextToSlide(current, quickEdit.text)
          : ({ kind: "text", text: quickEdit.text } as SlidePayload);
        return (
          <div
            ref={qePanelRef}
            className="fixed z-50 top-[14%] left-1/2 flex flex-col items-center"
            style={{ transform: "translate(-50%, 0)" }}
            role="dialog"
            aria-label={`Quick Edit — Slide ${quickEdit.slideIdx + 1}`}
            onKeyDown={(e) => {
              // stopPropagation: closing the panel must never also reach the global
              // hotkey handler (Esc = clear live).
              if (e.key === "Escape") { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation?.(); void closeQuickEdit(); }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { void handleQuickEditSave(editedTextRef.current); }
            }}
          >
            {/* Drag handle — grab this bar to move the box so it never blocks the
                slides behind it. Pointer-capture drag; updates the panel transform
                directly (no re-render, so the caret is untouched). */}
            <div
              onPointerDown={onQeDragStart}
              onPointerMove={onQeDragMove}
              onPointerUp={onQeDragEnd}
              className="mb-1.5 flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/70 ring-1 ring-white/20 text-white/70 text-[11px] cursor-move select-none touch-none hover:bg-black/85"
              title="Drag to move"
            >
              <GripHorizontal className="w-3.5 h-3.5" /> Drag to move
            </div>
            {/* The popped slide — the REAL render, edited IN PLACE. The themed text
                node itself is contentEditable (via AutoFitText.editable), so the
                caret sits on the real letters and the styling/wrapping is inherently
                correct across ANY theme/background/logo. `preview` is derived from
                the FROZEN quickEdit.text (not the live-typed value) so the caret +
                auto-fit stay put; the live text lives in editedTextRef. Smaller
                (42vw/380px) so more of the grid stays visible behind it. */}
            <div className="relative w-[min(42vw,380px)] aspect-video rounded-lg overflow-hidden shadow-[0_16px_56px_rgba(0,0,0,0.7)] ring-2 ring-white/30">
              <ThemedSlideCard
                // Re-key per edited slide so switching the target while the
                // (non-modal) editor stays open remounts the editable node and
                // re-runs its focus + caret-to-end effect on the new text.
                key={quickEdit.slideId ?? quickEdit.slideIdx}
                slide={preview}
                textMinPx={18}
                appearance={itemAppearance ?? undefined}
                background={ctx.background}
                editable
                onEditInput={(t) => { editedTextRef.current = t; }}
              />
              {/* Close ✕ — top-left, like ProPresenter. */}
              <button type="button" aria-label="Close" onClick={() => void closeQuickEdit()}
                className="absolute top-1.5 left-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white/90 ring-1 ring-white/20 z-10">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Minimal floating action row. */}
            <div className="mt-2.5 flex items-center justify-center gap-2">
              <button
                type="button"
                // Not `disabled`: disabling the focused button drops focus to <body>,
                // so Esc would no longer reach the panel. The ref guard below blocks
                // a double-click instead.
                aria-busy={qeSaving}
                onClick={async () => {
                  // In-flight guard: a double-click must not save + send twice.
                  if (qeSendingRef.current) return;
                  const t = editedTextRef.current.trim();
                  if (!t) {
                    void import("sonner").then(({ toast }) => toast("Type something first"));
                    return;
                  }
                  qeSendingRef.current = true;
                  try {
                  // Unsaved typed text → save first (same church-scoped path + empty
                  // rejection) so the grid and projector agree. "Save" alone still
                  // never pushes live (2026-08-26 directive).
                  if (qeDirty() && item?.type === "song") {
                    if (!(await handleQuickEditSave(editedTextRef.current))) return;
                  }
                  ctx.onSendSlideToLive(current ? applyTextToSlide(current, t) : { kind: "text", text: t }, undefined, itemSendOpts ?? { origin: { kind: "text" } });
                  } finally {
                    qeSendingRef.current = false;
                  }
                }}
                className="h-8 px-3 rounded-md text-[12px] font-medium bg-white/10 border border-white/20 hover:bg-white/20 text-white backdrop-blur-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send this slide live
              </button>
              <button
                type="button"
                onClick={() => void handleQuickEditSave(editedTextRef.current)}
                disabled={qeSaving || !item?.type || item.type !== "song"}
                className="h-8 px-4 rounded-md text-[12px] font-semibold bg-[var(--color-brand)] text-black hover:opacity-90 disabled:opacity-50"
              >
                {qeSaving ? "Saving…" : "Save"}
              </button>
              <span className="ml-1 text-[11px] text-white/60">{saveKey} Save · Esc Close · other slides stay live-clickable</span>
            </div>
          </div>
        );
      })()}
      {bgPickIdx !== null && (
        <MediaLibraryPicker
          kind="image"
          onClose={() => setBgPickIdx(null)}
          onPick={(url) => { const i = bgPickIdx; setBgPickIdx(null); if (i !== null) applyChosenBackground(i, url); }}
        />
      )}
    </div>
  );
}

function SortableSlideCard(props: {
  id: string;
  slide: SlidePayload;
  index: number;
  groupChip?: { label: string; color: string } | null;
  sectionMenu?: SectionMenu | null;
  bgMenu?: BgMenu | null;
  themeMenu?: ThemeMenu | null;
  actionCount?: number;
  actionTypes?: ActionSpec["type"][];
  actionsMenu?: SlideActionsMenu | null;
  appearance?: ThemeAppearance;
  background?: BackgroundSpec | null;
  selected: boolean;
  multiSelected?: boolean;
  canQuickEdit: boolean;
  canPaste: boolean;
  pasteReason: string | null;
  canPasteText: boolean;
  onSelect: (mods?: { toggle: boolean; range: boolean }) => void;
  onDouble: () => void;
  onDelete: () => void;
  onQuickEdit: () => void;
  onDuplicate: () => void;
  onCopyText: () => void;
  onCopySlide: () => void;
  onPasteSlide: () => void;
  onPasteText: () => void;
  onSendLive: () => void;
  bgDropActive: boolean;
  onMediaDragOver: (e: React.DragEvent) => void;
  onMediaDragLeave: (e: React.DragEvent) => void;
  onMediaDrop: (e: React.DragEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onDragOver={props.onMediaDragOver}
      onDragLeave={props.onMediaDragLeave}
      onDrop={props.onMediaDrop}
      className="relative w-full min-w-0 group/slide"
    >
      {/* Media-bin background drop affordance: a brand ring + "Set as background"
          badge over this slide while a media thumbnail hovers it. */}
      {props.bgDropActive && (
        <div className="pointer-events-none absolute inset-0 z-20 rounded-lg ring-2 ring-[var(--color-brand)] bg-[var(--color-brand)]/15 grid place-items-center">
          <span className="px-2 py-0.5 rounded-full bg-[var(--color-brand)] text-black text-[10px] font-semibold shadow">Set as background</span>
        </div>
      )}
      <SlideCard
        slide={props.slide}
        index={props.index}
        groupChip={props.groupChip}
        sectionMenu={props.sectionMenu}
        bgMenu={props.bgMenu}
        themeMenu={props.themeMenu}
        actionCount={props.actionCount}
        actionTypes={props.actionTypes}
        actionsMenu={props.actionsMenu}
        appearance={props.appearance}
        background={props.background}
        selected={props.selected}
        multiSelected={props.multiSelected}
        canQuickEdit={props.canQuickEdit}
        canPaste={props.canPaste}
        pasteReason={props.pasteReason}
        canPasteText={props.canPasteText}
        onSelect={props.onSelect}
        onDouble={props.onDouble}
        onDelete={props.onDelete}
        onQuickEdit={props.onQuickEdit}
        onDuplicate={props.onDuplicate}
        onCopyText={props.onCopyText}
        onCopySlide={props.onCopySlide}
        onPasteSlide={props.onPasteSlide}
        onPasteText={props.onPasteText}
        onSendLive={props.onSendLive}
      />
      {/* Native drag-to-playlist handle. Kept SEPARATE from the dnd-kit reorder
          (whose pointer listeners live on this wrapper) by stopping propagation
          on pointer/mouse down, so grabbing the handle starts an HTML5 drag —
          drop it on a playlist song to append this slide to that song's end —
          while the rest of the card still reorders within the grid. */}
      <div
        draggable
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDragStart={(e) => {
          e.stopPropagation();
          try {
            e.dataTransfer.setData("application/x-presentflow-slide", JSON.stringify(props.slide));
            e.dataTransfer.effectAllowed = "copy";
          } catch { /* noop */ }
        }}
        title="Drag onto a song in the playlist to add this slide to the end of that song"
        className="absolute top-1 right-1 z-10 w-6 h-6 rounded-md flex items-center justify-center cursor-grab active:cursor-grabbing opacity-0 group-hover/slide:opacity-100 transition-opacity bg-[var(--color-elevated)]/90 border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>
    </div>
  );
}

function SlideCard({
  slide, index, groupChip, sectionMenu, bgMenu, themeMenu, actionCount, actionTypes, actionsMenu, appearance, background, selected, multiSelected, canQuickEdit, canPaste, pasteReason, canPasteText, onSelect, onDouble, onDelete, onQuickEdit, onDuplicate, onCopyText, onCopySlide, onPasteSlide, onPasteText, onSendLive,
}: {
  slide: SlidePayload;
  index: number;
  groupChip?: { label: string; color: string } | null;
  sectionMenu?: SectionMenu | null;
  bgMenu?: BgMenu | null;
  themeMenu?: ThemeMenu | null;
  actionCount?: number;
  actionTypes?: ActionSpec["type"][];
  actionsMenu?: SlideActionsMenu | null;
  appearance?: ThemeAppearance;
  background?: BackgroundSpec | null;
  selected: boolean;
  multiSelected?: boolean;
  canQuickEdit: boolean;
  canPaste: boolean;
  pasteReason: string | null;
  canPasteText: boolean;
  onSelect: (mods?: { toggle: boolean; range: boolean }) => void;
  onDouble: () => void;
  onDelete: () => void;
  onQuickEdit: () => void;
  onDuplicate: () => void;
  onCopyText: () => void;
  onCopySlide: () => void;
  onPasteSlide: () => void;
  onPasteText: () => void;
  onSendLive: () => void;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <button
          type="button"
          role="gridcell"
          tabIndex={0}
          onClick={(e) => onSelect({ toggle: e.metaKey || e.ctrlKey, range: e.shiftKey })}
          onDoubleClick={onDouble}
          aria-selected={multiSelected || undefined}
          // 2026-08-25 fix: stop the right-click from ALSO reaching the grid-level
          // "Paste slide" context menu that wraps the whole grid (commit 0e2fead).
          // Radix ContextMenu.Trigger doesn't stopPropagation, so without this a
          // right-click on a card opened the outer paste-only menu ON TOP of the
          // per-slide menu, hiding Quick Edit ("Quick Edit basically nonexistent").
          // The inner (this card's) menu still opens — stopPropagation only blocks
          // the ANCESTOR grid trigger, not this element's own Radix handler.
          onContextMenu={(e) => e.stopPropagation()}
          // Keyboard access: Shift+F10 / the ContextMenu key open this card's menu.
          onKeyDown={(e) => {
            if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
              e.preventDefault();
              e.stopPropagation();
              openContextMenuAt(e.currentTarget);
            }
          }}
          // Staggered pop-in when a song's slides first mount (keyed by slide id,
          // so it fires on song switch, not on every re-render).
          style={{ animationDelay: `${Math.min(Math.max(index - 1, 0), 14) * 22}ms` }}
          className={cn(
            "pf-slide-pop",
            // w-full so every card fills its grid cell → uniform size regardless
            // of word count (a <button> otherwise shrinks to its text content,
            // which made short slides like "AMEN" tiny). aspect-video then gives
            // a consistent 16:9 box for all.
            "relative w-full min-w-0 aspect-video rounded-lg overflow-hidden text-left",
            "transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-house)]",
            "motion-safe:hover:-translate-y-[3px] active:translate-y-0 active:duration-75",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]",
            multiSelected && "ring-2 ring-[#0a84ff] ring-offset-1 ring-offset-[var(--color-shell)]",
            selected
              ? "border-2 border-[var(--color-brand)] pf-selected-glow shadow-[var(--shadow-ember)] hover:shadow-[var(--shadow-ember-lg)]"
              : "border border-[var(--color-border)] shadow-[var(--shadow-sm)] hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:shadow-[var(--shadow-lg)]",
          )}
        >
          {/* 2026-07-25 pull-back — textMinPx=8 + no-pagination made
              lyrics unreadable ("way too small" per field report). Raised
              to 14px (readable at glance size), pagination re-enabled so
              long stanzas split cleanly instead of shrinking to invisible.
              Text still fits WHOLE short verses without truncating, and
              long ones page (visible page indicator inside the card).
              Live projector rendering unaffected (uses the 24px default). */}
          <ThemedSlideCard slide={slide} textMinPx={14} appearance={appearance} background={background} />
          <div
            className="absolute top-1.5 left-1.5 min-w-[20px] h-5 px-1 flex items-center justify-center rounded-md text-[10px] font-bold tabular-nums transition-colors"
            style={selected
              ? { background: "var(--color-brand)", color: "var(--color-primary-foreground)", boxShadow: "var(--shadow-sm)" }
              : { background: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.82)", border: "1px solid rgba(255,255,255,0.14)" }}
            aria-hidden
          >
            {index}
          </div>
          {/* Group badge (wave 6D) — colour-coded chip. Moved to the BOTTOM-left
              corner (was top-left, over the lyrics) so the section label never
              obscures the words. Slightly smaller + translucent for the same reason. */}
          {groupChip && (
            <div
              className="absolute bottom-1.5 left-1.5 max-w-[55%] h-[18px] px-1.5 flex items-center rounded-md text-[9px] font-semibold uppercase tracking-wide truncate shadow-sm z-10 pointer-events-none"
              style={{ background: `color-mix(in oklab, ${groupChip.color} 85%, transparent)`, color: "#fff", border: "1px solid rgba(255,255,255,0.18)" }}
              title={`Section: ${groupChip.label}`}
            >
              <span className="truncate">{groupChip.label}</span>
            </div>
          )}
          {/* Background button (2026-09-20). The per-slide background controls existed only
              behind a right-click, so operators believed the whole THEME had to be edited
              to change a song's background. This surfaces the SAME menu — no new storage,
              no new precedence — on hover, next to the other card controls. */}
          {bgMenu && bgMenu.canEdit && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Background for this slide"
              title="Background for this slide — choose an image, use it on all slides, or clear it"
              className="absolute bottom-1.5 right-1.5 h-5 w-5 flex items-center justify-center rounded-md opacity-0 group-hover/slide:opacity-100 transition-opacity cursor-pointer z-10"
              style={{ background: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.88)", border: "1px solid rgba(255,255,255,0.14)" }}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); openContextMenuAt(e.currentTarget.closest("button")); }}
            >
              <ImageIcon className="w-3 h-3" />
            </span>
          )}
          {/* Slide-actions badge (Phase 4) — a tiny lightning row on the top-right
              when this slide has attached actions (ProPresenter-style). */}
          {(actionCount ?? 0) > 0 && (() => {
            const types = actionTypes ?? [];
            const shown = types.slice(0, 3);
            const extra = (actionCount ?? 0) - shown.length;
            return (
              <span
                className="absolute top-1.5 right-1.5 h-5 px-1.5 flex items-center gap-0.5 rounded-md text-[10px] font-bold shadow-sm cursor-pointer"
                style={{ background: "color-mix(in oklab, var(--color-shell) 70%, transparent)", color: "var(--color-brand)", border: "1px solid color-mix(in oklab, var(--color-brand) 40%, transparent)" }}
                title={`${actionCount} slide action${actionCount === 1 ? "" : "s"} fire when this slide goes live — click to view`}
                // Click opens the card menu (Actions → Attached list) instead of selecting/sending the slide.
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); openContextMenuAt(e.currentTarget.closest("button")); }}
              >
                {shown.length === 0
                  ? <><Zap className="w-3 h-3" />{actionCount}</>
                  : <>{shown.map((t, i) => { const Icon = actionTypeIcon(t); return <Icon key={i} className="w-3 h-3" />; })}{extra > 0 && <span>+{extra}</span>}</>}
              </span>
            );
          })()}
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        {/* ~13 rows ≈ 390px. Measured 2026-09-18 at 911x512 (1366x768 @150%):
            the menu rendered 124..512, i.e. flush to the bottom edge with ZERO
            margin and no scroll — one more attached action or automation and
            rows fall off-screen (Radix collision-flips, it does not scroll).
            Same cap + collisionPadding the Theme submenu below already uses. */}
        <ContextMenu.Content collisionPadding={8} className="min-w-[220px] max-h-[min(420px,var(--radix-context-menu-content-available-height))] overflow-y-auto rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-xl z-50">
          {/* Send to output — available for every slide type */}
          <ContextMenu.Item
            onSelect={onSendLive}
            className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)] font-medium"
          >
            <span className="w-3.5 h-3.5 rounded-full bg-[var(--color-brand)] inline-block shrink-0" />
            Send to Live
          </ContextMenu.Item>
          {actionsMenu && (
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)]">
                <Zap className="w-3.5 h-3.5 text-[var(--color-brand)]" />
                Actions{actionsMenu.current.length > 0 ? ` (${actionsMenu.current.length})` : ""}
                <ChevronRight className="w-3.5 h-3.5 ml-auto" />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent collisionPadding={8} className="min-w-[220px] max-h-[min(380px,var(--radix-context-menu-content-available-height))] overflow-y-auto rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-xl z-50">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">Attached — fire when this slide goes live</div>
                  {actionsMenu.current.length === 0 && (
                    <div className="px-3 py-1.5 text-[11px] text-[var(--color-muted-foreground)]">None attached</div>
                  )}
                  {actionsMenu.current.map((spec, i) => (
                    <ContextMenu.Item
                      key={`attached-${specKey(spec)}-${i}`}
                      onSelect={(e) => { e.preventDefault(); actionsMenu.onRemoveAt(i); }}
                      className="group flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)]"
                      aria-label={`Remove ${actionsMenu.describe(spec)}`}
                    >
                      <Check className="w-3.5 h-3.5 shrink-0 text-[var(--color-brand)]" />
                      <span className="flex-1 min-w-0 truncate">{actionsMenu.describe(spec)}</span>
                      <span className="ml-2 flex items-center gap-1 text-[10px] text-[var(--color-muted-foreground)] group-data-[highlighted]:text-[var(--color-destructive)]"><Trash2 className="w-3 h-3" />Remove</span>
                    </ContextMenu.Item>
                  ))}
                  {actionsMenu.current.length > 1 && (
                    <ContextMenu.Item
                      onSelect={(e) => { e.preventDefault(); actionsMenu.onClearAll(); }}
                      className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer text-[var(--color-destructive)] data-[highlighted]:bg-[var(--color-panel)]"
                    >
                      <Trash2 className="w-3.5 h-3.5 shrink-0" />
                      Remove all actions
                    </ContextMenu.Item>
                  )}
                  <ContextMenu.Separator className="h-px my-1 bg-[var(--color-border)]" />
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">Add</div>
                  {actionsMenu.palette.map((p, i) => {
                    const spec = p.make();
                    const on = actionsMenu.current.some((c) => specKey(c) === specKey(spec));
                    return (
                      <ContextMenu.Item
                        key={i}
                        onSelect={(e) => { e.preventDefault(); actionsMenu.onToggle(spec); }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)]"
                      >
                        <span className="w-3.5 h-3.5 shrink-0">{on && <Check className="w-3.5 h-3.5 text-[var(--color-brand)]" />}</span>
                        <span className="min-w-0 truncate">{p.label}</span>
                      </ContextMenu.Item>
                    );
                  })}
                  {actionsMenu.automations.length > 0 && (
                    <ContextMenu.Sub>
                      <ContextMenu.SubTrigger className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)]">
                        <Workflow className="w-3.5 h-3.5 shrink-0" />
                        Run automation
                        <ChevronRight className="w-3.5 h-3.5 ml-auto" />
                      </ContextMenu.SubTrigger>
                      <ContextMenu.Portal>
                        <ContextMenu.SubContent className="min-w-[200px] max-w-[280px] max-h-72 overflow-y-auto rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-xl z-50">
                          {actionsMenu.automations.map((m) => {
                            const spec: ActionSpec = { type: "macro", macroId: m.id };
                            const on = actionsMenu.current.some((c) => specKey(c) === specKey(spec));
                            return (
                              <ContextMenu.Item
                                key={m.id}
                                onSelect={(e) => { e.preventDefault(); actionsMenu.onToggle(spec); }}
                                className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)]"
                              >
                                <span className="w-3.5 h-3.5 shrink-0">{on && <Check className="w-3.5 h-3.5 text-[var(--color-brand)]" />}</span>
                                <span className="min-w-0 truncate">{m.name}</span>
                              </ContextMenu.Item>
                            );
                          })}
                        </ContextMenu.SubContent>
                      </ContextMenu.Portal>
                    </ContextMenu.Sub>
                  )}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          )}
          {/* Section (Groups & Arrangements, wave 6G) — grouped directly under
              Actions (the "organize this slide" pair). Tag THIS slide with a group
              so it can be arranged; lists existing sections + standard names to
              quick-create. */}
          {sectionMenu && (
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[state=open]:bg-[var(--color-panel)]">
                <Layers className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
                <span className="flex-1">Section</span>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className="min-w-[190px] max-h-[340px] overflow-y-auto rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-xl z-50">
                  {sectionMenu.currentGroupId && (
                    <>
                      <ContextMenu.Item
                        onSelect={() => sectionMenu.onAssign(null)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)]"
                      >
                        <X className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" /> Ungrouped
                      </ContextMenu.Item>
                      <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                    </>
                  )}
                  {/* Existing sections on this song */}
                  {sectionMenu.groups.length > 0 && (
                    <>
                      {[...sectionMenu.groups].map((g) => (
                        <ContextMenu.Item
                          key={g.id}
                          onSelect={() => sectionMenu.onAssign(g.id)}
                          className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)]"
                        >
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: groupColor({ kind: g.kind, color: g.color, name: g.name }) }} />
                          <span className="flex-1 truncate">{g.name || g.kind}</span>
                          {sectionMenu.currentGroupId === g.id && <Check className="w-3.5 h-3.5 text-[var(--color-brand)]" />}
                        </ContextMenu.Item>
                      ))}
                      <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                    </>
                  )}
                  {/* Standard names not already present — one-tap create + assign */}
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">New section</div>
                  {STANDARD_SECTIONS.filter(
                    (s) => !sectionMenu.groups.some((g) => g.name.trim().toLowerCase() === s.name.toLowerCase()),
                  ).map((s) => (
                    <ContextMenu.Item
                      key={s.name}
                      onSelect={() => sectionMenu.onQuickCreate(s.name, s.kind)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)]"
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0 opacity-70" style={{ background: groupColor({ kind: s.kind, color: null, name: s.name }) }} />
                      <span className="flex-1 truncate">{s.name}</span>
                    </ContextMenu.Item>
                  ))}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          )}
          {/* Theme — the named LOOKS (Gentle Waves, Holy Fire…) with a colour
              preview, applied to the live projector instantly; plus any saved DB
              themes (font/colour) applied to all slides. Peer of Actions/Section. */}
          {themeMenu && (
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[state=open]:bg-[var(--color-panel)]">
                <Palette className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
                <span className="flex-1">Theme</span>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent collisionPadding={8} className="min-w-[210px] max-h-[min(380px,var(--radix-context-menu-content-available-height))] overflow-y-auto rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-xl z-50">
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">Looks · projector</div>
                  {themeMenu.looks.map((l) => (
                    <ContextMenu.Item
                      key={l.id}
                      onSelect={(e) => { e.preventDefault(); themeMenu.onSwitchLook(l.id); }}
                      className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)]"
                    >
                      <span
                        className="w-4 h-4 rounded shrink-0 border border-[var(--color-border)]"
                        style={l.id === "none"
                          ? { background: "repeating-conic-gradient(#666 0% 25%, #333 0% 50%) 50% / 8px 8px" }
                          : { background: `linear-gradient(135deg, ${l.c1 ?? "#334155"}, ${l.c2 ?? l.c1 ?? "#334155"})` }}
                      />
                      <span className="flex-1 truncate">{l.name}</span>
                      {themeMenu.activeLookId === l.id && <Check className="w-3.5 h-3.5 text-[var(--color-brand)]" />}
                    </ContextMenu.Item>
                  ))}
                  {(themeMenu.dbThemes.length > 0 || themeMenu.builtins.length > 0) && (
                    <>
                      <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                      {themeMenu.dbThemes.length > 0 && <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">Saved themes</div>}
                      {/* Per theme: THIS slide (per-slide override), the SELECTED slides, or ALL slides. */}
                      {[...themeMenu.dbThemes, ...themeMenu.builtins].map((t, ti) => (<div key={t.id}>
                        {ti === themeMenu.dbThemes.length && themeMenu.builtins.length > 0 && <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">Built-in</div>}
                        <ContextMenu.Sub key={t.id}>
                          <ContextMenu.SubTrigger
                            disabled={!themeMenu.canApplyDb}
                            className={cn(
                              "flex items-center justify-between gap-2 px-3 py-1.5 rounded outline-none data-[state=open]:bg-[var(--color-panel)]",
                              themeMenu.canApplyDb ? "cursor-pointer data-[highlighted]:bg-[var(--color-panel)]" : "opacity-40 cursor-not-allowed",
                            )}
                          >
                            <span className="flex-1 truncate">{t.name}</span><span className="opacity-60">▸</span>
                          </ContextMenu.SubTrigger>
                          <ContextMenu.Portal>
                            <ContextMenu.SubContent collisionPadding={8} className="max-h-[min(420px,var(--radix-context-menu-content-available-height))] overflow-y-auto rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-[60] min-w-[150px]">
                              <ContextMenu.Item onSelect={() => themeMenu.canApplyDb && themeMenu.onApplyDbThisSlide(t.id)} className="px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)]">This slide</ContextMenu.Item>
                              {themeMenu.selectedCount > 0 && (
                                <ContextMenu.Item onSelect={() => themeMenu.canApplyDb && themeMenu.onApplyDbSelected(t.id)} className="px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)]">Selected slides ({themeMenu.selectedCount})</ContextMenu.Item>
                              )}
                              <ContextMenu.Item onSelect={() => themeMenu.canApplyDb && themeMenu.onApplyDb(t.id)} className="px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)]">All slides</ContextMenu.Item>
                            </ContextMenu.SubContent>
                          </ContextMenu.Portal>
                        </ContextMenu.Sub>
                      </div>))}
                      {themeMenu.canApplyDb && (
                        <>
                          <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                          <ContextMenu.Item
                            onSelect={() => themeMenu.onRemoveDbThisSlide()}
                            className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer text-[var(--color-destructive)] data-[highlighted]:bg-[var(--color-panel)]"
                          >
                            Remove theme (this slide)
                          </ContextMenu.Item>
                          <ContextMenu.Item
                            onSelect={() => themeMenu.onRemoveDb()}
                            className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer text-[var(--color-destructive)] data-[highlighted]:bg-[var(--color-panel)]"
                          >
                            Remove theme (all slides)
                          </ContextMenu.Item>
                        </>
                      )}
                    </>
                  )}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          )}
          {/* Background — the per-slide IMAGE. Add by dragging from the Media bin;
              copy this slide's image to all slides, or clear one/all. */}
          {bgMenu && bgMenu.canEdit && (
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[state=open]:bg-[var(--color-panel)]">
                <ImageIcon className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
                <span className="flex-1">Background</span>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent collisionPadding={8} className="min-w-[210px] max-h-[min(380px,var(--radix-context-menu-content-available-height))] overflow-y-auto rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-xl z-50">
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">This slide only</div>
                  <div className="px-3 py-0.5 text-[10px] text-[var(--color-muted-foreground)]">Drag from the Media bin onto a slide = that slide only. Use “BG” on a media item for every slide.</div>
                  <ContextMenu.Item
                    onSelect={() => bgMenu.onChooseImage()}
                    title="Pick a picture from your media library for this slide"
                    className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)]"
                  >
                    <ImageIcon className="w-3.5 h-3.5 opacity-70" /> Choose image…
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    disabled={!bgMenu.thisImageUrl}
                    onSelect={() => bgMenu.thisImageUrl && bgMenu.onUseOnAll()}
                    title={bgMenu.thisImageUrl ? "Copy this slide's image onto every slide" : "Drag an image from the Media bin onto this slide first"}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded outline-none",
                      bgMenu.thisImageUrl
                        ? "cursor-pointer data-[highlighted]:bg-[var(--color-panel)]"
                        : "opacity-40 cursor-not-allowed",
                    )}
                  >
                    Use this image on all slides
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    onSelect={() => bgMenu.onRemove()}
                    className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer text-[var(--color-destructive)] data-[highlighted]:bg-[var(--color-panel)]"
                  >
                    Remove image from this slide
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    onSelect={() => bgMenu.onRemoveAll()}
                    className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer text-[var(--color-destructive)] data-[highlighted]:bg-[var(--color-panel)]"
                  >
                    Remove images from all slides
                  </ContextMenu.Item>
                  {bgMenu.hasGlobalBg && (
                    <>
                      <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                      <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">All screens</div>
                      <ContextMenu.Item
                        onSelect={() => bgMenu.onClearGlobal()}
                        className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer text-[var(--color-destructive)] data-[highlighted]:bg-[var(--color-panel)]"
                      >
                        Clear projector background (the “BG” one)
                      </ContextMenu.Item>
                    </>
                  )}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          )}
          <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />

          {/* Quick Edit — only for song slides (non-song items have no editable text stored in DB) */}
          {canQuickEdit && (
            <ContextMenu.Item
              onSelect={onQuickEdit}
              className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
            >
              <Pencil className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
              Quick Edit
            </ContextMenu.Item>
          )}

          {/* Clipboard */}
          <ContextMenu.Item
            onSelect={onCopyText}
            className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
          >
            Copy Text
          </ContextMenu.Item>
          {/* Paste Text (C1) — drop copied text onto THIS slide, keeping its design.
              Disabled (with dimmed styling) until text is copied AND this is an
              editable song slide. */}
          <ContextMenu.Item
            disabled={!canPasteText}
            onSelect={canPasteText ? onPasteText : undefined}
            title={
              canPasteText
                ? "Replace this slide's words, keep its design"
                : slide.kind === "text"
                  ? "Copy text from a slide first"
                  : "Only text slides can take pasted text"
            }
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded outline-none",
              canPasteText
                ? "cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
                : "opacity-40 cursor-not-allowed",
            )}
          >
            Paste Text
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={onCopySlide}
            className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
          >
            Copy Slide
          </ContextMenu.Item>
          {/* Paste Slide — always shown. Disabled with an honest tooltip when it
              can't apply (nothing copied, or a non-editable Bible/media item), so
              the operator sees WHY rather than a silently missing action. */}
          <ContextMenu.Item
            disabled={!canPaste}
            onSelect={canPaste ? onPasteSlide : undefined}
            title={pasteReason ?? undefined}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded outline-none",
              canPaste
                ? "cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
                : "opacity-40 cursor-not-allowed",
            )}
          >
            Paste Slide
          </ContextMenu.Item>
          {canQuickEdit && (
            <ContextMenu.Item
              onSelect={onDuplicate}
              className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
            >
              Duplicate Slide
            </ContextMenu.Item>
          )}
          <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />

          {/* Destructive */}
          <ContextMenu.Item
            onSelect={onDelete}
            className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer text-[var(--color-destructive)] data-[highlighted]:bg-[var(--color-panel)]"
          >
            Delete Slide
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
