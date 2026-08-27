/*
 * OpenFlow's dedicated Groq client — server-only. Kept SEPARATE from
 * src/lib/ai-helpers.ts (which is hardwired to single-shot json_object and
 * shared by the detection helpers) and modelled on src/lib/server/sermon-rag.ts,
 * but streaming.
 *
 * Key isolation (per OPENFLOW_PLAN.md): OpenFlow bills and rate-limits on its
 * OWN key, OPENFLOW_GROQ_API_KEY — never the shared GROQ_API_KEY. Its model is
 * pinned by OPENFLOW_GROQ_MODEL (default llama-3.3-70b-versatile), independent
 * of the shared detection model ladder. Because its quota is separate, a 429
 * here is surfaced as a friendly retry rather than mutating shared limit state.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// 2026-08-27: Groq DECOMMISSIONED llama-3.3-70b-versatile (now 404
// model_not_found) — every OpenFlow call was failing at the non-OK branch
// below. Migrated to openai/gpt-oss-120b (Groq's strongest general model,
// already the shared-detection primary in groq-fallback.ts). It returns clean
// delta.content (its chain-of-thought is a SEPARATE `reasoning` field, so the
// SSE content stream is unaffected). Still env-overridable.
const OPENFLOW_MODEL = process.env.OPENFLOW_GROQ_MODEL || "openai/gpt-oss-120b";
const TIMEOUT_MS = 45_000;

export class MissingOpenFlowKeyError extends Error {
  constructor() {
    super("OPENFLOW_GROQ_API_KEY is not set");
    this.name = "MissingOpenFlowKeyError";
  }
}

export type OpenFlowMessage = { role: "user" | "assistant"; content: string };

/** True when OpenFlow is configured to talk to Groq at all. The route uses this
 *  to degrade gracefully (a clear message) instead of erroring. */
export function isOpenFlowConfigured(): boolean {
  return !!process.env.OPENFLOW_GROQ_API_KEY;
}

/**
 * Stream a chat completion from Groq, yielding text deltas as they arrive.
 * Throws MissingOpenFlowKeyError if unconfigured; the caller decides how to
 * surface that. Aborts on the caller's signal or the internal timeout.
 */
export async function* streamOpenFlowChat(
  systemPrompt: string,
  messages: OpenFlowMessage[],
  opts: { signal?: AbortSignal } = {},
): AsyncGenerator<string, void, unknown> {
  const key = process.env.OPENFLOW_GROQ_API_KEY;
  if (!key) throw new MissingOpenFlowKeyError();

  const model = OPENFLOW_MODEL;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.5,
        max_tokens: 1400,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
      signal: ctrl.signal,
    });

    if (res.status === 429) {
      throw new Error("OpenFlow is briefly rate-limited — please try again in a moment.");
    }
    if (!res.ok || !res.body) {
      // Log the upstream detail SERVER-side; never forward provider internals
      // (model id, org/quota taxonomy) to the browser.
      const body = await res.text().catch(() => "");
      console.error(`[openflow] Groq responded ${res.status}: ${body.slice(0, 500)}`);
      throw new Error("OpenFlow hit a problem talking to the AI service. Please try again.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by blank lines; each carries a `data:` payload.
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta: string | undefined = json?.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch { /* partial frame — ignore, next chunk completes it */ }
      }
    }
  } catch (err) {
    // Our own 45s timeout — surface a friendly message instead of the raw
    // DOMException "This operation was aborted".
    if (timedOut) throw new Error("OpenFlow took too long to respond — please try again.");
    // The caller (client) aborted — stop quietly; nothing to report.
    if (err instanceof DOMException && err.name === "AbortError") return;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
