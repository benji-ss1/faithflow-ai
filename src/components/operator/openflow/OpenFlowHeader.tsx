"use client";
/*
 * OpenFlowHeader — the persistent identity + conversation bar. Rendered ONCE by
 * OpenFlowPanel and never unmounts, so the OpenFlow logo/wordmark stay on screen
 * across the welcome→chat transition (fixing the "the logo disappears the moment
 * you start talking" complaint). In the welcome state it's a quiet brand bar; in
 * a live conversation it also carries the current title + a New-chat action that
 * returns to the first screen.
 *
 * A1 scope: identity persistence + New chat. The full conversation rail (history,
 * rename, delete, restore) lands in A2/A3 on top of this same bar.
 */
import { IconPlus, IconHistory } from "@tabler/icons-react";
import { OpenFlowMark, OpenFlowWordmark } from "./OpenFlowMark";

export function OpenFlowHeader({
  started,
  title,
  onNewChat,
  onOpenHistory,
}: {
  started: boolean;
  title?: string | null;
  onNewChat: () => void;
  onOpenHistory?: () => void;
}) {
  return (
    <header className="of-header" data-started={started ? "true" : "false"}>
      <button
        type="button"
        className="of-header-brand"
        onClick={onNewChat}
        title="New conversation"
        aria-label="OpenFlow — start a new conversation"
      >
        <OpenFlowMark size={26} />
        <OpenFlowWordmark />
      </button>

      {started && title ? (
        <span className="of-header-title" title={title}>{title}</span>
      ) : null}

      <div className="of-header-actions">
        {onOpenHistory ? (
          <button
            type="button"
            className="of-header-icon"
            onClick={onOpenHistory}
            title="Conversation history"
            aria-label="Conversation history"
          >
            <IconHistory size={17} stroke={1.8} />
          </button>
        ) : null}
        {started ? (
          <button
            type="button"
            className="of-header-new"
            onClick={onNewChat}
            title="New conversation — back to the start"
          >
            <IconPlus size={15} stroke={2.2} />
            <span>New chat</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
