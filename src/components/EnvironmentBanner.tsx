/**
 * EnvironmentBanner — "is what I'm looking at real?"
 *
 * Until this existed there was NO way to tell. Preview URLs are random hashes
 * nobody reads, and the desktop shell has no address bar at all — so inside the
 * app a test build and the live app were visually identical. Two consequences:
 * a tester reports a bug against the wrong build, and — far worse — someone
 * runs a real Sunday service off a test build without knowing.
 *
 * FAILS LOUD, DELIBERATELY. The dangerous direction is asymmetric: believing
 * you are on a test build when you are on production is catastrophic; the
 * reverse is merely annoying. So the banner renders unless VERCEL_ENV is
 * EXPLICITLY "production" — a missing or misconfigured value shows the banner
 * rather than hiding it, and a broken deploy degrades toward "looks like a test
 * build", never toward "looks safe".
 *
 * Colours are hard-coded, never theme tokens: a theme bug must not be able to
 * make this invisible.
 */

export type EnvBannerKind = "preview" | "demo" | null;

/** Decide what to show. Pure and exported so it is directly testable — the
 *  logic, not the markup, is the part that must never regress. */
export function envBannerKind(vercelEnv: string | undefined, isDemoChurch: boolean): EnvBannerKind {
  // Explicitly production is the ONLY way to suppress the environment banner.
  if (vercelEnv !== "production") return "preview";
  // On production, a demo church still gets a quieter marker so a tester
  // knows the data is not a real congregation's.
  if (isDemoChurch) return "demo";
  return null;
}

export const ENV_BANNER_HEIGHT_PX = 26;

export function EnvironmentBanner({
  vercelEnv,
  isDemoChurch = false,
  dataNote,
}: {
  vercelEnv: string | undefined;
  isDemoChurch?: boolean;
  /** e.g. "data copied 12 Sep" — makes staleness visible on every screen. */
  dataNote?: string;
}) {
  const kind = envBannerKind(vercelEnv, isDemoChurch);
  if (!kind) return null;

  const isPreview = kind === "preview";
  const bg = isPreview ? "#B91C1C" : "#92400E";  // red for "not live", amber for "demo data"
  const label = isPreview ? "TEST BUILD — NOT THE LIVE APP" : "DEMO CHURCH — NOT A REAL CONGREGATION";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 2147483647,
        height: ENV_BANNER_HEIGHT_PX, background: bg, color: "#ffffff",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        // Never let a click land on the banner instead of the app beneath it.
        pointerEvents: "none",
        borderBottom: "1px solid rgba(0,0,0,0.25)",
      }}
    >
      <span>{label}</span>
      {dataNote && <span style={{ opacity: 0.8, fontWeight: 500 }}>· {dataNote}</span>}
    </div>
  );
}

/**
 * The same signal for an OUTPUT surface (/live, /stage, /livestream, /ndi).
 *
 * These are what a congregation sees, so a full-width bar is not acceptable —
 * but going unmarked is worse. If a test build's projector output is
 * indistinguishable from production, someone eventually runs a real service
 * off it. A small corner mark is the compromise: unmissable to an operator
 * looking for it, survives a screenshot so a bug report is self-labelling, and
 * small enough not to ruin the output if it is ever seen.
 */
export function OutputEnvironmentMark({ vercelEnv }: { vercelEnv: string | undefined }) {
  if (vercelEnv === "production") return null;
  return (
    <div
      aria-hidden
      style={{
        position: "fixed", bottom: 8, right: 10, zIndex: 2147483647,
        padding: "2px 7px", borderRadius: 3,
        background: "rgba(185,28,28,0.85)", color: "#ffffff",
        fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      TEST BUILD
    </div>
  );
}
