import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";

/**
 * Dark marketing shell for the upgrade pages. Lives OUTSIDE the (app) route
 * group deliberately so we get no sidebar / no admin topbar — a clean
 * full-page dark experience for the "read the pitch, then upgrade" flow.
 *
 * Reachable from the billing page's CTA buttons (/settings/billing) and by
 * direct URL. requireUser() / requireRole() are handled per-page by the
 * checkout action when a user hits the actual "Start free trial" button;
 * the marketing content itself doesn't need to gate on auth.
 */
export default function UpgradeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: "#08080C", color: "#F1EFE8" }}>
      <header className="sticky top-0 z-40 border-b" style={{ background: "rgba(8,8,12,0.72)", borderColor: "#2A2A2E", backdropFilter: "blur(12px)" }}>
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/settings/billing" className="inline-flex items-center gap-2 text-xs font-medium transition-colors hover:text-white" style={{ color: "#8B8B92" }}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to billing
          </Link>
          <div className="flex items-center gap-2.5">
            <Image src="/brand/pf-logo-mark.png" alt="" width={22} height={22} className="object-contain" />
            <div className="text-sm font-semibold">
              <span style={{ color: "#F1EFE8" }}>Present</span>
              <span style={{ color: "#E8A838" }}>Flow</span>
            </div>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
