"use client";
/*
 * ScriptureCard — takes the model's reference (NOT its verse text), fetches the
 * REAL text from the church's Bible on mount, and offers Project (to the live
 * output) + Add to service. The model never supplies the words.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { resolveOpenFlowScripture, addOpenFlowScriptureToPlan } from "@/lib/openflow/actions";
import type { ScriptureRef } from "@/lib/openflow/parse";
import type { OpenFlowActions } from "@/lib/openflow/types";

type Resolved = { reference: string; translation: string; verses: { verse: number; text: string }[] };

export function ScriptureCard({ data, actions }: { data: ScriptureRef; actions: OpenFlowActions }) {
  const [state, setState] = useState<{ loading: boolean; resolved?: Resolved; error?: string }>({ loading: true });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resolveOpenFlowScripture(data.reference, data.translation)
      .then((r) => { if (cancelled) return; r.ok ? setState({ loading: false, resolved: r.data }) : setState({ loading: false, error: r.error }); })
      .catch(() => { if (!cancelled) setState({ loading: false, error: "Couldn't load that verse." }); });
    return () => { cancelled = true; };
  }, [data.reference, data.translation]);

  if (state.loading) return <div className="of-card of-mini"><span className="of-badge">Loading…</span><p className="of-verse-text" style={{ opacity: 0.5 }}>Fetching the passage…</p></div>;
  if (state.error || !state.resolved) return <div className="of-card of-mini"><p className="of-error">{state.error ?? "Couldn't load that verse."}</p></div>;

  const r = state.resolved;
  const text = r.verses.map((v) => v.text).join(" ");

  const add = async () => {
    setAdding(true);
    try {
      const res = await addOpenFlowScriptureToPlan(actions.planId, r.reference, r.translation);
      if (!res.ok) { toast.error(res.error || "Couldn't add."); return; }
      actions.onApplied();
      toast.success(`Added ${r.reference} to the service`);
    } finally { setAdding(false); }
  };

  return (
    <div className="of-card of-mini">
      <span className="of-badge">{r.translation}</span>
      <p className="of-verse-ref">{r.reference}</p>
      <p className="of-verse-text">{text}</p>
      <div style={{ display: "flex", gap: 9 }}>
        <button type="button" className="of-btn of-btn-primary of-btn-sm" onClick={() => actions.projectScripture(r.verses, r.reference)}>Project</button>
        <button type="button" className="of-btn of-btn-ghost of-btn-sm" onClick={add} disabled={adding}>{adding ? "Adding…" : "Add to service"}</button>
      </div>
    </div>
  );
}
