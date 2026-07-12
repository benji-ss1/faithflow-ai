"use client";

// Practice Mode operator sandbox.
//
// Sandbox invariants (enforced by grep in CP7 verification):
//   - No BroadcastChannel to "presentflow-live" (see safePost / broadcast.ts).
//   - No server actions that write (updateAiSuggestionStatus, updateDetectionStatus,
//     createServicePlan, saveSlideObjects, etc.).
//   - No inserts/updates to service_plans / ai_suggestions / detected_references
//     / transcript_segments.
//   - All decisions live in local React state only.
//
// The pipeline reused is the SAME detectAll() the real operator uses, so the
// user can rehearse against realistic AI behaviour without any side-effects.
import { useEffect, useMemo, useRef, useState } from "react";
import { detectAll, type DetectAllResult } from "@/lib/ai-detection";
import type { IndexedSong } from "@/lib/ai-detection/lyric-fragment";
import type { PracticePreset, PracticeSegment } from "./presets";

type Decision = "approved" | "rejected";

type DetectionCard = {
  id: string;
  kind: "scripture" | "song" | "lyric" | "command" | "section";
  label: string;
  confidence?: number;
  atMs: number;
  segmentText: string;
  decision?: Decision;
  matchedExpected?: boolean;
};

type SessionSummary = {
  approved: number;
  rejected: number;
  untouched: number;
  totalDetections: number;
  expectedTotal: number;
  expectedMatched: number;
  missedCues: string[];
};

