"use client";
import { useRef } from "react";
import type { MessagesApi } from "../../hooks";
import { OVERLAY_POSITIONS, type OverlayPosition } from "@/lib/broadcast";

const POSITION_LABELS: Record<OverlayPosition, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
  "lower-third": "Lower third",
  "center": "Center",
};

export function MessagesTab({ api }: { api: MessagesApi }) {
  const { state, setText, setDismiss, setAllowWeb, setPosition, toggleShow } = api;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // NOTE: auto-dismiss is owned by useMessagesSession (pro/hooks.ts) so it
  // survives this popover unmounting — do not re-add a timeout here.

  const insertToken = (token: string) => {
    const ta = taRef.current;
    if (!ta) { setText(state.text + token); return; }
    const s = ta.selectionStart ?? state.text.length;
    const e = ta.selectionEnd ?? state.text.length;
    setText(state.text.slice(0, s) + token + state.text.slice(e));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="eyebrow">Message Detail</div>
      <textarea
        ref={taRef}
        value={state.text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1"
        placeholder="Message text…"
      />
      <div className="flex items-center gap-2">
        <select
          onChange={(e) => {
            const v = e.target.value;
            if (v) insertToken(v);
            e.target.value = "";
          }}
          className="flex-1 h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded"
          defaultValue=""
        >
          <option value="">Add Token…</option>
          <option value="{{time}}">Time</option>
          <option value="{{date}}">Date</option>
          <option value="{{currentSlide}}">Current Slide</option>
        </select>
      </div>
      <div>
        <div className="eyebrow mb-1">Dismiss</div>
        <select
          value={state.dismiss}
          onChange={(e) => setDismiss(e.target.value)}
          className="w-full h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded"
        >
          <option value="manual">Manually</option>
          <option value="5s">5s</option>
          <option value="10s">10s</option>
          <option value="30s">30s</option>
          <option value="1min">1min</option>
          <option value="5min">5min</option>
        </select>
      </div>
      <div>
        <div className="eyebrow mb-1">Position</div>
        <select
          value={state.position}
          onChange={(e) => setPosition(e.target.value as OverlayPosition)}
          className="w-full h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded"
        >
          {OVERLAY_POSITIONS.map((p) => (
            <option key={p} value={p}>{POSITION_LABELS[p]}</option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={state.allowWeb}
          onChange={(e) => setAllowWeb(e.target.checked)}
        />
        Allow on web (livestream output)
      </label>
      <button
        onClick={toggleShow}
        className="h-9 rounded-md bg-[var(--color-brand)] text-black font-semibold"
      >
        {state.showing ? "Hide" : "Show"}
      </button>
      {state.showing && (
        <div className="text-[10px] text-center text-[var(--color-muted-foreground)]">
          Message active {state.dismiss !== "manual" && `(auto-dismiss in ${state.dismiss})`}
        </div>
      )}
    </div>
  );
}
