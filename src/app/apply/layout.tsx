import { Cormorant_Garamond, Lora, JetBrains_Mono } from "next/font/google";

// The beta application is a full-bleed, immersive "book" experience and
// deliberately does NOT sit under the dark marketing chrome (SiteNav/SiteFooter).
// It lives at a top-level /apply route with its own parchment layout. Every
// "Apply for the beta" CTA on the site already points to /apply, so the URL is
// unchanged — only the surrounding chrome is dropped.
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--pf-cormorant",
  display: "swap",
});
const lora = Lora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--pf-lora",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--pf-mono",
  display: "swap",
});

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${cormorant.variable} ${lora.variable} ${mono.variable}`}
      style={{ minHeight: "100vh", background: "#efeae0" }}
    >
      {children}
    </div>
  );
}
