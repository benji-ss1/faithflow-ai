"use client";
/*
 * OpenFlow mark — an OPEN ring (gap = "open") with a flowing CURRENT running
 * through it (the "flow"). The current animates via the .of-current CSS class.
 * The warm-gradient stroke references the shared def rendered once by
 * OpenFlowGradientDefs (mounted in the panel root).
 */
export function OpenFlowMark({ size = 32, className, solid }: { size?: number; className?: string; solid?: boolean }) {
  // `solid` uses a flat ember stroke instead of the shared gradient def — used
  // in the left-rail entry where the gradient <defs> isn't mounted (avoids a
  // duplicate id in the DOM).
  const stroke = solid ? "#E8742A" : "url(#of-grad-stroke)";
  return (
    <svg
      className={`of-mark${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="24" cy="24" r="15"
        stroke={stroke} strokeWidth="2.8" strokeLinecap="round"
        strokeDasharray="74 20" transform="rotate(-56 24 24)"
      />
      <path
        className="of-current"
        d="M9 24 C15 17, 20 31, 26 24 S 37 20, 41 26"
        stroke={stroke} strokeWidth="3.2" strokeLinecap="round"
      />
    </svg>
  );
}

/** The shared gradient definition — mount ONCE per OpenFlow surface. */
export function OpenFlowGradientDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="of-grad-stroke" x1="4" y1="8" x2="44" y2="40">
          <stop stopColor="#C0442E" />
          <stop offset="0.4" stopColor="#E8742A" />
          <stop offset="0.72" stopColor="#E0806A" />
          <stop offset="1" stopColor="#A64D6E" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** The "OpenFlow" wordmark — "Open" upright, "Flow" in flowing cursive, warm
 *  gradient fill. `tick` shows the small "AI" trademark annotation. */
export function OpenFlowWordmark({ tick = false, className }: { tick?: boolean; className?: string }) {
  return (
    <span className={`of-word${className ? ` ${className}` : ""}`}>
      <span className="o">Open</span>
      <span className="f">Flow</span>
      {tick ? <span className="tick">AI</span> : null}
    </span>
  );
}
