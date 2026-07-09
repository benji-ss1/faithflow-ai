import { requireUser } from "@/lib/session";
import { listMedia } from "@/lib/server/services";
import { presignGet } from "@/lib/s3";
import { PageHeader } from "@/components/layout/PageHeader";
import { MediaUploader } from "@/components/library/MediaUploader";

export default async function MediaPage() {
  const user = await requireUser();
  const media = await listMedia(user.churchId);
  const withUrls = await Promise.all(media.map(async (m) => ({ ...m, url: await presignGet(m.s3Key) })));
  return (
    <div>
      <PageHeader eyebrow="Library" title="Media" action={<MediaUploader purpose="media" />} />
      {withUrls.length === 0 ? (
        <div className="text-sm text-muted-foreground">No media uploaded.</div>
      ) : (
        <ul className="grid grid-cols-3 gap-3">
          {withUrls.map((m) => (
            <li key={m.id} className="border border-border rounded-md overflow-hidden bg-card">
              <div className="aspect-video bg-black flex items-center justify-center">
                {m.kind === "image"
                  ? <img src={m.url} alt="" className="w-full h-full object-contain" />
                  : <video src={m.url} className="w-full h-full object-contain" muted />}
              </div>
              <div className="p-3">
                <div className="eyebrow text-muted-foreground">{m.kind}</div>
                <div className="text-sm font-medium truncate">{m.fileName}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
