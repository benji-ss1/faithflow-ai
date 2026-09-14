"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DESKTOP_DOWNLOAD_ARM64_URL,
  DESKTOP_DOWNLOAD_X64_URL,
  DESKTOP_DOWNLOAD_WIN_URL,
  resolveDesktopDownloadUrls,
  type DesktopDownloadUrls,
} from "@/lib/desktop-download";
import { detectDesktopOs, type DesktopOs } from "@/lib/desktop-os";

type OS = DesktopOs;

const INITIAL_URLS: DesktopDownloadUrls = {
  arm64Url: DESKTOP_DOWNLOAD_ARM64_URL,
  x64Url: DESKTOP_DOWNLOAD_X64_URL,
  winUrl: DESKTOP_DOWNLOAD_WIN_URL,
  macVersion: "",
  winVersion: "",
  source: "fallback",
};

/**
 * Shared desktop-download UI — used by the onboarding download step and the
 * Settings download page. Auto-detects the operator's OS so the right installer
 * (Windows .exe or macOS .dmg) is the big primary button; the rest are tucked
 * under "Other computers". `deepLinkHref` is a fresh 5-min single-use token
 * minted server-side; the deep-link auto-sign-in works on Windows AND macOS.
 *
 * Download links auto-track whatever was most recently published to GitHub
 * Releases (`resolveDesktopDownloadUrls`) — cutting + publishing a new
 * DMG/exe is enough, no code change needed for this page to pick it up.
 * Renders the hardcoded fallback constants first (correct as of the last
 * manual bump) so there's never a blank/broken link while the live lookup
 * runs, then swaps in the live URLs once resolved.
 */
