"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { ChevronDown, ChevronRight, Plus, BookOpen, Library as LibraryIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CenterMode } from "../ProOperatorShell";
import { createLibrary, renameLibrary, deleteLibrary, listLibraries, setLibraryColor, setSongLibrary, setMediaLibrary, type LibraryRow } from "@/lib/actions";
import { useSelectedLibrary, setSelectedLibrary } from "./libraryFilter";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { SECTION_COLORS } from "./sectionColors";
import { useSpringLoad } from "./useSpringLoad";
import { classifyDrop } from "@/lib/spring-load";
import { requestOsDropImport } from "../center/pendingImport";

// Wave 3 (item 4): move dragged library items into a target library (null =
// Default), from the center Songs/Media browsers' HTML5 drag payloads.
async function moveLibraryItemsInto(
  dt: DataTransfer,
  libraryId: string | null,
): Promise<{ moved: number; failed: number }> {
  let moved = 0, failed = 0;
  const run = async (r: { ok: boolean } | void) => { if (r && r.ok) moved++; else failed++; };
  // Multi-select media group first (mirrors PlaylistSection precedence).
  const rawGroup = dt.getData("application/x-pf-library-items");
  if (rawGroup) {
    let g: { pfType?: string; items?: { id?: string }[] } = {};
    try { g = JSON.parse(rawGroup); } catch { g = {}; }
    if (g.pfType === "media-group" && Array.isArray(g.items)) {
      for (const it of g.items) if (typeof it.id === "string") await run(await setMediaLibrary(it.id, libraryId));
      return { moved, failed };
    }
  }
  const raw = dt.getData("application/x-pf-library-item");
  if (!raw) return { moved, failed };
  let data: { pfType?: string; id?: string } = {};
  try { data = JSON.parse(raw); } catch { return { moved, failed }; }
  if (!data.id || !data.pfType) return { moved, failed };
  if (data.pfType === "song") await run(await setSongLibrary(data.id, libraryId));
  else await run(await setMediaLibrary(data.id, libraryId));
  return { moved, failed };
}

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

  const recolor = async (id: string, color: string | null) => {
    const res = await setLibraryColor(id, color);
    if (!res.ok) { toast.error(res.error ?? "Recolor failed"); return; }
    await reload();
  };

  // Wave 3 (item 4a/4c): spring-loaded drop onto a library row. Hovering ~600ms
  // arms the row (accent ring + expand); a drop either MOVES dragged library
  // items into it (4a) or routes OS files through the media import wizard with
  // this library preselected (4c). `libraryId` is null for the Default bucket.
  const spring = useSpringLoad();

  const handleRowDragOver = (rowKey: string, e: React.DragEvent<HTMLElement>) => {
    const kind = classifyDrop(e.dataTransfer.types);
    if (kind === "none") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = kind === "os-files" ? "copy" : "move";
    spring.enter(rowKey);
  };

  const handleRowDrop = async (rowKey: string, libraryId: string | null, e: React.DragEvent<HTMLElement>) => {
    const kind = classifyDrop(e.dataTransfer.types);
    if (kind === "none") return;
    e.preventDefault();
    spring.reset();
    if (kind === "os-files") {
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      // Route through the EXISTING media import wizard (center), preselecting
      // this library. Switch the center to media so the browser mounts + opens.
      onCenterMode?.("media");
      requestOsDropImport({ files, libraryId });
      return;
    }
    const { moved, failed } = await moveLibraryItemsInto(e.dataTransfer, libraryId);
    if (moved > 0) {
      toast.success(`${moved} item${moved === 1 ? "" : "s"} moved`);
      window.dispatchEvent(new CustomEvent("presentflow:libraries-changed"));
      router.refresh();
    }
    if (failed > 0) toast.error(`${failed} item${failed === 1 ? "" : "s"} couldn't move`);
  };

  // Escape cancels an in-flight spring-arm.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") spring.reset(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spring]);

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
          <li
            onDragOver={(e) => handleRowDragOver("default", e)}
            onDragLeave={() => spring.leave("default")}
            onDrop={(e) => void handleRowDrop("default", null, e)}
            className={cn("transition-transform", spring.armed("default") && "scale-[1.02]")}
          >
            <button
              type="button"
              onClick={() => select("default")}
              title="Content not filed into a named library — drop here to un-file, or drop files to import"
              className={cn(rowCls(selected === "default"), spring.armed("default") && "ring-1 ring-inset ring-[var(--color-brand)] bg-[var(--color-brand)]/15")}
            >
              <BookOpen className={cn("w-4 h-4 shrink-0", selected === "default" && "text-[var(--color-brand)]")} />
              Default
              {countBadge(defaultCounts.songs + defaultCounts.media, selected === "default")}
            </button>
          </li>
          {libs.map((lib) => (
            <li
              key={lib.id}
              onDragOver={(e) => handleRowDragOver(lib.id, e)}
              onDragLeave={() => spring.leave(lib.id)}
              onDrop={(e) => void handleRowDrop(lib.id, lib.id, e)}
              className={cn("transition-transform", spring.armed(lib.id) && "scale-[1.02]")}
            >
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
                      className={cn(rowCls(selected === lib.id), spring.armed(lib.id) && "ring-1 ring-inset ring-[var(--color-brand)] bg-[var(--color-brand)]/15")}
                    >
                      {lib.color ? (
                        <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-inset ring-black/20" style={{ background: lib.color }} aria-hidden />
                      ) : (
                        <LibraryIcon className={cn("w-4 h-4 shrink-0", selected === lib.id && "text-[var(--color-brand)]")} />
                      )}
                      <span className="truncate">{lib.name}</span>
                      {countBadge(lib.songCount + lib.mediaCount, selected === lib.id)}
                    </button>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[140px]">
                      <ContextMenu.Item onSelect={() => { setRenameDraft(lib.name); setRenamingId(lib.id); }} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer">Rename</ContextMenu.Item>
                      <ContextMenu.Sub>
                        <ContextMenu.SubTrigger className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center justify-between data-[state=open]:bg-[var(--color-panel)]"><span>Change color</span><span className="opacity-60">▸</span></ContextMenu.SubTrigger>
                        <ContextMenu.Portal>
                          <ContextMenu.SubContent className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[160px]">
                            {SECTION_COLORS.map((c) => (
                              <ContextMenu.Item key={c.value} onSelect={() => void recolor(lib.id, c.value)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.value }} />
                                <span>{c.name}</span>
                                {(lib.color ?? "").toLowerCase() === c.value.toLowerCase() && <span className="ml-auto text-[var(--color-brand)]">✓</span>}
                              </ContextMenu.Item>
                            ))}
                            <ContextMenu.Separator className="h-px my-1 bg-[var(--color-border)]" />
                            <ContextMenu.Item onSelect={() => void recolor(lib.id, null)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full shrink-0 border border-[var(--color-border)]" />
                              <span>No label</span>
                              {!lib.color && <span className="ml-auto text-[var(--color-brand)]">✓</span>}
                            </ContextMenu.Item>
                          </ContextMenu.SubContent>
                        </ContextMenu.Portal>
                      </ContextMenu.Sub>
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
