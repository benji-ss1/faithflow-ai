import { notFound } from "next/navigation";
import { and, eq, asc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { servicePlans, serviceItems } from "@/lib/db/schema";
import { listSongs, listMedia, listPptxImports } from "@/lib/server/services";
import { PlaylistEditor } from "@/components/services/PlaylistEditor";

export default async function PlanEditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const [plan] = await db.select().from(servicePlans).where(and(eq(servicePlans.id, id), eq(servicePlans.churchId, user.churchId))).limit(1);
  if (!plan) notFound();
  const items = await db.select().from(serviceItems).where(eq(serviceItems.servicePlanId, plan.id)).orderBy(asc(serviceItems.order));
  const [songs, media, pptx] = await Promise.all([
    listSongs(user.churchId),
    listMedia(user.churchId),
    listPptxImports(user.churchId),
  ]);
  return (
    <PlaylistEditor
      planId={plan.id}
      planTitle={plan.title}
      initialItems={items.map((i) => ({ id: i.id, order: i.order, type: i.type, title: i.title }))}
      songs={songs.map((s) => ({ id: s.id, title: s.title }))}
      media={media.map((m) => ({ id: m.id, fileName: m.fileName, kind: m.kind }))}
      pptx={pptx.map((p) => ({ id: p.id, originalFileName: p.originalFileName, status: p.status }))}
    />
  );
}
