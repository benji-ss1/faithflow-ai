"use client";
/**
 * ThemePopover — ProPresenter 7 style Themes popover under the top-bar Themes
 * button (Victor's screenshots): header [logo] "Themes" [edit] [+]; Recents row;
 * grid of theme cards (blue dot = in use); click a card to apply; › opens the
 * theme's detail view (‹ back, name, pencil → editor); + opens "New Theme —
 * Save As" with a ▾ to start from an existing theme.
 *
 * Reuses the existing theme data (/api/themes), server actions and the shared
 * apply path (applyThemeLive). The editor is the desktop slide editor in theme
 * mode (`presentflow:open-slide-editor` with a themeId).
 *
 * 2026-09-18: this popover REPLACED the legacy ThemesManager screen. The two
 * capabilities that lived only there — "Import from ProPresenter" and the
 * per-content-type default look — moved here. Parity table:
 * docs/THEMES_MANAGER_RETIREMENT.md.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { ChevronLeft, ChevronRight, Palette, Pencil, Plus, SlidersHorizontal, Upload } from "lucide-react";
import { toast } from "sonner";
import { applyThemeLive, readThemeRecents, type ClientTheme } from "@/lib/theme-apply-client";
import { useLiveThemeId, isThemeLiveNow } from "@/lib/live-theme";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { themeConfigToAppearance } from "@/lib/theme-appearance";
import type { SlidePayload, SlideObjectWire, ThemeAppearance } from "@/lib/broadcast";
import { BUILTIN_THEMES, getBuiltinTheme, isBuiltinThemeId } from "@/lib/builtin-themes";
// Lazily loaded: ThemeImportDialog statically imports server actions, and the
// Themes popover is mounted on every operator render. Deferring it keeps that
// module (and its server-only chain) out of the popover's import graph.
const ThemeImportDialog = dynamic(() => import("@/components/library/ThemeImportDialog").then((m) => m.ThemeImportDialog), { ssr: false });
import { isContentTypeEditDenied } from "@/lib/church-styles-store";
import { loadContentTypeStyles, saveContentTypeStyles, CONTENT_STYLE_TYPES, type ContentStyleType, type ContentTypeStyles } from "@/lib/content-type-styles";
import { useLegacyThemes } from "@/lib/legacy-themes-flag";

/** Built-ins as client themes (constant config; never applied directly — they
 *  are materialized into a church theme first). */
const BUILTIN_CLIENT_THEMES: ClientTheme[] = BUILTIN_THEMES.map((b) => ({ id: b.id, name: b.name, config: b.config as Record<string, unknown> }));

/** A theme name not already used (case-insensitive): "X copy", "X copy 2", … */
export function uniqueThemeName(base: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) { const c = `${base} ${i}`; if (!used.has(c.toLowerCase())) return c; }
  return `${base} ${Date.now()}`;
}

/** Materialize a built-in into a real church theme (idempotent server-side). */
export async function materializeBuiltinClient(builtinId: string): Promise<ClientTheme | null> {
  try {
    const { materializeBuiltinTheme } = await import("@/lib/actions");
    const res = await materializeBuiltinTheme(builtinId);
    if (!res.ok || !res.data) { toast.error(res.ok ? "Could not load built-in theme" : res.error || "Could not load built-in theme"); return null; }
    if (res.data.created) window.dispatchEvent(new CustomEvent("presentflow:themes-changed"));
    return { id: res.data.id, name: res.data.name, config: res.data.config as Record<string, unknown> };
  } catch {
    toast.error("Could not load built-in theme");
    return null;
  }
}

// Theme Editor (PR 1): the pencil / "Edit…" open the PP7-style editor ON that
// theme (the same full-screen slide editor). The sliders icon (legacy screen)
// is now shown ONLY when the NEXT_PUBLIC_LEGACY_THEMES escape hatch is on.
function openThemeSlideEditor(themeId: string) {
  window.dispatchEvent(new CustomEvent("presentflow:open-slide-editor", { detail: { themeId } }));
}

function openThemeEditor() {
  window.dispatchEvent(new CustomEvent("presentflow:open-themes-settings"));
}

