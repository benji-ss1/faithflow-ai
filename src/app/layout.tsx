import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ServiceWorkerRegister } from "@/components/system/ServiceWorkerRegister";
import { OfflineIndicator } from "@/components/system/OfflineIndicator";
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
  // Theme defaults are surface-dependent:
  //   Web admin shell  → LIGHT default (warm ivory reads better for daylight
  //                      admin/planning work; user opts INTO dark).
  //   Desktop shell    → DARK default (stage/booth environments, low ambient
  //                      light, projector confidence; user opts INTO light).
  // In both cases an explicit ff_theme cookie wins over the surface default.
  const cookieStore = await cookies();
  const hdrs = await headers();
  const theme = cookieStore.get("ff_theme")?.value;
  const legacyDark = cookieStore.get("ff_dark")?.value === "1";
  const isDesktopShell =
    hdrs.get("x-pf-shell") === "desktop" ||
    cookieStore.get("pf_shell")?.value === "desktop";
  const isDark =
    theme === "dark" ||
    (!theme && legacyDark) ||
    (!theme && isDesktopShell);
  const htmlClass = isDark ? "" : "light";

  // Vercel Analytics + Speed Insights: only mount when running on the
  // production Vercel deployment. Dev + preview + local Electron shell all
  // skip them to keep the console clean and avoid noisy datapoints. The
  // components themselves are dev-safe, this is belt-and-braces.
  const isVercelProd = process.env.VERCEL_ENV === "production";

  return (
    <html lang="en" className={htmlClass} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        <ServiceWorkerRegister />
        <OfflineIndicator />
        <Toaster position="top-right" theme={isDark ? "dark" : "light"} richColors closeButton />
        {isVercelProd ? <Analytics /> : null}
        {isVercelProd ? <SpeedInsights /> : null}
      </body>
    </html>
  );
}
