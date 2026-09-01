import { UnifiedAuth } from "@/components/auth/UnifiedAuth";

// /signup opens the unified auth screen on the first-time Beta sign-up tab.
// Churches can switch to Sign in in place (no page hop) — see UnifiedAuth.
export default function SignUpPage() {
  return <UnifiedAuth initialMode="beta" />;
}
