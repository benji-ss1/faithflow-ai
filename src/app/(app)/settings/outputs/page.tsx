import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

export default function OutputsSettingsPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Settings"
        title="Devices & Outputs"
        description="Projector, stage display, and livestream outputs are configured from the Present Flow desktop app. This page is a stub — full device management from the web is a future feature."
      />

      <div style={{ marginTop: 24, padding: 24, borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)" }}>
        <div style={{ fontSize: 15, opacity: 0.8, marginBottom: 16, lineHeight: 1.5 }}>
          Manage your devices from the Present Flow desktop app. Screen assignments, projector calibration, and stage display layout live on the machine that runs your service.
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link
            href="/onboarding/download"
            style={{ display: "inline-block", padding: "10px 16px", borderRadius: 8, background: "linear-gradient(90deg,#ffb861,#ff7a2c)", color: "#0a0a0a", fontWeight: 600, textDecoration: "none", fontSize: 14 }}
          >
            Download desktop app
          </Link>
          <Link
            href="/settings/devices"
            style={{ display: "inline-block", padding: "10px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", color: "#fff", textDecoration: "none", fontSize: 14 }}
          >
            View paired devices
          </Link>
        </div>
      </div>
    </div>
  );
}
