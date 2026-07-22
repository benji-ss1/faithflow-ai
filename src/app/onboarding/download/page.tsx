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
            platform="macOS (Apple Silicon)"
            href="https://github.com/benji-ss1/faithflow-ai/releases/download/v0.1.9/Present-Flow-0.1.9-arm64-mac.dmg"
            hint="M1/M2/M3/M4 Macs"
          />
          <DownloadCard
            platform="macOS (Intel)"
            href="https://github.com/benji-ss1/faithflow-ai/releases/download/v0.1.9/Present-Flow-0.1.9-x64-mac.dmg"
            hint="Older Intel Macs"
          />
        </div>
        <p style={{ opacity: 0.6, fontSize: 12, marginTop: -8, marginBottom: 20 }}>
          Not sure which Mac you have? Click the Apple menu → About This Mac — it lists the chip.
        </p>

        <div style={{ textAlign: "left", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "16px 20px", marginBottom: 24, fontSize: 13, lineHeight: 1.6, opacity: 0.85 }}>
          <strong style={{ display: "block", marginBottom: 6, opacity: 1 }}>macOS will warn you before opening it — that's expected.</strong>
          The app isn&apos;t notarized by Apple yet, so the first time you open it macOS blocks it as being from an &quot;unidentified developer.&quot; To open it:
          <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            <li>Move the downloaded <code>.dmg</code> to Applications like normal (drag the app icon into the Applications folder).</li>
            <li>Right-click (or Control-click) the Present Flow app in Applications and choose <strong>Open</strong> — do NOT just double-click it the first time.</li>
            <li>You&apos;ll see a warning dialog. Click <strong>Open Anyway</strong>.</li>
            <li>If macOS still refuses (some versions do), open <strong>Terminal</strong> and run:
              <pre style={{ background: "#000", padding: "8px 10px", borderRadius: 6, marginTop: 6, overflowX: "auto" }}>xattr -cr /Applications/Present\ Flow.app</pre>
              then try opening it again the same way (right-click → Open).
            </li>
          </ol>
          This one-time warning only happens on first launch.
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
