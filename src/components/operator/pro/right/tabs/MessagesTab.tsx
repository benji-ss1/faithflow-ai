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
  const { state, setText, setDismiss, setAllowWeb, setPosition, setScroll, setScrollDir, setScrollSec, toggleShow } = api;
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
      <div className="rounded border border-[var(--color-border)] p-2 flex flex-col gap-2">
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" checked={state.scroll} onChange={(e) => setScroll(e.target.checked)} />
          Scroll across (ticker)
        </label>
        {state.scroll && (
          <>
            <div className="text-[10px] text-[var(--color-muted-foreground)] -mt-1">
              The message keeps moving across its band. Stays in the position you chose above.
            </div>
            <div>
              <div className="eyebrow mb-1">Direction</div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setScrollDir("rtl")}
                  className={`flex-1 h-8 rounded border ${state.scrollDir === "rtl" ? "border-[var(--color-brand)] text-[var(--color-brand)]" : "border-[var(--color-border)]"}`}
                >Right → Left</button>
                <button
                  type="button"
                  onClick={() => setScrollDir("ltr")}
                  className={`flex-1 h-8 rounded border ${state.scrollDir === "ltr" ? "border-[var(--color-brand)] text-[var(--color-brand)]" : "border-[var(--color-border)]"}`}
                >Left → Right</button>
              </div>
            </div>
            <div>
              <div className="eyebrow mb-1 flex justify-between">
                <span>Speed</span>
                <span className="text-[var(--color-muted-foreground)]">{state.scrollSec}s / pass</span>
              </div>
              {/* Slider drags RIGHT = faster. Underlying value is seconds-per-pass
                  (lower = faster), inverted here so the control reads intuitively. */}
              <input
                type="range"
                min={4}
                max={120}
                step={1}
                value={124 - state.scrollSec}
                onChange={(e) => setScrollSec(124 - Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-[var(--color-muted-foreground)]">
                <span>Slower</span><span>Faster</span>
              </div>
            </div>
          </>
        )}
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
