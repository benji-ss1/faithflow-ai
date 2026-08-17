// Email delivery. Uses Resend when RESEND_API_KEY is set; otherwise logs
// to stdout AND records to the DB `auth_tokens` row description so the
// operator can grab the link from `npm run dev` output in local dev.
//
// Never called from a client component. Import via a server action or
// route handler only.

import { Resend } from "resend";

const FROM = process.env.EMAIL_FROM || "PresentFlow <no-reply@presentflow.ai>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

let _resend: Resend | null = null;
function resend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (_resend) return _resend;
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

async function deliver(to: string, subject: string, html: string, text: string) {
  const r = resend();
  if (!r) {
    // Dev-mode fallback. Prints the message in a copy-pasteable block.
    console.log("\n" + "═".repeat(60));
    console.log(`📧 [dev-email] to=${to}`);
    console.log(`   subject: ${subject}`);
    console.log(`   ${text.replace(/\n/g, "\n   ")}`);
    console.log("═".repeat(60) + "\n");
    return { ok: true, dev: true } as const;
  }
  try {
    // The Resend SDK returns { data, error } and does NOT throw on API errors
    // (unverified sender domain, sandbox recipient restriction, bad key, …).
    // Must inspect `error` explicitly, or a rejected send looks like success.
    const { data, error } = await r.emails.send({ from: FROM, to, subject, html, text });
    if (error) {
      const msg = (error as { message?: string }).message ?? String(error);
      console.error("[email] Resend rejected:", msg);
      return { ok: false, dev: false, error: msg } as const;
    }
    return { ok: true, dev: false, id: data?.id } as const;
  } catch (e) {
    console.error("[email] send threw:", e instanceof Error ? e.message : e);
    return { ok: false, dev: false, error: e instanceof Error ? e.message : "Send failed" } as const;
  }
}

export async function sendVerificationEmail(to: string, name: string, token: string) {
  const url = `${APP_URL}/verify-email?token=${token}`;
  const text = `Hi ${name},

Welcome to PresentFlow. Confirm your email to finish setting up your account:

${url}

This link expires in 24 hours. If you didn't sign up, you can ignore this message.

— PresentFlow`;
  const html = `<p>Hi ${escapeHtml(name)},</p><p>Welcome to PresentFlow. Confirm your email to finish setting up your account:</p><p><a href="${url}">Confirm your email</a></p><p><small>This link expires in 24 hours. If you didn't sign up, you can ignore this message.</small></p>`;
  return deliver(to, "Confirm your PresentFlow email", html, text);
}

export async function sendPasswordResetEmail(to: string, name: string, token: string) {
  const url = `${APP_URL}/reset-password?token=${token}`;
  const text = `Hi ${name},

Someone (hopefully you) asked to reset your PresentFlow password. Reset it here:

${url}

This link expires in 1 hour. If you didn't request this, you can ignore it — your password is unchanged.

— PresentFlow`;
  const html = `<p>Hi ${escapeHtml(name)},</p><p>Someone (hopefully you) asked to reset your PresentFlow password. Reset it here:</p><p><a href="${url}">Reset your password</a></p><p><small>This link expires in 1 hour. If you didn't request this, you can ignore it — your password is unchanged.</small></p>`;
  return deliver(to, "Reset your PresentFlow password", html, text);
}

export async function sendInvitationEmail(to: string, invitedByName: string, churchName: string, token: string) {
  const url = `${APP_URL}/accept-invite?token=${token}`;
  const text = `Hi,

${invitedByName} invited you to join ${churchName} on PresentFlow. Accept the invite here:

${url}

This link expires in 7 days.

— PresentFlow`;
  const html = `<p>Hi,</p><p><b>${escapeHtml(invitedByName)}</b> invited you to join <b>${escapeHtml(churchName)}</b> on PresentFlow. Accept the invite here:</p><p><a href="${url}">Accept invitation</a></p><p><small>This link expires in 7 days.</small></p>`;
  return deliver(to, `You're invited to ${churchName} on PresentFlow`, html, text);
}

// Beta application notification. Sent to the team inbox (not the applicant).
// Called from the /actions/apply server action. Falls back to console in dev
// when RESEND_API_KEY is unset, like every other message here. The public
// marketing site's Apply flow is a one-question-at-a-time form; each answer
// arrives as a { question, answer } pair so this stays decoupled from the
// exact question set (which the marketing team may reword freely).
const APPLY_INBOX = process.env.APPLY_INBOX || "contact@presentflow.org";

export type BetaApplication = {
  answers: { question: string; answer: string }[];
  // Best-effort extracted identity for the subject line / at-a-glance triage.
  churchName?: string;
  contact?: string;
};

export async function sendBetaApplicationNotification(app: BetaApplication) {
  const rows = app.answers.filter((a) => a.answer?.trim());
  const text = `New PresentFlow beta application\n\n${rows
    .map(({ question, answer }) => `${question}\n  ${answer}`)
    .join("\n\n")}\n`;
  const html = `<h2>New PresentFlow beta application</h2><table cellpadding="6" style="border-collapse:collapse">${rows
    .map(
      ({ question, answer }) =>
        `<tr><td style="color:#888;vertical-align:top"><b>${escapeHtml(question)}</b></td><td>${escapeHtml(answer).replace(/\n/g, "<br>")}</td></tr>`,
    )
    .join("")}</table>`;
  const subjectWho = [app.churchName, app.contact].filter(Boolean).join(" — ") || "new applicant";
  return deliver(APPLY_INBOX, `Beta application: ${subjectWho}`, html, text);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
