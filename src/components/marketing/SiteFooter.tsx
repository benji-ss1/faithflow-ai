import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer style={{ borderTop: "1px solid rgba(255,255,255,.07)" }}>
      <div
        style={{
          maxWidth: 1160,
          margin: "0 auto",
          padding: "36px 24px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 18,
        }}
      >
        <Link href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/marketing/logo-trans.png"
            alt="PresentFlow"
            style={{ height: 84, marginLeft: -20, display: "block" }}
          />
        </Link>
        <div
          style={{
            font: "500 11px 'JetBrains Mono', monospace",
            letterSpacing: "0.14em",
            color: "var(--faint)",
          }}
        >
          © 2026 PRESENTFLOW
        </div>
      </div>
    </footer>
  );
}
