import Link from "next/link";

const CHURCH =
  "M60 8 L60 24 M20 52 L60 24 L100 52 M24 52 L24 86 M96 52 L96 86 M16 86 L104 86 M52 86 L52 64 L68 64 L68 86";

export default function SiteFooter() {
  return (
    <footer style={{ background: "var(--bg)", borderTop: "1px solid rgba(255,255,255,.06)" }}>
      <div
        style={{
          maxWidth: 1160,
          margin: "0 auto",
          padding: "clamp(48px,8vw,88px) clamp(24px,6vw,72px)",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 28,
        }}
      >
        <div>
          <Link
            href="/"
            style={{
              fontFamily: "var(--pf-serif), Georgia, serif",
              fontSize: "clamp(26px,3vw,40px)",
              letterSpacing: "-.02em",
              color: "var(--ink)",
              display: "inline-block",
            }}
          >
            <span style={{ fontWeight: 600 }}>Present</span>
            <span style={{ fontWeight: 300 }}>Flow</span>
          </Link>
          <div
            style={{
              marginTop: 14,
              font: "500 11px var(--pf-mono)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--faint)",
            }}
          >
            © 2026 PresentFlow
          </div>
        </div>
        {/* church line-drawing, mirroring the editorial mark above */}
        <svg width="88" height="74" viewBox="0 0 120 100" aria-hidden="true" style={{ opacity: 0.85 }}>
          <path d={CHURCH} fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </footer>
  );
}
