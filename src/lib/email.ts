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

async function deliver(
  to: string,
  subject: string,
  html: string,
  text: string,
  opts?: { replyTo?: string },
) {
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
    const { data, error } = await r.emails.send({
      from: FROM,
      to,
      subject,
      html,
      text,
      ...(opts?.replyTo ? { replyTo: opts.replyTo } : {}),
    });
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
const EMAIL_RE_INBOX = /[^\s@]+@[^\s@]+\.[^\s@]+/;

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

  // Deliberately PLAIN, transactional HTML — a lightweight table, system font,
  // no dark hero / monospace-uppercase / box-shadow "marketing" styling. Heavy
  // promo-looking HTML from a no-reply address is a common spam-filter trigger
  // for an INTERNAL notification (this one landed in Gmail Spam once). The
  // applicant-facing confirmation keeps its branded look; this internal one
  // optimises for the inbox, not the eye. Real deliverability still comes from
  // DKIM/DMARC on presentflow.org — see the ops note in apply.ts.
  const rowsHtml = rows
    .map(
      ({ question, answer }) => `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#555;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(question)}</td>
          <td style="padding:6px 0;color:#111;font-size:14px;">${escapeHtml(answer).replace(/\n/g, "<br>")}</td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;color:#111;">
    <p style="margin:0 0 4px;font-size:16px;font-weight:bold;">New PresentFlow beta application</p>
    <p style="margin:0 0 14px;font-size:13px;color:#555;">Reply to this email to reach the applicant directly.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rowsHtml}</table>
  </body></html>`;

  const church = (app.churchName || "").replace(/^church name:\s*/i, "").split("·")[0].trim();
  const who = [church, app.contact].filter(Boolean).join(" · ") || "new applicant";
  // reply_to = the applicant, so a team member can reply to the notification and
  // reach the church directly (the from-address is a no-reply). Also nudges
  // deliverability, since the notification then aligns with a real reply target.
  return deliver(APPLY_INBOX, `New beta application — ${who}`, html, text, {
    replyTo: app.contact && EMAIL_RE_INBOX.test(app.contact) ? app.contact : undefined,
  });
}

// Confirmation sent to the APPLICANT after they submit the beta application —
// a warm thank-you + "we've got it, we'll be in touch". From the verified
// presentflow.org domain, so it reaches any recipient.
export async function sendBetaApplicantConfirmation(to: string, name?: string) {
  const first = (name || "").trim().split(/\s+/)[0];
  const greeting = first ? `Hi ${first},` : "Hi there,";
  const text = `${greeting}

Thank you for applying to the PresentFlow beta — we've received your application.

We're opening wave one to a small group of churches, oldest applications first. We'll be in touch by email with your invitation and any updates before your first live Sunday. There's nothing you need to do in the meantime.

Grateful you want to help shape what church presentation should be.

— The PresentFlow team
presentflow.org`;

  const html = `<!doctype html><html><body style="margin:0;background:#f2ede4;padding:26px 12px;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 44px rgba(26,10,20,.12);">
        <tr><td style="background:#14090f;padding:26px 30px;">
          <div style="font:700 21px/1 -apple-system,'Segoe UI',sans-serif;color:#f4efe6;letter-spacing:-.01em;">Present<span style="color:#ff7a2c;">Flow</span></div>
          <div style="margin-top:9px;font:600 12px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:#c69a6a;">You're on the list</div>
        </td></tr>
        <tr><td style="padding:28px 30px;color:#1a140f;">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Thank you for applying to the <b>PresentFlow</b> beta — we've received your application.</p>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#4a423a;">We're opening <b>wave one</b> to a small group of churches, oldest applications first. We'll be in touch by email with your invitation and any updates before your first live Sunday. There's nothing you need to do in the meantime.</p>
          <p style="margin:0 0 4px;font-size:16px;line-height:1.6;color:#4a423a;">Grateful you want to help shape what church presentation should be.</p>
          <p style="margin:20px 0 0;font-size:15px;line-height:1.5;color:#1a140f;">— The PresentFlow team</p>
        </td></tr>
        <tr><td style="padding:16px 30px;background:#faf6ef;font:400 12px/1.5 ui-monospace,Menlo,monospace;color:#8a7f70;">presentflow.org · You received this because you applied to the PresentFlow beta.</td></tr>
      </table>
    </td></tr></table>
  </body></html>`;

  return deliver(to, "Thanks — your PresentFlow beta application is in", html, text);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
