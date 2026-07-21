"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight, Music, BookOpen, Image as ImageIcon, Presentation,
  ListMusic, Upload, Filter as FilterIcon, Circle, X, Bookmark, HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "./types";
import { BiblePanel } from "@/components/library/BiblePanel";
import { toast } from "sonner";

type LibKey = "songs" | "bible" | "media" | "sermon" | "playlists" | "imports";
const LIB: { key: LibKey; label: string; icon: typeof Music }[] = [
  { key: "songs",     label: "Songs",         icon: Music },
  { key: "bible",     label: "Bible",         icon: BookOpen },
  { key: "media",     label: "Media",         icon: ImageIcon },
  { key: "sermon",    label: "Sermon Slides", icon: Presentation },
  { key: "playlists", label: "Playlists",     icon: ListMusic },
  { key: "imports",   label: "Imports",       icon: Upload },
];

const HELP_ITEMS = [
  { label: "Guided Tutorial",     path: "/tutorial" },
  { label: "First Sunday Playbook", path: "/help/first-sunday" },
  { label: "Projector Setup",     path: "/setup/projector" },
  { label: "Microphone Setup",    path: "/setup/audio" },
  { label: "Install Diagnostics", path: "/setup/diagnostics" },
];

type SongRow = { id: string; title: string; artist: string | null };
type MediaRow = { id: string; fileName: string; kind: string; url: string };
type ImportRow = { id: string; fileName: string; status: string; createdAt: string };

// Payload written to dataTransfer during library drags. The Playlist section
// reads it on drop and calls ctx.onAddLibraryItem.
type LibraryDrag = { kind: "song" | "media" | "sermon"; id: string; title: string };
const DRAG_MIME = "application/x-presentflow-library";

