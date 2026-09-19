import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ServiceWorkerRegister } from "@/components/system/ServiceWorkerRegister";
import { UpdatePrompt } from "@/components/system/UpdatePrompt";
import { OutputReloadListener } from "@/components/system/OutputReloadListener";
import { PostHogProvider } from "@/components/system/PostHogProvider";
import { OfflineIndicator } from "@/components/system/OfflineIndicator";
import { OperatorChrome } from "@/components/system/OperatorChrome";
import "./globals.css";
import "./slide-fonts.css";
import "@/styles/openflow.css";
import { openFlowFontVars } from "@/lib/openflow/fonts";
import { PLATFORM_ATTR_SCRIPT } from "@/lib/platform";

export const metadata: Metadata = {
  metadataBase: new URL("https://presentflow.org"),
  title: "PresentFlow — AI-native presentation for churches",
  description:
    "The screen finally keeps up with the room. AI-native presentation for churches — apply for the Wave I beta.",
  icons: {
    icon: [{ url: "/brand/pf-logo-mark.png", type: "image/png" }],
    apple: [{ url: "/brand/pf-logo-mark.png" }],
  },
  openGraph: {
    title: "PresentFlow — AI-native presentation for churches",
    description:
      "The screen finally keeps up with the room. AI-native presentation for churches.",
    url: "https://presentflow.org",
    siteName: "PresentFlow",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PresentFlow — AI-native presentation for churches",
    description: "The screen finally keeps up with the room.",
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
      <head>
        {/* Fonts P1 (2026-09-17): preload ONLY the default projector face (Sora
            normal, the --font-display primary). Without it the first slide of a
            service can paint in the fallback and then reflow when the real face
            lands. Exactly one file — preloading the whole library would cost
            bandwidth for faces most churches never pick. */}
        <link rel="preload" href="/fonts/sora/sora-100-800-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body suppressHydrationWarning className={openFlowFontVars}>
        {/* Windows-only CSS scoping hook (html[data-platform=win]) — no-op on macOS. */}
        <script dangerouslySetInnerHTML={{ __html: PLATFORM_ATTR_SCRIPT }} />
        {children}
        <PostHogProvider />
        <ServiceWorkerRegister />
        {/* Operator-only chrome: never mounted on /live /stage /livestream /ndi (OperatorChrome). */}
        <OperatorChrome><UpdatePrompt /></OperatorChrome>
        <OutputReloadListener />
        <OperatorChrome><OfflineIndicator /></OperatorChrome>
        {/* Notification style (2026-08-15): the clean, strong dark card — the
            "Added: … [Undo]" look the user asked to standardise on. richColors
            (loud green/red fills) is OFF so EVERY toast — success, error, info,
            undo — renders as the same premium neutral card with a white action
            pill. Semantic meaning still reads via sonner's status icon + the
            message text, without the shouty backgrounds. */}
        <OperatorChrome>
        <Toaster
          position="top-right"
          theme={isDark ? "dark" : "light"}
          closeButton
          gap={10}
          toastOptions={{
            style: {
              background: isDark ? "rgba(15,15,17,0.96)" : "rgba(255,255,255,0.98)",
              color: isDark ? "#f4f4f5" : "#18181b",
              border: isDark
                ? "1px solid rgba(255,255,255,0.10)"
                : "1px solid rgba(0,0,0,0.08)",
              borderRadius: "14px",
              boxShadow: isDark
                ? "0 14px 44px rgba(0,0,0,0.55)"
                : "0 14px 44px rgba(0,0,0,0.16)",
              fontSize: "15px",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              padding: "15px 17px",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
            },
            actionButtonStyle: {
              background: isDark ? "#ffffff" : "#18181b",
              color: isDark ? "#0f0f11" : "#ffffff",
              fontWeight: 700,
              fontSize: "14px",
              borderRadius: "9px",
              padding: "8px 15px",
            },
            cancelButtonStyle: {
              background: "transparent",
              color: isDark ? "#a1a1aa" : "#71717a",
              fontWeight: 600,
            },
          }}
        />
        </OperatorChrome>
        {isVercelProd ? <Analytics /> : null}
        {isVercelProd ? <SpeedInsights /> : null}
      </body>
    </html>
  );
}
