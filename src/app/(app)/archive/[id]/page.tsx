import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getSermonSummary } from "@/lib/server/sermon-summary";
import { PageHeader } from "@/components/layout/PageHeader";

export default async function SermonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const row = await getSermonSummary(user.churchId, id);
  if (!row) notFound();

  const kp = (row as Record<string, unknown>).key_points as string[] || [];
  const nq = (row as Record<string, unknown>).notable_quotes as string[] || [];
  const ap = (row as Record<string, unknown>).action_points as string[] || [];
  const sl = (row as Record<string, unknown>).scripture_list as { book: string; chapter: number; verseStart: number; verseEnd: number }[] || [];

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow={`From ${row.planTitle}`} title={row.title}
        action={
          <div className="flex gap-2">
            <a href={`/api/archive/${id}/export?format=txt`} className="h-9 px-3 border border-border rounded-md text-xs font-semibold hover:bg-accent inline-flex items-center">Export .txt</a>
            <Link href="/archive" className="h-9 px-3 border border-border rounded-md text-xs font-semibold hover:bg-accent inline-flex items-center">Back</Link>
          </div>
        }
      />

      <div className="space-y-4">
        <Section title="Overview">
          <p className="text-sm leading-relaxed">{row.overview}</p>
        </Section>

        {kp.length > 0 && (
          <Section title="Key points">
            <ul className="list-disc pl-5 text-sm space-y-1">{kp.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </Section>
        )}

        {sl.length > 0 && (
          <Section title="Scripture referenced">
            <ul className="flex flex-wrap gap-1.5">
              {sl.map((r, i) => (
                <li key={i} className="font-mono text-xs px-2 py-1 rounded-sm border border-border">
                  {r.book} {r.chapter}:{r.verseStart}{r.verseStart !== r.verseEnd ? `-${r.verseEnd}` : ""}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {nq.length > 0 && (
          <Section title="Notable quotes">
            <ul className="space-y-2 text-sm italic border-l-2 border-border pl-4">{nq.map((q, i) => <li key={i}>“{q}”</li>)}</ul>
          </Section>
        )}

        {ap.length > 0 && (
          <Section title="Action points">
            <ul className="list-disc pl-5 text-sm space-y-1">{ap.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </Section>
        )}

        <p className="text-[10px] text-muted-foreground pt-4">
          Model: {String((row as Record<string, unknown>).model || "unknown")} · Word count: {String((row as Record<string, unknown>).word_count || 0)} · Generated {new Date(String((row as Record<string, unknown>).generated_at || Date.now())).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-border rounded-md bg-card">
      <header className="px-4 py-2.5 border-b border-border">
        <div className="eyebrow text-muted-foreground">{title}</div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
