"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Wraps a section in a scroll-triggered fade-in-and-slide-up. Uses
 * IntersectionObserver so it's zero JS cost until the target hits the
 * viewport; no framer-motion dep. The `delay` prop staggers cascading
 * reveals inside a group (e.g. hero → features → CTA).
 *
 * SSR-safe: falls back to `visible: true` on the first paint before the
 * observer attaches, so users with JS disabled still see the content.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            obs.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(24px)",
        transition: `opacity 700ms ease ${delay}ms, transform 700ms ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
