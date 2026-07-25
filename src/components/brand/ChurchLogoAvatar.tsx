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
  variant = "dark",
  className,
}: {
  logoUrl: string | null | undefined;
  churchName: string | null | undefined;
  size: number;
  /**
   * "dark" — for placement inside the sidebar's branded dark gradient header
   *          (fallback bg reads against dark chrome).
   * "light" — for the topbar's neutral admin-palette badge (fallback bg
   *           reads against the light card).
   */
  variant?: "dark" | "light";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const showFallback = !logoUrl || failed;
  const monogram = (churchName || "?").trim().charAt(0).toUpperCase() || "?";

  const fallbackCls =
    variant === "light"
      ? "bg-[var(--pf-admin-bg-muted)] text-[var(--pf-admin-text-secondary)]"
      : "bg-white/15 text-white/90";

  const skeletonCls =
    variant === "light" ? "bg-[var(--pf-admin-bg-muted)]" : "bg-white/10";

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
