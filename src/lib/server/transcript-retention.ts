import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

export async function pruneTranscripts() {
  const db = getDb();
  const started = Date.now();
  const churches = (await db.execute(sql`
    SELECT church_id, transcript_retention_days AS days
    FROM church_preferences
    WHERE transcript_retention_days > 0
  `)).rows as { church_id: string; days: number }[];
  let totalDeleted = 0;
  const errors: { churchId: string; error: string }[] = [];
  for (const church of churches) {
    try {
      const result = await db.execute(sql`
        DELETE FROM transcript_segments ts
        USING service_plans sp
        WHERE ts.service_plan_id = sp.id
          AND sp.church_id = ${church.church_id}
          AND ts.ts < NOW() - (${church.days} || ' days')::interval
      `);
      const deleted = (result as unknown as { rowCount?: number }).rowCount ?? 0;
      totalDeleted += deleted;
      console.log(JSON.stringify({ event: "prune.church.ok", churchId: church.church_id, days: church.days, deleted }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ churchId: church.church_id, error: message });
      console.error(JSON.stringify({ event: "prune.church.error", churchId: church.church_id, error: message }));
    }
  }
  return { churches: churches.length, totalDeleted, errors, elapsedMs: Date.now() - started };
}
