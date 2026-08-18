"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import ImageSlot from "./ImageSlot";
import AuditoriumBg from "./AuditoriumBg";
import BetaScroll from "./BetaScroll";
import AuditoriumScroll from "./AuditoriumScroll";
import RailConnector from "./RailConnector";
import CtaSection from "./CtaSection";

const WORDS = ["the room.", "the sermon.", "the setlist.", "the moment."];
const CH = "!<>-_\\/[]{}—=+*^?#________abcdefghjkmnpqrstuvwxyz";

const MONO = "var(--pf-mono)";

export default function Home() {
  const [scramble, setScramble] = useState("the room.");

  const wi = useRef(0);
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrambleRef = useRef("the room.");

  const scrambleTo = useCallback((target: string, done?: () => void) => {
    const from = scrambleRef.current;
    const len = Math.max(from.length, target.length);
    const q: { from: string; to: string; start: number; end: number }[] = [];
    for (let i = 0; i < len; i++) {
      q.push({
        from: from[i] || "",
        to: target[i] || "",
        start: Math.floor(Math.random() * 10),
        end: 12 + Math.floor(Math.random() * 10) + Math.floor(i * 0.8),
      });
    }
    let frame = 0;
    const step = () => {
      let out = "";
      let complete = 0;
      for (const c of q) {
        if (frame >= c.end) {
          out += c.to;
          complete++;
        } else if (frame >= c.start) {
          out += CH[Math.floor(Math.random() * CH.length)];
        } else {
          out += c.from;
        }
      }
      scrambleRef.current = out;
      setScramble(out);
      if (complete === q.length) {
        done && done();
        return;
      }
      frame++;
      stepTimer.current = setTimeout(step, 55);
    };
    if (stepTimer.current) clearTimeout(stepTimer.current);
    step();
  }, []);

  // Scramble loop (respects reduced motion)
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const hold = () => {
      holdTimer.current = setTimeout(() => {
        wi.current = (wi.current + 1) % WORDS.length;
        scrambleTo(WORDS[wi.current], () => hold());
      }, 4200);
    };
    hold();

    return () => {
      if (stepTimer.current) clearTimeout(stepTimer.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
    };
  }, [scrambleTo]);


  const monoTag: CSSProperties = {
    font: `500 11px ${MONO}`,
    letterSpacing: "0.06em",
    padding: "7px 11px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,.14)",
    color: "var(--muted)",
  };



  return (
    <>
      {/* overflowX clip (not overflow hidden) — hidden made <main> a scroll
          container and broke position:sticky pinning on the scroll sections. */}
      <main style={{ overflowX: "clip" }}>
        {/* HERO */}
        <section
          style={{
            position: "relative",
            padding: "clamp(104px,16vw,150px) 0 40px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: "100vh",
            background:
              "linear-gradient(135deg,#0B0B0B 0%,#1A0A14 40%,#0B0B0B 100%)",
          }}
        >
          {/* Cinematic Auditorium scene (full-bleed, behind everything) */}
          <AuditoriumBg />
          {/* Readability scrim: top→bottom darken + left-side darkening so the
              left-aligned headline/lede stay crisp over the scene. */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 1,
              pointerEvents: "none",
              background:
                "linear-gradient(180deg, rgba(8,4,8,.37) 0%, rgba(8,4,8,.24) 40%, rgba(8,4,8,.51) 100%), linear-gradient(90deg, rgba(8,4,8,.56) 0%, rgba(8,4,8,.34) 30%, rgba(8,4,8,0) 52%)",
            }}
          />
          {/* Bottom fade — dissolves the hero scene into the next section's
              background (var(--bg)) for a smooth flow, no hard seam. */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "clamp(120px,26vh,300px)",
              zIndex: 1,
              pointerEvents: "none",
              background: "linear-gradient(180deg, rgba(11,11,11,0) 0%, var(--bg) 100%)",
            }}
          />
          <div
            style={{
              position: "relative",
              zIndex: 2,
              maxWidth: 1160,
              margin: 0,
              padding: "0 clamp(28px,5vw,72px)",
              width: "100%",
              animation: "pfFadeUp .8s cubic-bezier(.22,1,.36,1) both",
            }}
          >
            <h1
              style={{
                margin: "20px 0 0",
                fontWeight: 800,
                fontSize: "clamp(30px,7vw,76px)",
                lineHeight: 1.05,
                letterSpacing: "-.03em",
                maxWidth: 600,
              }}
            >
              The screen finally keeps up with
              <span
                style={{
                  display: "block",
                  minHeight: "1.1em",
                  whiteSpace: "nowrap",
                  background: "linear-gradient(100deg,#ff7a2c,#ffb861)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  color: "var(--ember)",
                }}
              >
                {scramble}
              </span>
            </h1>
            <p
              className="pf-hero-lede"
              style={{
                margin: "22px 0 0",
                maxWidth: 480,
                fontSize: 17,
                lineHeight: 1.6,
                color: "var(--muted)",
                textWrap: "pretty",
              }}
            >
              PresentFlow listens to what&apos;s being preached and what&apos;s being
              sung, and puts the right verse or the right line on screen in under two
              seconds. No one scrambling at the back.
            </p>
            <div
              className="pf-hero-cta"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 14,
                marginTop: 30,
              }}
            >
              <Link
                href="/apply"
                className="pf-btn-primary"
                style={{
                  fontWeight: 700,
                  fontSize: 15,
                  padding: "15px 26px",
                  borderRadius: 10,
                  background: "linear-gradient(100deg,#ff7a2c,#ffb861)",
                  color: "#1A1005",
                  boxShadow: "0 10px 40px rgba(255,122,44,.28)",
                }}
              >
                Apply for the beta&nbsp;→
              </Link>
            </div>
            <div
              className="pf-hero-meta"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 26,
                marginTop: 26,
                font: `500 12px ${MONO}`,
                letterSpacing: "0.1em",
                color: "var(--faint)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--ember)",
                  }}
                />
                15 churches · wave one
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--ember)",
                  }}
                />
                Free throughout beta
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--ember)",
                  }}
                />
                macOS today · Windows next
              </span>
            </div>
          </div>
        </section>

        {/* WHAT'S IN THE BETA — pinned, scroll-scrubbed 3-card section */}
        <BetaScroll />

        {/* Rail connector — line + square travels from BetaScroll's left rail
            across to the auditorium's right rail as you scroll the gap. */}
        <RailConnector />

        {/* HOW IT WORKS — pinned full-bleed 3D auditorium */}
        <AuditoriumScroll />

        {/* CLOSING CTA — light editorial panel + pencil-drawn church */}
        <CtaSection />
      </main>

    </>
  );
}
