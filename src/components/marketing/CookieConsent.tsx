"use client";

/**
 * Cookie consent banner for the public marketing surfaces. Analytics (PostHog)
 * stays OFF until the visitor accepts — see PostHogProvider's consent gate. The
 * choice is stored in localStorage so the banner shows once. Styled as a small
 * dark card so it reads on both the dark marketing pages and the parchment
 * apply flow.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { getCookieConsent, setCookieConsent } from "@/components/system/PostHogProvider";

export default function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Only prompt if no choice has been made yet.
    if (getCookieConsent() === null) {
      const t = setTimeout(() => setShow(true), 700);
      return () => clearTimeout(t);
    }
  }, []);

  if (!show) return null;

  const choose = (accepted: boolean) => {
    setCookieConsent(accepted);
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      style={{
        position: "fixed",
        left: "50%",
        bottom: "clamp(14px,3vw,26px)",
        transform: "translateX(-50%)",
        zIndex: 200,
        width: "min(560px, calc(100vw - 28px))",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 14,
        padding: "16px 18px",
        borderRadius: 14,
        background: "rgba(20,18,16,.92)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,.12)",
        boxShadow: "0 16px 50px rgba(0,0,0,.45)",
        color: "#f5f0e5",
        fontFamily: "var(--pf-sans), system-ui, sans-serif",
      }}
    >
      <p style={{ margin: 0, flex: "1 1 240px", fontSize: 13.5, lineHeight: 1.5, color: "rgba(245,240,229,.86)" }}>
        We use cookies for analytics to improve PresentFlow. See our{" "}
        <Link href="/privacy" style={{ color: "#ffb861", textDecoration: "underline", textUnderlineOffset: 2 }}>
          Privacy Policy
        </Link>
        .
      </p>
      <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
        <button
          onClick={() => choose(false)}
          style={{
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13,
            padding: "9px 16px",
            borderRadius: 9,
            background: "transparent",
            border: "1px solid rgba(255,255,255,.2)",
            color: "#f5f0e5",
          }}
        >
          Decline
        </button>
        <button
          onClick={() => choose(true)}
          style={{
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 13,
            padding: "9px 18px",
            borderRadius: 9,
            border: "none",
            background: "linear-gradient(100deg,#ff7a2c,#ffb861)",
            color: "#1a1005",
          }}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