function previewStyle(cfg: Record<string, unknown>): React.CSSProperties {
  const bgType = (cfg.bgType as string) || "solid";
  const bg1 = (cfg.bgColor as string) || "#000000";
  const bg2 = (cfg.bgColor2 as string) || "#1a1a1a";
  const img = (cfg.bgImageUrl as string) || "";
  if (bgType === "gradient") return { background: `linear-gradient(135deg, ${bg1}, ${bg2})` };
  if (bgType === "image" && img) return { backgroundImage: `url("${img}")`, backgroundSize: "cover", backgroundPosition: "center" };
  if (bgType === "solid" && cfg.bgColor) return { background: bg1 };
  // No background: PP7 shows a transparency checkerboard.
  return {
    backgroundColor: "#1f1f1f",
    backgroundImage: "linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)",
    backgroundSize: "16px 16px",
    backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
  };
}

// A static preview appearance: the theme's real render appearance (boxes, decor,
// background, fonts) with motion removed — no animated gradient layer and no
// playing decor video in a grid of cards.
export function themeThumbAppearance(cfg: Record<string, unknown>): ThemeAppearance | null {
  const a = themeConfigToAppearance(cfg);
  if (!a) return null;
  const out: ThemeAppearance = { ...a };
  delete out.bgAnimation;
  if (out.layout) {
    const still = (d?: SlideObjectWire[]) => d?.filter((o) => o.kind !== "video");
    out.layout = {
      ...(out.layout.lyrics ? { lyrics: { ...out.layout.lyrics, decor: still(out.layout.lyrics.decor) } } : {}),
      ...(out.layout.scripture ? { scripture: { ...out.layout.scripture, decor: still(out.layout.scripture.decor) } } : {}),
    };
  }
  return out;
}

const THUMB_SLIDE: SlidePayload = { kind: "text", text: "Lyrics appear here" };

/** Theme card preview: the REAL slide renderer with the theme's appearance, so
 *  images, shapes, text boxes and backgrounds show exactly as projected. */
export function ThemeThumb({ theme, large = false }: { theme: ClientTheme; large?: boolean }) {
  const cfg = theme.config ?? {};
  const appearance = useMemo(() => themeThumbAppearance(cfg), [cfg]);
  return (
    <div className="relative aspect-video w-full rounded-[3px] overflow-hidden" style={appearance ? undefined : previewStyle(cfg)} data-theme-thumb="">
      <SlideRenderer slide={THUMB_SLIDE} appearance={appearance} textMinPx={large ? 6 : 4} disablePagination />
    </div>
  );
}

