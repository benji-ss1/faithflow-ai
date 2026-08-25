import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { listSongs } from "@/lib/server/services";
import { PageHeader } from "@/components/layout/PageHeader";
import { SongImporter } from "@/components/library/SongImporter";
import { InternetSongDetectionPanel } from "@/components/library/InternetSongDetectionPanel";
import { SongsTable } from "@/components/library/SongsTable";
import { TidyAllSongsButton } from "@/components/library/TidyAllSongsButton";
import { getSongUsage } from "@/lib/song-limits";
import { getEffectiveSongLimit } from "@/lib/server/song-limits-server";
import { createSong } from "@/lib/actions";

async function create(formData: FormData) {
  "use server";
  const res = await createSong(formData);
  if (res.ok && res.data) redirect(`/library/songs/${res.data.id}`);
}

export default async function SongsPage() {
  const user = await requireUser();
  const [songs, limit, usage] = await Promise.all([
    listSongs(user.churchId),
    getEffectiveSongLimit(user.churchId),
    getSongUsage(user.churchId),
  ]);

  // Detection testing panel: dev-only or dogfooders. Kept off the volunteer view.
  const showDebug = process.env.NODE_ENV === "development" || user.email?.endsWith("@presentflow.dev");
  const atLimit = usage >= limit;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Songs"
        action={<SongImporter />}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {songs.length} song{songs.length === 1 ? "" : "s"} in library
        </div>
        <TidyAllSongsButton count={songs.length} />
      </div>

      <form action={create} className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card/80 p-4">
        <input
          name="title"
          placeholder="Song title"
          required
          className="h-10 max-w-xs flex-1 rounded-xl border border-border bg-background px-3 text-sm"
        />
        <input
          name="artist"
          placeholder="Artist (optional)"
          className="h-10 max-w-xs flex-1 rounded-xl border border-border bg-background px-3 text-sm"
        />
        <button className="h-10 rounded-xl bg-foreground px-4 text-sm font-semibold text-background">
          Create
        </button>
      </form>

      <SongsTable
        songs={songs.map((s) => ({
          id: s.id,
          title: s.title,
          artist: s.artist,
          source: s.source,
        }))}
      />

      {atLimit ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/80 p-4">
          <div className="text-sm">
            You&apos;ve used <span className="font-semibold">{usage}</span> of{" "}
            <span className="font-semibold">{limit}</span> songs. Upgrade for more.
          </div>
          <Link
            href="/settings/billing"
            className="inline-flex h-9 items-center rounded-xl bg-foreground px-4 text-sm font-semibold text-background hover:opacity-90"
          >
            Upgrade
          </Link>
        </div>
      ) : null}

      {showDebug ? (
        <details className="group rounded-2xl border border-border bg-card/40 open:bg-card/80 open:shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-2xl px-5 py-3 text-sm font-medium text-muted-foreground transition hover:bg-card/60 hover:text-foreground">
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center rounded bg-[var(--pf-admin-bg-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--pf-admin-text-muted)]">
                Admin · Debug
              </span>
              Detection testing panel
            </span>
            <span className="text-[11px] text-muted-foreground group-open:hidden">Show</span>
            <span className="hidden text-[11px] text-muted-foreground group-open:inline">Hide</span>
          </summary>
          <div className="border-t border-border p-5">
            <InternetSongDetectionPanel totalSongs={songs.length} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
