"use client";
/*
 * useOpenFlowChat — client state for one OpenFlow conversation. Holds the
 * message list, posts to /api/openflow/chat, and assembles the NDJSON token
 * stream into the trailing assistant message as it arrives. In-memory only
 * (Increment 1); persistence is a later increment.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenFlowMode } from "@/lib/openflow/types";
import { saveOpenFlowConversation, getOpenFlowConversation } from "@/lib/openflow/conversations";

export type OpenFlowRole = "user" | "assistant";
export type OpenFlowMsg = { id: string; role: OpenFlowRole; content: string };
export type { OpenFlowMode };

let _seq = 0;
const nextId = () => `of-${Date.now().toString(36)}-${(_seq++).toString(36)}`;

export function useOpenFlowChat() {
  const [messages, setMessages] = useState<OpenFlowMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Persistence (A2): the DB id of the conversation being written. null until the
  // first turn is saved (or when a fresh conversation is started). A ref mirrors
  // it so the async save inside `send` reads the latest without being a dep.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const convIdRef = useRef<string | null>(null);
  convIdRef.current = conversationId;
  const [loadingConversation, setLoadingConversation] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const send = useCallback(async (text: string, mode: OpenFlowMode) => {
    const content = text.trim();
    if (!content || streaming) return;
    setError(null);

    const priorMsgs = messages; // pre-send thread (closure is fresh per render)
    const userMsg: OpenFlowMsg = { id: nextId(), role: "user", content };
    const aiMsg: OpenFlowMsg = { id: nextId(), role: "assistant", content: "" };
    // The history the server sees is everything BEFORE the empty assistant slot.
    const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    // Accumulate the assistant text locally too, so we can persist the finished
    // turn without depending on the async React state settling.
    let aiContent = "";
    const appendToAi = (delta: string) => {
      aiContent += delta;
      setMessages((prev) => prev.map((m) => (m.id === aiMsg.id ? { ...m, content: m.content + delta } : m)));
    };

    try {
      const res = await fetch("/api/openflow/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history, mode }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `OpenFlow request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as { delta?: string; done?: boolean; error?: string };
            if (evt.delta) appendToAi(evt.delta);
            if (evt.error) streamError = evt.error;
          } catch { /* skip a malformed line */ }
        }
      }

      if (streamError) {
        setError(streamError);
        // Drop the empty assistant bubble if nothing streamed before the error.
        setMessages((prev) => prev.filter((m) => !(m.id === aiMsg.id && m.content === "")));
      } else if (aiContent.trim()) {
        // Persist the completed turn (fail-soft: never throws to the UI). Adopt
        // the returned id so subsequent turns update the same conversation.
        const finalMessages = [
          ...priorMsgs.map((m) => ({ role: m.role, content: m.content })),
          { role: userMsg.role, content: userMsg.content },
          { role: aiMsg.role, content: aiContent },
        ];
        void saveOpenFlowConversation({ id: convIdRef.current, mode, messages: finalMessages })
          .then((res) => { if (res.ok && convIdRef.current !== res.id) setConversationId(res.id); })
          .catch(() => { /* persistence is best-effort */ });
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "OpenFlow hit a problem.");
      }
      setMessages((prev) => prev.filter((m) => !(m.id === aiMsg.id && m.content === "")));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setStreaming(false);
    }
  }, [messages, streaming]);

  const reset = useCallback(() => {
    stop();
    setMessages([]);
    setError(null);
    setConversationId(null);
  }, [stop]);

  /** Restore a saved conversation by id (church-scoped on the server). */
  const loadConversation = useCallback(async (id: string) => {
    stop();
    setError(null);
    setLoadingConversation(true);
    try {
      const conv = await getOpenFlowConversation(id);
      if (!conv) { setError("That conversation couldn't be opened."); return; }
      setMessages(conv.messages.map((m) => ({ id: nextId(), role: m.role, content: m.content })));
      setConversationId(conv.id);
    } catch {
      setError("That conversation couldn't be opened.");
    } finally {
      setLoadingConversation(false);
    }
  }, [stop]);

  // Abort any in-flight stream when the panel unmounts (e.g. the operator
  // switches center mode away from OpenFlow) so the server generator stops and
  // OpenFlow's dedicated Groq quota isn't burned streaming to a gone client.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  return { messages, streaming, error, send, stop, reset, conversationId, loadConversation, loadingConversation };
}
