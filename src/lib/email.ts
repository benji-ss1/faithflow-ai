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
    await r.emails.send({ from: FROM, to, subject, html, text });
    return { ok: true, dev: false } as const;
  } catch (e) {
    console.error("[email] send failed:", e instanceof Error ? e.message : e);
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