export function ThemePopover({ open, onOpenChange, anchorSelector }: { open: boolean; onOpenChange: (v: boolean) => void; /** CSS selector of the toolbar button the popover points at. */ anchorSelector: string }) {
  const [themes, setThemes] = useState<ClientTheme[] | null>(null);
  const liveThemeId = useLiveThemeId();
  const [error, setError] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const legacyThemes = useLegacyThemes();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Point the popover (and its arrow) at the real Themes button.
  const anchorRef = useRef<Element | null>(null);
  if (typeof document !== "undefined") anchorRef.current = document.querySelector(anchorSelector);
  const renameDone = useRef(false);
  const loadSeq = useRef(0);

  const load = useCallback(() => {
    setError(false);
    const seq = ++loadSeq.current;
    fetch("/api/themes")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: { themes?: ClientTheme[]; canEdit?: boolean }) => {
        if (seq !== loadSeq.current) return; // a newer load won
        setCanEdit(d.canEdit === true);
        setThemes((d.themes ?? []).map((t) => ({ ...t, config: (t.config as Record<string, unknown>) ?? {} })));
      })
      .catch(() => { if (seq === loadSeq.current) setError(true); });
  }, []);

  useEffect(() => {
    if (!open) { setDetailId(null); setRenamingId(null); return; }
    setRecents(readThemeRecents());
    load();
  }, [open, load]);

  useEffect(() => {
    const onChanged = () => { if (open) load(); };
    window.addEventListener("presentflow:themes-changed", onChanged);
    return () => window.removeEventListener("presentflow:themes-changed", onChanged);
  }, [open, load]);

  const byId = useMemo(() => new Map([...BUILTIN_CLIENT_THEMES, ...(themes ?? [])].map((t) => [t.id, t])), [themes]);
  const recentThemes = recents.map((id) => byId.get(id)).filter((t): t is ClientTheme => !!t).slice(0, 3);
  const detail = detailId ? byId.get(detailId) ?? null : null;

  const apply = async (t0: ClientTheme) => {
    setApplying(t0.id);
    // A built-in is materialized into a church theme first, then applied
    // through the one shared path (live outputs + current song + Recents).
    const t = isBuiltinThemeId(t0.id) ? await materializeBuiltinClient(t0.id) : t0;
    if (!t) { setApplying(null); return; }
    if (t.id !== t0.id) load();
    const ok = await applyThemeLive(t);
    setApplying(null);
    if (ok) {
      setRecents(readThemeRecents());
    }
  };

  const rename = async (t: ClientTheme, name: string) => {
    // Enter commits then unmounts the input, which fires blur — save once.
    if (renameDone.current) return;
    renameDone.current = true;
    setRenamingId(null);
    const next = name.trim();
    if (!next || next === t.name) return;
    const { updateTheme } = await import("@/lib/actions");
    const res = await updateTheme(t.id, { name: next });
    if (!res.ok) { toast.error(res.error || "Could not rename theme"); return; }
    setThemes((prev) => prev?.map((x) => (x.id === t.id ? { ...x, name: next } : x)) ?? prev);
    window.dispatchEvent(new CustomEvent("presentflow:themes-changed"));
  };

  const editTheme = async (t: ClientTheme) => {
    const target = isBuiltinThemeId(t.id) ? await materializeBuiltinClient(t.id) : t;
    if (!target) return;
    onOpenChange(false);
    openThemeSlideEditor(target.id);
  };

  const duplicate = async (t: ClientTheme) => {
    if (isBuiltinThemeId(t.id)) {
      const b = getBuiltinTheme(t.id);
      if (!b) return;
      const { createTheme } = await import("@/lib/actions");
      const cfg = JSON.parse(JSON.stringify(b.config)) as Record<string, unknown>;
      delete cfg.builtinId; // a copy is the church's own theme, not the built-in
      const name = uniqueThemeName(`${b.name} copy`, (themes ?? []).map((x) => x.name));
      const res = await createTheme(name, cfg as never);
      if (!res.ok) { toast.error(res.error || "Could not duplicate theme"); return; }
      toast.success(`Created “${name}”`);
      load();
      window.dispatchEvent(new CustomEvent("presentflow:themes-changed"));
      return;
    }
    const { duplicateTheme } = await import("@/lib/actions");
    const res = await duplicateTheme(t.id);
    if (!res.ok) { toast.error(res.error || "Could not duplicate theme"); return; }
    toast.success(`Duplicated “${t.name}”`);
    load();
    window.dispatchEvent(new CustomEvent("presentflow:themes-changed"));
  };

  const remove = async (t: ClientTheme) => {
    const ok = await confirm({ title: `Delete “${t.name}”?`, description: "Slides using it fall back to your default look. This can't be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const { deleteTheme } = await import("@/lib/actions");
    const res = await deleteTheme(t.id);
    if (!res.ok) { toast.error(res.error || "Could not delete theme"); return; }
    setThemes((prev) => prev?.filter((x) => x.id !== t.id) ?? prev);
    if (detailId === t.id) setDetailId(null);
    window.dispatchEvent(new CustomEvent("presentflow:themes-changed"));
  };

  const card = (t: ClientTheme, section: "recent" | "all" | "builtin") => {
    const renameKey = `${section}:${t.id}`;
    const builtin = isBuiltinThemeId(t.id);
    return (
    <ContextMenu.Root key={renameKey}>
      <ContextMenu.Trigger asChild>
        <div className="group flex flex-col items-center gap-1.5 min-w-0">
          <div className="relative w-full">
            <button
              type="button"
              onClick={() => void apply(t)}
              onDoubleClick={() => setDetailId(t.id)}
              disabled={applying !== null}
              title={`Apply “${t.name}” — double-click to open`}
              aria-label={`Apply ${t.name}`}
              className="block w-full rounded-[4px] ring-1 ring-white/10 hover:ring-2 hover:ring-[var(--color-brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:opacity-60"
            >
              <ThemeThumb theme={t} />
            </button>
            <button
              type="button"
              onClick={() => setDetailId(t.id)}
              aria-label={`Open ${t.name}`}
              title="Open"
              className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded bg-black/70 text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {renamingId === renameKey ? (
            <input
              autoFocus
              defaultValue={t.name}
              maxLength={80}
              aria-label="Theme name"
              onBlur={(e) => void rename(t, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void rename(t, e.currentTarget.value); }
                else if (e.key === "Escape") { e.preventDefault(); renameDone.current = true; setRenamingId(null); }
              }}
              className="w-full text-center text-[12px] rounded bg-[var(--color-panel)] border border-[var(--color-brand)] text-[var(--color-foreground)] px-1 outline-none"
            />
          ) : (
            <div className="flex items-center gap-1.5 min-w-0 max-w-full">
              {isThemeLiveNow(t, themes ?? [], liveThemeId) ? <span role="img" aria-label="Live now" title="Live now" className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#0a84ff]" /> : null}
              {t.isDefault ? <span role="img" aria-label="Main theme" title="Main theme (loads on every app start)" className="text-[10px] leading-none text-[var(--color-brand)]">★</span> : null}
              <span className="truncate text-[12px] text-[var(--color-foreground)]">{t.name}</span>
              {builtin ? <span className="shrink-0 rounded px-1 text-[9px] uppercase tracking-wide bg-white/10 text-[var(--color-muted-foreground)]">Built-in</span> : null}
            </div>
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-[90] min-w-[160px] rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] p-1 text-[12px] shadow-xl">
          {[
            { label: "Apply", run: () => void apply(t) },
            { label: "Open", run: () => setDetailId(t.id) },
            ...(canEdit ? [
              { label: "Edit…", run: () => void editTheme(t) },
              ...(builtin ? [] : [{ label: "Rename", run: () => { renameDone.current = false; setRenamingId(renameKey); } }]),
              { label: "Duplicate", run: () => void duplicate(t) },
            ] : []),
          ].map((it) => (
            <ContextMenu.Item key={it.label} onSelect={it.run} className="rounded px-2 py-1.5 outline-none data-[highlighted]:bg-white/10 text-[var(--color-foreground)]">
              {it.label}
            </ContextMenu.Item>
          ))}
          {canEdit && !builtin ? (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-[var(--color-border)]" />
              <ContextMenu.Item onSelect={() => void remove(t)} className="rounded px-2 py-1.5 outline-none data-[highlighted]:bg-red-500/20 text-[var(--color-destructive)]">
                Delete…
              </ContextMenu.Item>
            </>
          ) : null}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
    );
  };

  const iconBtn = "grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted-foreground)] hover:bg-white/[0.08] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]";

  return (
    <>
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Anchor virtualRef={anchorRef as React.RefObject<Element>} />
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="center"
            sideOffset={8}
            collisionPadding={12}
            aria-label="Themes"
            // Clicking the Themes button itself toggles; don't also dismiss-then-reopen.
            onInteractOutside={(e) => { const el = anchorRef.current; if (el && e.target instanceof Node && el.contains(e.target)) e.preventDefault(); }}
            className="z-[80] w-[440px] max-w-[calc(100vw-24px)] max-h-[75vh] flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl outline-none"
          >
            <Popover.Arrow className="fill-[var(--color-panel)]" width={16} height={8} />
            {detail ? (
              <>
                <header className="h-12 shrink-0 flex items-center gap-2 px-3 border-b border-[var(--color-border)]">
                  <button type="button" className={iconBtn} onClick={() => setDetailId(null)} aria-label="Back to themes"><ChevronLeft className="w-5 h-5" /></button>
                  <div className="flex-1 min-w-0 text-center text-[14px] font-semibold text-[var(--color-foreground)] truncate">{detail.name}</div>
                  {canEdit ? <button type="button" className={iconBtn} onClick={() => void editTheme(detail)} aria-label={`Edit “${detail.name}”`} title="Edit theme"><Pencil className="w-4 h-4" /></button> : <span className="w-8" aria-hidden />}
                </header>
                <div className="p-4 overflow-y-auto pf-transcript-scroll">
                  <button type="button" onClick={() => void apply(detail)} title={`Apply “${detail.name}”`} className="block w-1/2 rounded-[4px] ring-1 ring-white/10 hover:ring-2 hover:ring-[var(--color-brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]">
                    <ThemeThumb theme={detail} large />
                  </button>
                </div>
              </>
            ) : (
              <>
                <header className="h-12 shrink-0 flex items-center gap-2 px-3 border-b border-[var(--color-border)]">
                  <Palette className="w-5 h-5 text-[var(--color-brand)]" aria-hidden />
                  <div className="flex-1 text-center text-[14px] font-semibold text-[var(--color-foreground)]">Themes</div>
                  {canEdit && legacyThemes ? <button type="button" className={iconBtn} onClick={() => { onOpenChange(false); openThemeEditor(); }} aria-label="All themes (classic screen)" title="All themes (classic screen)"><SlidersHorizontal className="w-4 h-4" /></button> : null}
                  {canEdit ? <button type="button" className={iconBtn} onClick={() => setImportOpen(true)} aria-label="Import from ProPresenter" title="Import from ProPresenter"><Upload className="w-4 h-4" /></button> : null}
                  {canEdit ? <button type="button" className={iconBtn} onClick={() => setNewOpen(true)} aria-label="New theme" title="New theme"><Plus className="w-5 h-5" /></button> : null}
                </header>
                <div className="flex-1 min-h-0 overflow-y-auto p-3 pf-transcript-scroll">
                  {error ? (
                    <div className="flex items-center gap-3 text-[12px] text-[var(--color-destructive)]">Could not load themes.<button type="button" onClick={load} className="rounded px-2 py-1 bg-white/10 text-[var(--color-foreground)] hover:bg-white/15">Retry</button></div>
                  ) : themes === null ? (
                    <div className="text-[12px] text-[var(--color-muted-foreground)]">Loading themes…</div>
                  ) : (
                    <>
                      {themes.length === 0 ? (
                        <div className="py-4 flex flex-col items-center gap-3 text-[12px] text-[var(--color-muted-foreground)]">No themes yet.{canEdit ? <button type="button" onClick={() => setNewOpen(true)} className="rounded-md px-3 py-1.5 bg-[#0a84ff] text-white hover:bg-[#1a8fff]">New Theme</button> : null}</div>
                      ) : (
                        <>
                          {recentThemes.length > 0 && (
                            <>
                              <div className="text-[13px] font-semibold text-[var(--color-muted-foreground)] mb-2">Recents</div>
                              <div className="grid grid-cols-3 gap-3 pb-3 mb-3 border-b border-[var(--color-border)]">{recentThemes.map((t) => card(t, "recent"))}</div>
                            </>
                          )}
                          <div className="grid grid-cols-3 gap-3">{themes.map((t) => card(t, "all"))}</div>
                        </>
                      )}
                      <div className="text-[13px] font-semibold text-[var(--color-muted-foreground)] mt-4 pt-3 mb-2 border-t border-[var(--color-border)]" data-builtin-themes="">Built-in</div>
                      <div className="grid grid-cols-3 gap-3">{BUILTIN_CLIENT_THEMES.map((t) => card(t, "builtin"))}</div>
                      <ContentTypeDefaults themes={themes} />
                    </>
                  )}
                </div>
              </>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <NewThemeDialog
        open={newOpen}
        themes={themes ?? []}
        onClose={() => setNewOpen(false)}
        onCreated={(id) => { setNewOpen(false); load(); setDetailId(id); window.dispatchEvent(new CustomEvent("presentflow:themes-changed")); }}
      />
      <ThemeImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => { setImportOpen(false); load(); window.dispatchEvent(new CustomEvent("presentflow:themes-changed")); }}
      />
      {confirmDialog}
    </>
  );
}

/**
 * Default look per content type (Songs / Bible verses) — the one capability
 * that lived ONLY in the legacy ThemesManager's operator mode
 * (ThemesManager.tsx ContentTypeStyleBar). Church-scoped through
 * church-styles-store; a server refusal (no edit_library) disables the picker
 * rather than letting a volunteer set a value that never saves.
 */
function ContentTypeDefaults({ themes }: { themes: ClientTheme[] }) {
  const [styles, setStyles] = useState<ContentTypeStyles>({});
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    const load = () => { setStyles(loadContentTypeStyles()); setDenied(isContentTypeEditDenied()); };
    load();
    window.addEventListener("presentflow:content-type-styles-changed", load);
    return () => window.removeEventListener("presentflow:content-type-styles-changed", load);
  }, []);
  const set = (type: ContentStyleType, themeId: string) => {
    const next: ContentTypeStyles = { ...styles };
    if (themeId) next[type] = themeId; else delete next[type];
    setStyles(next);
    saveContentTypeStyles(next);
  };
  return (
    <div className="mt-4 pt-3 border-t border-[var(--color-border)]" data-content-type-defaults="">
      <div className="text-[13px] font-semibold text-[var(--color-muted-foreground)] mb-2">Default look per content type</div>
      <div className="grid grid-cols-2 gap-3">
        {CONTENT_STYLE_TYPES.map(({ key, label }) => (
          <label key={key} className="flex flex-col gap-1 text-[11px] text-[var(--color-muted-foreground)]">
            <span>{label}</span>
            <select
              value={styles[key] ?? ""}
              onChange={(e) => set(key, e.target.value)}
              disabled={denied}
              title={denied ? "Only someone who can edit the library can change this" : undefined}
              className="h-8 px-2 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] text-[12px] text-[var(--color-foreground)] outline-none disabled:opacity-60"
            >
              <option value="">Church default</option>
              {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        ))}
      </div>
      <p className="mt-2 text-[10.5px] leading-snug text-[var(--color-muted-foreground)]">
        Songs and Bible verses use these looks on the projector, stage &amp; livestream on every computer in your church — unless a specific item overrides it.
        {denied && " Only someone who can edit the library can change these."}
      </p>
    </div>
  );
}

/** PP7 "New Theme — Save As: [name] ▾" dialog. The ▾ picks a theme to start from. */
function NewThemeDialog({ open, themes, onClose, onCreated }: { open: boolean; themes: ClientTheme[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [baseId, setBaseId] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setName(""); setBaseId(""); setSaving(false); } }, [open]);

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    if (themes.some((t) => t.name.trim().toLowerCase() === n.toLowerCase())) {
      toast.error(`A theme called “${n}” already exists`);
      return;
    }
    setSaving(true);
    try {
      const builtin = getBuiltinTheme(baseId);
      const base = themes.find((t) => t.id === baseId);
      const cfg = JSON.parse(JSON.stringify(builtin?.config ?? base?.config ?? {})) as Record<string, unknown>;
      if (builtin) delete cfg.builtinId; // a new theme started FROM a built-in is the church's own
      const { createTheme } = await import("@/lib/actions");
      const res = await createTheme(n, cfg as never);
      if (!res.ok) { toast.error(res.error || "Could not create theme"); return; }
      if (!res.data) { toast.error("Could not create theme"); return; }
      toast.success(`Theme “${n}” created`);
      onCreated(res.data.id);
    } catch {
      toast.error("Could not create theme");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[95] bg-black/60" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-0 m-auto z-[96] h-fit w-[92vw] max-w-[520px] rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)] shadow-2xl outline-none">
          <Dialog.Title className="h-12 flex items-center justify-center border-b border-[var(--color-border)] text-[15px] font-semibold text-[var(--color-foreground)]">New Theme</Dialog.Title>
          <form className="p-5 flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <label className="flex items-center gap-3">
              <span className="text-[13px] text-[var(--color-foreground)] shrink-0">Save As:</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="Theme name"
                className="flex-1 min-w-0 rounded-md border-2 border-[#0a84ff] bg-[var(--color-panel)] px-2 py-1.5 text-[14px] text-[var(--color-foreground)] outline-none"
              />
              <select
                value={baseId}
                onChange={(e) => setBaseId(e.target.value)}
                aria-label="Start from"
                title="Start from"
                className="w-9 shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] py-1.5 text-[12px] text-[var(--color-foreground)] appearance-auto"
              >
                <option value="">Blank</option>
                {themes.length > 0 ? <optgroup label="Your themes">{themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup> : null}
                <optgroup label="Built-in">{BUILTIN_THEMES.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
              </select>
            </label>
            {baseId ? <div className="-mt-3 text-[11px] text-[var(--color-muted-foreground)]">Starts from “{getBuiltinTheme(baseId)?.name ?? themes.find((t) => t.id === baseId)?.name}”</div> : null}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} className="rounded-md px-4 py-1.5 text-[13px] bg-white/10 text-[var(--color-foreground)] hover:bg-white/15">Cancel</button>
              <button type="submit" disabled={!name.trim() || saving} className="rounded-md px-4 py-1.5 text-[13px] bg-[#0a84ff] text-white hover:bg-[#1a8fff] disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
