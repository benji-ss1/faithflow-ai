"use client";
/*
 * OpenFlow chat thread — the conversation view once a message has been sent.
 * User bubbles on the right; AI replies on the left beside the OpenFlow mark,
 * streaming token-by-token with a caret. The composer docks at the bottom.
 */
import { useEffect, useRef } from "react";
import { OpenFlowInput } from "./OpenFlowInput";
import { AIMessage } from "./messages/AIMessage";
import type { OpenFlowMsg, OpenFlowMode } from "@/hooks/useOpenFlowChat";
import type { OpenFlowActions } from "@/lib/openflow/types";

export function OpenFlowChat({
  messages, streaming, error, value, onChange, onSend, onStop, mode, onModeChange, actions,
}: {
  messages: OpenFlowMsg[];
  streaming: boolean;
  error: string | null;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  mode: OpenFlowMode;
  onModeChange: (m: OpenFlowMode) => void;
  actions: OpenFlowActions;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest content in view as it streams — but ONLY when the operator
  // is already near the bottom, so scrolling up to re-read mid-stream isn't
  // hijacked. rAF-coalesced so a burst of tokens is one scroll, not many.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
    if (!nearBottom) return;
    const id = requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
    return () => cancelAnimationFrame(id);
  }, [messages, streaming]);

  const lastId = messages[messages.length - 1]?.id;

  return (
    <div className="of-stage of-fade">
      <div className="of-thread" ref={scrollRef}>
        <div className="of-thread-inner">
          {messages.map((m) => {
            if (m.role === "user") {
              return <div key={m.id} className="of-msg-user">{m.content}</div>;
            }
            return (
              <AIMessage
                key={m.id}
                content={m.content}
                isLast={m.id === lastId}
                streaming={streaming}
                actions={actions}
              />
            );
          })}
          {error ? <p className="of-error">{error}</p> : null}
          <div ref={endRef} />
        </div>
      </div>

      <div className="of-composer-dock">
        {streaming ? (
          <div style={{ width: "min(760px, 100%)", margin: "0 auto 8px", textAlign: "center" }}>
            <button type="button" className="of-mode-pill" onClick={onStop}>Stop generating</button>
          </div>
        ) : null}
        <OpenFlowInput
          value={value}
          onChange={onChange}
          onSend={onSend}
          mode={mode}
          onModeChange={onModeChange}
          disabled={streaming}
          placeholder="Reply to OpenFlow…"
          autoFocus
        />
      </div>
    </div>
  );
}
