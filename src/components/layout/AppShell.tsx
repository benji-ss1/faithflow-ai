"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { RealtimeSyncBridge } from "@/components/layout/RealtimeSyncBridge";
import { useShell, type Shell } from "@/hooks/useShell";

type AppShellProps = {
  children: React.ReactNode;
  user: { name: string; email: string };
  churchId: string;
  churchName: string;
  churchLogoUrl?: string | null;
  // Y6: optional SSR-provided initial shell to prevent flash of web chrome.
  initialShell?: Shell;
};

export function AppShell({ children, user, churchId, churchName, churchLogoUrl, initialShell }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const shell = useShell(initialShell);
  const isDesktop = shell === "desktop";

  // Desktop shell (Electron): render children full-bleed with NO sidebar and
  // NO topbar chrome. The operator view provides its own top bar + left panel
  // — global chrome would double up. Web build unchanged.
  if (isDesktop) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        {children}
      </div>
    );
  }

  // Web admin shell. Wraps in .pf-admin-scope so the sidebar + content area
  // pick up the admin token palette (clean white in light mode, deep charcoal
  // in dark). Operator page on web is a niche path; it uses its own
  // component-level `bg-background` classes so it renders unaffected.
  return (
    <div className="pf-admin-scope relative flex min-h-screen bg-[var(--pf-admin-bg-page)] text-[var(--pf-admin-text)]">
      <Sidebar mobileOpen={mobileNavOpen} onMobileOpenChange={setMobileNavOpen} churchLogoUrl={churchLogoUrl} churchName={churchName} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          churchName={churchName}
          churchLogoUrl={churchLogoUrl}
          onOpenNavigation={() => setMobileNavOpen(true)}
        />
        <main className="flex-1 overflow-x-hidden px-4 pb-8 pt-5 sm:px-6 lg:px-8 lg:pt-6">
          {children}
        </main>
      </div>
      <RealtimeSyncBridge churchId={churchId} />
    </div>
  );
}
