"use server";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import {
  sendBetaApplicationNotification,
  sendBetaApplicantConfirmation,
} from "@/lib/email";
import { createLimiter } from "@/lib/rate-limit";
import { getDb } from "@/lib/db/client";
import { betaApplications } from "@/lib/db/schema";

// 5 applications per 10 minutes per client IP — generous for a real applicant,
// tight enough to blunt spam / abusive resubmits on this public endpoint.
const applyLimiter = createLimiter("apply", 5, 10 * 60 * 1000);

// Server Action backing the public marketing Apply flow (10-question beta
// application). Emails the team inbox (contact@presentflow.org) via the
// existing Resend helper. No DB write — the schema is intentionally untouched.

export type ApplyResult = { ok: true } | { ok: false; error: string };

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

type Answer = { question: string; answer: string };

/**
 * Church name, contact email, name and phone from the raw answer set — the
 * one thing guaranteed correct, unlike a stored `beta_applications` column.
 * Before 2026-08-23 the church-name derivation also matched the
 * soundboard/mixer question ("...does your church use?"), so several early
 * rows have a mixer model (e.g. "behringer X32") sitting in their
 * `church_name` column. Re-deriving from `answers` here — rather than
 * trusting a caller-supplied name — fixes that for any historical replay and
 * adds defense-in-depth for the live path too.
 */
function deriveIdentity(answers: Answer[]) {
  const answerMap = Object.fromEntries(answers.map(({ question, answer }) => [question, answer]));
  const all = answers.map((a) => a.answer).join(" — ");
  const contactEmail = EMAIL_RE.exec(all)?.[0] ?? null;
  const churchNameRaw =
    answers.find((a) => /church name\s*:/i.test(a.answer))?.answer ??
    answers.find((a) => /church/i.test(a.question) && !/mixer|soundboard|\buse\b/i.test(a.question))?.answer ??
    null;
  const churchName = churchNameRaw
    ? (/church name\s*:\s*([^·—\n|]+)/i.exec(churchNameRaw)?.[1]?.trim() || churchNameRaw.trim())
    : null;
  // The name/phone answers are shaped "First name: X · Last name: Y" and
  // "Phone: X" — strip the labels so the CRM's contact_name/contact_phone
  // columns hold the value a person would actually want to see, not the
  // question's own label text.
  const nameRaw = (answerMap["What's your name?"] ?? "").trim();
  const first = /first name\s*:\s*([^·—\n|]+)/i.exec(nameRaw)?.[1]?.trim();
  const last = /last name\s*:\s*([^·—\n|]+)/i.exec(nameRaw)?.[1]?.trim();
  const contactName = [first, last].filter(Boolean).join(" ").trim() || nameRaw || null;
  const phoneRaw = (answerMap["What's the best number to reach you?"] ?? "").trim();
  const contactPhone = (/phone\s*:\s*([^·—\n|]+)/i.exec(phoneRaw)?.[1]?.trim()) || phoneRaw || null;
  return { churchName, contactEmail, contactName, contactPhone };
}

/**
 * Copies a durably stored marketing application to Ops. This is deliberately
 * server-to-server: the shared signing secret never reaches the public form.
 * The application UUID is the delivery idempotency key, so retries and a
 * historical backfill cannot make duplicate CRM applications. Identity is
 * derived from `answers`, not caller-supplied fields — see `deriveIdentity`.
 */
export async function deliverApplicationToOps(input: {
  id: string;
  answers: Answer[];
}): Promise<void> {
  const url = process.env.PRESENTFLOW_OPS_BETA_WEBHOOK_URL;
  const secret = process.env.BETA_FORM_WEBHOOK_SECRET;
  if (!url || !secret) {
    console.warn("[apply] Ops beta webhook is not configured");
    return;
  }

  const identity = deriveIdentity(input.answers);
  const answerMap = Object.fromEntries(input.answers.map(({ question, answer }) => [question, answer]));
  const body = JSON.stringify({
    church_name: identity.churchName?.trim() || "Beta application",
    contact_name: identity.contactName,
    contact_email: identity.contactEmail,
    contact_phone: identity.contactPhone,
    category: "beta",
    answers: answerMap,
  });
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-presentflow-event-id": input.id,
        "x-presentflow-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) console.error(`[apply] Ops beta webhook returned ${response.status}`);
  } catch (error) {
    console.error("[apply] Ops beta webhook failed:", error instanceof Error ? error.message : error);
  }
}

function cleanAnswers(raw: unknown): { question: string; answer: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      question: typeof x.question === "string" ? x.question.trim().slice(0, 300) : "",
      answer: typeof x.answer === "string" ? x.answer.trim().slice(0, 2000) : "",
    }))
    .filter((x) => x.question)
    .slice(0, 40);
}

