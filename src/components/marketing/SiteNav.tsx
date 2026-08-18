"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";

const MAIN = "cubic-bezier(0.65,0.01,0.05,0.99)";

type LinkDef = { label: string; href: string; apply?: boolean };

const LINKS: LinkDef[] = [
  { label: "Home", href: "/" },
  { label: "Why we're building", href: "/why-were-building" },
  { label: "Apply for the beta", href: "/apply", apply: true },
];

// Pencil-drawn church mark, blended into the menu (draws itself in on open).
const CHURCH_PATH =
  "M60 8 L60 24 M20 52 L60 24 L100 52 M24 52 L24 86 M96 52 L96 86 M16 86 L104 86 M52 86 L52 64 L68 64 L68 86";

type Trans = "idle" | "cover" | "reveal";

export default function SiteNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [trans, setTrans] = useState<Trans>("idle");
  const pendingHref = useRef<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const setMenu = useCallback((open: boolean) => {
    setMenuOpen(open);
    document.body.style.overflow = open ? "hidden" : "";
  }, []);

  // Escape closes the menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menuOpen) setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, setMenu]);

  // When the route actually changes after a "cover", play the reveal.
  useEffect(() => {
    if (pendingHref.current && pendingHref.current === pathname) {
      pendingHref.current = null;
      setTrans("reveal");
      const t = setTimeout(() => {
        setTrans("idle");
        document.body.style.overflow = "";
      }, 700);
      timers.current.push(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const list = timers.current;
    return () => {
      list.forEach(clearTimeout);
      document.body.style.overflow = "";
    };
  }, []);

  const navTo = useCallback(
    (href: string) => {
      if (href === pathname) {
        setMenu(false);
        return;
      }
      setMenuOpen(false);
      document.body.style.overflow = "hidden";
      setTrans("cover");
      pendingHref.current = href;
      const t = setTimeout(() => router.push(href), 620);
      timers.current.push(t);
    },
    [pathname, router, setMenu],
  );

  const o = menuOpen;
  const t = trans;
  const covered = t === "cover";

  const panel = (bg: string, i: number): CSSProperties => ({
    position: "absolute",
    inset: 0,
    background: bg,
    transform: o ? "translateX(0)" : "translateX(101%)",
    transition: `transform .6s ${MAIN} ${(o ? i * 0.1 : (2 - i) * 0.06)}s`,
  });

  const col = (i: number): CSSProperties => ({
    position: "absolute",
    top: 0,
    left: i * 20 + "%",
    width: "calc(20% + 1px)",
    height: "calc(100% + 140px)",
    transform: covered ? "translateY(0)" : "translateY(-115%)",
    transition:
      t === "idle"
        ? "none"
        : `transform .6s cubic-bezier(.7,0,.2,1) ${(t === "reveal" ? 4 - i : i) * 0.055}s`,
  });

  return (
    <>
      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 120,
          background: "rgba(10,10,11,.72)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderBottom: "1px solid rgba(255,255,255,.06)",
        }}
      >
        <div
          className="pf-nav-row"
          style={{
            maxWidth: 1160,
            margin: "0 auto",
            padding: "0 24px",
            height: 66,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navTo("/");
            }}
            className="pf-nav-logolink"
            style={{ display: "flex", alignItems: "center" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/marketing/logo-trans.png"
              alt="PresentFlow"
              className="pf-nav-logo"
            />
          </a>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <a
              href="/apply"
              onClick={(e) => {
                e.preventDefault();
                navTo("/apply");
              }}
              className="pf-nav-apply"
              style={{
                fontWeight: 600,
                fontSize: 13,
                padding: "9px 16px",
                borderRadius: 10,
                background: "linear-gradient(100deg,#F7941D,#FDB748)",
                color: "#1A1005",
                whiteSpace: "nowrap",
              }}
            >
              Apply for the beta
            </a>
            <button
              onClick={() => setMenu(!o)}
              className="pf-menu-btn"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "none",
                border: "1px solid rgba(255,255,255,.14)",
                borderRadius: 10,
                padding: "9px 14px",
                cursor: "pointer",
                color: "var(--ink)",
              }}
            >
              <span style={{ display: "block", overflow: "hidden", height: 15 }}>
                <span
                  style={{
                    display: "block",
                    transform: o ? "translateY(-15px)" : "translateY(0)",
                    transition: `transform .45s ${MAIN}`,
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      font: "600 12px/15px 'JetBrains Mono',monospace",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                    }}
                  >
                    Menu
                  </span>
                  <span
                    style={{
                      display: "block",
                      font: "600 12px/15px 'JetBrains Mono',monospace",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: "var(--gold)",
                    }}
                  >
                    Close
                  </span>
                </span>
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 17,
                  lineHeight: "15px",
                  fontWeight: 400,
                  color: o ? "var(--gold)" : "var(--ink)",
                  transform: o ? "rotate(315deg)" : "rotate(0deg)",
                  transition: `transform .5s ${MAIN},color .3s`,
                }}
              >
                +
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* KINETIC OVERLAY MENU */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 110,
          visibility: o ? "visible" : "hidden",
          transition: o ? "visibility 0s" : "visibility 0s linear .75s",
        }}
      >
        <div
          onClick={() => setMenu(false)}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(5,5,6,.6)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            opacity: o ? 1 : 0,
            transition: "opacity .5s ease",
            cursor: "pointer",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: "min(640px,100%)",
            overflow: "hidden",
          }}
        >
          <div style={panel("linear-gradient(160deg,#F7941D,#D9418C)", 0)} />
          <div style={panel("#2A1240", 1)} />
          <div style={panel("#0C0C0E", 2)} />
          <div
            style={{
              position: "absolute",
              top: "-15%",
              right: "-25%",
              width: "70%",
              height: "60%",
              background: "radial-gradient(circle,rgba(150,70,232,.22),transparent 65%)",
              filter: "blur(50px)",
              animation: "pfDrift 8s ease-in-out infinite",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "-15%",
              left: "-20%",
              width: "75%",
              height: "55%",
              background: "radial-gradient(circle,rgba(247,148,29,.16),transparent 65%)",
              filter: "blur(50px)",
              animation: "pfDrift 11s ease-in-out infinite reverse",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "relative",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "96px 56px 56px",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/marketing/logo-trans.png"
              alt="PresentFlow"
              style={{
                height: 76,
                width: "auto",
                alignSelf: "flex-start",
                marginLeft: -18,
                opacity: o ? 1 : 0,
                transform: o ? "translateY(0)" : "translateY(24px)",
                transition: `all .6s ${MAIN} ${o ? 0.35 : 0}s`,
              }}
            />
            <nav
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                marginTop: 30,
              }}
            >
              {LINKS.map((l, i) => (
                <div key={l.href} style={{ overflow: "hidden", padding: "2px 0" }}>
                  <a
                    href={l.href}
                    onClick={(e) => {
                      e.preventDefault();
                      navTo(l.href);
                    }}
                    className="pf-menu-link"
                    style={{
                      display: "block",
                      cursor: "pointer",
                      padding: "5px 0",
                      font: "800 clamp(28px,4.2vw,46px)/1.15 'Plus Jakarta Sans',sans-serif",
                      letterSpacing: "-.02em",
                      color: l.apply ? "var(--ember)" : "var(--ink)",
                      transform: o
                        ? "translateY(0) rotate(0deg)"
                        : "translateY(140%) rotate(5deg)",
                      transition: `transform .7s ${MAIN} ${
                        o ? 0.28 + i * 0.05 : 0
                      }s, color .3s, padding-left .3s`,
                    }}
                  >
                    <span
                      style={{
                        font: "500 12px 'JetBrains Mono',monospace",
                        letterSpacing: "0.14em",
                        color: "var(--faint)",
                        marginRight: 18,
                        verticalAlign: "super",
                      }}
                    >
                      {"0" + (i + 1)}
                    </span>
                    {l.label}
                  </a>
                </div>
              ))}
            </nav>
            <svg
              viewBox="0 0 120 100"
              width="108"
              height="90"
              aria-hidden="true"
              style={{
                marginTop: 44,
                opacity: o ? 0.5 : 0,
                transition: `opacity .6s ${MAIN} ${o ? 0.55 : 0}s`,
              }}
            >
              <path
                d={CHURCH_PATH}
                fill="none"
                stroke="var(--ink)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  strokeDasharray: 640,
                  strokeDashoffset: o ? 0 : 640,
                  transition: `stroke-dashoffset 1.5s ${MAIN} ${o ? 0.6 : 0}s`,
                }}
              />
            </svg>
          </div>
        </div>
      </div>

      {/* PAGE TRANSITION CURTAIN */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 200,
          overflow: "hidden",
          pointerEvents: t === "idle" ? "none" : "auto",
          visibility: t === "idle" ? "hidden" : "visible",
        }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={col(i)}>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "linear-gradient(120deg,#9646E8,#D9418C,#F7941D)",
                borderRadius: "0 0 50% 50% / 0 0 120px 120px",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 9,
                background: "#0C0C0E",
                borderRadius: "0 0 50% 50% / 0 0 110px 110px",
              }}
            />
          </div>
        ))}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            font: "800 clamp(34px,6vw,64px) 'Plus Jakarta Sans',sans-serif",
            letterSpacing: "-.03em",
            whiteSpace: "nowrap",
            background: "linear-gradient(100deg,#F7941D,#FDB748)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            opacity: covered ? 1 : 0,
            transition: covered ? "opacity .3s ease .22s" : "opacity .2s ease",
          }}
        >
          PresentFlow
        </div>
      </div>
    </>
  );
}
