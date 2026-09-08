"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { ChevronDown, ChevronRight, Plus, BookOpen, Library as LibraryIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CenterMode } from "../ProOperatorShell";
import { createLibrary, renameLibrary, deleteLibrary, listLibraries, type LibraryRow } from "@/lib/actions";
import { useSelectedLibrary, setSelectedLibrary } from "./libraryFilter";
import { useConfirm } from "@/components/ui/ConfirmDialog";

// ProPresenter parity (Phase 3.6): multiple named Libraries. "Default" is the
// implicit bucket (content with no library_id) and is always present — it can't
// be renamed or deleted. Selecting a library filters the center Songs/Media
// browsers to that library's items; clicking Default (or the row) opens Songs.

export function LibrarySection({ onCenterMode }: { onCenterMode?: (m: CenterMode) => void }) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const [selected] = useSelectedLibrary();
  const [libs, setLibs] = useState<LibraryRow[]>([]);
  const [defaultCounts, setDefaultCounts] = useState({ songs: 0, media: 0 });
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // Electron-safe confirm (native window.confirm can freeze the desktop shell).
  const { confirm, dialog: confirmDialog } = useConfirm();

  const reload = useCallback(async () => {
    const res = await listLibraries();
    if (!res.ok) return;
    setLibs(res.data!.libraries);
    setDefaultCounts({ songs: res.data!.defaultSongCount, media: res.data!.defaultMediaCount });
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  // Re-count when content is moved between libraries elsewhere.
  useEffect(() => {
    const h = () => void reload();
    window.addEventListener("presentflow:libraries-changed", h);
    return () => window.removeEventListener("presentflow:libraries-changed", h);
  }, [reload]);

  const select = (id: "all" | "default" | string) => {
    setSelectedLibrary(id);
    onCenterMode?.("songs"); // show the library's items (songs are primary content)
  };

  const commitCreate = async () => {
    const name = createDraft.trim();
    setCreating(false);
    setCreateDraft("");
    if (!name) return;
    const res = await createLibrary(name);
    if (!res.ok) { toast.error(res.error ?? "Couldn't create library"); return; }
    toast.success(`Library "${name}" created`);
    await reload();
    if (res.data) select(res.data.id);
  };

  const commitRename = async (id: string) => {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name) return;
    const res = await renameLibrary(id, name);
    if (!res.ok) { toast.error(res.error ?? "Rename failed"); return; }
    await reload();
  };

  const remove = async (lib: LibraryRow) => {
    const n = lib.songCount + lib.mediaCount;
    const msg = n > 0
      ? `Its ${n} item${n === 1 ? "" : "s"} will move back to Default (nothing is deleted).`
      : "This library is empty.";
    if (!(await confirm({ title: `Delete library "${lib.name}"?`, description: msg, confirmLabel: "Delete", danger: true }))) return;
    const res = await deleteLibrary(lib.id);
    if (!res.ok) { toast.error(res.error ?? "Delete failed"); return; }
    if (selected === lib.id) setSelectedLibrary("all");
    toast.success(`Library "${lib.name}" deleted`);
    await reload();
    router.refresh();
  };

  const rowCls = (active: boolean) => cn(
    "w-full flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] text-left rounded-r-md border-l-[3px] transition-colors",
    active
      ? "border-[var(--color-brand)] bg-[var(--color-elevated)] text-[var(--color-foreground)] font-semibold shadow-[var(--edge-top)]"
      : "border-transparent text-[var(--color-muted-foreground)] font-medium hover:text-[var(--color-foreground)] hover:bg-[var(--color-brand)]/10",
  );
  const countBadge = (n: number, active: boolean) => (
    <span className={cn(
      "ml-auto shrink-0 min-w-[18px] h-[17px] px-1 grid place-items-center rounded-full text-[10px] font-bold tabular-nums",
      active ? "bg-[var(--color-brand)]/18 text-[var(--color-brand)]" : "bg-white/[0.06] text-[var(--color-muted-foreground)]",
    )}>{n}</span>
  );

  return (
    <section className="border-b border-[var(--color-border)]">
      {confirmDialog}
      <header className="flex items-center h-8 px-2.5 gap-2 bg-[linear-gradient(180deg,var(--color-panel),transparent)]">
        <button type="button" className="flex items-center gap-1 shrink-0 text-left" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="eyebrow">Library</span>
        </button>
        <span className="h-px flex-1" style={{ background: "linear-gradient(90deg, var(--color-border), transparent)" }} aria-hidden />
        <button
          type="button"
          onClick={() => { setCreateDraft(""); setCreating(true); setOpen(true); }}
          className="w-[22px] h-[22px] grid place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] text-[var(--color-muted-foreground)] transition-[transform,box-shadow,color,border-color] duration-200 [transition-timing-function:var(--ease-spring)] hover:-translate-y-px hover:text-[var(--color-brand)] hover:border-[color-mix(in_oklab,var(--color-brand)_50%,var(--color-border))] active:translate-y-0 active:scale-95"
          title="New library"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2.4} />
        </button>
      </header>
      {open && (
        <ul className="pb-1">
          {/* Default (implicit) bucket — always present, not editable. */}
          <li>
            <button type="button" onClick={() => select("all")} title="All content across every library" className={rowCls(selected === "all")}>
              <LibraryIcon className={cn("w-4 h-4 shrink-0", selected === "all" && "text-[var(--color-brand)]")} />
              All
            </button>
          </li>
          <li>
            <button type="button" onClick={() => select("default")} title="Content not filed into a named library" className={rowCls(selected === "default")}>
              <BookOpen className={cn("w-4 h-4 shrink-0", selected === "default" && "text-[var(--color-brand)]")} />
              Default
              {countBadge(defaultCounts.songs + defaultCounts.media, selected === "default")}
            </button>
          </li>
          {libs.map((lib) => (
            <li key={lib.id}>
              {renamingId === lib.id ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => void commitRename(lib.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void commitRename(lib.id); }
                    else if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
                  }}
                  maxLength={100}
                  className="w-[calc(100%-8px)] mx-1 my-0.5 px-1.5 py-0.5 text-[12px] rounded bg-[var(--color-panel)] border border-[var(--color-brand)] text-[var(--color-foreground)] outline-none"
                />
              ) : (
                <ContextMenu.Root>
                  <ContextMenu.Trigger asChild>
                    <button
                      type="button"
                      onClick={() => select(lib.id)}
                      onDoubleClick={() => { setRenameDraft(lib.name); setRenamingId(lib.id); }}
                      title={`${lib.name} — ${lib.songCount} song${lib.songCount === 1 ? "" : "s"}, ${lib.mediaCount} media (right-click for options)`}
                      className={rowCls(selected === lib.id)}
                    >
                      <LibraryIcon className={cn("w-4 h-4 shrink-0", selected === lib.id && "text-[var(--color-brand)]")} />
                      <span className="truncate">{lib.name}</span>
                      {countBadge(lib.songCount + lib.mediaCount, selected === lib.id)}
                    </button>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[140px]">
                      <ContextMenu.Item onSelect={() => { setRenameDraft(lib.name); setRenamingId(lib.id); }} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer">Rename</ContextMenu.Item>
                      <ContextMenu.Separator className="h-px my-1 bg-[var(--color-border)]" />
                      <ContextMenu.Item onSelect={() => void remove(lib)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer text-[var(--color-destructive)]">Delete</ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              )}
            </li>
          ))}
          {creating && (
            <li>
              <input
                autoFocus
                value={createDraft}
                onChange={(e) => setCreateDraft(e.target.value)}
                onBlur={commitCreate}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void commitCreate(); }
                  else if (e.key === "Escape") { e.preventDefault(); setCreating(false); setCreateDraft(""); }
                }}
                placeholder="Library name…"
                maxLength={100}
                className="w-[calc(100%-8px)] mx-1 my-0.5 px-1.5 py-0.5 text-[12px] rounded bg-[var(--color-panel)] border border-[var(--color-brand)] text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted-foreground)]"
              />
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
