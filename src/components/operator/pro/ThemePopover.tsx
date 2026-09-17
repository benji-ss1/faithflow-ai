"use client";
/**
 * ThemePopover — ProPresenter 7 style Themes popover under the top-bar Themes
 * button (Victor's screenshots): header [logo] "Themes" [edit] [+]; Recents row;
 * grid of theme cards (blue dot = in use); click a card to apply; › opens the
 * theme's detail view (‹ back, name, pencil → editor); + opens "New Theme —
 * Save As" with a ▾ to start from an existing theme.
 *
 * Reuses the existing theme data (/api/themes), server actions and the shared
 * apply path (applyThemeLive). The full editor is the existing ThemesModal,
 * opened via `presentflow:open-themes-settings`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { ChevronLeft, ChevronRight, Palette, Pencil, Plus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { applyThemeLive, readThemeRecents, type ClientTheme } from "@/lib/theme-apply-client";
import { useConfirm } from "@/components/ui/ConfirmDialog";

// Theme Editor (PR 1): the pencil / "Edit…" open the PP7-style editor ON that
// theme (the same full-screen slide editor). The sliders icon still opens the
// old Themes screen until parity is verified.
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

function ThemeThumb({ theme, large = false }: { theme: ClientTheme; large?: boolean }) {
  const cfg = theme.config ?? {};
  const color = (cfg.textColor as string) || "#ffffff";
  const font = (cfg.fontFamily as string) || undefined;
  return (
    <div className="relative aspect-video w-full rounded-[3px] overflow-hidden grid place-items-center" style={previewStyle(cfg)}>
      <span style={{ color, fontFamily: font, fontSize: large ? 14 : 8, fontWeight: 600 }}>Text</span>
    </div>
  );
}

export function ThemePopover({ open, onOpenChange, anchorSelector }: { open: boolean; onOpenChange: (v: boolean) => void; /** CSS selector of the toolbar button the popover points at. */ anchorSelector: string }) {
  const [themes, setThemes] = useState<ClientTheme[] | null>(null);
  const [error, setError] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
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

  const byId = useMemo(() => new Map((themes ?? []).map((t) => [t.id, t])), [themes]);
  const recentThemes = recents.map((id) => byId.get(id)).filter((t): t is ClientTheme => !!t).slice(0, 3);
  const detail = detailId ? byId.get(detailId) ?? null : null;

  const apply = async (t: ClientTheme) => {
    setApplying(t.id);
    const ok = await applyThemeLive(t);
    setApplying(null);
    if (ok) {
      setThemes((prev) => prev?.map((x) => ({ ...x, isDefault: x.id === t.id })) ?? prev);
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

  const duplicate = async (t: ClientTheme) => {
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

  const card = (t: ClientTheme, section: "recent" | "all") => {
    const renameKey = `${section}:${t.id}`;
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
              {t.isDefault ? <span role="img" aria-label="In use" title="In use" className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#0a84ff]" /> : null}
              <span className="truncate text-[12px] text-[var(--color-foreground)]">{t.name}</span>
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
              { label: "Edit…", run: () => { onOpenChange(false); openThemeSlideEditor(t.id); } },
              { label: "Rename", run: () => { renameDone.current = false; setRenamingId(renameKey); } },
              { label: "Duplicate", run: () => void duplicate(t) },
            ] : []),
          ].map((it) => (
            <ContextMenu.Item key={it.label} onSelect={it.run} className="rounded px-2 py-1.5 outline-none data-[highlighted]:bg-white/10 text-[var(--color-foreground)]">
              {it.label}
            </ContextMenu.Item>
          ))}
          {canEdit ? (
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
                  {canEdit ? <button type="button" className={iconBtn} onClick={() => { onOpenChange(false); openThemeSlideEditor(detail.id); }} aria-label={`Edit “${detail.name}”`} title="Edit theme"><Pencil className="w-4 h-4" /></button> : <span className="w-8" aria-hidden />}
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
                  {canEdit ? <button type="button" className={iconBtn} onClick={() => { onOpenChange(false); openThemeEditor(); }} aria-label="Open theme editor" title="Theme editor"><SlidersHorizontal className="w-4 h-4" /></button> : null}
                  {canEdit ? <button type="button" className={iconBtn} onClick={() => setNewOpen(true)} aria-label="New theme" title="New theme"><Plus className="w-5 h-5" /></button> : null}
                </header>
                <div className="flex-1 min-h-0 overflow-y-auto p-3 pf-transcript-scroll">
                  {error ? (
                    <div className="flex items-center gap-3 text-[12px] text-[var(--color-destructive)]">Could not load themes.<button type="button" onClick={load} className="rounded px-2 py-1 bg-white/10 text-[var(--color-foreground)] hover:bg-white/15">Retry</button></div>
                  ) : themes === null ? (
                    <div className="text-[12px] text-[var(--color-muted-foreground)]">Loading themes…</div>
                  ) : themes.length === 0 ? (
                    <div className="py-6 flex flex-col items-center gap-3 text-[12px] text-[var(--color-muted-foreground)]">No themes yet.{canEdit ? <button type="button" onClick={() => setNewOpen(true)} className="rounded-md px-3 py-1.5 bg-[#0a84ff] text-white hover:bg-[#1a8fff]">New Theme</button> : null}</div>
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
      {confirmDialog}
    </>
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
      const base = themes.find((t) => t.id === baseId);
      const { createTheme } = await import("@/lib/actions");
      const res = await createTheme(n, (base?.config ?? {}) as never);
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
                {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            {baseId ? <div className="-mt-3 text-[11px] text-[var(--color-muted-foreground)]">Starts from “{themes.find((t) => t.id === baseId)?.name}”</div> : null}
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
