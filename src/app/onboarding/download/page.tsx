import Link from "next/link";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function OnboardingDownloadPage() {
  await requireUser();
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

        <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 32 }}>
          On first launch, sign in with the account you just created. Your church data will sync automatically.
        </div>

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
