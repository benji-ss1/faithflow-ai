import { cookies, headers } from "next/headers";
import { UnifiedAuth } from "@/components/auth/UnifiedAuth";

// /login opens the unified auth screen on the Sign-in tab. Churches can switch
// to first-time Beta sign-up in place (no page hop) — see UnifiedAuth.
export default async function LoginPage() {
  // Desktop shell detection (x-pf-shell header from Electron / httpOnly
  // pf_shell cookie) → offer password-less "continue with web account" pairing.
  const h = await headers();
  const c = await cookies();
  const isDesktop = h.get("x-pf-shell") === "desktop" || c.get("pf_shell")?.value === "desktop";
  return <UnifiedAuth initialMode="signin" isDesktop={isDesktop} />;
}
