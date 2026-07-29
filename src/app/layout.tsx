import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PresentFlow",
  description: "AI-native production console for live services",
  icons: {
    icon: [{ url: "/brand/pf-logo-mark.png", type: "image/png" }],
    apple: [{ url: "/brand/pf-logo-mark.png" }],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Dark is now DEFAULT. Users opt-in to light via ff_theme=light cookie.
  // Legacy ff_dark cookie is preserved for backwards compatibility.
  const cookieStore = await cookies();
  const theme = cookieStore.get("ff_theme")?.value;
  const legacyDark = cookieStore.get("ff_dark")?.value === "1";
  const isLight = theme === "light" || (!theme && !legacyDark && false);
  const htmlClass = isLight ? "light" : "";

  // Vercel Analytics + Speed Insights: only mount when running on the
  // production Vercel deployment. Dev + preview + local Electron shell all
  // skip them to keep the console clean and avoid noisy datapoints. The
  // components themselves are dev-safe, this is belt-and-braces.
  const isVercelProd = process.env.VERCEL_ENV === "production";

  return (
    <html lang="en" className={htmlClass} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        <Toaster position="top-right" theme="dark" richColors closeButton />
        {isVercelProd ? <Analytics /> : null}
        {isVercelProd ? <SpeedInsights /> : null}
      </body>
    </html>
  );
}
