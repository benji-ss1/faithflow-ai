"use client";
/**
 * Chunk-level RAG Q&A over past service transcripts — distinct from the
 * per-sermon-summary keyword/semantic search above it on this page. Ask a
 * free-text question, get a Groq-composed answer grounded in the actual
 * retrieved transcript excerpts (shown below so the operator can verify,
 * not just trust the summary).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Source = { id: string; text: string; planTitle: string; scheduledFor: string | null; similarity: number };

export function AskSermonHistory() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Arrived here via the What's New modal's "Try it" link
  // (?highlight=ask-sermon-history) — pulse this box briefly so a tester's
  // eye actually lands on the new feature, then clean up the URL param.
  const [highlighted, setHighlighted] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("highlight") !== "ask-sermon-history") return;
    setHighlighted(true);
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const params = new URLSearchParams(searchParams.toString());
    params.delete("highlight");
    router.replace(params.size > 0 ? `?${params.toString()}` : "?", { scroll: false });
    const t = setTimeout(() => setHighlighted(false), 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = async () => {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setSources([]);
    try {
      const res = await fetch("/api/sermon/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Search failed"); return; }
      setAnswer(data.answer);
      setSources(data.sources || []);
    } catch {
      setError("Search failed — check your connection");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={boxRef}
      className={cn(
        "border border-border rounded-md p-4 bg-card mb-6 transition-shadow duration-500",
        highlighted && "ring-2 ring-[var(--color-brand)] shadow-[0_0_0_6px_var(--color-brand)]/15",
      )}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">Ask about past services</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Ask a question in plain language — searches the actual transcript of every past service, not just summaries.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
          placeholder="e.g. What has the pastor taught about forgiveness?"
          className="flex-1 h-9 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
        />
        <button
          type="button"
          onClick={ask}
          disabled={loading || !question.trim()}
          className="h-9 px-4 rounded-md bg-[var(--color-brand)] text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Ask
        </button>
      </div>
      {error && <div className="text-xs text-destructive mt-2">{error}</div>}
      {answer && (
        <div className="mt-3 text-sm whitespace-pre-wrap border-t border-border pt-3">{answer}</div>
      )}
      {sources.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Sources</div>
          {sources.map((s) => (
            <div key={s.id} className="text-xs border border-border rounded-sm p-2 bg-background">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold">{s.planTitle}{s.scheduledFor ? ` — ${new Date(s.scheduledFor).toLocaleDateString()}` : ""}</span>
                <span className="font-mono text-muted-foreground">{s.similarity}%</span>
              </div>
              <div className="text-muted-foreground line-clamp-3">{s.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
