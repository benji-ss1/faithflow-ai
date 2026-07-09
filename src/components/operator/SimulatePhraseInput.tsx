"use client";
import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

// Phase 5A — testing helper. Runs the exact same detectAll pipeline as the
// live audio path (via useAudioStream.simulateTranscript). NEVER hits the
// network or an external API.

const PRESETS = [
  "John 3:16",
  "John chapter three verse sixteen",
  "Let's sing Amazing Grace",
  "what a God what a God",
  "go to the chorus",
  "show verse two",
  "unknown lyric that does not match anything",
];

export function SimulatePhraseInput({ onSimulate }: { onSimulate: (text: string) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  const submit = (t: string) => {
    const trimmed = t.trim();
    if (!trimmed) return;
    onSimulate(trimmed);
    setText("");
  };

  return (
    <div className="border-t border-border bg-muted/20">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent"
      >
        <FlaskConical className="w-3 h-3" /> Test · Simulate phrase {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2">
          <div className="flex gap-1.5">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(text); }}
              placeholder="Type a phrase and press Enter…"
              className="flex-1 h-8 px-2 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-foreground"
            />
            <button
              onClick={() => submit(text)}
              className={cn(
                "h-8 px-3 rounded-md border border-border text-[11px] font-semibold uppercase tracking-wider",
                "hover:bg-accent"
              )}
            >
              Simulate
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => submit(p)}
                title="Run this phrase through the detection pipeline"
                className="text-[10px] px-2 py-0.5 rounded-full border border-border hover:bg-accent text-muted-foreground"
              >
                {p}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground italic">
            Runs the same detectAll pipeline as live audio. No network calls.
          </p>
        </div>
      )}
    </div>
  );
}
