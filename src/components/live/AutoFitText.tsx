"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { calculateProjectorFontSize, projectorFloorPx, projectorCeilingPx } from "@/lib/projectorFontSize";

// Congregation-readability floor per operator spec: 24px absolute minimum.
// Below this on a 1080p projector at sanctuary distance verses become
// squinty. If we can't fit at 24px we paginate rather than shrink further.
const MIN_READABLE_PX = 24;
// Max applies to the top-level clamp in the AutoFitText binary search below —
// spec cap of 120px keeps a "Jesus wept" from becoming absurdly huge.

/**
 * Binary-search font size until the rendered text fits both container
 * dimensions. When text is so long that even the minimum readable font
 * size would overflow, we PAGINATE at sentence boundaries and show a
 * discreet page indicator. Never renders below MIN_READABLE_PX.
 *
 * Pagination is transparent to the caller — the same `text` prop is
 * accepted, and the component picks the natural page count. Operator
 * navigates pages via ← → arrow keys while focused, or automatically
 * via context nav (handled at the OperatorConsole layer).
 */
// 2026-07-24 T3 fix — module-level LRU-ish cache of computed font sizes,
// keyed by (text, boxWidth, boxHeight, maxPx). Skips the ~8-iteration
// binary search entirely on repeat slides (song swap-back, verse repeat,
// same-slide re-fire during word-tracking auto-advance). Bounded to
// avoid unbounded growth over a long service. Same-text same-box always
// yields the same size deterministically, so caching is safe.
const FIT_CACHE_MAX = 200;
const fitCache = new Map<string, number>();
function fitCacheKey(text: string, bw: number, bh: number, maxPx: number) {
  // Round box dims to nearest 4px so trivial resize jitter still cache-hits.
  return `${Math.round(bw / 4) * 4}|${Math.round(bh / 4) * 4}|${maxPx}|${text}`;
}
function fitCacheGet(k: string): number | undefined { return fitCache.get(k); }
function fitCacheSet(k: string, v: number) {
  if (fitCache.size >= FIT_CACHE_MAX) {
    const first = fitCache.keys().next().value;
    if (first) fitCache.delete(first);
  }
  fitCache.set(k, v);
}

// Fix-loop 2026-07-27: the overflow-at-floor warning used to fire on EVERY
// refit (resize, page change) — warn once per unique text, capped at ~50
// entries so a long service can't grow this unbounded.
const OVERFLOW_WARNED_MAX = 50;
const overflowWarned = new Set<string>();
function warnOverflowOnce(text: string, floorPx: number) {
  if (overflowWarned.has(text)) return;
  if (overflowWarned.size >= OVERFLOW_WARNED_MAX) overflowWarned.clear();
  overflowWarned.add(text);
  console.warn(
    `[projector] slide text overflows even at the ${floorPx}px readability floor ` +
    `(${text.length} chars). Tightening line-height and clipping into safe-area ` +
    `padding — consider splitting this slide.`
  );
}

