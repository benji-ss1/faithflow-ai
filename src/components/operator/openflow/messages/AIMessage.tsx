"use client";
/*
 * AIMessage — one OpenFlow assistant turn. Splits the streamed content into
 * prose plus an optional structured card (service plan / scripture / songs) and
 * renders both. The tagged JSON only becomes a card once its closing tag has
 * arrived, so partial JSON never flashes mid-stream.
 */
import { useMemo } from "react";
import { OpenFlowMark } from "../OpenFlowMark";
import { ServicePlanCard } from "./ServicePlanCard";
import { ScriptureCard } from "./ScriptureCard";
import { SongSuggestionCard } from "./SongSuggestionCard";
import { extractOpenFlowCard } from "@/lib/openflow/parse";
import type { OpenFlowActions } from "@/lib/openflow/types";

export function AIMessage({
  content, isLast, streaming, actions,
}: {
  content: string;
  isLast: boolean;
  streaming: boolean;
  actions: OpenFlowActions;
}) {
  const { prose, card } = useMemo(() => extractOpenFlowCard(content), [content]);
  const empty = prose.length === 0 && !card;
  const showCursor = streaming && isLast && !card;

  return (
    <div className="of-msg-ai">
      <div className="of-avatar"><OpenFlowMark size={18} /></div>
      <div className="of-ai-body">
        {empty && streaming && isLast ? (
          <span className="of-thinking" aria-label="OpenFlow is thinking"><b /><b /><b /></span>
        ) : (
          <>
            {prose ? (
              <p className="of-ai-text">{prose}{showCursor ? <span className="of-cursor" /> : null}</p>
            ) : null}
            {card?.kind === "service_plan" ? <ServicePlanCard plan={card.data} actions={actions} /> : null}
            {card?.kind === "scripture" ? <ScriptureCard data={card.data} actions={actions} /> : null}
            {card?.kind === "song_suggestions" ? <SongSuggestionCard data={card.data} actions={actions} /> : null}
          </>
        )}
      </div>
    </div>
  );
}
