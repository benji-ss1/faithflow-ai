// Full-bleed layout for /preview/* — deliberately OUTSIDE the (app) route group
// so it escapes the app shell + the onboarding funnel (requireUser redirect).
// Middleware still auth-gates it (signed-out → /login), so only signed-in users
// can reach the preview. This keeps the live onboarding path completely untouched.
export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
