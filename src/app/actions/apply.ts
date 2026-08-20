"use server";

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
  const churchName =
    answered.find((a) => /church name/i.test(a.question))?.answer ||
    answered.find((a) => /church/i.test(a.question))?.answer;

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
