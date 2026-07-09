"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function ArchiveSearchBar({ defaultQuery, defaultMode }: { defaultQuery: string; defaultMode: "keyword" | "semantic" }) {
  const router = useRouter();
  const [q, setQ] = useState(defaultQuery);
  const [mode, setMode] = useState<"keyword" | "semantic">(defaultMode);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (mode === "semantic") params.set("mode", "semantic");
    router.push(`/archive${params.size ? "?" + params.toString() : ""}`);
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 mb-4">
      <div className="flex items-center border border-border rounded-md p-0.5">
        <button type="button" onClick={() => setMode("keyword")}
          className={cn("px-3 h-8 text-xs font-semibold rounded-sm transition-all", mode === "keyword" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent")}>
          <Search className="w-3 h-3 inline mr-1" /> Keyword
        </button>
        <button type="button" onClick={() => setMode("semantic")}
          className={cn("px-3 h-8 text-xs font-semibold rounded-sm transition-all", mode === "semantic" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent")}>
          <Sparkles className="w-3 h-3 inline mr-1" /> By meaning
        </button>
      </div>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={mode === "keyword" ? "Search titles + overviews…" : "What did the pastor say about…?"}
        className="h-9 flex-1 max-w-md px-3 border border-border rounded-md bg-background text-sm" />
      <button type="submit" className="h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold">Search</button>
      {q && (
        <button type="button" onClick={() => { setQ(""); router.push("/archive"); }}
          className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground">Clear</button>
      )}
    </form>
  );
}
