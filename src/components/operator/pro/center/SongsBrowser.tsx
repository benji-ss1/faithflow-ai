"use client";
/**
 * Inline songs library — center-mode "songs".
 * Left: searchable song list. Right: preview slides for the selected song.
 * Single click = select (loads preview). Double click = add to playlist &
 * jump to slides mode. "Send first to live" button honors nothing extra —
 * onSendSlideToLive is the operator's opt-in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Upload, Loader2, Trash2, CheckSquare, Square, ListPlus, Sparkles } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { ThemedSlideCard } from "./ThemedSlideCard";
import { NewSongDialog } from "./NewSongDialog";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import { DotGridBackground } from "../DotGridBackground";
import type { SlidePayload } from "@/lib/broadcast";
import { createSong, createSongSlide, importPro6Files, renameSong, updateSongSlides, updateSongSlideText, deleteSong, reChunkSong, importParsedSongs } from "@/lib/actions";
import { projectableTextSlide } from "@/lib/broadcast";
import { quickEditInPlace } from "@/lib/slide-inherit";
import { cleanRenderUrl } from "@/lib/render-url";
import { parseVpagd } from "@/lib/import/videopsalm";
import { parseSongText } from "@/lib/import/song-text";
import { isInternalEvent } from "@/lib/internal-events";
import type { SongSelection } from "@/lib/song-selection";
import { ProPresenterImportDialog } from "@/components/library/ProPresenterImportDialog";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useSelectedLibrary, libraryQueryParam, getSelectedLibrary, setSelectedLibrary, type LibraryFilter } from "../left/libraryFilter";
import { listLibraries, setSongLibrary, applyThemeToSong, type LibraryRow } from "@/lib/actions";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useSongLyricSearch } from "@/lib/song-lyric-search-store";

type SongRow = { id: string; title: string; artist: string | null };
type SlideRow = { id?: string; order?: number; lyrics: string; objectsJson?: unknown };

export function SongsBrowser({
  ctx,
  onExitToSlides,
  openSong,
  onSongOpened,
}: {
  ctx: OperatorShellCtx;
  onExitToSlides: () => void;
  // A song requested from outside (e.g. the Cmd+K search palette), carried in by
  // the always-mounted shell so it survives this panel's mount. Null when none.
  openSong?: SongSelection | null;
  onSongOpened?: () => void;
}) {
  const router = useRouter();
  const [songs, setSongs] = useState<SongRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SongRow | null>(null);
  // Slide `order` to scroll to/highlight after opening a song from a lyric hit.
  const [focusSlideOrder, setFocusSlideOrder] = useState<number | null>(null);
  // Multi-select for bulk add-to-playlist / delete.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [slides, setSlides] = useState<SlideRow[] | null>(null);
  // Theme-baked song (settings.appliedThemeId): preview + send use the slide's
  // stored background/objects exactly like the playlist path (services.ts
  // projectableSongSlide). Unthemed songs keep the plain-text payload.
  const [songThemed, setSongThemed] = useState(false);
  // Which song `slides` belongs to — the lyric-hit scroll must never run against
  // the PREVIOUS song's slides while the newly clicked song is still loading.
  const [slidesForId, setSlidesForId] = useState<string | null>(null);
  const [slidesLoading, setSlidesLoading] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // Inline song-title rename (works for imported songs too).
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const titleCommittedRef = useRef(false);
  const commitTitleRename = useCallback(() => {
    if (titleCommittedRef.current) return; // guard Enter + blur double-fire
    titleCommittedRef.current = true;
    setEditingTitle(false);
    const cur = selected;
    if (!cur) return;
    const next = titleDraft.trim().slice(0, 200);
    if (!next || next === cur.title) return;
    setSavingTitle(true);
    // Optimistic local update in both the list and the selected preview.
    setSongs((list) => list.map((s) => (s.id === cur.id ? { ...s, title: next } : s)));
    setSelected((s) => (s && s.id === cur.id ? { ...s, title: next } : s));
    void renameSong(cur.id, next).then((res) => {
      setSavingTitle(false);
      if (!res.ok) {
        setSongs((list) => list.map((s) => (s.id === cur.id ? { ...s, title: cur.title } : s)));
        setSelected((s) => (s && s.id === cur.id ? { ...s, title: cur.title } : s));
        toast.error(res.error || "Rename failed");
      } else {
        toast.success("Song renamed");
        // Refresh the operator plan so the playlist sidebar label (a server
        // snapshot on the service item, updated by renameSong) reflects the new
        // name in-session. Safe: does not disturb the projector or unsaved edits.
        router.refresh();
      }
    });
  }, [selected, titleDraft, router]);
  // Shared slide-size preference — same event/localStorage key the CenterHeader
  // uses so a single slider works everywhere.
  const [slideSize, setSlideSize] = useState(280);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("presentflow.center.slideSize");
      const n = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n >= 120 && n <= 480) setSlideSize(n);
    } catch { /* noop */ }
    const handler = (e: Event) => {
      const d = (e as CustomEvent<number>).detail;
      if (typeof d === "number" && d >= 120 && d <= 480) setSlideSize(d);
    };
    window.addEventListener("presentflow:center-slide-size", handler);
    return () => window.removeEventListener("presentflow:center-slide-size", handler);
  }, []);

  // ProPresenter parity (Phase 3.6): filter the list by the selected Library
  // and offer a "Move to library" action per song.
  const [selectedLibrary] = useSelectedLibrary();
  const [libs, setLibs] = useState<LibraryRow[]>([]);
  useEffect(() => {
    let m = true;
    void listLibraries().then((r) => { if (m && r.ok) setLibs(r.data!.libraries.filter((l) => l.kind !== "smart")); });
    const h = () => { void listLibraries().then((r) => { if (m && r.ok) setLibs(r.data!.libraries.filter((l) => l.kind !== "smart")); }); };
    window.addEventListener("presentflow:libraries-changed", h);
    return () => { m = false; window.removeEventListener("presentflow:libraries-changed", h); };
  }, []);
  // "Apply theme" on ANY library song (incl. imported — imports come in
  // transparent and the operator picks a theme afterwards, plan A.6). Same
  // church-scoped server action the slide-grid Theme menu uses.
  const [menuThemes, setMenuThemes] = useState<{ id: string; name: string }[] | null>(null);
  const loadMenuThemes = useCallback(() => {
    if (menuThemes) return;
    void fetch("/api/themes").then((r) => r.json()).then((d: { themes?: { id: string; name: string }[] }) => {
      setMenuThemes((d.themes ?? []).map((t) => ({ id: t.id, name: t.name })));
    }).catch(() => setMenuThemes([]));
  }, [menuThemes]);
  const applyThemeToLibrarySong = useCallback(async (songId: string, themeId: string, themeName: string) => {
    const res = await applyThemeToSong(themeId, songId);
    if (!res.ok) { toast.error(res.error ?? "Couldn't apply theme"); return; }
    toast.success(`Theme "${themeName}" applied`);
    setSelected((cur) => (cur && cur.id === songId ? { ...cur } : cur)); // reload its slides
  }, []);
  const moveSong = useCallback(async (songId: string, libraryId: string | null) => {
    const res = await setSongLibrary(songId, libraryId);
    if (!res.ok) { toast.error(res.error ?? "Move failed"); return; }
    // Field fix (wave 6C): "I moved it into Songs and now it's completely gone."
    // A move filters the item out of the CURRENT library view — which reads as
    // the item vanishing. If we're viewing a specific library that ISN'T the
    // destination, the song legitimately leaves this view, so offer a one-tap
    // "View in <dest>" that switches the filter to where it now lives. When
    // viewing "all", it stays on screen (the reload keeps it), so a plain
    // confirmation is enough.
    const destFilter: LibraryFilter = libraryId ?? "default";
    const destName = libraryId
      ? (libs.find((l) => l.id === libraryId)?.name ?? "that library")
      : "Ungrouped";
    const current = getSelectedLibrary();
    if (current !== "all" && current !== destFilter) {
      toast.success(`Moved to ${destName}`, {
        action: { label: `View in ${destName}`, onClick: () => setSelectedLibrary(destFilter) },
        duration: 6000,
      });
    } else {
      toast.success(`Moved to ${destName}`);
    }
    window.dispatchEvent(new CustomEvent("presentflow:libraries-changed"));
    setReloadKey((k) => k + 1);
  }, [libs]);

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const q = libraryQueryParam(selectedLibrary);
    fetch(`/api/songs/list${q ? `?library=${encodeURIComponent(q)}` : ""}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) { toast.error(data.error || `Failed to load songs (${r.status})`); return; }
        setSongs(Array.isArray(data.songs) ? data.songs : []);
      })
      .catch((err) => { if (!cancelled) toast.error(err instanceof Error ? err.message : "Failed to load songs"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey, selectedLibrary]);

  // --- ProPresenter import (button + drag-drop) ----------------------------
  // The button now opens the polished 4-step dialog (handles Pro7, .proBundle,
  // media extraction, thumbnails, background linking). The drag-drop path
  // stays on the legacy per-file importPro6Files action because a bare
  // .pro6/.pro5 drop is a fast one-shot flow — no need to force the modal
  // for it. Drop a .proBundle here and it'll route to the dialog instead
  // (see onDrop below).
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[] | undefined>(undefined);
  const dragDepth = useRef(0);

  const importProFiles = useCallback(async (fileList: FileList | File[]) => {
    if (importing) return;
    const all = Array.from(fileList);
    if (all.length === 0) return;
    // .pro6/.pro5 = XML we parse; .pro/.propresenter = Pro7 — send anyway so
    // the server reports the honest per-file "export as Pro6" message and the
    // rest of the batch continues.
    const matched = all.filter((f) => /\.(pro6|pro5|pro|propresenter)$/i.test(f.name));
    if (matched.length === 0) {
      toast.error("No ProPresenter files found — drop .pro6 (or .pro5) exports.");
      return;
    }
    const ignored = all.length - matched.length;
    setImporting(true);
    try {
      const payload: { name: string; content: string }[] = [];
      for (const f of matched) payload.push({ name: f.name, content: await f.text() });
      const res = await importPro6Files(payload);
      if (!res.ok) { toast.error(res.error || "Import failed"); return; }
      const { added, duplicates, limitSkipped, failed, warnings } = res.data!;
      const parts = [`Imported ${added} song${added === 1 ? "" : "s"}`];
      if (duplicates > 0) parts.push(`${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped`);
      if (limitSkipped > 0) parts.push(`${limitSkipped} skipped — song limit reached`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (ignored > 0) parts.push(`${ignored} non-ProPresenter file${ignored === 1 ? "" : "s"} ignored`);
      const msg = parts.join(", ");
      if (added > 0) toast.success(msg, { duration: 5000 });
      else toast.warning(msg, { duration: 5000 });
      // Surface the first few per-file reasons (e.g. ".pro7 — export as Pro6").
      for (const w of warnings.slice(0, 3)) {
        toast.info(`${w.file}: ${w.warnings[0]}`, { duration: 6000 });
      }
      if (warnings.length > 3) toast.info(`…and ${warnings.length - 3} more files had warnings`, { duration: 4000 });
      if (added > 0) {
        setReloadKey((k) => k + 1);
        // Live detector must pick up the new library in-session.
        try { window.dispatchEvent(new Event("presentflow:songs-changed")); } catch { /* ignore */ }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }, [importing]);

  // Import from VideoPsalm (.vpagd, unzip + relaxed-JSON) AND plain-text song
  // exports (.txt — the "guided export" path for EasyWorship & ProPresenter text
  // exports). Both parse in the browser → persisted via importParsedSongs. A raw
  // binary .ews (EasyWorship's own DB) can't be read directly, so we point the user
  // at its text export instead of failing silently.
  const importVideoPsalmFiles = useCallback(async (fileList: FileList | File[]) => {
    if (importing) return;
    const all = Array.from(fileList);
    const vpagd = all.filter((f) => /\.vpagd$/i.test(f.name));
    const txt = all.filter((f) => /\.txt$/i.test(f.name));
    const ews = all.filter((f) => /\.ews$/i.test(f.name));
    if (ews.length > 0) {
      toast.info("For EasyWorship, export your songs to plain text (.txt) — File → Export → Text — then drop those here.", { duration: 7000 });
    }
    if (vpagd.length === 0 && txt.length === 0) return;
    setImporting(true);
    try {
      const parsed: { title: string; artist: string | null; slides: string[] }[] = [];
      let failedFiles = 0;
      for (const f of vpagd) {
        try { parsed.push(...parseVpagd(new Uint8Array(await f.arrayBuffer()))); } catch { failedFiles++; }
      }
      for (const f of txt) {
        try {
          const song = parseSongText(await f.text(), f.name);
          if (song.slides.length > 0) parsed.push(song); else failedFiles++;
        } catch { failedFiles++; }
      }
      if (parsed.length === 0) {
        toast.error(failedFiles > 0 ? "Couldn't read that song file." : "No songs with lyrics found in the file(s).");
        return;
      }
      const res = await importParsedSongs(parsed);
      if (!res.ok) { toast.error(res.error || "Import failed"); return; }
      const { added, duplicateSkipped, limitSkipped } = res.data!;
      const parts = [`Imported ${added} song${added === 1 ? "" : "s"}`];
      if (duplicateSkipped > 0) parts.push(`${duplicateSkipped} duplicate${duplicateSkipped === 1 ? "" : "s"} skipped`);
      if (limitSkipped > 0) parts.push(`${limitSkipped} skipped — song limit reached`);
      if (failedFiles > 0) parts.push(`${failedFiles} file${failedFiles === 1 ? "" : "s"} unreadable`);
      (added > 0 ? toast.success : toast.warning)(parts.join(", "), { duration: 5000 });
      if (added > 0) {
        setReloadKey((k) => k + 1);
        try { window.dispatchEvent(new Event("presentflow:songs-changed")); } catch { /* ignore */ }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }, [importing]);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    dragDepth.current++;
    setDragOver(true);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const arr = Array.from(e.dataTransfer.files);
    // VideoPsalm / text (EasyWorship guided export) take their own client-parse path.
    if (arr.some((f) => /\.(vpagd|txt|ews)$/i.test(f.name))) {
      void importVideoPsalmFiles(arr);
      if (!arr.some((f) => /\.(pro6|pro5|pro|propresenter|proBundle|proPlaylist|prolib|proLibrary|pro7|pro7x|zip)$/i.test(f.name))) return;
    }
    // Route through the dialog for anything Pro7/bundle-shaped. Legacy
    // .pro6/.pro5 XML drops keep the fast one-shot path so a single-file
    // drop of an older ProPresenter export still finishes in one action.
    const needsDialog = arr.some((f) =>
      /\.(proBundle|proPlaylist|prolib|proLibrary|pro7|pro7x|zip)$/i.test(f.name) ||
      /\.pro$/i.test(f.name), // .pro is Pro7 binary — dialog handles it
    );
    if (needsDialog) {
      setDroppedFiles(arr);
      setImportDialogOpen(true);
      return;
    }
    void importProFiles(e.dataTransfer.files);
  }, [importProFiles, importVideoPsalmFiles]);

  useEffect(() => {
    if (!selected) { setSlides(null); return; }
    let cancelled = false;
    setSlidesLoading(true);
    fetch(`/api/songs/${selected.id}/slides`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) { setSlides(data.slides || []); setSongThemed(data.themed === true); setSlidesForId(selected.id); } })
      .catch(() => { if (!cancelled) toast.error("Failed to load slides"); })
      .finally(() => { if (!cancelled) setSlidesLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  // 2026-07-25 — CenterHeader ▶ Play button dispatches `songs-play-current`
  // when in Songs mode. Fire the selected song's first slide.
  // The "presentflow:songs-play-current" listener lived here until 2026-09-25. Its only
  // trigger — the ▶ Play button in CenterHeader — was removed on
  // 2026-09-10 per an operator request, so nothing has dispatched it
  // since. Found by test/event-bus-connected.test.ts, which requires
  // every presentflow:* event to have both ends.

  // Open a song requested from outside (Cmd+K search). The shell holds the pick
  // and passes it as `openSong`, so it's already present when this panel mounts
  // (no listener-mount race). The payload carries the row directly, so the preview
  // works even if the song is filtered out of the current library view. We ack via
  // onSongOpened so the shell clears it and a later manual selection isn't reverted.
  useEffect(() => {
    if (!openSong) return;
    setFocusSlideOrder(typeof openSong.slideOrder === "number" ? openSong.slideOrder : null);
    setSelected({ id: openSong.id, title: openSong.title, artist: openSong.artist });
    onSongOpened?.();
  }, [openSong, onSongOpened]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) =>
      s.title.toLowerCase().includes(q) || (s.artist || "").toLowerCase().includes(q));
  }, [songs, query]);

  // Lyric search (additive): kicks in for ≥3-word queries, or when a ≥3-char
  // query has no title/artist match. Title results above stay exactly as before;
  // lyric hits are listed after them, limited to songs in the current library view.
  const lyricQueryWords = query.trim().split(/\s+/).filter(Boolean).length;
  const lyricEnabled = lyricQueryWords >= 3 || (query.trim().length >= 3 && filtered.length === 0);
  const { hits: rawLyricHits, indexing: lyricIndexing } = useSongLyricSearch(query, lyricEnabled, 40);
  const lyricHits = useMemo(() => {
    if (rawLyricHits.length === 0) return [];
    const inView = new Map(songs.map((s) => [s.id, s]));
    const shown = new Set(filtered.map((s) => s.id));
    return rawLyricHits
      .filter((h) => inView.has(h.songId) && !shown.has(h.songId))
      .slice(0, 25)
      .map((h) => ({ hit: h, row: inView.get(h.songId)! }));
  }, [rawLyricHits, songs, filtered]);

  // After a lyric-hit open, scroll to + highlight the matching slide once loaded.
  useEffect(() => {
    if (focusSlideOrder == null || !slides || slides.length === 0) return;
    if (!selected || slidesForId !== selected.id) return; // wait for the new song's slides
    const idx = slides.findIndex((s) => s.order === focusSlideOrder);
    if (idx < 0) return;
    const el = document.querySelector<HTMLElement>(`[data-song-slide-idx="${idx}"]`);
    try { el?.scrollIntoView({ block: "center", behavior: "smooth" }); } catch { /* ignore */ }
  }, [focusSlideOrder, slides, slidesForId, selected]);

  const refreshSlides = (songId: string) => {
    fetch(`/api/songs/${songId}/slides`)
      .then((r) => r.json())
      .then((data) => { setSlides(data.slides || []); setSongThemed(data.themed === true); })
      .catch(() => { /* silent — retry on next select */ });
    // Signal the live detector to refetch its song library — a slide (lyric)
    // change here must become detectable in-session, not after a reload.
    try { window.dispatchEvent(new Event("presentflow:songs-changed")); } catch { /* ignore */ }
  };

  const saveSlideEdit = async (idx: number) => {
    if (!selected || !slides || savingEdit) return;
    setSavingEdit(true);
    try {
      const target = slides[idx];
      if (target?.id && quickEditInPlace(songThemed, target.objectsJson)) {
        // Edit ONLY this slide's text, in place (same slide id, objectsJson kept).
        // A themed song ALWAYS takes this path — even a slide with a NULL
        // objectsJson (a verse added before round 5) — because the rewrite-all
        // path below deletes + re-inserts every row, which drops each slide's
        // baked background and rewrites the slide ids the theme undo snapshot is
        // keyed by. Unthemed plain / single-text-box slides take it too (same
        // pixels, ids + design kept); see quickEditInPlace.
        const res = await updateSongSlideText(target.id, editDraft);
        if (!res.ok) { toast.error(res.error || "Save failed"); return; }
        // Note: the refresh reads /api/songs/[id]/slides, which runs
        // sanitizeLyrics — so 3+ blank lines collapse to one stanza break
        // ("\n\n\n" → "\n\n") on this refresh rather than on the next reload
        // as on main. Words and stanza breaks are unchanged (pinned in
        // test/composable-round5b.test.ts); accepted, sanitizeLyrics untouched.
        refreshSlides(selected.id);
        setSlides(slides.map((sl, i) => (i === idx ? { ...sl, lyrics: editDraft } : sl)));
        setEditingIdx(null);
        toast.success("Slide updated");
        return;
      }
      const next = slides.map((sl, i) => (i === idx ? { lyrics: editDraft } : { lyrics: sl.lyrics }));
      const res = await updateSongSlides(selected.id, next);
      if (!res.ok) { toast.error(res.error || "Save failed"); return; }
      setSlides(next);
      setEditingIdx(null);
      // In-place lyric edits must reach the live detector in-session too —
      // slide count is unchanged here, so the library refetch + content-digest
      // signature is what catches the text change (review 🟡).
      try { window.dispatchEvent(new Event("presentflow:songs-changed")); } catch { /* ignore */ }
      toast.success("Slide updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingEdit(false);
    }
  };

  const addToPlaylist = async (s: SongRow) => {
    if (!ctx.onAddLibraryItem) { toast.info("Playlist add not available in this view"); return; }
    await ctx.onAddLibraryItem("song", { id: s.id, title: s.title });
    onExitToSlides();
  };

  // ── Bulk selection ────────────────────────────────────────────────────────
  const toggleSel = (id: string) => setSelectedIds((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id));
  const toggleSelectAll = () => setSelectedIds(allFilteredSelected ? new Set() : new Set(filtered.map((s) => s.id)));

  const bulkAddToPlaylist = async () => {
    if (!ctx.onAddLibraryItem) { toast.info("Playlist add not available in this view"); return; }
    const rows = songs.filter((s) => selectedIds.has(s.id));
    if (rows.length === 0) return;
    setBulkBusy(true);
    let added = 0;
    for (const s of rows) { try { await ctx.onAddLibraryItem("song", { id: s.id, title: s.title }); added++; } catch { /* keep going */ } }
    setBulkBusy(false);
    setSelectedIds(new Set());
    toast.success(`Added ${added} song${added === 1 ? "" : "s"} to the playlist`);
  };

  const bulkDelete = async () => {
    const rows = songs.filter((s) => selectedIds.has(s.id));
    if (rows.length === 0) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete ${rows.length} song${rows.length === 1 ? "" : "s"} from your library? This can't be undone.`)) return;
    setBulkBusy(true);
    const failed = new Set<string>();
    let deleted = 0;
    for (const s of rows) { const res = await deleteSong(s.id); if (res.ok) deleted++; else failed.add(s.id); }
    setBulkBusy(false);
    setSongs((list) => list.filter((s) => !selectedIds.has(s.id) || failed.has(s.id)));
    if (selected && selectedIds.has(selected.id) && !failed.has(selected.id)) setSelected(null);
    setSelectedIds(failed);
    toast[deleted > 0 ? "success" : "error"](`Deleted ${deleted} song${deleted === 1 ? "" : "s"}${failed.size ? ` — ${failed.size} failed` : ""}`);
    router.refresh();
  };

  return (
    <div
      className="relative isolate p-4 grid gap-3 h-full"
      style={{ gridTemplateColumns: "minmax(280px, 360px) 1fr" }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <DotGridBackground />
      {dragOver && (
        <div className="absolute inset-2 z-40 rounded-lg border-2 border-dashed border-[var(--color-brand)] bg-[var(--color-brand)]/10 flex items-center justify-center pointer-events-none">
          <div className="text-sm font-semibold text-[var(--color-brand)] bg-[var(--color-panel)]/90 px-4 py-2 rounded-md">
            Drop ProPresenter (.proBundle / .pro / .pro7 / .pro6 / .pro5), VideoPsalm (.vpagd) or text (.txt) song files to import
          </div>
        </div>
      )}
      {/* Song list */}
      <div className="flex flex-col border border-[var(--color-border)] rounded-md overflow-hidden">
        <div className="p-2 border-b border-[var(--color-border)] flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={loading ? "Loading songs…" : `Search ${songs.length} songs…`}
            className="min-w-0 flex-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md px-3 h-8 text-sm outline-none focus:border-[var(--color-brand)]"
          />
          <button
            type="button"
            onClick={() => setImportDialogOpen(true)}
            title="Import songs — ProPresenter (.proBundle, .pro, .pro7, .pro6, .pro5), VideoPsalm (.vpagd) or EasyWorship / text (.txt), all in one window"
            className={cn(
              "shrink-0 h-8 px-2 rounded-md border border-[var(--color-border)] flex items-center gap-1 text-[11px] font-semibold cursor-pointer hover:bg-[var(--color-elevated)]",
              importing && "opacity-50 pointer-events-none",
            )}
          >
            <Upload className="w-3.5 h-3.5" /> {importing ? "Importing…" : "Import"}
          </button>
          <AddSongDialog
            existingTitles={songs.map((s) => s.title)}
            defaultLibraryId={selectedLibrary !== "all" && selectedLibrary !== "default" ? selectedLibrary : null}
            onAddedToPlan={() => router.refresh()}
            onCreated={(row) => {
              // Optimistic: prepend to local list so the operator sees it
              // instantly, then select it so the preview panel opens the
              // (still-empty) slide editor path.
              setSongs((cur) => [{ id: row.id, title: row.title, artist: row.artist }, ...cur]);
              setSelected({ id: row.id, title: row.title, artist: row.artist });
            }}
          />
        </div>
        {/* Bulk-select bar: pick many songs to add-to-playlist or delete at once */}
        <div className="px-2 h-8 shrink-0 border-b border-[var(--color-border)] flex items-center gap-1.5">
          <button type="button" onClick={toggleSelectAll} title={allFilteredSelected ? "Deselect all" : "Select all"}
            className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
            {allFilteredSelected ? <CheckSquare className="w-3.5 h-3.5 text-[var(--color-brand)]" /> : <Square className="w-3.5 h-3.5" />}
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select"}
          </button>
          {selectedIds.size > 0 && (
            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => void bulkAddToPlaylist()} disabled={bulkBusy}
                className="h-6 px-2 rounded border border-[var(--color-border)] flex items-center gap-1 text-[10px] font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-elevated)] disabled:opacity-50">
                <ListPlus className="w-3 h-3" /> Add to playlist
              </button>
              <button type="button" onClick={() => void bulkDelete()} disabled={bulkBusy}
                className="h-6 px-2 rounded border border-red-500/40 flex items-center gap-1 text-[10px] font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                <Trash2 className="w-3 h-3" /> Delete
              </button>
              <button type="button" onClick={() => setSelectedIds(new Set())} title="Clear selection"
                className="grid h-6 w-6 place-items-center rounded text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">×</button>
            </div>
          )}
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filtered.length === 0 && lyricHits.length === 0 && !lyricIndexing && !loading && (
            <li className="p-3 text-[12px] text-[var(--color-muted-foreground)]">No songs found.</li>
          )}
          {filtered.map((s) => {
            const isChecked = selectedIds.has(s.id);
            return (
            <ContextMenu.Root key={s.id}>
              <ContextMenu.Trigger asChild>
            <li
              draggable
              onDragStart={(e) => {
                // "copyMove" — NOT "copy". A library-row drop target sets
                // dropEffect="move" (filing into a library) and Chromium/Electron
                // REJECTS the drop when the source only allows "copy" (drop event
                // never fires → "why doesn't it enter?"). copyMove permits BOTH the
                // playlist "copy" add and the library "move" file. (Field fix 5B-1.)
                e.dataTransfer.effectAllowed = "copyMove";
                e.dataTransfer.setData(
                  "application/x-pf-library-item",
                  JSON.stringify({ pfType: "song", id: s.id, title: s.title }),
                );
              }}
              className={cn("flex items-stretch border-b border-[var(--color-border)]", (isChecked || selected?.id === s.id) && "bg-[var(--color-elevated)]")}
            >
              <button
                type="button"
                onClick={() => toggleSel(s.id)}
                title={isChecked ? "Deselect" : "Select"}
                className="shrink-0 grid w-8 place-items-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              >
                {isChecked ? <CheckSquare className="w-3.5 h-3.5 text-[var(--color-brand)]" /> : <Square className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => { setFocusSlideOrder(null); setSelected(s); }}
                onDoubleClick={() => void addToPlaylist(s)}
                className="flex-1 min-w-0 text-left pr-3 py-2 hover:bg-[var(--color-elevated)] cursor-grab active:cursor-grabbing"
              >
                <div className="text-[13px] text-[var(--color-foreground)] truncate">{s.title}</div>
                {s.artist && <div className="text-[11px] text-[var(--color-muted-foreground)] truncate">{s.artist}</div>}
              </button>
            </li>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[160px]">
                  <ContextMenu.Sub>
                    <ContextMenu.SubTrigger className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center justify-between data-[state=open]:bg-[var(--color-panel)]"><span>Move to library</span><span className="opacity-60">▸</span></ContextMenu.SubTrigger>
                    <ContextMenu.Portal>
                      <ContextMenu.SubContent className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[160px] max-h-[300px] overflow-y-auto">
                        <ContextMenu.Item onSelect={() => void moveSong(s.id, null)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer">Default (unfiled)</ContextMenu.Item>
                        {libs.length > 0 && <ContextMenu.Separator className="h-px my-1 bg-[var(--color-border)]" />}
                        {libs.map((lib) => (
                          <ContextMenu.Item key={lib.id} onSelect={() => void moveSong(s.id, lib.id)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer truncate">{lib.name}</ContextMenu.Item>
                        ))}
                      </ContextMenu.SubContent>
                    </ContextMenu.Portal>
                  </ContextMenu.Sub>
                  <ContextMenu.Sub onOpenChange={(o) => { if (o) loadMenuThemes(); }}>
                    <ContextMenu.SubTrigger onPointerEnter={loadMenuThemes} onFocus={loadMenuThemes} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center justify-between data-[state=open]:bg-[var(--color-panel)]"><span>Apply theme</span><span className="opacity-60">▸</span></ContextMenu.SubTrigger>
                    <ContextMenu.Portal>
                      <ContextMenu.SubContent className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[160px] max-h-[300px] overflow-y-auto">
                        {menuThemes === null && <div className="px-3 py-1.5 opacity-60">Loading…</div>}
                        {menuThemes?.length === 0 && <div className="px-3 py-1.5 opacity-60">No themes yet</div>}
                        {menuThemes?.map((t) => (
                          <ContextMenu.Item key={t.id} onSelect={() => void applyThemeToLibrarySong(s.id, t.id, t.name)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer truncate">{t.name}</ContextMenu.Item>
                        ))}
                      </ContextMenu.SubContent>
                    </ContextMenu.Portal>
                  </ContextMenu.Sub>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
            );
          })}
          {lyricIndexing && (
            <li className="px-3 py-2 text-[11px] italic text-[var(--color-muted-foreground)] border-b border-[var(--color-border)]">
              Indexing lyrics…
            </li>
          )}
          {lyricHits.length > 0 && (
            <li className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] border-b border-[var(--color-border)]">
              Lyric matches
            </li>
          )}
          {lyricHits.map(({ hit, row }) => (
            <li
              key={`lyric-${hit.songId}`}
              className={cn("flex items-stretch border-b border-[var(--color-border)]", selected?.id === hit.songId && "bg-[var(--color-elevated)]")}
            >
              <button
                type="button"
                onClick={() => { setFocusSlideOrder(hit.slideOrder >= 0 ? hit.slideOrder : null); setSelected({ ...row }); }}
                onDoubleClick={() => void addToPlaylist(row)}
                title={hit.matchedLine ? `"${hit.matchedLine}" — slide ${hit.slideOrder + 1}` : row.title}
                className="flex-1 min-w-0 text-left pl-8 pr-3 py-2 hover:bg-[var(--color-elevated)] cursor-pointer"
              >
                <div className="text-[13px] text-[var(--color-foreground)] truncate">{row.title}</div>
                {hit.matchedLine
                  ? <div className="text-[11px] italic text-[var(--color-muted-foreground)] truncate">“{hit.matchedLine.length > 80 ? `${hit.matchedLine.slice(0, 80)}…` : hit.matchedLine}”</div>
                  : row.artist && <div className="text-[11px] text-[var(--color-muted-foreground)] truncate">{row.artist}</div>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Preview column */}
      <div className="flex flex-col border border-[var(--color-border)] rounded-md overflow-hidden">
        <div className="p-2 border-b border-[var(--color-border)] flex items-center gap-2">
          {selected && editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              maxLength={200}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitTitleRename(); }
                else if (e.key === "Escape") { e.preventDefault(); titleCommittedRef.current = true; setEditingTitle(false); }
              }}
              onBlur={commitTitleRename}
              aria-label="Song title"
              className="flex-1 text-[13px] font-medium bg-transparent border border-[var(--color-border)] rounded px-2 py-1 outline-none focus:border-[var(--color-brand)]"
            />
          ) : (
            <button
              type="button"
              disabled={!selected || savingTitle}
              onClick={() => {
                if (!selected || savingTitle) return;
                setTitleDraft(selected.title);
                titleCommittedRef.current = false;
                setEditingTitle(true);
              }}
              title={selected ? "Click to rename this song" : undefined}
              className="flex-1 text-[13px] font-medium truncate text-left inline-flex items-center gap-1.5 hover:text-[var(--color-brand)] disabled:hover:text-inherit group"
            >
              <span className="truncate">{selected ? selected.title : "Select a song to preview"}</span>
              {selected && !savingTitle && <Pencil className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-60" />}
              {savingTitle && <Loader2 className="w-3 h-3 shrink-0 animate-spin opacity-60" />}
            </button>
          )}
          {selected && (
            <>
              {/* Edit slide — opens the full-screen style editor for THIS selected
                  song (fonts, layout, backgrounds, objects). Passes the song
                  along so the editor always opens the song being previewed. */}
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("presentflow:open-slide-editor", {
                    detail: { songId: selected.id, title: selected.title },
                  }));
                }}
                className="h-8 px-3 rounded-md border border-[var(--color-border)] text-[12px] font-semibold hover:bg-[var(--color-elevated)] inline-flex items-center gap-1.5"
                title="Edit slide — fonts, layout, backgrounds"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit slide
              </button>
              <button
                onClick={() => {
                  setEditingIdx(null);
                  void createSongSlide(selected.id, undefined, { objects: [], lyrics: "" }).then((res) => {
                    if (!res.ok) { toast.error(res.error || "Add slide failed"); return; }
                    // Invalidate cached slides so live tracking / jump suggestions
                    // don't use stale (pre-edit) text.
                    try { window.dispatchEvent(new CustomEvent("presentflow:song-slides-changed", { detail: { songId: selected.id } })); } catch { /* noop */ }
                    refreshSlides(selected.id);
                  });
                }}
                className="h-8 px-3 rounded-md border border-[var(--color-border)] text-[12px] font-semibold hover:bg-[var(--color-elevated)]"
                title="Add a new blank lyric slide to this song"
              >
                + Add slide
              </button>
              {/* Tidy — re-break this song into cleaner, fewer-words-per-slide
                  slides (A2). Skips custom-styled songs, never orphans a plan. */}
              <button
                onClick={() => {
                  void reChunkSong(selected.id).then((res) => {
                    if (!res.ok) { toast.error(res.error || "Tidy failed"); return; }
                    const d = res.data;
                    if (!d || d.skipped === "noop") { toast.success("Slides are already tidy."); return; }
                    if (d.skipped === "rich") { toast.error("Custom-styled slides — tidy skipped to keep your styling."); return; }
                    if (d.skipped === "empty") { toast.error("No lyrics to tidy."); return; }
                    toast.success(`Tidied — ${d.before} → ${d.after} cleaner slides.`);
                    refreshSlides(selected.id);
                  });
                }}
                className="h-8 px-3 rounded-md border border-[var(--color-border)] text-[12px] font-semibold hover:bg-[var(--color-elevated)] inline-flex items-center gap-1.5"
                title="Tidy slides — re-break into cleaner, easier-to-read slides"
              >
                <Sparkles className="w-3.5 h-3.5" /> Tidy
              </button>
              <button
                onClick={() => void addToPlaylist(selected)}
                className="h-8 px-3 rounded-md bg-[var(--color-brand)] text-black text-[12px] font-semibold"
              >
                Add to playlist
              </button>
            </>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {slidesLoading && <div className="text-[11px] text-[var(--color-muted-foreground)]">Loading slides…</div>}
          {slides && slides.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="text-[12px] text-[var(--color-muted-foreground)]">No slides yet for this song.</div>
              {selected && (
                <AddLyricSlide
                  songId={selected.id}
                  onAdded={() => refreshSlides(selected.id)}
                />
              )}
            </div>
          )}
          {slides && slides.length > 0 && (
            // Match the Bible verse-card grid density: 280px minmax + slightly
            // larger gap so lyrics don't feel cramped next to Bible cards.
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${slideSize}px, 1fr))` }}>
              {slides.map((sl, idx) => {
                const oj = songThemed ? (sl.objectsJson as { bgColor?: unknown; bgExplicit?: unknown; bgImageUrl?: unknown; objects?: unknown } | null | undefined) : null;
                const payload: SlidePayload = oj
                  ? projectableTextSlide(sl.lyrics, oj.bgColor, cleanRenderUrl(oj.bgImageUrl) ?? undefined, oj.objects, oj.bgExplicit)
                  : { kind: "text", text: sl.lyrics };
                const isEditing = editingIdx === idx;
                if (isEditing) {
                  return (
                    <div
                      key={idx}
                      className="relative aspect-video rounded overflow-hidden border-2 border-[var(--color-brand)] bg-[var(--color-elevated)] flex flex-col p-2 gap-1"
                    >
                      <textarea
                        autoFocus
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") { setEditingIdx(null); return; }
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void saveSlideEdit(idx); }
                        }}
                        maxLength={5000}
                        className="flex-1 w-full resize-none bg-transparent text-[12px] outline-none"
                        placeholder="Type lyrics for this slide…"
                      />
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditingIdx(null)}
                          className="h-6 px-2 rounded border border-[var(--color-border)] text-[10px]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => void saveSlideEdit(idx)}
                          disabled={savingEdit}
                          className="h-6 px-2 rounded bg-[var(--color-brand)] text-black text-[10px] font-semibold disabled:opacity-50"
                        >
                          {savingEdit ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={idx}
                    data-song-slide-idx={idx}
                    className={cn(
                      "group relative aspect-video rounded overflow-hidden border-2 border-[var(--color-border)] hover:border-[var(--color-brand)] transition-colors",
                      focusSlideOrder != null && sl.order === focusSlideOrder && "border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]/50",
                    )}
                  >
                    <button
                      // Operator-directive: single-click sends to live. This is
                      // a MANUAL operator click — copyright rule 7 (songs never
                      // AUTO-project) applies to AI/autopilot only. Direct
                      // operator intent is trusted.
                      // 2026-07-25 field-report defensive additions:
                      //  - reject empty payloads with a visible toast (rather
                      //    than silently no-op which reads as "the button is
                      //    broken")
                      //  - console.log the click so if `ctx.onSendSlideToLive`
                      //    is stale/undefined, DevTools shows exactly why
                      //  - success toast confirms the click reached the live
                      //    pipeline — if this fires but nothing appears on the
                      //    projector, the bug is in the projector window, not
                      //    the send handler
                      onClick={() => {
                        try { console.log("[songs-browser] slide clicked", { idx, textLen: sl.lyrics?.length ?? 0, hasHandler: typeof ctx.onSendSlideToLive === "function" }); } catch { /* ignore */ }
                        if (!sl.lyrics || !sl.lyrics.trim()) {
                          toast.info("This slide is empty — add lyrics with the pencil icon first.");
                          return;
                        }
                        if (typeof ctx.onSendSlideToLive !== "function") {
                          toast.error("Live-send handler not wired — reload the app.");
                          return;
                        }
                        ctx.onSendSlideToLive(payload, undefined, selected ? { origin: { kind: "song", songId: selected.id } } : undefined);
                        toast.success(`Sent to LIVE: "${sl.lyrics.slice(0, 40).replace(/\n/g, " ")}${sl.lyrics.length > 40 ? "…" : ""}"`, { duration: 2000 });
                      }}
                      className="absolute inset-0 w-full h-full"
                      title="Click to send lyric slide to live"
                    >
                      <ThemedSlideCard slide={payload} appearance={ctx.appearance ?? undefined} background={ctx.background}
                        // Theme-baked song: the slide's own background must paint ABOVE the
                        // card's absolute screen-colour base (a static renderer root paints
                        // under it, so the baked colour was hidden). Unthemed cards unchanged.
                        {...(oj ? { className: "relative" } : {})} />
                      {!sl.lyrics.trim() && (
                        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[var(--color-muted-foreground)]">
                          Empty slide — click pencil to add lyrics
                        </div>
                      )}
                    </button>
                    <div className="absolute top-1 left-1 text-[10px] font-mono text-white/70 bg-black/40 px-1.5 py-0.5 rounded pointer-events-none">
                      {idx + 1}
                    </div>
                    <button
                      type="button"
                      aria-label="Edit slide lyrics"
                      title="Edit lyrics"
                      onClick={(e) => { e.stopPropagation(); setEditDraft(sl.lyrics); setEditingIdx(idx); }}
                      className="absolute top-1 right-1 h-5 w-5 inline-flex items-center justify-center rounded bg-black/50 text-white/80 hover:bg-[var(--color-brand)] hover:text-black transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <ProPresenterImportDialog
        open={importDialogOpen}
        initialFiles={droppedFiles}
        onOtherFiles={(fs) => void importVideoPsalmFiles(fs)}
        onClose={() => {
          setImportDialogOpen(false);
          setDroppedFiles(undefined);
          // Refresh the song list after the modal closes — even a partial
          // import should surface in the operator's library without a full
          // page reload.
          setReloadKey((k) => k + 1);
          try { window.dispatchEvent(new Event("presentflow:songs-changed")); } catch { /* ignore */ }
        }}
      />
    </div>
  );
}

function AddSongDialog({ onCreated, existingTitles, defaultLibraryId, onAddedToPlan }: { onCreated: (row: SongRow) => void; existingTitles: string[]; defaultLibraryId?: string | null; onAddedToPlan?: () => void }) {
  // PP7 "New Presentation" dialog (plan A.6). The old hardcoded
  // Default/Dark/Light/Brand select wrote a localStorage key nothing read; the
  // theme is now a real church theme persisted via applyThemeToSong.
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  return (
    <>
    {confirmDialog}
    <button
      type="button"
      title="Add a new song"
      aria-label="Add song"
      onClick={() => setOpen(true)}
      className="shrink-0 h-8 px-2.5 rounded-md border border-[var(--color-brand)] bg-[var(--color-brand)] text-black flex items-center gap-1 text-[11px] font-semibold hover:opacity-90"
    >
      <Plus className="w-3.5 h-3.5" /> Add song
    </button>
    <NewSongDialog
      open={open}
      onOpenChange={setOpen}
      existingTitles={existingTitles}
      defaultLibraryId={defaultLibraryId}
      confirmDuplicate={(t) => confirm({ title: `"${t}" already exists`, description: "A song with this title is already in your library. Create another anyway?", confirmLabel: "Create another" })}
      onCreated={(row) => {
        onCreated({ id: row.id, title: row.title, artist: row.artist });
        if (row.planId) onAddedToPlan?.();
      }}
    />
    </>
  );
}

function AddLyricSlide({ songId, onAdded }: { songId: string; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    const t = text.trim();
    if (!t) { toast.error("Enter lyrics for the slide"); return; }
    if (t.length > 5000) { toast.error("Slide text too long (max 5000 chars)"); return; }
    setBusy(true);
    try {
      const res = await createSongSlide(songId, undefined, { objects: [], lyrics: t });
      if (!res.ok) { toast.error(res.error); return; }
      setText("");
      toast.success("Slide added");
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Add slide failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="w-full max-w-md flex flex-col gap-2 items-stretch">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Amazing grace, how sweet the sound\nThat saved a wretch like me…"}
        rows={4}
        maxLength={5000}
        className="w-full px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] text-sm resize-none"
      />
      <button
        onClick={save}
        disabled={busy || !text.trim()}
        className="h-8 px-3 rounded bg-[var(--color-brand)] text-black text-[12px] font-semibold self-end disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add lyric slide"}
      </button>
    </div>
  );
}
