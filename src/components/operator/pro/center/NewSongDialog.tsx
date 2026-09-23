"use client";
/**
 * New-song dialog — ProPresenter 7 "New Presentation" parity (plan A.6/A.7).
 *
 *   Filename (focused) · Theme thumbnail + ▾ (Themes popover) · Size · Library ·
 *   Playlist · Cancel / New
 *
 * Default theme = "None (transparent)": the song is created with NO theme, which
 * is byte-for-byte what "Add song" did before (createSong + one blank slide with
 * no objectsJson, no appliedThemeId) — so existing projector behaviour for such a
 * song is unchanged; under Layer Order V3 the slide is see-through and media
 * shows. A chosen theme is persisted through the existing, church-scoped
 * `applyThemeToSong` (bakes the look + stores settings.appliedThemeId), after
 * `createSong` has already refused any theme id that isn't this church's.
 *
 * Replaces the old hardcoded Default/Dark/Light/Brand select, whose value went to
 * a localStorage key (`presentflow.song.template.<id>`) that nothing ever read.
 * Artist + "blank first slide" are kept (never regress).
 *
 * Size: songs have no size in the data model (the output size is a Screens
 * setting), so Size is display-only and never stored.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { ThemeThumb } from "../ThemePopover";
import type { ClientTheme } from "@/lib/theme-apply-client";
import {
  NEW_SONG_LIBRARY_DEFAULT, NEW_SONG_PLAYLIST_NONE, NEW_SONG_SIZES, NEW_SONG_THEME_NONE,
  pickRecentThemes, type NewSongSize,
} from "@/lib/new-song-options";

/** "Current default" pseudo-choice (resolved to the church default theme at create). */
export const NEW_SONG_THEME_DEFAULT = "current-default";

export type NewSongValues = {
  title: string;
  artist: string;
  /** NEW_SONG_THEME_NONE | NEW_SONG_THEME_DEFAULT | a church theme id */
  theme: string;
  size: NewSongSize;
  /** NEW_SONG_LIBRARY_DEFAULT | a manual library id */
  libraryId: string;
  /** NEW_SONG_PLAYLIST_NONE | a service plan id */
  planId: string;
  seedFirstSlide: boolean;
};

