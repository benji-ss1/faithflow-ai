import { UnifiedAuth } from "@/components/auth/UnifiedAuth";

// /login opens the unified auth screen on the Sign-in tab. Churches can switch
// to first-time Beta sign-up in place (no page hop) — see UnifiedAuth.
export default function LoginPage() {
  return <UnifiedAuth initialMode="signin" />;
}
