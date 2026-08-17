import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
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
      className={`pf-site ${jakarta.variable} ${mono.variable}`}
      style={{ fontFamily: "var(--pf-sans)" }}
    >
      <SiteNav />
      {children}
      <SiteFooter />
    </div>
  );
}
