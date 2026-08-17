"use client";

import { useEffect, useRef, useState } from "react";

const TEXT =
  "We're building automated emotion. The song swells, the verse lands, the room moves, and the screen finally moves with it. No scramble at the back. No dead slide. Just flow.";

export default function Manifesto() {
  const [on, setOn] = useState(false);
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (es) => {
          if (es.some((x) => x.isIntersecting)) {
            setOn(true);
            io.disconnect();
          }
        },
        { threshold: 0.3 },
      );
      io.observe(el);
      return () => io.disconnect();
    }
    setOn(true);
  }, []);

  const words = TEXT.split(" ");
  const accentFrom = words.length - 2;

  return (
    <section
      ref={ref}
      id="why"
      style={{ maxWidth: 900, margin: "0 auto", padding: "200px 24px 120px", textAlign: "center" }}
    >
      <div style={{ animation: "pfFadeUp .8s cubic-bezier(.22,1,.36,1) both" }}>
        <div
          style={{
            font: "500 12px var(--pf-mono)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ember)",
          }}
        >
          Why we&apos;re building this
        </div>
        <p
          style={{
            margin: "34px 0 0",
            fontWeight: 700,
            fontSize: "clamp(28px,4vw,46px)",
            lineHeight: 1.28,
            letterSpacing: "-.02em",
            textWrap: "balance",
          }}
        >
          {words.map((w, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                marginRight: "0.26em",
                color: on
                  ? i >= accentFrom
                    ? "var(--ember)"
                    : "var(--ink)"
                  : "rgba(244,241,234,.13)",
                transition: `color .55s ease ${i * 55}ms`,
              }}
            >
              {w}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
