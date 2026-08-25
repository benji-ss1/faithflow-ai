import { notFound } from "next/navigation";
import { and, eq, asc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { songs, songSlides } from "@/lib/db/schema";
import { SongTitleEditor } from "@/components/library/SongTitleEditor";
import { SongSlideEditor } from "@/components/library/SongSlideEditor";
import { SongLicensingPanel } from "@/components/library/SongLicensingPanel";
import { TidySlidesButton } from "@/components/library/TidySlidesButton";
import { sanitizeLyrics } from "@/lib/pro6-parser";

export default async function SongDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const [song] = await db.select().from(songs).where(and(eq(songs.id, id), eq(songs.churchId, user.churchId))).limit(1);
  if (!song) notFound();
  const slides = await db.select().from(songSlides).where(eq(songSlides.songId, song.id)).orderBy(asc(songSlides.order));
  return (
    <div className="space-y-8">
      <SongTitleEditor
        songId={song.id}
        initialTitle={song.title}
        description={`${song.artist ? `${song.artist} · ` : ""}${song.source === "public_domain" ? "Public-domain song" : song.source === "imported" ? "Imported church-owned content" : "Church-owned lyric entry"}`}
      />
      <SongLicensingPanel songCount={1} importedCount={song.source === "imported" ? 1 : 0} />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--color-foreground)]">Slides</h2>
        <TidySlidesButton songId={song.id} />
      </div>
      <SongSlideEditor songId={song.id} initialSlides={slides.map((s) => ({ lyrics: sanitizeLyrics(s.lyrics) }))} />
    </div>
  );
}