export function DesktopDownloadPanel({ deepLinkHref, showSkipLink = true }: { deepLinkHref: string | null; showSkipLink?: boolean }) {
  const [os, setOs] = useState<OS | null>(null);
  const [urls, setUrls] = useState<DesktopDownloadUrls>(INITIAL_URLS);

  useEffect(() => {
    setOs(detectDesktopOs(navigator as Navigator & { userAgentData?: { platform?: string } }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    resolveDesktopDownloadUrls().then((resolved) => {
      if (!cancelled) setUrls(resolved);
    });
    return () => { cancelled = true; };
  }, []);

  const copyXattr = () => {
    navigator.clipboard?.writeText('xattr -cr /Applications/Present\\ Flow.app').then(
      () => toast.success("Copied — paste into Terminal"),
      () => toast.error("Couldn't copy — select the text manually"),
    );
  };

  // Windows AND macOS are both shown prominently, side by side — churches run
  // both and Windows was previously buried behind a link. The detected OS gets
  // only its ORDER (it leads) — no "this computer" badge: UA
  // sniffing mislabelled cards for Windows users, and browsers can't tell Apple
  // Silicon from Intel, so both Mac cards are presented equally.
  const winCard = <DownloadCard key="win" platform="Windows" href={urls.winUrl} hint="Windows 10 / 11 · .exe installer" primary />;
  const macArm = <DownloadCard key="marm" platform="macOS (Apple Silicon)" href={urls.arm64Url} hint="M1 / M2 / M3 / M4 Macs" primary />;
  const macInt = <DownloadCard key="mint" platform="macOS (Intel)" href={urls.x64Url} hint="Older Intel Macs" primary />;

  // Detected OS leads. Windows on its own row; the two Mac cards sit side by
  // side as equals (we never claim which Mac architecture this is).
  const winRow = <div key="win-row" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 12 }}>{winCard}</div>;
  const macRow = <div key="mac-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>{macArm}{macInt}</div>;
  const rows = os === "windows" ? [winRow, macRow] : [macRow, winRow];

  return (
    <div style={{ maxWidth: 640, width: "100%" }}>
      {rows}
      <div style={{ marginBottom: 8 }} />

      {/* First-launch instructions — BOTH shown so a Mac operator setting up a
          Windows church PC (or vice-versa) always has the steps they need.
          Detected OS is ordered first. */}
      {(os === "windows" ? ["win", "mac"] : ["mac", "win"]).map((which) => (
        which === "win" ? (
          <div key="win-box" style={{ textAlign: "left", background: "#ffffff", border: "1px solid rgba(10,10,10,0.12)", borderRadius: 10, padding: "16px 20px", marginBottom: 16, fontSize: 13, lineHeight: 1.6, color: "#1a1a1a", boxShadow: "0 1px 3px rgba(10,10,10,0.06)" }}>
            <strong style={{ display: "block", marginBottom: 6 }}>Windows: it will show a blue warning the first time — that&apos;s expected.</strong>
            The app isn&apos;t signed yet, so Windows SmartScreen shows a &quot;Windows protected your PC&quot; box. To open it:
            <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              <li>Double-click the downloaded <code>PresentFlow-Setup.exe</code>.</li>
              <li>On the blue &quot;Windows protected your PC&quot; box, click <strong>More info</strong>.</li>
              <li>Then click <strong>Run anyway</strong>.</li>
              <li>It installs (no admin password needed) and opens automatically.</li>
            </ol>
            This one-time warning only happens on the first install.
          </div>
        ) : (
          <div key="mac-box" style={{ textAlign: "left", background: "#ffffff", border: "1px solid rgba(10,10,10,0.12)", borderRadius: 10, padding: "16px 20px", marginBottom: 16, fontSize: 13, lineHeight: 1.6, color: "#1a1a1a", boxShadow: "0 1px 3px rgba(10,10,10,0.06)" }}>
            <strong style={{ display: "block", marginBottom: 6 }}>macOS: it will warn you before opening it — that&apos;s expected.</strong>
            The app isn&apos;t notarized by Apple yet, so the first time you open it macOS blocks it as being from an &quot;unidentified developer.&quot; To open it:
            <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              <li>Move the downloaded <code>.dmg</code> to Applications like normal (drag the app icon into the Applications folder).</li>
              <li>Right-click (or Control-click) the Present Flow app in Applications and choose <strong>Open</strong> — do NOT just double-click it the first time.</li>
              <li>You&apos;ll see a warning dialog. Click <strong>Open Anyway</strong>.</li>
              <li>
                If macOS still refuses (some versions do), open <strong>Terminal</strong> and paste this, then press Enter:
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <pre style={{ background: "#f1eee8", color: "#1a1a1a", border: "1px solid rgba(10,10,10,0.12)", padding: "8px 10px", borderRadius: 6, overflowX: "auto", flex: 1, margin: 0, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" }}>xattr -cr /Applications/Present&#92; Flow.app</pre>
                  <button type="button" onClick={copyXattr} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #1a1a1a", background: "#1a1a1a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Copy</button>
                </div>
                then try opening it again the same way (right-click → Open).
              </li>
            </ol>
            This one-time warning only happens on first launch.
          </div>
        )
      ))}

      {deepLinkHref ? (
        <>
          <a href={deepLinkHref} style={{ display: "inline-block", padding: "12px 28px", borderRadius: 10, background: "linear-gradient(90deg,#ffb861,#e8501a)", color: "#0a0a0a", fontWeight: 600, fontSize: 15, textDecoration: "none", marginBottom: 12 }}>
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

function DownloadCard({ platform, href, hint, primary }: { platform: string; href: string; hint: string; primary: boolean }) {
  return (
    <a
      href={href}
      style={{
        position: "relative", display: "block", padding: 20, borderRadius: 12,
        border: primary ? "1px solid #e8501a" : "1px solid rgba(10,10,10,0.2)",
        background: primary ? "linear-gradient(90deg,#ffb861,#e8501a)" : "#ffffff",
        textDecoration: "none", color: primary ? "#0a0a0a" : "#1a1a1a", transition: "background 0.15s",
        boxShadow: primary ? "0 2px 8px rgba(232,80,26,0.25)" : "0 1px 3px rgba(10,10,10,0.08)",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Download for {platform}</div>
      <div style={{ fontSize: 12, opacity: primary ? 0.8 : 0.65 }}>{hint}</div>
    </a>
  );
}
