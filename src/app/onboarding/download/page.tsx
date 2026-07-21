import Link from "next/link";
import { requireUser } from "@/lib/session";
import { mintDeviceLinkToken } from "@/lib/device-link-actions";

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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
          <DownloadCard
            platform="macOS"
            href="/downloads/present-flow-mac.dmg"
            hint="Apple silicon & Intel"
          />
          <DownloadCard
            platform="Windows"
            href="/downloads/present-flow-win.exe"
            hint="Windows 10 & 11"
          />
        </div>

        {deepLinkHref ? (
          <>
            <a
              href={deepLinkHref}
              style={{
                display: "inline-block",
                padding: "12px 28px",
                borderRadius: 10,
                background: "linear-gradient(90deg,#ffb861,#ff7a2c)",
                color: "#0a0a0a",
                fontWeight: 600,
                fontSize: 15,
                textDecoration: "none",
                marginBottom: 12,
              }}
            >
              Downloaded? Open PresentFlow — you'll be signed in automatically
            </a>
            <div style={{ opacity: 0.55, fontSize: 12, marginBottom: 32 }}>
              This link expires in 5 minutes and only works once — refresh this page for a new one if it's stale.
              <br />
              First time installing? Open the downloaded app once manually first (you'll see a normal sign-in screen) — that
              one launch is what lets your computer recognize this link afterward. From then on, this button signs you in automatically.
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 32 }}>
            On first launch, sign in with the account you just created. Your church data will sync automatically.
          </div>
        )}

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

function DownloadCard({ platform, href, hint }: { platform: string; href: string; hint: string }) {
  return (
    <a
      href={href}
      style={{
        display: "block",
        padding: 20,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.03)",
        textDecoration: "none",
        color: "#fff",
        transition: "background 0.15s",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Download for {platform}</div>
      <div style={{ fontSize: 12, opacity: 0.6 }}>{hint}</div>
    </a>
  );
}
