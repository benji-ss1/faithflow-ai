import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "FaithFlow AI",
  description: "AI-native production console for live services",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Dark is now DEFAULT. Users opt-in to light via ff_theme=light cookie.
  // Legacy ff_dark cookie is preserved for backwards compatibility.
  const cookieStore = await cookies();
  const theme = cookieStore.get("ff_theme")?.value;
  const legacyDark = cookieStore.get("ff_dark")?.value === "1";
  const isLight = theme === "light" || (!theme && !legacyDark && false);
  const htmlClass = isLight ? "light" : "";

  return (
    <html lang="en" className={htmlClass} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        <Toaster position="top-right" theme="dark" richColors closeButton />
      </body>
    </html>
  );
}
