/**
 * Maps next-auth signIn() result codes (set by the CredentialsSignin
 * subclasses in login-guard.ts) to operator-facing copy. Pure — unit-tested.
 */
export function signInErrorMessage(code: string | undefined | null): string {
  const m = /^rate_limited(?::(\d+))?$/.exec(code ?? "");
  if (m) {
    const n = Math.min(15, Math.max(1, m[1] ? Number(m[1]) : 15));
    return `Too many sign-in attempts — try again in ${n} minute${n === 1 ? "" : "s"}, or reset your password.`;
  }
  if (code === "invalid_credentials") return "Email or password is incorrect.";
  return "Sign-in failed — please try again.";
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
