import { requireUser } from "@/lib/session";
import { listMedia } from "@/lib/server/services";
import { presignGet } from "@/lib/s3";
import { PageHeader } from "@/components/layout/PageHeader";
import { MediaUploader } from "@/components/library/MediaUploader";
import { MediaCard } from "@/components/library/MediaCard";

export default async function MediaPage() {
  const user = await requireUser();
  const media = await listMedia(user.churchId);
  const withUrls = await Promise.all(media.map(async (m) => ({ ...m, url: await presignGet(m.s3Key) })));
  return (
    <div>
      <PageHeader eyebrow="Library" title="Media" action={<MediaUploader purpose="media" />} />
      {withUrls.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">
          No media uploaded yet. Use the &ldquo;Upload media&rdquo; button above to add images or videos.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {withUrls.map((m) => (
            <MediaCard key={m.id} item={{ id: m.id, kind: m.kind, fileName: m.fileName, url: m.url }} />
          ))}
        </ul>
      )}
    </div>
  );
}
