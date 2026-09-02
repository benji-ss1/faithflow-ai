// Full-screen lock shown across the whole app (web dashboard AND desktop
// operator — both live under the (app) route group) once a church's beta trial
// has expired. There is no self-serve checkout yet, so the only way back in is
// to contact us; a "Pay" flow slots in here when pricing lands. Server-rendered
// (a plain mailto link, no client JS needed).
const HELP_EMAIL = "contact@presentflow.org";

export function TrialEndedLock({ churchName }: { churchName?: string | null }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "radial-gradient(120% 90% at 50% -10%, #161318, #0a0a0b 60%)",
        color: "#ECE7E0",
        fontFamily: '"Sora","Plus Jakarta Sans",system-ui,sans-serif',
      }}
    >
      <div style={{ maxWidth: 480, width: "100%", textAlign: "center" }}>
        <div
          style={{
            width: 44,
            height: 44,
            margin: "0 auto 22px",
            borderRadius: 12,
            background: "conic-gradient(from 210deg,#ff7a2c,#ffb861,#ff7a2c)",
          }}
        />
        <div
          style={{
            fontFamily: "ui-monospace,Menlo,monospace",
            fontSize: 11,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#ff7a2c",
            marginBottom: 14,
          }}
        >
          Your trial has ended
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.12, margin: "0 0 14px" }}>
          Thanks for trying PresentFlow{churchName ? `, ${churchName}` : ""}.
        </h1>
        <p style={{ color: "#9a938a", fontSize: 15, lineHeight: 1.6, margin: "0 0 26px" }}>
          Your free trial week is up. We hope it made your services lighter. To keep going — your songs, Bibles, themes,
          and the live AI — reach out and we&rsquo;ll get you set up. Everything you added is safe and waiting.
        </p>
        <a
          href={`mailto:${HELP_EMAIL}?subject=${encodeURIComponent("PresentFlow — continue after my trial")}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "13px 22px",
            borderRadius: 11,
            fontWeight: 700,
            fontSize: 15,
            textDecoration: "none",
            color: "#1a0f06",
            background: "linear-gradient(180deg,#ffb861,#ff7a2c)",
            boxShadow: "0 10px 30px -12px rgba(255,122,44,0.6)",
          }}
        >
          Contact us to continue — {HELP_EMAIL}
        </a>
        <div style={{ marginTop: 18, fontSize: 12.5, color: "#57524b" }}>
          Paid plans are coming soon. Email us and we&rsquo;ll turn you back on right away.
        </div>
      </div>
    </div>
  );
}
