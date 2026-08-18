import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono, Fraunces, Caveat, Cormorant_Garamond, Lora } from "next/font/google";
import SiteNav from "@/components/marketing/SiteNav";
import SiteFooter from "@/components/marketing/SiteFooter";
import "@/components/marketing/site.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--pf-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--pf-mono",
  display: "swap",
});

// Editorial serif + handwritten face for the light-mode CTA section / footer.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--pf-serif",
  display: "swap",
});
const caveat = Caveat({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--pf-hand",
  display: "swap",
});
// Parchment menu faces.
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--pf-cormorant",
  display: "swap",
});
const lora = Lora({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--pf-lora",
  display: "swap",
});

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
    </div>
  );
}
