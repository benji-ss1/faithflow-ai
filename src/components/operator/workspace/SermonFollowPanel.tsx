"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Zap, Eye, Send, X, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SlidePayload } from "@/lib/broadcast";

type MatchHit = { slideIdx: number; confidence: number; matchedText: string };
type MatchResponse = { current: MatchHit | null; next: MatchHit | null; source: "text" | "embedding" | "hybrid" };

type Props = {
  pptxImportId: string | null;
  slides: SlidePayload[];
  listening: boolean;
  transcriptText: string; // recent window of transcript text
  currentSlideIdx: number;
  autopilotActive: boolean;
  onJumpSlide: (slideIdx: number) => void;
  onSendPreview: (slide: SlidePayload) => void;
  onSendLive: (slide: SlidePayload) => void;
};

const DISABLED_KEY_PREFIX = "presentflow.sermonFollow.disabled.";

export function SermonFollowPanel({
  pptxImportId, slides, listening, transcriptText, currentSlideIdx,
  autopilotActive, onJumpSlide, onSendPreview, onSendLive,
}: Props) {
  const [suggestion, setSuggestion] = useState<MatchResponse | null>(null);
  const [rejectedIdx, setRejectedIdx] = useState<number | null>(null);
  const [disabled, setDisabled] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTranscriptRef = useRef<string>("");

  // Load per-deck disabled preference
  useEffect(() => {
    if (!pptxImportId) return;
    try {
      setDisabled(!!window.localStorage.getItem(DISABLED_KEY_PREFIX + pptxImportId));
    } catch { /* noop */ }
  }, [pptxImportId]);

  const fetchMatch = useCallback(async () => {
    if (!pptxImportId) return;
    const tw = lastTranscriptRef.current.trim();
    if (tw.length < 15) return;
    try {
      const res = await fetch("/api/sermon/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pptxImportId, transcriptWindow: tw, currentSlideIdx }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as MatchResponse;
      setSuggestion(data);
    } catch { /* noop */ }
  }, [pptxImportId, currentSlideIdx]);

  useEffect(() => { lastTranscriptRef.current = transcriptText; }, [transcriptText]);

  useEffect(() => {
    if (!listening || disabled || !pptxImportId) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    fetchMatch();
    timerRef.current = setInterval(fetchMatch, 4000);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [listening, disabled, pptxImportId, fetchMatch]);

  const cur = suggestion?.current;
  const nxt = suggestion?.next;

  // Autopilot Active: auto-preview when confidence is high enough and it's a
  // forward move. Never auto-send to live unless explicitly requested by op.
  useEffect(() => {
    if (!autopilotActive || !cur || disabled) return;
    if (cur.confidence < 80) return;
    if (cur.slideIdx === currentSlideIdx) return;
    const target = slides[cur.slideIdx];
    if (!target) return;
    onSendPreview(target);
    onJumpSlide(cur.slideIdx);
    // one-shot per suggestion — clear so we don't loop
    setSuggestion(null);
  }, [autopilotActive, cur, disabled, currentSlideIdx, slides, onSendPreview, onJumpSlide]);

  if (!pptxImportId || disabled) return (
    <FollowChrome disabled={disabled} pptxImportId={pptxImportId} onToggle={(v) => {
      setDisabled(v);
      if (!pptxImportId) return;
      try {
        if (v) window.localStorage.setItem(DISABLED_KEY_PREFIX + pptxImportId, "1");
        else window.localStorage.removeItem(DISABLED_KEY_PREFIX + pptxImportId);
      } catch { /* noop */ }
    }} />
  );

  if (!cur || !listening) return null;
  if (rejectedIdx === cur.slideIdx) return null;

  return (
    <div className="absolute bottom-3 right-3 z-20 w-80 rounded-md border shadow-lg overflow-hidden"
      style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}>
      <header className="px-3 py-2 flex items-center gap-2 border-b" style={{ borderColor: "var(--color-border)" }}>
        <Zap className="w-3.5 h-3.5 text-[color:var(--color-warning)]" />
        <div className="text-[10px] font-bold uppercase tracking-wider">Sermon follow</div>
        <span className="ml-auto text-[9px] font-mono opacity-60">{suggestion?.source ?? "text"}</span>
        <button title="Disable follow for this deck" onClick={() => {
          setDisabled(true);
          try { if (pptxImportId) window.localStorage.setItem(DISABLED_KEY_PREFIX + pptxImportId, "1"); } catch { /* noop */ }
        }} className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]">
          <EyeOff className="w-3 h-3" />
        </button>
      </header>
      <div className="p-3 space-y-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)]">Now on</div>
          <div className="text-sm font-semibold">Slide {cur.slideIdx + 1} <span className="text-xs font-mono opacity-70">· {cur.confidence}%</span></div>
          {cur.matchedText && <div className="text-[11px] text-[color:var(--color-muted-foreground)] line-clamp-2 mt-0.5">"{cur.matchedText}"</div>}
        </div>
        {nxt && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)]">Next likely</div>
            <div className="text-xs">Slide {nxt.slideIdx + 1} <span className="font-mono opacity-70">· {nxt.confidence}%</span></div>
          </div>
        )}
        <div className="flex items-center gap-1.5 pt-1">
          <button onClick={() => { const s = slides[cur.slideIdx]; if (s) { onSendPreview(s); onJumpSlide(cur.slideIdx); } }}
            className={cn("flex-1 h-7 rounded-md text-[10px] font-bold uppercase tracking-wider border inline-flex items-center justify-center gap-1",
              "border-[color:var(--color-brand)] text-[color:var(--color-brand)] hover:bg-[color:var(--color-brand)]/10")}>
            <Eye className="w-3 h-3" /> Preview
          </button>
          <button onClick={() => { const s = slides[cur.slideIdx]; if (s) { onSendLive(s); onJumpSlide(cur.slideIdx); } }}
            className="flex-1 h-7 rounded-md text-[10px] font-bold uppercase tracking-wider bg-[color:var(--color-destructive)] text-white hover:opacity-90 inline-flex items-center justify-center gap-1">
            <Send className="w-3 h-3" /> Live
          </button>
          <button onClick={() => setRejectedIdx(cur.slideIdx)} title="Reject this suggestion"
            className="h-7 w-7 rounded-md text-[color:var(--color-muted-foreground)] border border-[color:var(--color-border)] hover:bg-[color:var(--color-raised-shell)] inline-flex items-center justify-center">
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function FollowChrome({ disabled, pptxImportId, onToggle }: { disabled: boolean; pptxImportId: string | null; onToggle: (v: boolean) => void }) {
  if (!pptxImportId) return null;
  if (!disabled) return null;
  return (
    <div className="absolute bottom-3 right-3 z-20 rounded-md border px-3 py-1.5 text-[10px] font-semibold flex items-center gap-2"
      style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}>
      <EyeOff className="w-3 h-3 opacity-60" />
      Sermon follow disabled for this deck
      <button onClick={() => onToggle(false)} className="ml-2 underline opacity-70 hover:opacity-100">Re-enable</button>
    </div>
  );
}
