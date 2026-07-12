"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { useShell } from "@/hooks/useShell";

type AppShellProps = {
  children: React.ReactNode;
  user: { name: string; email: string };
  churchName: string;
};

export function AppShell({ children, user, churchName }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const shell = useShell();
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

  return (
    <div className="relative flex min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(111,224,194,0.07),transparent_24%),radial-gradient(circle_at_top_right,rgba(123,199,255,0.07),transparent_22%),linear-gradient(180deg,#141818_0%,#151919_32%,#171c1c_100%)]" />
        <div className="absolute inset-y-0 left-0 w-[28rem] bg-[radial-gradient(circle_at_left,rgba(255,255,255,0.03),transparent_65%)]" />
      </div>

      <Sidebar mobileOpen={mobileNavOpen} onMobileOpenChange={setMobileNavOpen} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          churchName={churchName}
          onOpenNavigation={() => setMobileNavOpen(true)}
        />
        <main className="flex-1 overflow-x-hidden px-4 pb-8 pt-5 sm:px-6 lg:px-8 lg:pt-6">
          {children}
        </main>
      </div>
    </div>
  );
}
