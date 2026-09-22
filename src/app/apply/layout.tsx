import {
  cormorantGaramond as cormorant, lora, jetbrainsMono as mono,
} from "@/lib/fonts";
import CookieConsent from "@/components/marketing/CookieConsent";

// The beta application is a full-bleed, immersive "book" experience and
// deliberately does NOT sit under the dark marketing chrome (SiteNav/SiteFooter).
// It lives at a top-level /apply route with its own parchment layout. Every
// "Apply for the beta" CTA on the site already points to /apply, so the URL is
// unchanged — only the surrounding chrome is dropped.
//
// Faces are SELF-HOSTED (2026-09-22) — same faces, same CSS variables, no
// build-time fetch from Google. See src/lib/fonts.ts.

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${cormorant.variable} ${lora.variable} ${mono.variable}`}
      style={{ minHeight: "100vh", background: "#efeae0" }}
    >
      {children}
      <CookieConsent />
    </div>
  );
}
