"use client";
/*
 * SongSuggestionCard — lists suggested songs and adds one to the service by
 * matching its title to the church's real library (addOpenFlowSongToPlan). A
 * title the library doesn't have surfaces a clear message instead of an item.
 */
import { useState } from "react";
import { toast } from "sonner";
import { addOpenFlowSongToPlan } from "@/lib/openflow/actions";
import type { SongSuggestions } from "@/lib/openflow/parse";
import type { OpenFlowActions } from "@/lib/openflow/types";
import { OpenFlowSlidePreview } from "./SlidePreview";

export function SongSuggestionCard({ data, actions }: { data: SongSuggestions; actions: OpenFlowActions }) {
  const [busy, setBusy] = useState<string | null>(null);

  const add = async (title: string) => {
    setBusy(title);
    try {
      const res = await addOpenFlowSongToPlan(actions.planId, title);
      if (!res.ok) { toast.error(res.error || "Couldn't add that song."); return; }
      actions.onApplied();
      toast.success(`Added "${res.data?.matched ?? title}" to the service`);
    } finally { setBusy(null); }
  };

  return (
    <div className="of-card of-mini">
      {data.suggestions.map((s, i) => (
        <div key={`${s.title}-${i}`} className="of-song-row of-song-grid">
          <OpenFlowSlidePreview slide={{ kind: "text", text: s.title }} actions={actions} className="of-song-thumb" textMinPx={9} />
          <div>
            <p className="of-song-title">{s.title}</p>
            {s.author ? <p className="of-song-author">{s.author}</p> : null}
            {s.reason ? <p className="of-why">{s.reason}</p> : null}
            <button type="button" className="of-btn of-btn-primary of-btn-sm" onClick={() => add(s.title)} disabled={busy === s.title}>
              {busy === s.title ? "Adding…" : "Add to service"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
