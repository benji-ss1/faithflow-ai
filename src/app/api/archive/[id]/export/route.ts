import { apiUser } from "@/lib/session";
import { getSermonSummary } from "@/lib/server/sermon-summary";

export const runtime = "nodejs";

type Fmt = "txt" | "md" | "html";

function pickFormat(url: string): Fmt {
  const q = new URL(url).searchParams.get("format")?.toLowerCase();
  if (q === "md" || q === "markdown") return "md";
  if (q === "html" || q === "pdf") return "html";
  return "txt";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return new Response("Session expired", { status: 401 });
  const { id } = await ctx.params;
  const row = await getSermonSummary(user.churchId, id);
  if (!row) return new Response("Not found", { status: 404 });

  const fmt = pickFormat(req.url);
  const r = row as unknown as Record<string, unknown>;
  const kp = (r.key_points as string[]) || [];
  const nq = (r.notable_quotes as string[]) || [];
  const ap = (r.action_points as string[]) || [];
  const sl = (r.scripture_list as { book: string; chapter: number; verseStart: number; verseEnd: number }[]) || [];
  const title = String(row.title);
  const planTitle = String(row.planTitle || "");
  const overview = String(row.overview || "");
  const generated = new Date(String(r.generated_at)).toLocaleString();
  const model = String(r.model || "unknown");

  const refFmt = (s: { book: string; chapter: number; verseStart: number; verseEnd: number }) =>
    `${s.book} ${s.chapter}:${s.verseStart}${s.verseStart !== s.verseEnd ? `-${s.verseEnd}` : ""}`;

  let body: string;
  let contentType: string;
  let ext: string;

  if (fmt === "md") {
    // Markdown opens cleanly in Word, Google Docs, Notion, GitHub — one
    // format that covers "give me an editable doc".
    const lines: string[] = [];
    lines.push(`# ${title}`, "");
    if (planTitle) lines.push(`_From: ${planTitle}_`, "");
    lines.push(`_Generated: ${generated} · Model: ${model}_`, "");
    lines.push("## Overview", "", overview, "");
    if (kp.length) {
      lines.push("## Key points", "");
      for (const p of kp) lines.push(`- ${p}`);
      lines.push("");
    }
    if (sl.length) {
      lines.push("## Scripture referenced", "");
      for (const s of sl) lines.push(`- ${refFmt(s)}`);
      lines.push("");
    }
    if (nq.length) {
      lines.push("## Notable quotes", "");
      for (const q of nq) lines.push(`> ${q}`);
      lines.push("");
    }
    if (ap.length) {
      lines.push("## Action points", "");
      for (const p of ap) lines.push(`- ${p}`);
      lines.push("");
    }
    body = lines.join("\n");
    contentType = "text/markdown; charset=utf-8";
    ext = "md";
  } else if (fmt === "html") {
    // Print-optimized HTML — user hits Cmd/Ctrl+P → Save as PDF. Avoids
    // shipping pdfkit; browser's native PDF engine is already excellent.
    const sections: string[] = [];
    sections.push(`<section><h2>Overview</h2><p>${esc(overview)}</p></section>`);
    if (kp.length) sections.push(`<section><h2>Key points</h2><ul>${kp.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></section>`);
    if (sl.length) sections.push(`<section><h2>Scripture referenced</h2><ul>${sl.map((s) => `<li>${esc(refFmt(s))}</li>`).join("")}</ul></section>`);
    if (nq.length) sections.push(`<section><h2>Notable quotes</h2>${nq.map((q) => `<blockquote>${esc(q)}</blockquote>`).join("")}</section>`);
    if (ap.length) sections.push(`<section><h2>Action points</h2><ul>${ap.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></section>`);
    body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #111; max-width: 720px; margin: 32px auto; padding: 0 24px; line-height: 1.55; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.06em; color: #444; margin: 24px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 12px; }
  blockquote { border-left: 3px solid #ccc; margin: 8px 0; padding: 2px 12px; color: #333; font-style: italic; }
  ul { padding-left: 20px; margin: 4px 0; } li { margin: 3px 0; }
  @media print { body { margin: 0; padding: 0 24px; } }
</style></head><body>
<h1>${esc(title)}</h1>
<div class="meta">${planTitle ? `From: ${esc(planTitle)} · ` : ""}Generated: ${esc(generated)} · Model: ${esc(model)}</div>
${sections.join("\n")}
<script>if (new URL(location.href).searchParams.get("print") === "1") window.addEventListener("load", () => setTimeout(() => print(), 200));</script>
</body></html>`;
    contentType = "text/html; charset=utf-8";
    ext = "html";
  } else {
    // Plain text — original format.
    const lines: string[] = [];
    lines.push(title, "=".repeat(title.length), "");
    if (planTitle) lines.push(`From: ${planTitle}`);
    lines.push(`Generated: ${generated}`, `Model: ${model}`, "");
    lines.push("OVERVIEW", "--------", overview, "");
    if (kp.length) {
      lines.push("KEY POINTS", "----------");
      for (const p of kp) lines.push(`* ${p}`);
      lines.push("");
    }
    if (sl.length) {
      lines.push("SCRIPTURE REFERENCED", "--------------------");
      for (const s of sl) lines.push(`* ${refFmt(s)}`);
      lines.push("");
    }
    if (nq.length) {
      lines.push("NOTABLE QUOTES", "--------------");
      for (const q of nq) lines.push(`"${q}"`);
      lines.push("");
    }
    if (ap.length) {
      lines.push("ACTION POINTS", "-------------");
      for (const p of ap) lines.push(`* ${p}`);
      lines.push("");
    }
    body = lines.join("\n");
    contentType = "text/plain; charset=utf-8";
    ext = "txt";
  }

  const safeName = title.replace(/[^\w-]+/g, "_").slice(0, 60) || "sermon";
  // HTML preview opens inline (so the ?print=1 hook can auto-open the
  // print dialog for PDF); md + txt download as attachments.
  const disp = fmt === "html" ? "inline" : `attachment; filename="${safeName}.${ext}"`;
  return new Response(body, {
    headers: { "Content-Type": contentType, "Content-Disposition": disp },
  });
}