export function LeftColumn({ ctx }: { ctx: OperatorShellCtx }) {
  const [libOpen, setLibOpen] = useState(true);
  const [playOpen, setPlayOpen] = useState(true);
  const [quickOpen, setQuickOpen] = useState(true);
  const [filterOpen, setFilterOpen] = useState(true);
  const [activeLib, setActiveLib] = useState<LibKey>("songs");
  const [filter, setFilter] = useState("");
  const [bibleOpen, setBibleOpen] = useState(false);

  // Inline library data (lazy fetched on first expansion).
  const [songs, setSongs] = useState<SongRow[] | null>(null);
  const [media, setMedia] = useState<MediaRow[] | null>(null);
  const [imports, setImports] = useState<ImportRow[] | null>(null);
  const [libFilter, setLibFilter] = useState("");

  useEffect(() => {
    if (activeLib === "songs" && songs === null) {
      fetch("/api/songs/list").then((r) => r.json()).then((d) => setSongs(d.songs || [])).catch(() => setSongs([]));
    }
    if (activeLib === "media" && media === null) {
      fetch("/api/media/list").then((r) => r.json()).then((d) => setMedia(d.assets || [])).catch(() => setMedia([]));
    }
    if (activeLib === "imports" && imports === null) {
      fetch("/api/imports/list").then((r) => r.json()).then((d) => setImports(d.imports || [])).catch(() => setImports([]));
    }
  }, [activeLib, songs, media, imports]);

  const filteredSongs = useMemo(
    () => (songs || []).filter((s) => !libFilter || s.title.toLowerCase().includes(libFilter.toLowerCase()) || (s.artist || "").toLowerCase().includes(libFilter.toLowerCase())),
    [songs, libFilter]
  );
  const filteredMedia = useMemo(
    () => (media || []).filter((m) => !libFilter || m.fileName.toLowerCase().includes(libFilter.toLowerCase())),
    [media, libFilter]
  );
  const filteredImports = useMemo(
    () => (imports || []).filter((i) => !libFilter || i.fileName.toLowerCase().includes(libFilter.toLowerCase())),
    [imports, libFilter]
  );

  const isElectron = typeof window !== "undefined" && !!(window as { electronAPI?: unknown }).electronAPI;

  // Pending guard: a rapid double-click (or impatient repeat-click) on a
  // library row can fire onAddLibraryItem twice before the first call lands.
  // Track the "key" of the item currently in flight and ignore repeat clicks
  // on it until the add resolves.
  const [addPendingKey, setAddPendingKey] = useState<string | null>(null);
  async function guardedAdd(key: string, kind: "song" | "media" | "sermon", payload: { id: string; title: string }) {
    if (addPendingKey === key || !ctx.onAddLibraryItem) return;
    setAddPendingKey(key);
    try {
      await ctx.onAddLibraryItem(kind, payload);
    } finally {
      setAddPendingKey(null);
    }
  }

  function onLibraryDragStart(e: React.DragEvent, payload: LibraryDrag) {
    try {
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
      e.dataTransfer.setData("text/plain", payload.title);
      e.dataTransfer.effectAllowed = "copy";
    } catch { /* noop */ }
  }

  async function onPlaylistDrop(e: React.DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    try {
      const p = JSON.parse(raw) as LibraryDrag;
      if (!ctx.onAddLibraryItem) return;
      await ctx.onAddLibraryItem(p.kind, { id: p.id, title: p.title });
    } catch { /* noop */ }
  }

  function onSongClick(s: SongRow) {
    void guardedAdd(`song:${s.id}`, "song", { id: s.id, title: s.title });
  }
  function onMediaClick(m: MediaRow) {
    void guardedAdd(`media:${m.id}`, "media", { id: m.id, title: m.fileName });
  }
  function onImportClick(i: ImportRow) {
    if (i.status !== "ready") { toast.info(`Import status: ${i.status}`); return; }
    void guardedAdd(`sermon:${i.id}`, "sermon", { id: i.id, title: i.fileName });
  }

  return (
    <>
    <aside className="w-56 shrink-0 flex flex-col border-r min-h-0"
      style={{ borderColor: "#2a3232", background: "#1e2525" }}>
      <div className="flex-1 min-h-0 overflow-y-auto">
      <Panel title="Library" open={libOpen} onToggle={() => setLibOpen((v) => !v)}>
        <ul className="flex flex-col">
          {LIB.map(({ key, label, icon: Icon }) => {
            const active = activeLib === key;
            return (
              <li key={key}>
                <button onClick={() => {
                    // Accordion — clicking an active one closes; opening
                    // another closes the previous by simply switching activeLib.
                    setActiveLib(key);
                    if (key === "bible") setBibleOpen(true);
                  }}
                  title={`Open ${label}`}
                  className={cn(
                    "w-full flex items-center gap-2 h-7 px-2 rounded-md text-[11px] text-left",
                    active ? "bg-teal-500/10 text-teal-200" : "text-zinc-300 hover:bg-white/5",
                  )}>
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
                {active && key !== "bible" && (
                  <div className="pl-2 pr-1 pb-2 pt-1">
                    <div className="relative mb-1">
                      <FilterIcon className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <input value={libFilter} onChange={(e) => setLibFilter(e.target.value)}
                        placeholder={`Search ${label.toLowerCase()}…`}
                        className="w-full h-6 pl-6 pr-2 rounded-md text-[10px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none border"
                        style={{ background: "#1a2020", borderColor: "#2a3232" }} />
                    </div>
                    <div className="pr-0.5">
                      {key === "songs" && (
                        songs === null ? <Loading /> :
                        filteredSongs.length === 0 ? <Empty label="songs" /> :
                        <ul className="flex flex-col">
                          {filteredSongs.map((s) => (
                            <li key={s.id}
                              draggable
                              onDragStart={(e) => onLibraryDragStart(e, { kind: "song", id: s.id, title: s.title })}
                              onClick={() => onSongClick(s)}
                              title={`${s.title}${s.artist ? " · " + s.artist : ""} — click to add, drag onto playlist`}
                              className="h-7 px-1.5 rounded-md flex items-center gap-1.5 text-[11px] text-zinc-200 hover:bg-white/5 cursor-grab active:cursor-grabbing">
                              <Music className="w-3 h-3 text-zinc-500 shrink-0" />
                              <span className="truncate flex-1">{s.title}</span>
                              {s.artist && <span className="text-[9px] text-zinc-500 truncate max-w-[60px]">{s.artist}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {key === "media" && (
                        media === null ? <Loading /> :
                        filteredMedia.length === 0 ? <Empty label="media" /> :
                        <div className="grid grid-cols-2 gap-1">
                          {filteredMedia.map((m) => (
                            <div key={m.id}
                              draggable
                              onDragStart={(e) => onLibraryDragStart(e, { kind: "media", id: m.id, title: m.fileName })}
                              onClick={() => onMediaClick(m)}
                              title={`${m.fileName} — click to add, drag onto playlist`}
                              className="aspect-video rounded-sm border overflow-hidden cursor-grab active:cursor-grabbing hover:border-teal-400"
                              style={{ borderColor: "#2a3232", background: "#000" }}>
                              {m.kind === "image"
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={m.url} alt="" className="w-full h-full object-cover" />
                                : <div className="w-full h-full flex items-center justify-center text-[9px] text-zinc-500">VIDEO</div>}
                            </div>
                          ))}
                        </div>
                      )}
                      {key === "imports" && (
                        imports === null ? <Loading /> :
                        filteredImports.length === 0 ? <Empty label="imports" /> :
                        <ul className="flex flex-col">
                          {filteredImports.map((i) => (
                            <li key={i.id}
                              draggable={i.status === "ready"}
                              onDragStart={(e) => onLibraryDragStart(e, { kind: "sermon", id: i.id, title: i.fileName })}
                              onClick={() => onImportClick(i)}
                              title={`${i.fileName} · ${i.status}`}
                              className="h-9 px-1.5 rounded-md flex items-center gap-1.5 text-[11px] text-zinc-200 hover:bg-white/5 cursor-grab active:cursor-grabbing">
                              <Upload className="w-3 h-3 text-zinc-500 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="truncate">{i.fileName}</div>
                                <div className="text-[9px] font-mono text-zinc-500">{i.status} · {new Date(i.createdAt).toLocaleDateString()}</div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                      {key === "sermon" && <div className="text-[10px] text-zinc-500 italic px-1 py-2">Use Imports to bring in sermon slides.</div>}
                      {key === "playlists" && <div className="text-[10px] text-zinc-500 italic px-1 py-2">No playlists yet.</div>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title={`Playlist · ${ctx.plan.items.length}`} open={playOpen} onToggle={() => setPlayOpen((v) => !v)}>
        <div
          className="pr-0.5"
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes(DRAG_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={onPlaylistDrop}
        >
          {ctx.plan.items.length === 0 && (
            <div className="text-[10px] text-zinc-500 italic px-2 py-3 border border-dashed rounded-md" style={{ borderColor: "#2a3232" }}>
              Drop songs, media, or imports here.
            </div>
          )}
          <ul className="flex flex-col">
            {ctx.plan.items
              .map((it, idx) => ({ it, idx }))
              .filter(({ it }) => !filter || it.title.toLowerCase().includes(filter.toLowerCase()))
              .map(({ it, idx }) => {
                const active = ctx.previewItemIdx === idx;
                const live = ctx.liveItemIdx === idx;
                return (
                  <li key={idx}>
                    <button onClick={() => ctx.onSetPreviewItem(idx)}
                      title={it.title}
                      className={cn(
                        "w-full h-8 flex items-center gap-2 px-2 rounded-md text-left",
                        active ? "bg-teal-500/10" : "hover:bg-white/5",
                      )}>
                      <span className="text-[9px] font-mono uppercase text-zinc-500 w-7 shrink-0">{it.type.slice(0, 4)}</span>
                      <span className={cn("text-[12px] font-medium truncate flex-1", active ? "text-teal-100" : "text-zinc-200")}>
                        {it.title}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500 shrink-0">{it.slides.length}</span>
                      <PipDot active={active} live={live} />
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      </Panel>

      <Panel title={`Quick Access · ${ctx.bank.length}`} open={quickOpen} onToggle={() => setQuickOpen((v) => !v)}>
        {ctx.bank.length === 0 ? (
          <div className="text-[10px] text-zinc-500 px-2 py-1">Save verses from the Bible panel to appear here.</div>
        ) : (
          <div className="pr-0.5">
            <ul className="flex flex-col">
              {ctx.bank.map((b, idx) => {
                const label = `${b.book} ${b.chapter}:${b.verseStart}${b.verseStart !== b.verseEnd ? `-${b.verseEnd}` : ""}`;
                return (
                  <li key={b.id} className="group flex items-center">
                    <button
                      onClick={() => ctx.onSendBankedToLive(idx)}
                      title={`Send ${label} (${b.translation}) to Live`}
                      className="flex-1 h-7 flex items-center gap-1.5 px-2 rounded-md text-left text-[11px] text-zinc-200 hover:bg-white/5"
                    >
                      <Bookmark className="w-3 h-3 text-teal-300 shrink-0" />
                      <span className="truncate">{label}</span>
                      <span className="text-[9px] font-mono text-zinc-500 ml-auto">{b.translation}</span>
                    </button>
                    <button
                      onClick={() => ctx.onRemoveBanked(idx)}
                      title="Remove from Quick Access"
                      className="opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center text-zinc-500 hover:text-red-300"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Panel>

      <Panel title="Filter" open={filterOpen} onToggle={() => setFilterOpen((v) => !v)}>
        <div className="relative">
          <FilterIcon className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter playlist..."
            className="w-full h-7 pl-7 pr-2 rounded-md text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none border"
            style={{ background: "#1a2020", borderColor: "#2a3232" }} />
        </div>
      </Panel>
      </div>

      {/* Bottom Help icon — mirrors the Electron Help menu. Web shell hides it
          (web has its own navigation). */}
      {isElectron && (
        <div className="mt-auto shrink-0 border-t p-1.5 flex items-center justify-end" style={{ borderColor: "#2a3232" }}>
          <HelpDropdown />
        </div>
      )}
    </aside>

    {bibleOpen && (
      <div className="fixed inset-0 z-50 flex" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setBibleOpen(false)}>
        <div className="ml-auto w-full max-w-[1100px] h-full flex" onClick={(e) => e.stopPropagation()}>
          <BiblePanel
            defaultTranslationCode={ctx.defaultTranslationCode}
            onSendSlideToLive={ctx.onSendSlideToLive}
            onStageSlide={ctx.onStageSlide}
            onBankAdd={ctx.onBankAddReference}
            transitionSpec={ctx.transitionSpec}
            onSetTransitionSpec={ctx.onSetTransitionSpec}
            detections={ctx.audio.detections}
            autoApproveEnabled={ctx.autoApproveOn}
            autoApproveThreshold={ctx.confidenceThreshold}
            autoSendToLive={ctx.autoSendToLive}
            onClose={() => setBibleOpen(false)}
          />
        </div>
      </div>
    )}
    </>
  );
}

function HelpDropdown() {
  const [open, setOpen] = useState(false);
  const base = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_APP_URL) || "";

  function openItem(path: string) {
    const url = base ? `${base}${path}` : path;
    const api = (window as { electronAPI?: { shell?: { openExternal: (u: string) => void } } }).electronAPI;
    if (api?.shell?.openExternal) void api.shell.openExternal(url);
    else window.open(url, "_blank");
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        title="Help & tutorials"
        aria-label="Help"
        onClick={() => setOpen((v) => !v)}
        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/5"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 bottom-9 z-50 w-56 rounded-md border shadow-lg py-1"
            style={{ borderColor: "#2a3232", background: "#232b2b" }}>
            {HELP_ITEMS.map((it) => (
              <button key={it.path} onClick={() => openItem(it.path)}
                className="w-full text-left px-3 h-7 text-[11px] text-zinc-200 hover:bg-white/5">
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Panel({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="border-b flex flex-col shrink-0" style={{ borderColor: "#2a3232" }}>
      <button onClick={onToggle}
        className="h-7 px-2 flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400 hover:text-zinc-100">
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="truncate">{title}</span>
      </button>
      {open && <div className="px-1.5 pb-2">{children}</div>}
    </section>
  );
}

function PipDot({ active, live }: { active: boolean; live: boolean }) {
  if (live) return <Circle className="w-2 h-2 text-red-400 fill-red-400 shrink-0" />;
  if (active) return <Circle className="w-2 h-2 text-teal-300 fill-teal-300 shrink-0" />;
  return <Circle className="w-2 h-2 text-zinc-700 shrink-0" />;
}

function Loading() {
  return <div className="text-[10px] text-zinc-500 italic px-1 py-2">Loading…</div>;
}
function Empty({ label }: { label: string }) {
  return <div className="text-[10px] text-zinc-500 italic px-1 py-2">No {label} found.</div>;
}