export type NewSongDeps = {
  createSong: (fd: FormData) => Promise<{ ok: boolean; error?: string; data?: { id: string } }>;
  createSongSlide: (songId: string, atIndex?: number, initial?: { objects: unknown[]; lyrics: string }) => Promise<{ ok: boolean; error?: string }>;
  applyThemeToSong: (themeId: string, songId: string) => Promise<{ ok: boolean; error?: string }>;
  addServiceItem: (planId: string, type: "song", title: string, payload: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  pushThemeRecent?: (id: string) => void;
};

/** Resolve the theme choice to a real theme id (or null = transparent). */
export function resolveThemeChoice(choice: string, themes: ClientTheme[]): string | null {
  if (!choice || choice === NEW_SONG_THEME_NONE) return null;
  if (choice === NEW_SONG_THEME_DEFAULT) return themes.find((t) => t.isDefault)?.id ?? null;
  return themes.some((t) => t.id === choice) ? choice : null;
}

/**
 * The create sequence (pure over injected deps → unit-testable):
 * createSong (validates theme + library church-scoped) → optional blank slide →
 * applyThemeToSong (only when a theme was chosen) → optional playlist add.
 * Steps after the create are best-effort: the song exists, so a later failure
 * is reported as a warning rather than losing it.
 */
export async function performCreateSong(v: NewSongValues, themes: ClientTheme[], deps: NewSongDeps): Promise<{ ok: true; id: string; themeId: string | null; warnings: string[] } | { ok: false; error: string }> {
  const title = v.title.trim();
  const themeId = resolveThemeChoice(v.theme, themes);
  const fd = new FormData();
  fd.set("title", title);
  if (v.artist.trim()) fd.set("artist", v.artist.trim().slice(0, 120));
  if (themeId) fd.set("themeId", themeId);
  if (v.libraryId && v.libraryId !== NEW_SONG_LIBRARY_DEFAULT) fd.set("libraryId", v.libraryId);
  const res = await deps.createSong(fd);
  if (!res.ok || !res.data) return { ok: false, error: res.error || "Create failed" };
  const id = res.data.id;
  const warnings: string[] = [];
  if (v.seedFirstSlide) {
    try { await deps.createSongSlide(id, undefined, { objects: [], lyrics: "" }); } catch { /* non-fatal — user can add manually */ }
  }
  if (themeId) {
    try {
      const r = await deps.applyThemeToSong(themeId, id);
      if (!r.ok) warnings.push(`Theme not applied: ${r.error || "unknown error"}`);
      else deps.pushThemeRecent?.(themeId);
    } catch { warnings.push("Theme not applied"); }
  }
  if (v.planId && v.planId !== NEW_SONG_PLAYLIST_NONE) {
    try {
      const r = await deps.addServiceItem(v.planId, "song", title, { songId: id });
      if (!r.ok) warnings.push(`Not added to playlist: ${r.error || "unknown error"}`);
    } catch { warnings.push("Not added to playlist"); }
  }
  return { ok: true, id, themeId, warnings };
}

const CHECKER: React.CSSProperties = {
  backgroundColor: "#1f1f1f",
  backgroundImage: "linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
};

/** 16:9 transparent (checkerboard) thumbnail. */
export function TransparentThumb() {
  return <div className="relative aspect-video w-full rounded-[3px] overflow-hidden" style={CHECKER} data-transparent-thumb="" />;
}

function dotColor(t: ClientTheme | null): string {
  const c = t?.config?.bgColor;
  return typeof c === "string" && c ? c : "transparent";
}

type PickerItem = { id: string; name: string; theme: ClientTheme | null };

/**
 * Themes popover (A.7): header "Themes" + image button; Recents (last 3) above a
 * rule; then a 3-column grid of every church theme as live-rendered 16:9
 * thumbnails. Click / Enter selects and closes; arrows move; Esc closes.
 */
export function NewSongThemePicker({
  themes, recentIds, value, onSelect, onClose, onManageThemes,
}: {
  themes: ClientTheme[];
  recentIds: string[];
  value: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onManageThemes?: () => void;
}) {
  const items: PickerItem[] = useMemo(() => {
    const def = themes.find((t) => t.isDefault) ?? null;
    return [
      { id: NEW_SONG_THEME_NONE, name: "None (transparent)", theme: null },
      ...(def ? [{ id: NEW_SONG_THEME_DEFAULT, name: `Current default (${def.name})`, theme: def }] : []),
      ...themes.map((t) => ({ id: t.id, name: t.name, theme: t })),
    ];
  }, [themes]);
  const recents: PickerItem[] = useMemo(
    () => pickRecentThemes(recentIds, themes).map((t) => ({ id: t.id, name: t.name, theme: t })),
    [recentIds, themes],
  );
  // One flat focus order: recents first, then the full grid.
  const flat = useMemo(() => [...recents.map((r) => ({ ...r, key: `r:${r.id}` })), ...items.map((i) => ({ ...i, key: `a:${i.id}` }))], [recents, items]);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIdx, setFocusIdx] = useState(() => {
    const i = flat.findIndex((f) => f.key === `a:${value}`);
    return i >= 0 ? i : 0;
  });
  useEffect(() => { btns.current[focusIdx]?.focus(); }, [focusIdx]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = flat.length;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    const move = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? 3 : e.key === "ArrowUp" ? -3 : 0;
    if (move) { e.preventDefault(); setFocusIdx((i) => Math.max(0, Math.min(n - 1, i + move))); return; }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const it = flat[focusIdx];
      if (it) { onSelect(it.id); onClose(); }
    }
  };

  const card = (it: PickerItem & { key: string }, idx: number) => {
    const selected = it.id === value;
    return (
      <div key={it.key} role="gridcell" className="flex flex-col items-center gap-1 min-w-0">
        <button
          ref={(el) => { btns.current[idx] = el; }}
          type="button"
          tabIndex={idx === focusIdx ? 0 : -1}
          aria-label={`${it.name}${selected ? " (selected)" : ""}`}
          aria-pressed={selected}
          data-theme-choice={it.id}
          onClick={() => { onSelect(it.id); onClose(); }}
          onFocus={() => setFocusIdx(idx)}
          className={
            "block w-full rounded-[4px] focus-visible:outline-none " +
            (selected ? "ring-[3px] ring-[#0a84ff]" : "ring-1 ring-white/10 hover:ring-2 hover:ring-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]")
          }
        >
          {it.theme ? <ThemeThumb theme={it.theme} /> : <TransparentThumb />}
        </button>
        <span className="flex w-full items-center justify-center gap-1 text-[11px] text-[var(--color-foreground)]">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full border border-white/30" style={{ background: dotColor(it.theme) }} />
          <span className="truncate">{it.name}</span>
        </span>
      </div>
    );
  };

  return (
    <div
      role="dialog"
      aria-label="Themes"
      data-new-song-theme-picker=""
      onKeyDown={onKeyDown}
      className="relative w-[420px] max-w-[90vw] rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl"
    >
      {/* arrow pointing up at the ▾ */}
      <span aria-hidden className="absolute -top-[7px] left-6 h-3 w-3 rotate-45 border-l border-t border-[var(--color-border)] bg-[var(--color-panel)]" />
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <span className="text-[13px] font-semibold">Themes</span>
        <button type="button" aria-label="Manage themes" title="Manage themes" onClick={onManageThemes}
          className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted-foreground)] hover:bg-white/[0.08] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]">
          <ImageIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-[360px] overflow-y-auto px-3 pb-3" role="grid" aria-label="Theme choices">
        {recents.length > 0 && (
          <>
            <div className="py-1 text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">Recents</div>
            <div role="row" className="grid grid-cols-3 gap-2" data-recents="">
              {flat.slice(0, recents.length).map((it, i) => card(it, i))}
            </div>
            <hr className="my-2 border-[var(--color-border)]" />
          </>
        )}
        <div role="row" className="grid grid-cols-3 gap-2" data-all-themes="">
          {flat.slice(recents.length).map((it, i) => card(it, i + recents.length))}
        </div>
      </div>
    </div>
  );
}

