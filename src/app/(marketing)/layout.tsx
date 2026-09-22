import type { Metadata } from "next";
import {
  plusJakartaSans as jakarta, jetbrainsMono as mono, fraunces,
  caveat, cormorantGaramond as cormorant, lora,
} from "@/lib/fonts";
import SiteNav from "@/components/marketing/SiteNav";
import SiteFooter from "@/components/marketing/SiteFooter";
import CookieConsent from "@/components/marketing/CookieConsent";
import "@/components/marketing/site.css";

// SELF-HOSTED (2026-09-22). These six were next/font/google declarations that
// fetched from Google at BUILD time; three production builds died inside that
// loader in one afternoon. The faces, weights and CSS variable names are
// unchanged — see src/lib/fonts.ts.

export const metadata: Metadata = {
  title: "PresentFlow — AI-native presentation for churches",
  description:
    "AI-native presentation for churches. The screen finally keeps up with the room.",
  icons: {
    icon: [{ url: "/brand/pf-logo-mark.png", type: "image/png" }],
    apple: [{ url: "/brand/pf-logo-mark.png" }],
  },
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`pf-site ${jakarta.variable} ${mono.variable} ${fraunces.variable} ${caveat.variable} ${cormorant.variable} ${lora.variable}`}
      style={{ fontFamily: "var(--pf-sans)" }}
    >
      <SiteNav />
      {children}
      <SiteFooter />
      <CookieConsent />
    </div>
  );
}
