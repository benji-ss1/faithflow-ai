import Link from "next/link";
import { requireUser } from "@/lib/session";
import { mintDeviceLinkToken } from "@/lib/device-link-actions";
import { DesktopDownloadPanel } from "@/components/settings/DesktopDownloadPanel";

export const dynamic = "force-dynamic";

export default async function OnboardingDownloadPage() {
  await requireUser();
  // Minted fresh on every page load (5 min TTL) — if the user sits on this
  // page a while before clicking, they can just refresh for a new one.
  const link = await mintDeviceLinkToken();
  const deepLinkHref = link.ok ? `presentflow://auth?token=${encodeURIComponent(link.token)}` : null;
  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 640, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", opacity: 0.6, marginBottom: 12 }}>
          Final step
        </div>
        <h1 style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1, marginBottom: 16, background: "linear-gradient(90deg,#ffb861,#ff7a2c)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Download Present Flow for your computer
        </h1>
        <p style={{ opacity: 0.8, fontSize: 17, lineHeight: 1.5, marginBottom: 32 }}>
          Your workspace is ready. The Present Flow desktop app is where you run live services — projector output, stage display, real-time AI detection, and Bible panel all run locally on your church's computer.
        </p>

        <DesktopDownloadPanel deepLinkHref={deepLinkHref} />

        <Link
          href="/dashboard"
          style={{ color: "#ffb861", textDecoration: "underline", fontSize: 14 }}
        >
          Skip for now — take me to the web dashboard
        </Link>
      </div>
    </div>
  );
}
