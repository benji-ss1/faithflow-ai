"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import ImageSlot from "./ImageSlot";

const WORDS = ["the room.", "the sermon.", "the setlist.", "the moment."];
const CH = "!<>-_\\/[]{}—=+*^?#________abcdefghjkmnpqrstuvwxyz";

const MONO = "var(--pf-mono)";

export default function Home() {
  const [scramble, setScramble] = useState("the room.");
  const [videoOpen, setVideoOpen] = useState(false);

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

  const closeVideo = useCallback(() => {
    setVideoOpen(false);
    document.body.style.overflow = "";
  }, []);

  const openVideo = useCallback(() => {
    setVideoOpen(true);
    document.body.style.overflow = "hidden";
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && videoOpen) closeVideo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [videoOpen, closeVideo]);

  const monoTag: CSSProperties = {
    font: `500 11px ${MONO}`,
    letterSpacing: "0.06em",
    padding: "7px 11px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,.14)",
    color: "var(--muted)",
  };

  const videoWrapStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 140,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    visibility: videoOpen ? "visible" : "hidden",
    opacity: videoOpen ? 1 : 0,
    transition: videoOpen
      ? "opacity .35s ease"
      : "opacity .25s ease, visibility 0s linear .25s",
  };

  const videoFrameStyle: CSSProperties = {
    position: "relative",
    width: "min(960px,100%)",
    background: "#101012",
    border: "1px solid rgba(255,255,255,.1)",
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0 40px 120px rgba(0,0,0,.7)",
    transform: videoOpen ? "scale(1)" : "scale(.96)",
    transition: "transform .35s cubic-bezier(.22,1,.36,1)",
  };

  return (
    <>
      <main style={{ overflow: "hidden" }}>
        {/* HERO */}
        <section
          style={{
            position: "relative",
            padding: "150px 0 0",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: "100vh",
          }}
        >
          <div
            style={{
              position: "relative",
              maxWidth: 1160,
              margin: "0 auto",
              padding: "0 24px",
              animation: "pfFadeUp .8s cubic-bezier(.22,1,.36,1) both",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                font: `500 12px ${MONO}`,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--ember)",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--ember)",
                  animation: "pfPulse 2.2s ease infinite",
                }}
              />
              AI-native presentation&nbsp;&nbsp;·&nbsp;&nbsp;Private beta
            </div>
            <h1
              style={{
                margin: "20px 0 0",
                fontWeight: 800,
                fontSize: "clamp(40px,6.4vw,76px)",
                lineHeight: 1.05,
                letterSpacing: "-.03em",
                maxWidth: 860,
              }}
            >
              The screen finally keeps up with
              <span
                style={{
                  display: "block",
                  minHeight: "1.1em",
                  whiteSpace: "nowrap",
                  background: "linear-gradient(100deg,#F7941D,#FDB748)",
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
              style={{
                margin: "22px 0 0",
                maxWidth: 560,
                fontSize: 17,
                lineHeight: 1.6,
                color: "var(--muted)",
                textWrap: "pretty",
              }}
            >
              PresentFlow listens to what&apos;s being preached and what&apos;s being
              sung, and puts the right verse or the right line on screen in under two
              seconds. No one scrambling at the back. No dead slide while the pastor
              waits.
            </p>
            <div
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
                  background: "linear-gradient(100deg,#F7941D,#FDB748)",
                  color: "#1A1005",
                  boxShadow: "0 10px 40px rgba(247,148,29,.28)",
                }}
              >
                Apply for the beta&nbsp;→
              </Link>
              <a
                onClick={openVideo}
                className="pf-btn-ghost"
                style={{
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 15,
                  padding: "15px 26px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,.14)",
                  color: "var(--ink)",
                }}
              >
                ▶&nbsp;&nbsp;Watch it work in 90 seconds
              </a>
            </div>
            <div
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
          <div className="pf-hero-wordwrap">
            <div className="pf-hero-glow" />
            <div className="pf-hero-word">PresentFlow</div>
          </div>
        </section>

        {/* WHAT'S IN THE BETA */}
        <section
          id="beta"
          style={{ borderTop: "1px solid rgba(255,255,255,.07)", background: "#0D0D0F" }}
        >
          <div style={{ maxWidth: 1160, margin: "0 auto", padding: "110px 24px 90px" }}>
            <div
              style={{
                font: `500 12px ${MONO}`,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--ember)",
              }}
            >
              What&apos;s in the beta
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 28,
                alignItems: "flex-end",
                justifyContent: "space-between",
                marginTop: 18,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontWeight: 800,
                  fontSize: "clamp(34px,5vw,58px)",
                  letterSpacing: "-.03em",
                  lineHeight: 1.04,
                  maxWidth: 560,
                }}
              >
                Everything you need. Nothing you don&apos;t.
              </h2>
              <p
                style={{
                  margin: 0,
                  maxWidth: 400,
                  fontSize: 16,
                  lineHeight: 1.6,
                  color: "var(--muted)",
                  textWrap: "pretty",
                }}
              >
                A cleaner, smarter way to run your services. Built for the person behind
                the screen every Sunday.
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
                gap: 18,
                marginTop: 56,
              }}
            >
              {/* Card 1: library migration */}
              <div
                className="pf-card"
                style={{
                  background: "var(--panel)",
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 16,
                  padding: 28,
                  display: "flex",
                  flexDirection: "column",
                  gap: 22,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 76,
                  }}
                >
                  <span style={monoTag}>ProPresenter</span>
                  <span style={monoTag}>EasyWorship</span>
                  <span style={monoTag}>Proclaim</span>
                  <span style={monoTag}>CCLI</span>
                  <span
                    style={{
                      color: "var(--ember)",
                      fontSize: 18,
                      display: "inline-block",
                      animation: "pfArrow 1.6s ease infinite",
                    }}
                  >
                    →
                  </span>
                  <span
                    style={{
                      font: `600 11px ${MONO}`,
                      letterSpacing: "0.06em",
                      padding: "7px 11px",
                      borderRadius: 8,
                      background: "linear-gradient(100deg,#F7941D,#FDB748)",
                      color: "#1A1005",
                    }}
                  >
                    PresentFlow
                  </span>
                </div>
                <div>
                  <h3
                    style={{
                      margin: "0 0 8px",
                      fontWeight: 700,
                      fontSize: 20,
                      letterSpacing: "-.01em",
                    }}
                  >
                    Bring your library with you
                  </h3>
                  <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--muted)" }}>
                    Migrate songs and scripture from wherever you&apos;re coming from.
                    Connect CCLI and your verses come too. No starting from scratch.
                  </p>
                </div>
              </div>

              {/* Card 2: schedule builder */}
              <div
                className="pf-card"
                style={{
                  background: "var(--panel)",
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 16,
                  padding: 28,
                  display: "flex",
                  flexDirection: "column",
                  gap: 22,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    minHeight: 76,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "var(--panel-2)",
                      border: "1px solid rgba(255,255,255,.07)",
                      font: `500 11px ${MONO}`,
                      color: "var(--faint)",
                    }}
                  >
                    <span style={{ letterSpacing: 2 }}>⠿</span> 01 · WELCOME &amp; OPENER
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "#1B160E",
                      border: "1px solid rgba(247,148,29,.5)",
                      font: `500 11px ${MONO}`,
                      color: "var(--gold)",
                      animation: "pfBob 3.4s ease-in-out infinite",
                    }}
                  >
                    <span style={{ letterSpacing: 2 }}>⠿</span> 02 · WORSHIP SET × 4
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "var(--panel-2)",
                      border: "1px solid rgba(255,255,255,.07)",
                      font: `500 11px ${MONO}`,
                      color: "var(--faint)",
                    }}
                  >
                    <span style={{ letterSpacing: 2 }}>⠿</span> 03 · MESSAGE · ROMANS 8
                  </div>
                </div>
                <div>
                  <h3
                    style={{
                      margin: "0 0 8px",
                      fontWeight: 700,
                      fontSize: 20,
                      letterSpacing: "-.01em",
                    }}
                  >
                    Plan your service in minutes
                  </h3>
                  <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--muted)" }}>
                    A simple schedule builder. Lay out the whole order, drag it into shape,
                    and hand it off to whoever&apos;s on tech. No clutter, no learning
                    curve.
                  </p>
                </div>
              </div>

              {/* Card 3: themes */}
              <div
                className="pf-card"
                style={{
                  background: "var(--panel)",
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 16,
                  padding: 28,
                  display: "flex",
                  flexDirection: "column",
                  gap: 22,
                }}
              >
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: "16/7",
                    borderRadius: 10,
                    overflow: "hidden",
                    border: "1px solid rgba(255,255,255,.08)",
                  }}
                >
                  <ImageSlot placeholder="Drop a theme or lyrics screenshot" />
                </div>
                <div>
                  <h3
                    style={{
                      margin: "0 0 8px",
                      fontWeight: 700,
                      fontSize: 20,
                      letterSpacing: "-.01em",
                    }}
                  >
                    Themes that actually look good
                  </h3>
                  <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--muted)" }}>
                    Clean, modern visuals out of the box. Lyrics and scripture look sharp
                    on screen, no design degree, no templates from 2012.
                  </p>
                </div>
              </div>

              {/* Card 4: dual output */}
              <div
                className="pf-card"
                style={{
                  background: "var(--panel)",
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 16,
                  padding: 28,
                  display: "flex",
                  flexDirection: "column",
                  gap: 22,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "stretch",
                    minHeight: 76,
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      borderRadius: 10,
                      background: "var(--panel-2)",
                      border: "1px solid rgba(255,255,255,.08)",
                      padding: "10px 12px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        font: `500 9px ${MONO}`,
                        letterSpacing: "0.16em",
                        color: "var(--faint)",
                      }}
                    >
                      OPERATOR
                    </span>
                    <div>
                      <div
                        style={{
                          height: 5,
                          width: "82%",
                          borderRadius: 3,
                          background: "rgba(253,183,72,.65)",
                          marginBottom: 5,
                        }}
                      />
                      <div
                        style={{
                          height: 5,
                          width: "55%",
                          borderRadius: 3,
                          background: "rgba(255,255,255,.16)",
                        }}
                      />
                    </div>
                  </div>
                  <div
                    style={{
                      alignSelf: "center",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#3DD68C",
                        animation: "pfRing 1.8s ease-out infinite",
                      }}
                    />
                    <span
                      style={{
                        font: `500 8px ${MONO}`,
                        letterSpacing: "0.14em",
                        color: "var(--faint)",
                      }}
                    >
                      SYNC
                    </span>
                  </div>
                  <div
                    style={{
                      flex: 1,
                      borderRadius: 10,
                      background: "var(--panel-2)",
                      border: "1px solid rgba(255,255,255,.08)",
                      padding: "10px 12px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        font: `500 9px ${MONO}`,
                        letterSpacing: "0.16em",
                        color: "var(--faint)",
                      }}
                    >
                      AUDIENCE
                    </span>
                    <div>
                      <div
                        style={{
                          height: 5,
                          width: "82%",
                          borderRadius: 3,
                          background: "rgba(253,183,72,.65)",
                          marginBottom: 5,
                        }}
                      />
                      <div
                        style={{
                          height: 5,
                          width: "55%",
                          borderRadius: 3,
                          background: "rgba(255,255,255,.16)",
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <h3
                    style={{
                      margin: "0 0 8px",
                      fontWeight: 700,
                      fontSize: 20,
                      letterSpacing: "-.01em",
                    }}
                  >
                    Dual output that just works
                  </h3>
                  <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--muted)" }}>
                    Operator screen. Audience screen. Both running exactly what they
                    should, every time. Reliable, stable, no surprises mid-service.
                  </p>
                </div>
              </div>
            </div>

            {/* stats band */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                gap: 32,
                marginTop: 64,
                paddingTop: 52,
                borderTop: "1px solid rgba(255,255,255,.08)",
              }}
            >
              <div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 46,
                    letterSpacing: "-.03em",
                    background: "linear-gradient(100deg,#F7941D,#FDB748)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  1.6s
                </div>
                <div
                  style={{
                    marginTop: 8,
                    font: `500 11px ${MONO}`,
                    letterSpacing: "0.16em",
                    color: "var(--faint)",
                  }}
                >
                  AVG. VERSE TO SCREEN
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 46, letterSpacing: "-.03em" }}>15</div>
                <div
                  style={{
                    marginTop: 8,
                    font: `500 11px ${MONO}`,
                    letterSpacing: "0.16em",
                    color: "var(--faint)",
                  }}
                >
                  CHURCHES IN WAVE ONE
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 46, letterSpacing: "-.03em" }}>$0</div>
                <div
                  style={{
                    marginTop: 8,
                    font: `500 11px ${MONO}`,
                    letterSpacing: "0.16em",
                    color: "var(--faint)",
                  }}
                >
                  THROUGHOUT THE BETA
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 46, letterSpacing: "-.03em" }}>
                  4 weeks
                </div>
                <div
                  style={{
                    marginTop: 8,
                    font: `500 11px ${MONO}`,
                    letterSpacing: "0.16em",
                    color: "var(--faint)",
                  }}
                >
                  TO YOUR FIRST LIVE SUNDAY
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CLOSED BETA CTA */}
        <section style={{ maxWidth: 1160, margin: "0 auto", padding: "110px 24px 130px" }}>
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              background: "var(--panel)",
              border: "1px solid rgba(255,255,255,.09)",
              borderRadius: 22,
              padding: "90px 40px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -160,
                left: "50%",
                transform: "translateX(-50%)",
                width: 700,
                height: 380,
                background:
                  "radial-gradient(ellipse at center,rgba(247,148,29,.2),rgba(217,65,140,.08) 55%,transparent 75%)",
                filter: "blur(36px)",
                animation: "pfDrift 9s ease-in-out infinite",
              }}
            />
            <div style={{ position: "relative" }}>
              <div
                style={{
                  font: `500 12px ${MONO}`,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "var(--ember)",
                }}
              >
                Spots are limited
              </div>
              <h2
                style={{
                  margin: "20px auto 0",
                  fontWeight: 800,
                  fontSize: "clamp(34px,5vw,60px)",
                  letterSpacing: "-.03em",
                  lineHeight: 1.05,
                  maxWidth: 640,
                  textWrap: "balance",
                }}
              >
                This is a closed beta.
              </h2>
              <p
                style={{
                  margin: "20px auto 0",
                  maxWidth: 520,
                  fontSize: 16,
                  lineHeight: 1.65,
                  color: "var(--muted)",
                  textWrap: "pretty",
                }}
              >
                We&apos;re starting with a small group of churches who want to help shape
                what church presentation software should be in 2026 and beyond. If you
                want something cleaner, smarter, and built for how your team actually
                works, this is your chance to get in early.
              </p>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 36 }}>
                <Link
                  href="/apply"
                  className="pf-btn-primary"
                  style={{
                    fontWeight: 700,
                    fontSize: 16,
                    padding: "17px 32px",
                    borderRadius: 10,
                    background: "linear-gradient(100deg,#F7941D,#FDB748)",
                    color: "#1A1005",
                    boxShadow: "0 10px 40px rgba(247,148,29,.3)",
                  }}
                >
                  Apply for the beta&nbsp;→
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* VIDEO LIGHTBOX */}
      <div style={videoWrapStyle}>
        <div
          onClick={closeVideo}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(4,4,5,.85)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            cursor: "pointer",
          }}
        />
        <div style={videoFrameStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              borderBottom: "1px solid rgba(255,255,255,.08)",
            }}
          >
            <span
              style={{
                font: `500 11px ${MONO}`,
                letterSpacing: "0.16em",
                color: "var(--ember)",
              }}
            >
              WATCH IT WORK · 90 SECONDS
            </span>
            <a
              onClick={closeVideo}
              className="pf-link-gold"
              style={{
                cursor: "pointer",
                font: `500 12px ${MONO}`,
                letterSpacing: "0.14em",
                color: "var(--faint)",
              }}
            >
              ESC / CLOSE ✕
            </a>
          </div>
          <div
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "16/9",
              background: "#050506",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 22,
            }}
          >
            <div
              style={{
                width: 76,
                height: 76,
                borderRadius: "50%",
                background: "linear-gradient(120deg,#9646E8,#D9418C,#F7941D)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                animation: "pfRing 2s ease-out infinite",
                cursor: "pointer",
              }}
            >
              <span style={{ color: "#fff", fontSize: 26, marginLeft: 5 }}>▶</span>
            </div>
            <div style={{ textAlign: "center", padding: "0 24px" }}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>
                The 90-second demo lands here
              </div>
              <div
                style={{
                  marginTop: 8,
                  font: `500 11px ${MONO}`,
                  letterSpacing: "0.14em",
                  color: "var(--faint)",
                }}
              >
                PLACEHOLDER · VIDEO AUTOPLAYS ONCE IT&apos;S DROPPED IN
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
