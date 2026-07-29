"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Music, Plus, Search, Trash2, Download } from "lucide-react";
import { deleteSong } from "@/lib/actions";
import { ProPresenterImportDialog } from "./ProPresenterImportDialog";

type Song = {
  id: string;
  title: string;
  artist: string | null;
  source: "public_domain" | "church" | "imported";
};

type SortKey = "title" | "artist" | "source";
type SortDir = "asc" | "desc";

export function SongsTable({ songs: initial }: { songs: Song[] }) {
  const [songs, setSongs] = useState(initial);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [pending, startTransition] = useTransition();
  const [ppOpen, setPpOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const src = q
      ? songs.filter((s) =>
          s.title.toLowerCase().includes(q) ||
          (s.artist || "").toLowerCase().includes(q),
        )
      : songs;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...src].sort((a, b) => {
      const av = (a[sortKey] || "").toString().toLowerCase();
      const bv = (b[sortKey] || "").toString().toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [songs, query, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  function onDelete(s: Song) {
    if (!confirm(`Delete "${s.title}"? Slides will be removed too.`)) return;
    startTransition(async () => {
      const res = await deleteSong(s.id);
      if (!res.ok) { toast.error(res.error || "Could not delete"); return; }
      setSongs((prev) => prev.filter((x) => x.id !== s.id));
      toast.success(`Deleted "${s.title}"`);
    });
  }

  if (initial.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-white/[0.02] p-12 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
          <Music className="h-5 w-5" />
        </div>
        <div className="text-base font-semibold text-foreground">No songs yet</div>
        <p className="max-w-md text-sm text-muted-foreground">
          Add your first worship song, or import from ProPresenter, EasyWorship, or a plain CSV.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="#create"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)]"
          >
            <Plus className="h-4 w-4" /> Add a song
          </Link>
          <button
            type="button"
            onClick={() => setPpOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:bg-accent"
          >
            <Download className="h-4 w-4" /> Import from ProPresenter
          </button>
          <Link
            href="/library/imports/wizard"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:bg-white/[0.04]"
          >
            Other formats
          </Link>
        </div>
        <ProPresenterImportDialog open={ppOpen} onClose={() => setPpOpen(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs by title or artist…"
            className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-[var(--color-primary)]/70"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPpOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold text-foreground hover:bg-accent"
          >
            <Download className="h-3.5 w-3.5" /> Import from ProPresenter
          </button>
          <div className="text-xs text-muted-foreground">
            {filtered.length === songs.length
              ? `${songs.length} song${songs.length === 1 ? "" : "s"}`
              : `${filtered.length} of ${songs.length}`}
          </div>
        </div>
      </div>
      <ProPresenterImportDialog open={ppOpen} onClose={() => setPpOpen(false)} />
      <div className="overflow-hidden rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.02] text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <tr>
              <ThHead label="Title" active={sortKey === "title"} dir={sortDir} onClick={() => toggleSort("title")} />
              <ThHead label="Artist" active={sortKey === "artist"} dir={sortDir} onClick={() => toggleSort("artist")} />
              <ThHead label="Source" active={sortKey === "source"} dir={sortDir} onClick={() => toggleSort("source")} />
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="group border-t border-border transition hover:bg-white/[0.03]">
                <td className="px-4 py-3">
                  <Link href={`/library/songs/${s.id}`} className="font-medium hover:underline">
                    {s.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{s.artist || "—"}</td>
                <td className="px-4 py-3">
                  <SourceBadge source={s.source} />
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onDelete(s)}
                    disabled={pending}
                    title="Delete song"
                    className="opacity-0 transition group-hover:opacity-100 disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-400" />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No matches for &ldquo;{query}&rdquo;
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ThHead({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <th className="px-4 py-3 text-left">
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""}`}>
        {label}
        {active ? <span className="text-[10px]">{dir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );
}

function SourceBadge({ source }: { source: Song["source"] }) {
  const styles =
    source === "public_domain"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : source === "imported"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
        : "border-white/10 bg-white/[0.03] text-muted-foreground";
  const label = source === "public_domain" ? "Public domain" : source === "imported" ? "Imported" : "Church-owned";
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] ${styles}`}>{label}</span>;
}
