"use client";
/**
 * Full service transcript on the archive detail page. The transcript is
 * captured live during the service (Fly.io audio bridge → transcript_segments)
 * but was never rendered anywhere before — only the LLM summary was. This
 * shows the raw text, collapsed by default (it can be long), with copy.
 */
import { useState } from "react";
import { ChevronDown, Copy, Check, FileText } from "lucide-react";
import { toast } from "sonner";

export function TranscriptSection({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Transcript copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select and copy manually");
    }
  };

  return (
    <section className="border border-border rounded-md bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-border text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
        aria-expanded={open}
      >
        <FileText className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="eyebrow text-muted-foreground">Full transcript</span>
        {text ? (
          <span className="text-[10px] text-muted-foreground font-mono">{wordCount.toLocaleString()} words</span>
        ) : null}
        <ChevronDown className={`ml-auto w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="p-4">
          {text ? (
            <>
              <div className="flex justify-end mb-2">
                <button
                  type="button"
                  onClick={copy}
                  className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md border border-border text-xs font-medium hover:bg-accent"
                >
                  {copied ? <Check className="w-3 h-3 text-[var(--pf-admin-green,green)]" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="max-h-[420px] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                {text}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground leading-relaxed">
              No transcript was captured for this service. A transcript is only
              recorded when the service is run with <strong>AI Listening</strong> connected,
              and it&apos;s finalized when you press <strong>Stop</strong> at the end (closing
              the tab or cutting power can skip it). The summary above was
              generated from whatever was captured.
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
