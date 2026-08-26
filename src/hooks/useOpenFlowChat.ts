"use client";
/*
 * useOpenFlowChat — client state for one OpenFlow conversation. Holds the
 * message list, posts to /api/openflow/chat, and assembles the NDJSON token
 * stream into the trailing assistant message as it arrives. In-memory only
 * (Increment 1); persistence is a later increment.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenFlowMode } from "@/lib/openflow/types";

export type OpenFlowRole = "user" | "assistant";
export type OpenFlowMsg = { id: string; role: OpenFlowRole; content: string };
export type { OpenFlowMode };

let _seq = 0;
const nextId = () => `of-${Date.now().toString(36)}-${(_seq++).toString(36)}`;

export function useOpenFlowChat() {
  const [messages, setMessages] = useState<OpenFlowMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

    const userMsg: OpenFlowMsg = { id: nextId(), role: "user", content };
    const aiMsg: OpenFlowMsg = { id: nextId(), role: "assistant", content: "" };
    // The history the server sees is everything BEFORE the empty assistant slot.
    const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    const appendToAi = (delta: string) =>
      setMessages((prev) => prev.map((m) => (m.id === aiMsg.id ? { ...m, content: m.content + delta } : m)));

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
  }, [stop]);

  // Abort any in-flight stream when the panel unmounts (e.g. the operator
  // switches center mode away from OpenFlow) so the server generator stops and
  // OpenFlow's dedicated Groq quota isn't burned streaming to a gone client.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  return { messages, streaming, error, send, stop, reset };
}