export async function submitApplication(raw: unknown): Promise<ApplyResult> {
  const input = (raw ?? {}) as Record<string, unknown>;

  // Honeypot: bots fill hidden fields. Pretend success, send nothing.
  if (typeof input.hp === "string" && input.hp.trim()) return { ok: true };

  // Rate limit per client IP — blunt spam / abusive resubmits on this public
  // endpoint.
  try {
    const h = await headers();
    const ip =
      (h.get("x-forwarded-for") || "").split(",")[0].trim() ||
      h.get("x-real-ip") ||
      "unknown";
    const allowed = await applyLimiter(ip);
    if (!allowed) {
      return {
        ok: false,
        error: "Too many applications from this connection. Please try again in a few minutes.",
      };
    }
  } catch {
    // headers() unavailable (shouldn't happen in a server action) — fail open.
  }

  const answers = cleanAnswers(input.answers);
  const answered = answers.filter((a) => a.answer);
  if (answered.length < 3) {
    return { ok: false, error: "Please answer a few more questions before submitting." };
  }

  // Best-effort identity for the notification subject line.
  const all = answered.map((a) => a.answer).join(" — ");
  const contact = EMAIL_RE.exec(all)?.[0];
  // Church name. The "What's your church called" answer is shaped
  // "Church name: X · City: Y · Country: Z", so match the ANSWER shape first
  // (most reliable). Fall back to a church-specific QUESTION, explicitly
  // excluding the mixer/soundboard question — it also contains the word
  // "church" ("...does your church use?") and was previously being stored as
  // the church name (e.g. "Behringer X32").
  const churchNameRaw =
    answered.find((a) => /church name\s*:/i.test(a.answer))?.answer ??
    answered.find(
      (a) => /church/i.test(a.question) && !/mixer|soundboard|\buse\b/i.test(a.question),
    )?.answer ??
    null;
  const churchName: string | undefined = churchNameRaw
    ? (/church name\s*:\s*([^·—\n|]+)/i.exec(churchNameRaw)?.[1]?.trim() || churchNameRaw.trim())
    : undefined;

  // Capture identity of this request for triage / anti-abuse review.
  let ua = "";
  let ip = "";
  try {
    const h = await headers();
    ua = (h.get("user-agent") || "").slice(0, 500);
    ip = ((h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "").slice(0, 80);
  } catch {
    /* headers() unavailable — non-fatal */
  }

  // DURABLE STORE FIRST. Persist the application to the DB before any email is
  // attempted, so a submission is never lost to email delivery problems (spam,
  // quarantine, an unmonitored inbox). This is the record of record; the emails
  // below are notification, not storage. A DB failure here is the only thing
  // that can lose a lead, so it's the one failure we surface to the applicant.
  let applicationId: string;
  try {
    const db = getDb();
    const [row] = await db
      .insert(betaApplications)
      .values({
        churchName: churchName ?? null,
        contactEmail: contact ?? null,
        answers: answered,
        userAgent: ua || null,
        ip: ip || null,
      })
      .returning({ id: betaApplications.id });
    applicationId = row.id;
  } catch (e) {
    console.error("[apply] DB insert failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Something went wrong saving your application. Please try again." };
  }

  // Ops is a second system of record for sales work. Delivery does not alter
  // the applicant result: this database row is already durable, and the UUID
  // lets the backfill script safely replay a temporarily failed delivery.
  await deliverApplicationToOps({
    id: applicationId,
    answers: answered,
  });

  // Notify the team. The application is already saved, so an email failure no
  // longer loses the lead — record the outcome on the row and keep going.
  const res = await sendBetaApplicationNotification({ answers: answered, churchName, contact });
  if (res.ok) {
    void markApplication(applicationId, { notified: true });
  } else {
    console.error("[apply] team notification failed:", res.error);
    void markApplication(applicationId, { notified: false, emailError: res.error ?? "notify failed" });
  }

  // Send the applicant a thank-you / confirmation. Best-effort: a failure here
  // must not break the applicant's "You're on the list" success — the DB row
  // above already captured the application.
  if (contact) {
    // Name and email are now separate questions. Pull the first name from the
    // "First name:" field (new form), falling back to older formats.
    const name = (
      /first name:\s*([^·—]+)/i.exec(all)?.[1] ??
      /full name:\s*([^·—]+)/i.exec(all)?.[1] ??
      ""
    ).trim();
    try {
      const c = await sendBetaApplicantConfirmation(contact, name);
      if (c.ok) void markApplication(applicationId, { confirmed: true });
    } catch (e) {
      console.error("[apply] confirmation email failed:", e instanceof Error ? e.message : e);
    }
  }

  return { ok: true };
}

// Fire-and-forget status stamp on the stored application. Never throws into the
// request path — the row already exists; this is just bookkeeping.
async function markApplication(
  id: string,
  fields: { notified?: boolean; confirmed?: boolean; emailError?: string },
): Promise<void> {
  try {
    await getDb().update(betaApplications).set(fields).where(eq(betaApplications.id, id));
  } catch (e) {
    console.error("[apply] status update failed:", e instanceof Error ? e.message : e);
  }
}
