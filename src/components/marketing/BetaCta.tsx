import Link from "next/link";

export default function BetaCta({
  heading,
  sub,
}: {
  heading: string;
  sub: string;
}) {
  return (
    <section style={{ maxWidth: 1160, margin: "0 auto", padding: "40px 24px 120px" }}>
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid rgba(255,255,255,.09)",
          borderRadius: 22,
          padding: "64px 40px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontWeight: 800,
            fontSize: "clamp(28px,4vw,44px)",
            letterSpacing: "-.03em",
          }}
        >
          {heading}
        </h2>
        <p
          style={{
            margin: "16px auto 0",
            maxWidth: 440,
            fontSize: 16,
            lineHeight: 1.6,
            color: "var(--muted)",
          }}
        >
          {sub}
        </p>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 30 }}>
          <Link
            href="/apply"
            className="pf-btn-primary"
            style={{
              fontWeight: 700,
              fontSize: 15,
              padding: "15px 28px",
              borderRadius: 10,
              background: "linear-gradient(100deg,#F7941D,#FDB748)",
              color: "#1A1005",
              boxShadow: "0 10px 40px rgba(247,148,29,.28)",
            }}
          >
            Apply for the beta&nbsp;→
          </Link>
        </div>
      </div>
    </section>
  );
}
