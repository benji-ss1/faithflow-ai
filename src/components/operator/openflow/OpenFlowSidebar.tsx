"use client";
/*
 * OpenFlowSidebar — the fixed left-rail entry point (between Playlist and Media).
 * The "OpenFlow" wordmark ("Open" upright + "Flow" cursive) with the mark and a
 * small AI trademark tick. Clicking opens the OpenFlow center panel. Carries the
 * .openflow-scope + font variables so the branded type renders in the rail.
 */
import { openFlowFontVars } from "@/lib/openflow/fonts";
import { OpenFlowMark, OpenFlowWordmark } from "./OpenFlowMark";

export function OpenFlowSidebar({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  return (
    <div className={`openflow-scope ${openFlowFontVars}`} style={{ background: "transparent" }}>
      <button
        type="button"
        className={`of-entry${active ? " active" : ""}`}
        onClick={onOpen}
        aria-pressed={active}
        title="Open OpenFlow — your AI assistant"
      >
        <OpenFlowMark size={22} solid />
        <OpenFlowWordmark />
        <span className="of-entry-ai">AI</span>
      </button>
    </div>
  );
}
