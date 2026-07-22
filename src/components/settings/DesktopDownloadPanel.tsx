"use client";
import { toast } from "sonner";
import { DESKTOP_DOWNLOAD_ARM64_URL, DESKTOP_DOWNLOAD_X64_URL } from "@/lib/desktop-download";

/**
 * Shared desktop-download UI — used by both the first-time onboarding flow
 * (src/app/onboarding/download) and the always-available Settings entry
 * (src/app/(app)/settings/download), so an existing user who skipped
 * onboarding, or is setting up a second machine, isn't stuck without a way
 * back to this page. `deepLinkHref` is minted server-side per-page (a fresh
 * 5-minute single-use token) since it needs `requireUser()`.
 */
export function DesktopDownloadPanel({ deepLinkHref, showSkipLink = true }: { deepLinkHref: string | null; showSkipLink?: boolean }) {
  const copyXattr = () => {
    const cmd = 'xattr -cr /Applications/Present\\ Flow.app';
    navigator.clipboard?.writeText(cmd).then(
      () => toast.success("Copied — paste into Terminal"),
      () => toast.error("Couldn't copy — select the text manually"),
    );
  };

  return (
    <div style={{ maxWidth: 640, width: "100%" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        <DownloadCard platform="macOS (Apple Silicon)" href={DESKTOP_DOWNLOAD_ARM64_URL} hint="M1/M2/M3/M4 Macs" />
        <DownloadCard platform="macOS (Intel)" href={DESKTOP_DOWNLOAD_X64_URL} hint="Older Intel Macs" />
      </div>
      <p style={{ opacity: 0.6, fontSize: 12, marginTop: -8, marginBottom: 20 }}>
        Not sure which Mac you have? Click the Apple menu → About This Mac — it lists the chip.
      </p>

      <div style={{ textAlign: "left", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "16px 20px", marginBottom: 24, fontSize: 13, lineHeight: 1.6, opacity: 0.85 }}>
        <strong style={{ display: "block", marginBottom: 6, opacity: 1 }}>macOS will warn you before opening it — that&apos;s expected.</strong>
        The app isn&apos;t notarized by Apple yet, so the first time you open it macOS blocks it as being from an &quot;unidentified developer.&quot; To open it:
        <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li>Move the downloaded <code>.dmg</code> to Applications like normal (drag the app icon into the Applications folder).</li>
          <li>Right-click (or Control-click) the Present Flow app in Applications and choose <strong>Open</strong> — do NOT just double-click it the first time.</li>
          <li>You&apos;ll see a warning dialog. Click <strong>Open Anyway</strong>.</li>
          <li>
            If macOS still refuses (some versions do), open <strong>Terminal</strong> and paste this, then press Enter:
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <pre style={{ background: "#000", padding: "8px 10px", borderRadius: 6, overflowX: "auto", flex: 1, margin: 0 }}>xattr -cr /Applications/Present&#92; Flow.app</pre>
              <button
                type="button"
                onClick={copyXattr}
                style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                Copy
              </button>
            </div>
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
              display: "inline-block", padding: "12px 28px", borderRadius: 10,
              background: "linear-gradient(90deg,#ffb861,#ff7a2c)", color: "#0a0a0a",
              fontWeight: 600, fontSize: 15, textDecoration: "none", marginBottom: 12,
            }}
          >
            Downloaded? Open PresentFlow — you&apos;ll be signed in automatically
          </a>
          <div style={{ opacity: 0.55, fontSize: 12, marginBottom: showSkipLink ? 32 : 0 }}>
            This link expires in 5 minutes and only works once — refresh this page for a new one if it&apos;s stale.
            <br />
            First time installing? Open the downloaded app once manually first (you&apos;ll see a normal sign-in screen) — that
            one launch is what lets your computer recognize this link afterward. From then on, this button signs you in automatically.
          </div>
        </>
      ) : (
        <div style={{ opacity: 0.6, fontSize: 13, marginBottom: showSkipLink ? 32 : 0 }}>
          On first launch, sign in with the account you just created. Your church data will sync automatically.
        </div>
      )}
    </div>
  );
}

function DownloadCard({ platform, href, hint }: { platform: string; href: string; hint: string }) {
  return (
    <a
      href={href}
      style={{
        display: "block", padding: 20, borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)",
        textDecoration: "none", color: "#fff", transition: "background 0.15s",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Download for {platform}</div>
      <div style={{ fontSize: 12, opacity: 0.6 }}>{hint}</div>
    </a>
  );
}
