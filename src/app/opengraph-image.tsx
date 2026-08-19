import { ImageResponse } from "next/og";

// Branded link-preview image (shown in iMessage, WhatsApp, Slack, X, etc.) for
// any shared PresentFlow URL. Site-wide via the root opengraph-image convention.
export const alt = "PresentFlow — the screen finally keeps up with the room";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "70px 76px",
          background: "linear-gradient(135deg,#0B0B0B 0%,#1A0A14 55%,#0B0B0B 100%)",
          color: "#F4EFE4",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 36, fontWeight: 800, letterSpacing: -1 }}>
          <span>Present</span>
          <span style={{ color: "#ff7a2c" }}>Flow</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1.06, letterSpacing: -3 }}>
            The screen finally
          </div>
          <div style={{ display: "flex", fontSize: 78, fontWeight: 800, lineHeight: 1.06, letterSpacing: -3 }}>
            <span>keeps up with&nbsp;</span>
            <span style={{ color: "#ff7a2c" }}>the room.</span>
          </div>
          <div style={{ marginTop: 30, fontSize: 30, color: "#A29D93" }}>
            AI-native presentation for churches
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24 }}>
          <span style={{ color: "#8a8278" }}>presentflow.org</span>
          <span style={{ color: "#ff7a2c", fontWeight: 700 }}>Wave I · now in beta</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
