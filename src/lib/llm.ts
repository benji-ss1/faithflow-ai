// LLM wrapper. Uses xAI's OpenAI-compatible endpoint (base_url
// https://api.x.ai/v1). Kept as a thin, provider-agnostic function so we
// can swap in Groq (`gsk_...`) or another OpenAI-compatible provider by
// changing the env vars only.
//
// Called ONLY from server-side code (RSC, actions, scripts). Never expose
// XAI_API_KEY to the client.

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function chatComplete(opts: {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object" | "text";
}): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  const baseUrl = process.env.XAI_BASE_URL || "https://api.x.ai/v1";
  const model = opts.model || process.env.XAI_MODEL || "grok-2-latest";
  if (!apiKey) throw new Error("XAI_API_KEY not configured");

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 1500,
  };
  if (opts.responseFormat === "json_object") body.response_format = { type: "json_object" };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty response");
  return content;
}
