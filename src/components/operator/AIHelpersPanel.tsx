"use client";
// Phase 5D-3 — compact "AI helpers" section that lives inside the AI tab.
// Five cards, each surfaces a `reason` string so the operator understands
// WHY the suggestion was made. All requests go through /api/ai/helpers/*.
// If GROQ_API_KEY is missing, every card shows a graceful disabled state.

import { useState } from "react";
import { Wand2, Sparkles, Type as TypeIcon, Megaphone, Wrench, Loader2, AlertCircle, Check } from "lucide-react";
import { useSlideEditorCtx } from "./editor/SlideEditorContext";
import type { EffectId } from "@/lib/effects";
import type { EditableSlide, TextObject } from "@/lib/slide-objects";

type ApiResp<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

async function call<T>(action: string, body: unknown): Promise<ApiResp<T>> {
  try {
    const r = await fetch(`/api/ai/helpers/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await r.json() as ApiResp<T>;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), code: "UPSTREAM" };
  }
}

export function AIHelpersPanel() {
  const editor = useSlideEditorCtx();
  const slide = editor?.currentSlide ?? null;
  const itemType = editor?.itemType ?? null;
  const selectedText = slide?.objects.find(
    (o) => o.kind === "text" && (!editor?.selectedObjectId || o.id === editor.selectedObjectId),
  ) as TextObject | undefined;
  const hasText = !!selectedText;
  const isSong = itemType === "song";

  return (
    <div className="border-t px-3 py-3 space-y-2" style={{ borderColor: "#2a3232" }}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-400 flex items-center gap-1">
        <Sparkles className="w-3 h-3" /> AI helpers
      </div>

      <ImproveReadabilityCard
        disabled={!hasText}
        text={selectedText?.text || ""}
        onApply={(newText) => {
          if (!selectedText || !editor) return;
          editor.updateObject(selectedText.id, { text: newText });
        }}
      />
      <FormatLyricsCard
        disabled={!isSong || !hasText}
        text={selectedText?.text || ""}
        onApply={(formatted) => {
          if (!selectedText || !editor) return;
          editor.updateObject(selectedText.id, { text: formatted });
        }}
      />
      <SuggestEffectCard
        disabled={!slide}
        slide={slide}
        itemType={itemType || "blank"}
        onApply={(effectId) => {
          if (!slide || !editor) return;
          editor.updateSlideDirect({
            transition: { effectId, durationMs: 400, easing: "ease-out" },
          });
        }}
      />
      <DraftAnnouncementCard />
      <FixSlideCard
        disabled={!slide || !isSong}
        slide={slide}
        onApplyPatch={(patch) => {
          if (!editor) return;
          editor.updateSlideDirect(patch);
        }}
      />
    </div>
  );
}

// ---------- Shared UI bits --------------------------------------------------

function CardShell({ icon: Icon, title, desc, children }: {
  icon: typeof Wand2; title: string; desc: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-2 space-y-1.5" style={{ borderColor: "#2a3232", background: "#171c1c" }}>
      <div className="flex items-start gap-1.5">
        <Icon className="w-3.5 h-3.5 mt-0.5 text-teal-300 shrink-0" />
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-zinc-100 truncate" title={title}>{title}</div>
          <div className="text-[10px] text-zinc-500 leading-tight">{desc}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function PrimaryBtn({ children, onClick, loading, disabled, title }: {
  children: React.ReactNode; onClick: () => void; loading?: boolean; disabled?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className="w-full h-7 rounded-md border text-[10px] font-bold uppercase tracking-wider inline-flex items-center justify-center gap-1 bg-teal-500/15 border-teal-500/40 text-teal-200 disabled:opacity-40 focus-visible:ring-1 focus-visible:ring-teal-400/50 focus-visible:outline-none"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
      {children}
    </button>
  );
}

function ErrorLine({ code, error }: { code: string; error: string }) {
  if (code === "MISSING_API_KEY") {
    return (
      <div className="text-[10px] text-amber-300 flex items-start gap-1">
        <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
        <span>Groq API key required.{" "}
          <a href="/settings" className="underline">Add it in Settings</a>.
        </span>
      </div>
    );
  }
  if (code === "RATE_LIMITED") return <div className="text-[10px] text-amber-300">Slow down — 10 requests per minute limit.</div>;
  return <div className="text-[10px] text-red-300 truncate" title={error}>{error}</div>;
}

function ReasonLine({ text }: { text: string }) {
  if (!text) return null;
  return <div className="text-[10px] text-zinc-400 italic leading-tight">Why: {text}</div>;
}

// ---------- Cards ----------------------------------------------------------

function ImproveReadabilityCard({ disabled, text, onApply }: { disabled: boolean; text: string; onApply: (t: string) => void }) {
  const [state, setState] = useState<{ loading: boolean; data?: { suggestions: string[]; reason: string }; err?: { code: string; error: string } }>({ loading: false });
  async function run() {
    setState({ loading: true });
    const r = await call<{ suggestions: string[]; reason: string }>("improve_readability", { text });
    if (r.ok) setState({ loading: false, data: r.data });
    else setState({ loading: false, err: { code: r.code, error: r.error } });
  }
  return (
    <CardShell icon={TypeIcon} title="Improve readability" desc="Rewrite selected text for on-screen clarity.">
      <PrimaryBtn onClick={run} loading={state.loading} disabled={disabled}
        title={disabled ? "Select a text object first" : "Suggest rewrites"}>
        Suggest rewrites
      </PrimaryBtn>
      {state.err && <ErrorLine code={state.err.code} error={state.err.error} />}
      {state.data && (
        <div className="space-y-1">
          <ReasonLine text={state.data.reason} />
          {state.data.suggestions.map((s, i) => (
            <div key={i} className="rounded border p-1.5 space-y-1" style={{ borderColor: "#2a3232" }}>
              <div className="text-[11px] text-zinc-200 whitespace-pre-wrap">{s}</div>
              <button onClick={() => onApply(s)}
                className="text-[10px] font-bold uppercase tracking-wider text-teal-300 hover:text-teal-100">
                Apply
              </button>
            </div>
          ))}
          {state.data.suggestions.length === 0 && <div className="text-[10px] text-zinc-500">No suggestions.</div>}
        </div>
      )}
    </CardShell>
  );
}

function FormatLyricsCard({ disabled, text, onApply }: { disabled: boolean; text: string; onApply: (t: string) => void }) {
  const [state, setState] = useState<{ loading: boolean; data?: { formatted: string; sections: { name: string; lines: string[] }[] }; err?: { code: string; error: string } }>({ loading: false });
  async function run() {
    setState({ loading: true });
    const r = await call<{ formatted: string; sections: { name: string; lines: string[] }[] }>("format_lyrics", { text });
    if (r.ok) setState({ loading: false, data: r.data });
    else setState({ loading: false, err: { code: r.code, error: r.error } });
  }
  return (
    <CardShell icon={Wand2} title="Format lyrics" desc="Split into Verse / Chorus / Bridge (song text only).">
      <PrimaryBtn onClick={run} loading={state.loading} disabled={disabled}
        title={disabled ? "Available on song slides with text" : "Format"}>
        Format
      </PrimaryBtn>
      {state.err && <ErrorLine code={state.err.code} error={state.err.error} />}
      {state.data && (
        <div className="space-y-1">
          <div className="text-[10px] text-zinc-500">{state.data.sections.length} section{state.data.sections.length === 1 ? "" : "s"} detected</div>
          <div className="max-h-32 overflow-auto rounded border p-1.5 text-[11px] text-zinc-200 whitespace-pre-wrap" style={{ borderColor: "#2a3232" }}>
            {state.data.formatted}
          </div>
          <button onClick={() => onApply(state.data!.formatted)}
            className="text-[10px] font-bold uppercase tracking-wider text-teal-300 hover:text-teal-100">
            Apply to slide
          </button>
        </div>
      )}
    </CardShell>
  );
}

function SuggestEffectCard({ disabled, slide, itemType, onApply }: { disabled: boolean; slide: EditableSlide | null; itemType: string; onApply: (id: EffectId) => void }) {
  const [state, setState] = useState<{ loading: boolean; data?: { effectId: EffectId; reason: string; alt: EffectId[] }; err?: { code: string; error: string } }>({ loading: false });
  async function run() {
    setState({ loading: true });
    const textPreview = slide?.objects
      .filter((o) => o.kind === "text")
      .map((o) => (o as TextObject).text)
      .join(" ")
      .slice(0, 300) || "";
    const r = await call<{ effectId: EffectId; reason: string; alt: EffectId[] }>("suggest_effect", {
      slide: { textPreview, itemType },
    });
    if (r.ok) setState({ loading: false, data: r.data });
    else setState({ loading: false, err: { code: r.code, error: r.error } });
  }
  return (
    <CardShell icon={Sparkles} title="Suggest effect" desc="Pick a transition that fits this slide.">
      <PrimaryBtn onClick={run} loading={state.loading} disabled={disabled}
        title={disabled ? "Select a slide first" : "Suggest"}>
        Suggest
      </PrimaryBtn>
      {state.err && <ErrorLine code={state.err.code} error={state.err.error} />}
      {state.data && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] text-zinc-100 font-medium">{state.data.effectId.replace(/_/g, " ")}</span>
            <button onClick={() => onApply(state.data!.effectId)}
              className="text-[10px] font-bold uppercase tracking-wider text-teal-300 hover:text-teal-100">
              Apply
            </button>
          </div>
          <ReasonLine text={state.data.reason} />
          {state.data.alt.length > 0 && (
            <div className="text-[10px] text-zinc-500">
              Alt: {state.data.alt.map((a) => a.replace(/_/g, " ")).join(", ")}
            </div>
          )}
        </div>
      )}
    </CardShell>
  );
}

function DraftAnnouncementCard() {
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<"warm" | "formal" | "urgent" | "celebratory">("warm");
  const [state, setState] = useState<{ loading: boolean; data?: { line1: string; line2: string; reason: string }; err?: { code: string; error: string } }>({ loading: false });
  const [filled, setFilled] = useState(false);
  async function run() {
    setState({ loading: true });
    const r = await call<{ line1: string; line2: string; reason: string }>("draft_announcement", { topic, tone });
    if (r.ok) setState({ loading: false, data: r.data });
    else setState({ loading: false, err: { code: r.code, error: r.error } });
  }
  function fillAnnounceTab() {
    if (!state.data) return;
    try {
      window.dispatchEvent(new CustomEvent("faithflow:draft-announcement", {
        detail: { line1: state.data.line1, line2: state.data.line2 },
      }));
      setFilled(true);
      setTimeout(() => setFilled(false), 2000);
    } catch { /* noop */ }
  }
  return (
    <CardShell icon={Megaphone} title="Draft announcement" desc="Two-line lower-third from a topic + tone.">
      <input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Topic (e.g. potluck Sunday)"
        className="w-full h-6 px-1.5 rounded border text-[11px] bg-transparent text-zinc-100 focus-visible:ring-1 focus-visible:ring-teal-400/50 focus-visible:outline-none"
        style={{ borderColor: "#2a3232" }}
      />
      <div className="flex gap-1 flex-wrap">
        {(["warm", "formal", "urgent", "celebratory"] as const).map((t) => (
          <button key={t} onClick={() => setTone(t)}
            className={`h-5 px-2 rounded-full text-[9px] font-semibold uppercase tracking-wider border ${tone === t ? "bg-teal-500/20 border-teal-500/60 text-teal-100" : "border-zinc-700 text-zinc-400 hover:text-zinc-100"}`}>
            {t}
          </button>
        ))}
      </div>
      <PrimaryBtn onClick={run} loading={state.loading} title="Draft announcement">
        Draft
      </PrimaryBtn>
      {state.err && <ErrorLine code={state.err.code} error={state.err.error} />}
      {state.data && (
        <div className="space-y-1">
          <div className="rounded border p-1.5 space-y-0.5" style={{ borderColor: "#2a3232" }}>
            <div className="text-[11px] font-semibold text-zinc-100">{state.data.line1}</div>
            <div className="text-[10px] text-zinc-300">{state.data.line2}</div>
          </div>
          <ReasonLine text={state.data.reason} />
          <button onClick={fillAnnounceTab}
            className="text-[10px] font-bold uppercase tracking-wider text-teal-300 hover:text-teal-100 inline-flex items-center gap-1">
            {filled ? <><Check className="w-3 h-3" /> Sent</> : "Fill Announce tab"}
          </button>
        </div>
      )}
    </CardShell>
  );
}

function FixSlideCard({ disabled, slide, onApplyPatch }: { disabled: boolean; slide: EditableSlide | null; onApplyPatch: (p: Partial<EditableSlide>) => void }) {
  const [state, setState] = useState<{ loading: boolean; data?: { patch: Partial<EditableSlide>; reason: string; warnings: string[] }; err?: { code: string; error: string } }>({ loading: false });
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());
  async function run() {
    if (!slide) return;
    setState({ loading: true });
    setAppliedKeys(new Set());
    const r = await call<{ patch: Partial<EditableSlide>; reason: string; warnings: string[] }>("fix_slide", { slide });
    if (r.ok) setState({ loading: false, data: r.data });
    else setState({ loading: false, err: { code: r.code, error: r.error } });
  }
  const patchEntries = state.data ? Object.entries(state.data.patch) : [];
  return (
    <CardShell icon={Wrench} title="Fix this slide" desc="Review the slide and propose fixes.">
      <PrimaryBtn onClick={run} loading={state.loading} disabled={disabled}
        title={disabled ? "Select a song slide first" : "Fix"}>
        Fix
      </PrimaryBtn>
      {state.err && <ErrorLine code={state.err.code} error={state.err.error} />}
      {state.data && (
        <div className="space-y-1">
          <ReasonLine text={state.data.reason} />
          {state.data.warnings.length > 0 && (
            <ul className="text-[10px] text-amber-200/90 list-disc pl-3 space-y-0.5">
              {state.data.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {patchEntries.length > 0 && (
            <>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Proposed changes</div>
              {patchEntries.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-1 rounded border p-1" style={{ borderColor: "#2a3232" }}>
                  <span className="text-[10px] font-mono text-zinc-300 truncate">{k}: {String(v)}</span>
                  <button
                    onClick={() => { onApplyPatch({ [k]: v } as Partial<EditableSlide>); setAppliedKeys((s) => new Set(s).add(k)); }}
                    className="text-[10px] font-bold uppercase tracking-wider text-teal-300 hover:text-teal-100 shrink-0">
                    {appliedKeys.has(k) ? <Check className="w-3 h-3 inline" /> : "Apply"}
                  </button>
                </div>
              ))}
              <button
                onClick={() => { onApplyPatch(state.data!.patch); setAppliedKeys(new Set(patchEntries.map(([k]) => k))); }}
                className="text-[10px] font-bold uppercase tracking-wider text-teal-200 hover:text-teal-100">
                Apply all
              </button>
            </>
          )}
          {patchEntries.length === 0 && state.data.warnings.length === 0 && (
            <div className="text-[10px] text-zinc-500">No changes suggested.</div>
          )}
        </div>
      )}
    </CardShell>
  );
}
