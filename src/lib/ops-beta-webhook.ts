import { createHmac } from "node:crypto";

export type BetaApplicationAnswer = { question: string; answer: string };

/** Server-only, idempotent handoff of a durable website application to Ops. */
export async function deliverBetaApplicationToOps(input: {
  id: string;
  churchName: string | null;
  contactEmail: string | null;
  answers: BetaApplicationAnswer[];
}): Promise<void> {
  const url = process.env.PRESENTFLOW_OPS_BETA_WEBHOOK_URL;
  const secret = process.env.BETA_FORM_WEBHOOK_SECRET;
  if (!url || !secret) { console.warn("[apply] Ops beta webhook is not configured"); return; }
  const answers = Object.fromEntries(input.answers.map(({ question, answer }) => [question, answer]));
  const body = JSON.stringify({
    church_name: input.churchName?.trim() || "Beta application",
    contact_name: (answers["What's your name?"] ?? "").trim() || null,
    contact_email: input.contactEmail,
    contact_phone: (answers["What's the best number to reach you?"] ?? "").trim() || null,
    category: "beta",
    answers,
  });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-presentflow-event-id": input.id, "x-presentflow-signature": createHmac("sha256", secret).update(body).digest("hex") },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) console.error(`[apply] Ops beta webhook returned ${response.status}`);
  } catch (error) { console.error("[apply] Ops beta webhook failed:", error instanceof Error ? error.message : error); }
}