export type NewSongFormData = {
  themes: ClientTheme[];
  libraries: Array<{ id: string; name: string }>;
  plans: Array<{ id: string; title: string; scheduledFor: string | null }>;
  recentIds: string[];
};

/** The dialog body (no Radix wrapper) — rendered directly by DOM tests. */
export function NewSongForm({
  data, initial, busy, onSubmit, onCancel, onManageThemes,
}: {
  data: NewSongFormData;
  initial?: Partial<NewSongValues>;
  busy?: boolean;
  onSubmit: (v: NewSongValues) => void;
  onCancel: () => void;
  onManageThemes?: () => void;
}) {
  const [v, setV] = useState<NewSongValues>({
    title: "", artist: "", theme: NEW_SONG_THEME_NONE, size: "1920x1080",
    libraryId: NEW_SONG_LIBRARY_DEFAULT, planId: NEW_SONG_PLAYLIST_NONE, seedFirstSlide: true,
    ...initial,
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const set = (p: Partial<NewSongValues>) => setV((cur) => ({ ...cur, ...p }));
  const chosen = v.theme === NEW_SONG_THEME_DEFAULT
    ? data.themes.find((t) => t.isDefault) ?? null
    : data.themes.find((t) => t.id === v.theme) ?? null;
  const themeLabel = v.theme === NEW_SONG_THEME_NONE || !chosen ? "None (transparent)" : v.theme === NEW_SONG_THEME_DEFAULT ? `Current default (${chosen.name})` : chosen.name;
  const submit = () => { if (!busy && v.title.trim()) onSubmit(v); };
  const field = "h-8 px-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] text-[12px]";
  const label = "text-[11px] text-right text-[var(--color-muted-foreground)] self-center";

  return (
    <form
      data-new-song-form=""
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2.5"
    >
      <label htmlFor="new-song-filename" className={label}>Filename:</label>
      <input
        id="new-song-filename"
        autoFocus
        value={v.title}
        onChange={(e) => set({ title: e.target.value })}
        maxLength={200}
        placeholder="Untitled"
        className={field}
      />
      <span className={label + " self-start pt-1"}>Theme:</span>
      <div className="relative flex items-end gap-1">
        <div className="w-[168px]" data-new-song-theme-thumb={v.theme === NEW_SONG_THEME_NONE || !chosen ? "transparent" : chosen.id}>
          {v.theme === NEW_SONG_THEME_NONE || !chosen ? <TransparentThumb /> : <ThemeThumb theme={chosen} />}
          <div className="mt-0.5 truncate text-[10px] text-[var(--color-muted-foreground)]">{themeLabel}</div>
        </div>
        <button
          type="button"
          aria-label="Choose theme"
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((o) => !o)}
          className="mb-4 grid h-6 w-6 place-items-center rounded border border-[var(--color-border)] hover:bg-white/[0.08]"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {pickerOpen && (
          <div className="absolute left-0 top-full z-[60] mt-2">
            <NewSongThemePicker
              themes={data.themes}
              recentIds={data.recentIds}
              value={v.theme}
              onSelect={(id) => set({ theme: id })}
              onClose={() => setPickerOpen(false)}
              onManageThemes={onManageThemes}
            />
          </div>
        )}
      </div>
      <label htmlFor="new-song-size" className={label}>Size:</label>
      <select id="new-song-size" value={v.size} onChange={(e) => set({ size: e.target.value as NewSongSize })} className={field}
        title="Display only — the output size is set per screen in Screens">
        {NEW_SONG_SIZES.map((s) => <option key={s} value={s}>{s.replace("x", " x ")}</option>)}
      </select>
      <label htmlFor="new-song-library" className={label}>Library:</label>
      <select id="new-song-library" value={v.libraryId} onChange={(e) => set({ libraryId: e.target.value })} className={field}>
        <option value={NEW_SONG_LIBRARY_DEFAULT}>Default</option>
        {data.libraries.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <label htmlFor="new-song-playlist" className={label}>Playlist:</label>
      <select id="new-song-playlist" value={v.planId} onChange={(e) => set({ planId: e.target.value })} className={field}>
        <option value={NEW_SONG_PLAYLIST_NONE}>No Playlist</option>
        {data.plans.map((p) => <option key={p.id} value={p.id}>{p.title}{p.scheduledFor ? ` — ${p.scheduledFor}` : ""}</option>)}
      </select>
      <label htmlFor="new-song-artist" className={label}>Artist:</label>
      <input id="new-song-artist" value={v.artist} onChange={(e) => set({ artist: e.target.value })} maxLength={120} placeholder="Optional" className={field} />
      <span />
      <label className="text-[11px] inline-flex items-center gap-2 select-none">
        <input type="checkbox" checked={v.seedFirstSlide} onChange={(e) => set({ seedFirstSlide: e.target.checked })} className="h-3.5 w-3.5" />
        Create a blank first slide ready to edit
      </label>
      <div className="col-span-2 mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-8 px-3 rounded border border-[var(--color-border)] text-[12px]">Cancel</button>
        <button type="submit" disabled={busy || !v.title.trim()} data-new-song-submit=""
          className="h-8 px-4 rounded bg-[#0a84ff] text-white text-[12px] font-semibold disabled:opacity-50">
          {busy ? "Creating…" : "New"}
        </button>
      </div>
    </form>
  );
}

/**
 * The full dialog: loads the church's themes (/api/themes), libraries and
 * playlists when opened, validates the title, then runs `performCreateSong`.
 */
export function NewSongDialog({
  open, onOpenChange, existingTitles, onCreated, defaultLibraryId, confirmDuplicate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existingTitles: string[];
  onCreated: (row: { id: string; title: string; artist: string | null; libraryId: string | null; planId: string | null }) => void;
  defaultLibraryId?: string | null;
  /** In-app confirm (a native confirm() can freeze the Electron shell). */
  confirmDuplicate?: (title: string) => Promise<boolean>;
}) {
  const [data, setData] = useState<NewSongFormData | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const load = useCallback(async () => {
    const [themesRes, libs, plans, recents] = await Promise.all([
      fetch("/api/themes").then((r) => (r.ok ? r.json() : { themes: [] })).catch(() => ({ themes: [] })),
      import("@/lib/actions").then((m) => m.listLibraries()).catch(() => null),
      import("@/lib/actions").then((m) => m.listServicePlanChoices()).catch(() => null),
      import("@/lib/theme-apply-client").then((m) => m.readThemeRecents()).catch(() => [] as string[]),
    ]);
    const themes = ((themesRes as { themes?: ClientTheme[] }).themes ?? []).map((t) => ({ ...t, config: (t.config as Record<string, unknown>) ?? {} }));
    setData({
      themes,
      libraries: libs && libs.ok && libs.data ? libs.data.libraries.filter((l) => l.kind === "manual").map((l) => ({ id: l.id, name: l.name })) : [],
      plans: plans && plans.ok && plans.data ? plans.data : [],
      recentIds: recents,
    });
  }, []);
  useEffect(() => { if (open) { setData(null); setFormKey((k) => k + 1); void load(); } }, [open, load]);

  const submit = async (v: NewSongValues) => {
    if (busy) return;
    const t = v.title.trim();
    if (!t) { toast.error("Song title required"); return; }
    if (t.length > 200) { toast.error("Title too long (max 200 chars)"); return; }
    if (!/[\p{L}\p{N}]/u.test(t)) { toast.error("Song title needs letters or numbers"); return; }
    const dup = existingTitles.some((x) => x.trim().toLowerCase() === t.toLowerCase());
    if (dup && confirmDuplicate && !(await confirmDuplicate(t))) return;
    setBusy(true);
    try {
      const a = await import("@/lib/actions");
      const { pushThemeRecent } = await import("@/lib/theme-apply-client");
      const res = await performCreateSong(v, data?.themes ?? [], {
        createSong: a.createSong,
        createSongSlide: (id, at, init) => a.createSongSlide(id, at, init as never),
        applyThemeToSong: a.applyThemeToSong,
        addServiceItem: (planId, type, title, payload) => a.addServiceItem(planId, type, title, payload),
        pushThemeRecent,
      });
      if (!res.ok) { toast.error(res.error); return; }
      for (const w of res.warnings) toast.warning(w);
      const libraryId = v.libraryId !== NEW_SONG_LIBRARY_DEFAULT ? v.libraryId : null;
      const planId = v.planId !== NEW_SONG_PLAYLIST_NONE ? v.planId : null;
      onCreated({ id: res.id, title: t, artist: v.artist.trim() || null, libraryId, planId });
      toast.success(`"${t}" created${v.seedFirstSlide ? " with blank slide" : ""} — edit lyrics on the right`);
      try { window.dispatchEvent(new Event("presentflow:songs-changed")); } catch { /* ignore */ }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[460px] max-w-[95vw] bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4 flex flex-col gap-3"
        >
          <Dialog.Title className="text-sm font-semibold">New Presentation</Dialog.Title>
          {data ? (
            <NewSongForm
              key={formKey}
              data={data}
              initial={defaultLibraryId && data.libraries.some((l) => l.id === defaultLibraryId) ? { libraryId: defaultLibraryId } : undefined}
              busy={busy}
              onSubmit={(v) => void submit(v)}
              onCancel={() => onOpenChange(false)}
              onManageThemes={() => { try { window.dispatchEvent(new CustomEvent("presentflow:open-themes-settings")); } catch { /* ignore */ } }}
            />
          ) : (
            <div className="py-8 text-center text-[12px] text-[var(--color-muted-foreground)]">Loading…</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
