"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Church logo avatar — shared by the sidebar workspace pill and the topbar
 * church badge. Three states:
 *
 *  · logoUrl provided → renders <img> with:
 *      - subtle skeleton shimmer while `onLoad` hasn't fired
 *      - onError → falls back to monogram (broken/expired presign, S3 blip)
 *  · no logoUrl → monogram (first letter of church name) on the fallback bg
 *
 * Deliberately client-side (`"use client"`) so we can track load state per
 * mount. Size is caller-controlled — the two current call sites use 22px
 * (sidebar) and 24px (topbar).
 */
export function ChurchLogoAvatar({
  logoUrl,
  churchName,
  size,
  variant = "auto",
  className,
}: {
  logoUrl: string | null | undefined;
  churchName: string | null | undefined;
  size: number;
  /**
   * "auto"  — default. Uses sidebar-header tile tokens (which flip with theme).
   * "dark"  — legacy dark surface (kept for external callers that hardcoded).
   * "light" — legacy light surface.
   */
  variant?: "auto" | "dark" | "light";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const showFallback = !logoUrl || failed;
  const monogram = (churchName || "?").trim().charAt(0).toUpperCase() || "?";

  const fallbackCls =
    variant === "light"
      ? "bg-[var(--pf-admin-bg-muted)] text-[var(--pf-admin-text-secondary)]"
      : variant === "dark"
        ? "bg-white/15 text-white/90"
        : "bg-[var(--pf-sidebar-header-tile-bg)] text-[var(--pf-sidebar-header-text)]";

  const skeletonCls =
    variant === "light"
      ? "bg-[var(--pf-admin-bg-muted)]"
      : variant === "dark"
        ? "bg-white/10"
        : "bg-[var(--pf-sidebar-header-tile-bg)]";

  return (
    <div
      className={cn("relative shrink-0 overflow-hidden rounded", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {showFallback ? (
        <div
          className={cn("flex h-full w-full items-center justify-center font-semibold", fallbackCls)}
          style={{ fontSize: Math.max(9, Math.floor(size * 0.42)) }}
        >
          {monogram}
        </div>
      ) : (
        <>
          {!loaded && (
            <div className={cn("absolute inset-0 animate-pulse", skeletonCls)} aria-hidden />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl!}
            alt=""
            width={size}
            height={size}
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={cn(
              "h-full w-full object-contain transition-opacity duration-200",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
        </>
      )}
    </div>
  );
}
