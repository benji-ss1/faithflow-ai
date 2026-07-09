import { notFound } from "next/navigation";
import { and, eq, asc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { songs, songSlides } from "@/lib/db/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { SongSlideEditor } from "@/components/library/SongSlideEditor";
import { SongLicensingPanel } from "@/components/library/SongLicensingPanel";

export default async function SongDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const [song] = await db.select().from(songs).where(and(eq(songs.id, id), eq(songs.churchId, user.churchId))).limit(1);
  if (!song) notFound();
  const slides = await db.select().from(songSlides).where(eq(songSlides.songId, song.id)).orderBy(asc(songSlides.order));
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Song"
        title={song.title}
        description={`${song.artist ? `${song.artist} · ` : ""}${song.source === "public_domain" ? "Public-domain song" : song.source === "imported" ? "Imported church-owned content" : "Church-owned lyric entry"}`}
      />
      <SongLicensingPanel songCount={1} importedCount={song.source === "imported" ? 1 : 0} />
      <SongSlideEditor songId={song.id} initialSlides={slides.map((s) => ({ lyrics: s.lyrics }))} />
    </div>
  );
}