export default function PracticeConsole({
  churchId,
  presets,
}: {
  churchId: string;
  presets: PracticePreset[];
}) {
  const [presetId, setPresetId] = useState<string>(presets[0]?.id ?? "");
  const [customText, setCustomText] = useState<string>("");
  const [useCustom, setUseCustom] = useState(false);

  const [library, setLibrary] = useState<IndexedSong[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [cursor, setCursor] = useState(0); // segment index
  const [cards, setCards] = useState<DetectionCard[]>([]);
  const [ended, setEnded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    // Read-only fetch of the church's song library so lyric matching feels
    // real. This route does not write.
    fetch("/api/songs/library")
      .then((r) => r.json())
      .then((res) => {
        if (Array.isArray(res.songs)) setLibrary(res.songs as IndexedSong[]);
      })
      .catch(() => {})
      .finally(() => setLibraryLoaded(true));
  }, []);

  const activeSegments: PracticeSegment[] = useMemo(() => {
    if (useCustom) {
      const lines = customText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      return lines.map((text, i) => ({ tMs: i * 6000, text }));
    }
    return presets.find((p) => p.id === presetId)?.segments ?? [];
  }, [useCustom, customText, presets, presetId]);

  const totalSegments = activeSegments.length;

  const resetSession = () => {
    stopTimer();
    setCards([]);
    setCursor(0);
    setEnded(false);
    setPlaying(false);
  };

  useEffect(() => {
    // When the transcript source changes, wipe the session state.
    resetSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, useCustom]);

  function stopTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    cancelRef.current = true;
  }

  async function processSegmentAt(index: number): Promise<void> {
    const seg = activeSegments[index];
    if (!seg || !seg.text) return;
    const chunk = seg.text;
    try {
      const result: DetectAllResult = await detectAll(chunk, {
        churchId,
        library,
        hasVerseContext: false,
        hasSlideContext: false,
        hasSongContext: false,
      });
      const created = extractCards(result, seg);
      if (created.length > 0) {
        setCards((prev) => [...prev, ...created]);
      }
    } catch (err) {
      // Detector never throws in practice, but be defensive — the sandbox
      // must never crash the operator's practice run.
      console.warn("[practice] detectAll error:", err);
    }
  }

  useEffect(() => {
    if (!playing) return;
    cancelRef.current = false;
    let idx = cursor;

    const step = async () => {
      if (cancelRef.current) return;
      if (idx >= totalSegments) {
        setPlaying(false);
        setEnded(true);
        return;
      }
      const seg = activeSegments[idx];
      const next = activeSegments[idx + 1];
      await processSegmentAt(idx);
      setCursor(idx + 1);
      idx += 1;
      if (idx >= totalSegments) {
        setPlaying(false);
        setEnded(true);
        return;
      }
      const gapMs = Math.max(200, (next.tMs - seg.tMs) / speed);
      timerRef.current = setTimeout(step, gapMs);
    };

    // fire the first tick
    step();

    return () => stopTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const skip = async () => {
    if (cursor >= totalSegments) return;
    await processSegmentAt(cursor);
    const nextIdx = cursor + 1;
    setCursor(nextIdx);
    if (nextIdx >= totalSegments) {
      setPlaying(false);
      setEnded(true);
    }
  };

  const decide = (id: string, d: Decision) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, decision: d } : c)));
  };

  const summary: SessionSummary = useMemo(() => {
    const approved = cards.filter((c) => c.decision === "approved").length;
    const rejected = cards.filter((c) => c.decision === "rejected").length;
    const untouched = cards.length - approved - rejected;

    const expectedList = activeSegments
      .slice(0, cursor)
      .flatMap((s) => expectedLabelsFor(s));
    const expectedTotal = expectedList.length;

    const matchedLabels = new Set(
      cards.filter((c) => c.matchedExpected).map((c) => c.label.toLowerCase()),
    );
    const missed: string[] = [];
    for (const exp of expectedList) {
      if (!matchedLabels.has(exp.toLowerCase())) missed.push(exp);
    }
    return {
      approved,
      rejected,
      untouched,
      totalDetections: cards.length,
      expectedTotal,
      expectedMatched: expectedTotal - missed.length,
      missedCues: missed,
    };
  }, [cards, activeSegments, cursor]);

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      {/* Control panel */}
      <aside className="space-y-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Transcript</div>
          <div className="mt-2 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={!useCustom}
                onChange={() => setUseCustom(false)}
              />
              Preset
            </label>
            {!useCustom && (
              <select
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.segments.length} lines)
                  </option>
                ))}
              </select>
            )}
            {!useCustom && (
              <div className="text-xs text-muted-foreground">
                {presets.find((p) => p.id === presetId)?.description}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={useCustom}
                onChange={() => setUseCustom(true)}
              />
              Custom (one line per utterance)
            </label>
            {useCustom && (
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                rows={6}
                placeholder={"Welcome church.\nLet's sing Amazing Grace.\nTurn to John 3:16."}
                className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
              />
            )}
          </div>
        </div>

        <div className="border-t border-white/10 pt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Playback</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {!playing ? (
              <button
                disabled={totalSegments === 0 || cursor >= totalSegments}
                onClick={() => {
                  setEnded(false);
                  setPlaying(true);
                }}
                className="rounded-md bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
              >
                Play
              </button>
            ) : (
              <button
                onClick={() => setPlaying(false)}
                className="rounded-md bg-amber-500/90 px-3 py-1.5 text-sm font-medium text-black"
              >
                Pause
              </button>
            )}
            <button
              onClick={skip}
              disabled={cursor >= totalSegments}
              className="rounded-md border border-white/15 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Skip →
            </button>
            <button
              onClick={resetSession}
              className="rounded-md border border-white/15 px-3 py-1.5 text-sm"
            >
              Reset
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[0.5, 1, 2, 5].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`rounded-md px-2 py-1 text-xs ${
                  speed === s
                    ? "bg-white/15 text-foreground"
                    : "border border-white/10 text-muted-foreground hover:bg-white/[0.05]"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Progress: {cursor} / {totalSegments}
          </div>
          {!libraryLoaded && (
            <div className="mt-2 text-[11px] text-muted-foreground">Loading song library…</div>
          )}
        </div>
      </aside>

      {/* Center canvas + right AI tab */}
      <div className="grid gap-4 md:grid-cols-[1fr_360px]">
        <div className="flex min-h-[320px] flex-col rounded-2xl border border-white/8 bg-black/40 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Simulated stage (no output)
          </div>
          <div className="mt-3 flex-1 rounded-lg border border-dashed border-white/15 bg-black/60 p-4 text-sm">
            {cursor === 0 ? (
              <div className="text-muted-foreground">Press Play to start walking through the transcript.</div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Latest utterance</div>
                <div className="text-base text-foreground">
                  {activeSegments[Math.max(0, cursor - 1)]?.text || "(silence)"}
                </div>
              </div>
            )}
          </div>
          {ended && (
            <SummaryBlock summary={summary} />
          )}
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            AI suggestions ({cards.length})
          </div>
          <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {cards.length === 0 && (
              <div className="text-xs text-muted-foreground">No detections yet.</div>
            )}
            {cards.map((c) => (
              <div
                key={c.id}
                className={`rounded-lg border p-3 text-sm ${
                  c.decision === "approved"
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : c.decision === "rejected"
                    ? "border-rose-500/40 bg-rose-500/10 opacity-70"
                    : "border-white/10 bg-black/30"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {c.kind}
                    {c.matchedExpected && (
                      <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-200">expected</span>
                    )}
                  </div>
                  {typeof c.confidence === "number" && (
                    <div className="text-[10px] text-muted-foreground">{c.confidence}%</div>
                  )}
                </div>
                <div className="mt-1 font-medium text-foreground">{c.label}</div>
                <div className="mt-1 text-[11px] italic text-muted-foreground line-clamp-2">
                  “{c.segmentText}”
                </div>
                {!c.decision && (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => decide(c.id, "approved")}
                      className="rounded bg-emerald-500/80 px-2 py-1 text-xs font-medium text-black"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => decide(c.id, "rejected")}
                      className="rounded border border-white/15 px-2 py-1 text-xs"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryBlock({ summary }: { summary: SessionSummary }) {
  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-4 text-sm">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Practice session summary
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Detections" value={summary.totalDetections} />
        <Stat label="Approved" value={summary.approved} />
        <Stat label="Rejected" value={summary.rejected} />
        <Stat label="Untouched" value={summary.untouched} />
        <Stat label="Expected cues" value={summary.expectedTotal} />
        <Stat label="Matched expected" value={summary.expectedMatched} />
        <Stat label="Missed cues" value={summary.missedCues.length} />
      </div>
      {summary.missedCues.length > 0 && (
        <div className="mt-3 text-xs text-amber-200">
          Missed: {summary.missedCues.slice(0, 8).join(", ")}
          {summary.missedCues.length > 8 ? "…" : ""}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 p-2">
      <div className="text-lg font-semibold text-foreground tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function expectedLabelsFor(seg: PracticeSegment): string[] {
  const out: string[] = [];
  const e = seg.expected;
  if (!e) return out;
  if (e.scripture) {
    const s = e.scripture;
    out.push(`${s.book} ${s.ch}:${s.vs}${s.ve && s.ve !== s.vs ? `-${s.ve}` : ""}`);
  }
  if (e.song) out.push(e.song);
  if (e.command) out.push(`cmd:${e.command}`);
  return out;
}

function extractCards(res: DetectAllResult, seg: PracticeSegment): DetectionCard[] {
  const cards: DetectionCard[] = [];
  const expLabels = new Set(expectedLabelsFor(seg).map((s) => s.toLowerCase()));

  for (const s of res.scripture) {
    const label = `${s.book} ${s.chapter}:${s.verseStart}${s.verseEnd && s.verseEnd !== s.verseStart ? `-${s.verseEnd}` : ""}`;
    cards.push({
      id: cryptoRandomId(),
      kind: "scripture",
      label,
      confidence: s.confidence,
      atMs: seg.tMs,
      segmentText: seg.text,
      matchedExpected: expLabels.has(label.toLowerCase()),
    });
  }
  for (const m of res.song) {
    cards.push({
      id: cryptoRandomId(),
      kind: "song",
      label: m.title,
      confidence: m.confidence,
      atMs: seg.tMs,
      segmentText: seg.text,
      matchedExpected: expLabels.has(m.title.toLowerCase()),
    });
  }
  for (const m of res.lyric) {
    cards.push({
      id: cryptoRandomId(),
      kind: "lyric",
      label: m.title,
      confidence: m.confidence,
      atMs: seg.tMs,
      segmentText: seg.text,
      matchedExpected: expLabels.has(m.title.toLowerCase()),
    });
  }
  for (const c of res.command) {
    cards.push({
      id: cryptoRandomId(),
      kind: "command",
      label: c.verb,
      confidence: c.confidence,
      atMs: seg.tMs,
      segmentText: seg.text,
      matchedExpected: expLabels.has(`cmd:${c.verb}`.toLowerCase()),
    });
  }
  for (const s of res.section) {
    const label = s.section === "verse" && s.index ? `Jump: verse ${s.index}` : `Jump: ${s.section}`;
    cards.push({
      id: cryptoRandomId(),
      kind: "section",
      label,
      confidence: s.confidence,
      atMs: seg.tMs,
      segmentText: seg.text,
    });
  }
  return cards;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}
