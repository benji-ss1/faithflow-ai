import { apiUser } from "@/lib/session";
import { getSermonSummary } from "@/lib/server/sermon-summary";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return new Response("Session expired", { status: 401 });
  const { id } = await ctx.params;
  const row = await getSermonSummary(user.churchId, id);
  if (!row) return new Response("Not found", { status: 404 });

  const r = row as unknown as Record<string, unknown>;
  const kp = r.key_points as string[] || [];
  const nq = r.notable_quotes as string[] || [];
  const ap = r.action_points as string[] || [];
  const sl = r.scripture_list as { book: string; chapter: number; verseStart: number; verseEnd: number }[] || [];

  const lines: string[] = [];
  lines.push(String(row.title));
  lines.push("=".repeat(String(row.title).length));
  lines.push("");
  lines.push(`From: ${row.planTitle}`);
  lines.push(`Generated: ${new Date(String(r.generated_at)).toLocaleString()}`);
  lines.push(`Model: ${String(r.model || "unknown")}`);
  lines.push("");
  lines.push("OVERVIEW");
  lines.push("--------");
  lines.push(row.overview);
  lines.push("");
  if (kp.length) {
    lines.push("KEY POINTS");
    lines.push("----------");
    for (const p of kp) lines.push(`* ${p}`);
    lines.push("");
  }
  if (sl.length) {
    lines.push("SCRIPTURE REFERENCED");
    lines.push("--------------------");
    for (const s of sl) lines.push(`* ${s.book} ${s.chapter}:${s.verseStart}${s.verseStart !== s.verseEnd ? `-${s.verseEnd}` : ""}`);
    lines.push("");
  }
  if (nq.length) {
    lines.push("NOTABLE QUOTES");
    lines.push("--------------");
    for (const q of nq) lines.push(`"${q}"`);
    lines.push("");
  }
  if (ap.length) {
    lines.push("ACTION POINTS");
    lines.push("-------------");
    for (const p of ap) lines.push(`* ${p}`);
    lines.push("");
  }

  const filename = String(row.title).replace(/[^\w-]+/g, "_").slice(0, 60) + ".txt";
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