export function AutoFitText({ text, className, textStyle, maxPx = 220, paddingRatio = 0.06, minPx, disablePagination, projectorFit, fontScale = 1 }:
  {
    text: string;
    className?: string;
    // Themes Phase 1: theme-driven text styling (color, fontFamily, fontWeight,
    // textAlign, textShadow). Merged so it overrides the readability defaults
    // but NOT the layout-critical props (fitted fontSize, wrapping, uppercase),
    // which are re-asserted after it. Applied to the measured element so the
    // fit stays correct for a different font/weight.
    textStyle?: React.CSSProperties;
    maxPx?: number;
    paddingRatio?: number;
    // B3 (2026-08-11): operator manual size. AUTO = 1.0 (pure largest-fit).
    // A−/A+ nudge this multiplier; it scales the fitted size, clamped to the
    // readable floor/ceiling so the operator can bias smaller/bigger without
    // ever driving text off-screen. Applied AFTER the fit (so the fit cache
    // stays scale-independent).
    fontScale?: number;
    // 2026-07-25: `minPx` — override the readable floor. Live-projector
    // context passes the default (24 px, sanctuary readability). Grid
    // thumbnails pass a much smaller value (e.g. 8 px) so a whole verse
    // fits in a single card at a glance without pagination.
    minPx?: number;
    // 2026-07-25: `disablePagination` — for grid thumbnails, we prefer to
    // shrink until it fits rather than split across pages, because a page
    // indicator inside a thumbnail is unreadable at glance size. Live
    // preview keeps pagination (readability floor is more important there).
    disablePagination?: boolean;
    // 2026-07-27 JPD Fix 2: `projectorFit` — viewport-proportional sizing
    // for the LIVE/STAGE output surfaces. The old 24px absolute floor is
    // tiny on a projector (~2.2% of 1080p). In projector mode the target
    // size comes from calculateProjectorFontSize() (word-count-banded % of
    // container height) and the floor is a HARD 3% of container height.
    // If even the floor overflows, we tighten line-height slightly and
    // clip into the safe-area padding rather than shrink further, and log
    // a console warning suggesting the slide be split. Grid thumbnails and
    // operator preview panes do NOT pass this flag — their sizing is
    // untouched.
    projectorFit?: boolean;
  }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  // Themes: fontFamily/fontWeight change glyph widths, so they must be part of
  // the fit-cache key AND trigger a refit — otherwise a theme swap reuses the
  // previous font's cached size and the verse overflows / undersizes.
  const fontToken = `${(textStyle?.fontFamily as string) ?? ""}|${(textStyle?.fontWeight as string | number) ?? ""}`;
  // Read fontScale through a ref so the ResizeObserver's `fit` closure (which
  // is captured once, deps []) always sees the CURRENT scale on a resize, not
  // a stale value. A scale CHANGE separately triggers a refit via the
  // useLayoutEffect dep below. `|| 1` also coerces NaN/0/undefined → AUTO.
  const fontScaleRef = useRef(fontScale);
  fontScaleRef.current = Number.isFinite(fontScale) && fontScale! > 0 ? fontScale! : 1;
  // 2026-07-24 T3 fix — initial size = last fitted size (from ref) rather
  // than MIN_READABLE_PX. Previously every new slide painted for one frame
  // at 24 px before the binary search corrected it, producing a visible
  // "shrink then grow" flicker on every AI-fired slide. Now the first
  // paint uses the last known good size — usually within a few px of the
  // final answer, so the correction is imperceptible.
  // 2026-07-25: effective floor honors caller override (grid thumbnails
  // pass a much smaller value so a full verse fits at a glance without
  // pagination). Live-projector callers omit the prop and get the
  // sanctuary-readability default (24 px).
  const effectiveMinPx = Math.max(1, Math.min(maxPx, minPx ?? MIN_READABLE_PX));
  const lastFittedRef = useRef<number>(effectiveMinPx);
  const [size, setSize] = useState(lastFittedRef.current);
  // Projector floor-clipping mode: at the hard 3%-of-height floor a very
  // long slide may still overflow. We tighten line-height (1.15 → 1.05)
  // and let the safe-area padding absorb the excess rather than shrink.
  const [tightLine, setTightLine] = useState(false);
  const [pad, setPad] = useState(4);
  const [pageIdx, setPageIdx] = useState(0);

  // 2026-07-25: skip pagination entirely when the caller opts out (grid
  // thumbnails prefer shrink-to-fit over page-split since a page indicator
  // is illegible at glance size).
  const pages = useMemo(() => disablePagination ? [text] : paginateForFit(text), [text, disablePagination]);
  const currentText = pages[Math.min(pageIdx, pages.length - 1)] || text;

  // B2 hierarchy (2026-08-10): a Bible slide ends with "\n\n<Book ch:verse (VER)>".
  // The VERSE is the primary readable content; render the reference at a
  // SECONDARY size (0.5em, relative to the auto-fit size so it scales with it)
  // so the reference never steals space from the verse. Song/announcement text
  // has no trailing scripture ref → renders whole, unchanged.
  const refSplit = useMemo(() => splitTrailingRef(currentText), [currentText]);

  // Reset page when text prop changes
  useEffect(() => { setPageIdx(0); }, [text]);

  const fit = () => {
    const box = boxRef.current;
    const t = textRef.current;
    if (!box || !t) return;
    const padPx = Math.max(4, Math.min(48, Math.round(Math.min(box.clientWidth, box.clientHeight) * paddingRatio)));
    setPad(padPx);
    const bw = box.clientWidth - padPx * 2;
    const bh = box.clientHeight - padPx * 2;
    if (bw <= 0 || bh <= 0) return;

    // JPD Fix 2 — projector mode: viewport-proportional sizing with a
    // HARD readability floor of 3% of container height. Target size is
    // word-count-banded (calculateProjectorFontSize). If the target
    // overflows, step down toward the floor; NEVER go below it. At the
    // floor, tighten line-height and allow clipping into the safe-area
    // padding instead of shrinking further.
    if (projectorFit) {
      const containerH = box.clientHeight;
      // PREFERRED readable minimum (9% of height). Normal verses land at or above
      // this via the largest-fit. It is NOT a hard clamp.
      const prefFloorPx = projectorFloorPx(containerH);
      // ABSOLUTE minimum — the guaranteed-fit floor. A very long verse (e.g.
      // Revelation 1:20) that can't fit at the preferred floor is allowed to
      // shrink BELOW it, down to here, so projected text ALWAYS fits the screen
      // and NEVER clips out of frame. Guaranteed fit beats preferred size.
      const absMinPx = Math.max(14, Math.round(0.028 * containerH));
      const scale = fontScaleRef.current;
      const ceilPx = Math.round(projectorCeilingPx(containerH) * Math.max(1, scale));
      // Projector line spacing tightened to 1.08 — measure + render use the SAME
      // value so the fit stays exact.
      t.style.lineHeight = "1.08";
      const fitsAt = (px: number) => {
        t.style.fontSize = `${px}px`;
        return t.scrollWidth <= bw + 1 && t.scrollHeight <= bh + 1;
      };

      // ProPresenter-style SCALE-UP-TO-FIT (maximize space) on the fixed 1920×1080
      // presentation canvas (PresentationCanvas). Because every surface — the
      // operator preview and the projector alike — now measures this SAME fixed
      // canvas, the largest-fit result is deterministic and IDENTICAL everywhere
      // (the old mismatch came from each surface measuring a different physical
      // container). Find the TRUE largest font that fits the safe area: short text
      // grows large (up to the ceiling), long passages shrink only as much as
      // needed, and pathologically long text bottoms out at the guaranteed-fit
      // floor rather than clipping. A−/A+ scale rides the ceiling. Seeded by the
      // word-count band for fast convergence; cached by text+box.
      const projKey = `projfit|${Math.round(bw / 4) * 4}|${Math.round(bh / 4) * 4}|${absMinPx}|${ceilPx}|${fontToken}|${currentText}`;
      let best: number;
      const cachedProj = fitCacheGet(projKey);
      if (cachedProj !== undefined) {
        best = cachedProj;
      } else {
        const seedBand = calculateProjectorFontSize(currentText, containerH);
        const seed = Math.min(ceilPx, Math.max(absMinPx, Math.max(seedBand, Math.round(lastFittedRef.current))));
        let lo = absMinPx, hi = ceilPx, found = -1;
        if (fitsAt(seed)) { found = seed; lo = seed + 1; } else { hi = seed - 1; }
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (fitsAt(mid)) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
        }
        best = found >= absMinPx ? found : absMinPx;
        fitCacheSet(projKey, best);
      }
      // Below the preferred floor → a long passage; tighten leading for a touch
      // more room. Only a pathological single line can still overflow (paginateForFit
      // already splits long text) — warn once for diagnostics.
      const belowPref = best < prefFloorPx;
      const stillOverflows = !fitsAt(best);
      if (stillOverflows) warnOverflowOnce(currentText, best);
      const tight = belowPref || stillOverflows;
      // A+ rides the raised ceiling (in ceilPx); A− multiplies down. Clamped to
      // the guaranteed-fit range so manual scale can never clip or vanish.
      const shown = Math.max(absMinPx, Math.min(ceilPx, Math.round(best * Math.min(1, scale))));
      lastFittedRef.current = best;
      t.style.fontSize = `${shown}px`;
      t.style.lineHeight = tight ? "1.02" : "1.08";
      setTightLine(tight);
      setSize(shown);
      return;
    }
    setTightLine(false);

    // T3 cache hit — same text, same box → skip binary search entirely.
    // Cache key includes effectiveMinPx so grid thumbnails don't share
    // cache entries with live-projector renders of the same text (different
    // valid font sizes for different min floors).
    const cacheKey = fitCacheKey(currentText, bw, bh, maxPx) + `|${effectiveMinPx}|${fontToken}`;
    const cached = fitCacheGet(cacheKey);
    if (cached !== undefined) {
      lastFittedRef.current = cached;
      setSize(Math.max(effectiveMinPx, Math.min(maxPx, Math.round(cached * fontScaleRef.current))));
      return;
    }

    // T3 seeded binary search — start the search anchored at the last
    // fitted size, so if the new text is similar-length to the old,
    // convergence is 1-2 iterations instead of 8. Falls back to full
    // range if seed is invalid.
    let lo = effectiveMinPx, hi = maxPx, best = effectiveMinPx;
    const seed = Math.min(maxPx, Math.max(effectiveMinPx, lastFittedRef.current));
    // Probe the seed first — if it fits, expand upward; if not, contract
    // downward. This makes the common case (similar-length swap) O(1)
    // in visible fit iterations.
    t.style.fontSize = `${seed}px`;
    if (t.scrollWidth <= bw + 1 && t.scrollHeight <= bh + 1) {
      best = seed; lo = seed + 1;
    } else {
      hi = seed - 1;
    }
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      t.style.fontSize = `${mid}px`;
      if (t.scrollWidth <= bw + 1 && t.scrollHeight <= bh + 1) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    // B3 manual scale (see projector path). Clamp to [effectiveMinPx, maxPx].
    const shown = Math.max(effectiveMinPx, Math.min(maxPx, Math.round(best * fontScaleRef.current)));
    // Fix-loop 2026-07-27: pin the DOM to the shown size — the loop's last
    // probe may have been a failing value, and a no-op setState (resize with
    // unchanged best) would otherwise leave it on screen.
    t.style.fontSize = `${shown}px`;
    lastFittedRef.current = best; // seed off the UNSCALED fit
    fitCacheSet(cacheKey, best);
    setSize(shown);
  };

  // Always call the LATEST fit closure from listeners set up once. Without this,
  // the ResizeObserver below (empty deps) captured the FIRST render's `fit`,
  // which held stale `currentText`/dimensions — so when a FRESH projector window
  // settled its real height AFTER the initial fit, the observer's re-fit ran the
  // stale closure and the wrong size (one tiny line, text measured against a
  // not-yet-settled height) never self-corrected. The operator preview never hit
  // this because its aspect-video box has a stable height on first paint.
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useLayoutEffect(() => {
    fit();
    // Re-fit after layout/transition settles. TWO reasons this is needed:
    //  1) A fresh projector window can still be settling its flex height on the
    //     frame the first slide paints.
    //  2) The /live output REMOUNTS this component on every slide change and
    //     plays an enter animation — a fit measured mid-animation can under-size
    //     and (without this) stick tiny for the rest of that slide. That's the
    //     "next verse/song slide goes small" bug.
    // rAF catches the fast case with no visible flash; the timeouts land AFTER
    // the transition animation finishes so the final size is always the correct
    // big one. All idempotent + cached, so redundant runs are free.
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { fitRef.current(); r2 = requestAnimationFrame(() => fitRef.current()); });
    const t1 = window.setTimeout(() => fitRef.current(), 160);
    const t2 = window.setTimeout(() => fitRef.current(), 420);
    const t3 = window.setTimeout(() => fitRef.current(), 750);
    return () => {
      cancelAnimationFrame(r1); if (r2) cancelAnimationFrame(r2);
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [currentText, fontScale, fontToken]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => fitRef.current());
    ro.observe(box);
    // Belt-and-braces: a projector window going fullscreen / a display
    // connecting fires a window resize that a box-scoped ResizeObserver can miss
    // on some compositors. Re-fit on those too.
    const onResize = () => fitRef.current();
    window.addEventListener("resize", onResize);
    return () => { ro.disconnect(); window.removeEventListener("resize", onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FOUT fix (2026-08-12): fonts load with display=swap, so the FIRST slide of a
  // session can paint in the fallback font and then swap to the real font (Sora)
  // when it finishes loading — the fit measured fallback glyph widths, so the
  // line reflows/overflows on swap. Refit ONCE when the webfonts are actually
  // ready. One-shot: later slides fit correctly because the font is already
  // loaded by then. No artificial delay — a real "font is ready" signal.
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts?.ready) return;
    let cancelled = false;
    document.fonts.ready.then(() => { if (!cancelled) fitRef.current(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard-only page nav inside the pane (for operator preview
  // testing). Live projector doesn't respond to keys.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (pages.length <= 1) return;
      if (e.key === "PageDown") { e.preventDefault(); setPageIdx((i) => Math.min(pages.length - 1, i + 1)); }
      if (e.key === "PageUp")   { e.preventDefault(); setPageIdx((i) => Math.max(0, i - 1)); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages.length]);

  return (
    <div ref={boxRef} className="w-full h-full flex items-center justify-center overflow-hidden relative" style={{ padding: pad }}>
      <div
        ref={textRef}
        className={className}
        style={{
          // Themeable defaults — overridable by the active theme's textStyle.
          fontWeight: 700, // bold — pastor projection readability floor
          textAlign: "center",
          textShadow: "0 2px 8px rgba(0,0,0,0.55)", // slight halo so text pops on busy backgrounds
          ...textStyle,
          // Layout-critical — always win over the theme (never let a theme break
          // the fit, wrapping, or the always-on ALL-CAPS crowd readability).
          fontSize: `${size}px`,
          lineHeight: tightLine ? 1.02 : 1.08,
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
          wordBreak: "normal",
          textWrap: "balance",
          // Projector: force the text block to the FULL container width so long
          // lines MUST wrap (and the binary search grows the font to fill the
          // HEIGHT with wrapped lines) instead of shrinking a single line to fit
          // the width — the exact failure that made verses/lyrics project as one
          // tiny clipped line. text-align keeps it centred within the full width.
          // Non-projector surfaces (thumbnails) keep shrink-to-fit (maxWidth only).
          width: projectorFit ? "100%" : undefined,
          maxWidth: "100%",
          maxHeight: "100%",
          textTransform: "uppercase", // ProPresenter-style crowd readability (2026-08-11, user: always-on). The fit measures the transformed (wider) glyphs, so sizing stays correct.
        }}
      >
        {refSplit.body}
        {refSplit.ref && (
          // Secondary reference — em-relative so it tracks the verse size.
          <span style={{ fontSize: "0.62em", fontWeight: 600, opacity: 0.85 }}>{"\n\n" + refSplit.ref}</span>
        )}
      </div>
      {pages.length > 1 && (
        <div className="absolute bottom-2 right-3 text-white/60 text-[10px] font-mono flex items-center gap-1.5">
          <span className="opacity-80">{pageIdx + 1} / {pages.length}</span>
          <span className="flex gap-1">
            {pages.map((_, i) => (
              <span key={i} className={`inline-block w-1.5 h-1.5 rounded-full ${i === pageIdx ? "bg-white" : "bg-white/30"}`} />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Split text into readable chunks. Heuristic:
 *   1. If total chars ≤ ~350, return [text] — likely fits.
 *   2. Otherwise, split at sentence terminators (. ! ?) first, then at
 *      semicolons/commas if any resulting chunk is still too long,
 *      finally at word boundaries.
 *   3. Target ~350 chars per chunk (roughly what fits at 22px in a
 *      500×280 pane; scales with container).
 *   4. Preserve any trailing "\n\n<reference>" attribution intact on
 *      the LAST page only.
 */
// Matches a trailing scripture reference like "\n\n John 3:16 (KJV)" or
// "\n\n 1 Corinthians 13:4-7". Shared shape with paginateForFit's detector.
const TRAILING_REF_RE = /\n\n([1-3]?\s?[A-Za-z ]+ \d+:\d+(?:-\d+)?\s*(?:\([A-Z0-9]+\))?)\s*$/;

/**
 * Split a slide's text into { body, ref } where `ref` is a trailing scripture
 * reference (rendered smaller for hierarchy). Returns ref="" when there's no
 * trailing reference (songs, announcements, plain text) so the whole string
 * renders at the primary size.
 */
export function splitTrailingRef(text: string): { body: string; ref: string } {
  if (!text) return { body: "", ref: "" };
  const m = TRAILING_REF_RE.exec(text);
  if (!m) return { body: text, ref: "" };
  const body = text.slice(0, m.index);
  // Degenerate "reference only, no verse" slide — render the whole thing at the
  // primary size rather than shrinking the sole content to 0.5em.
  if (!body.trim()) return { body: text, ref: "" };
  return { body, ref: m[1].trim() };
}

export function paginateForFit(text: string, targetChars = 350): string[] {
  if (!text) return [""];

  // Preserve the trailing reference label ("\n\n John 3:16 (KJV)") — stick
  // it on the last page only.
  let body = text;
  let refLabel = "";
  const refMatch = /\n\n([1-3]?\s?[A-Za-z ]+ \d+:\d+(?:-\d+)?\s*(?:\([A-Z0-9]+\))?)\s*$/.exec(text);
  if (refMatch) {
    refLabel = refMatch[0];
    body = text.slice(0, refMatch.index);
  }

  if (body.length <= targetChars) return [text];

  // Split on sentence terminators, keeping the terminator with the sentence
  const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + " " + s).trim().length <= targetChars) {
      current = current ? current + " " + s : s;
    } else {
      if (current) chunks.push(current.trim());
      // If a single sentence itself is too long, fall back to clause / word split
      if (s.length > targetChars) {
        chunks.push(...breakLongSentence(s, targetChars));
        current = "";
      } else {
        current = s;
      }
    }
  }
  if (current) chunks.push(current.trim());

  // Append the reference label to the last chunk
  if (refLabel && chunks.length > 0) chunks[chunks.length - 1] = chunks[chunks.length - 1] + refLabel;
  return chunks.length > 0 ? chunks : [text];
}

function breakLongSentence(s: string, targetChars: number): string[] {
  // Try clause boundaries first (;, :, — comma) then hard word wrap
  const clauses = s.split(/(?<=[,:;—-])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const c of clauses) {
    if ((cur + " " + c).trim().length <= targetChars) {
      cur = cur ? cur + " " + c : c;
    } else {
      if (cur) out.push(cur.trim());
      if (c.length > targetChars) {
        // Hard word wrap — shouldn't happen for real prose
        for (let i = 0; i < c.length; i += targetChars) out.push(c.slice(i, i + targetChars));
        cur = "";
      } else {
        cur = c;
      }
    }
  }
  if (cur) out.push(cur.trim());
  return out;
}
