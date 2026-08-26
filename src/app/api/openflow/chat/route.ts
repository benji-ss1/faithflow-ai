import { apiUser } from "@/lib/session";
import { createLimiter } from "@/lib/rate-limit";
import { getOpenFlowChurchContext, buildOpenFlowSystemPrompt } from "@/lib/server/openflow-context";
import { streamOpenFlowChat, isOpenFlowConfigured, MissingOpenFlowKeyError, type OpenFlowMessage } from "@/lib/server/openflow";
import { OPENFLOW_MODES, type OpenFlowMode } from "@/lib/openflow/types";

export const runtime = "nodejs"; // Node client (Drizzle/pg) + streaming; not edge
export const maxDuration = 60;

const chatLimiter = createLimiter("openflow-chat", 30, 60_000);

const MAX_MESSAGES = 40;
const MAX_CHARS = 8000;

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return json({ error: "Session expired — please sign in again." }, 401);
  if (!(await chatLimiter(user.id))) return json({ error: "You're sending messages very fast — give it a second." }, 429);

  if (!isOpenFlowConfigured()) {
    return json({ error: "OpenFlow isn't switched on yet. Set OPENFLOW_GROQ_API_KEY to enable it." }, 503);
  }

  const body = (await req.json().catch(() => ({}))) as { messages?: unknown; mode?: unknown };
  const mode: OpenFlowMode = OPENFLOW_MODES.includes(body.mode as OpenFlowMode) ? (body.mode as OpenFlowMode) : "chat";

  // Validate + sanitise the transcript. Roles are user/assistant only (the
  // system prompt is built server-side and never accepted from the client).
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages: OpenFlowMessage[] = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    const role = (m as { role?: string })?.role;
    const content = (m as { content?: string })?.content;
    if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
      messages.push({ role, content: content.slice(0, MAX_CHARS) });
    }
  }
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json({ error: "Bad request" }, 400);
  }

  // churchId is authoritative from the session — never from the request body.
  const ctx = await getOpenFlowChurchContext(user.churchId);
  const systemPrompt = buildOpenFlowSystemPrompt(ctx, mode, new Date());

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        for await (const delta of streamOpenFlowChat(systemPrompt, messages, { signal: req.signal })) {
          send({ delta });
        }
        send({ done: true });
      } catch (err) {
        if (err instanceof MissingOpenFlowKeyError) {
          send({ error: "OpenFlow isn't switched on yet." });
        } else {
          const msg = err instanceof Error ? err.message : "OpenFlow hit a problem. Please try again.";
          send({ error: msg });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
