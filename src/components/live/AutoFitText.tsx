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

export function AutoFitText({ text, className, maxPx = 220, paddingRatio = 0.06, minPx, disablePagination, projectorFit, fontScale = 1 }:
  {
    text: string;
    className?: string;
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
      const floorPx = projectorFloorPx(containerH);
      // B3 manual scale, projector: A+ RAISES the fit ceiling so short text can
      // grow bigger while STILL fitting (never clipped); A− is applied as a
      // post-fit shrink below (always fits). This makes A+/A− both effective
      // and clip-free — vs a naive post-scale where A+ would just crop.
      const scale = fontScaleRef.current;
      const ceilPx = Math.round(projectorCeilingPx(containerH) * Math.max(1, scale));
      t.style.lineHeight = "1.15";
      const fitsAt = (px: number) => {
        t.style.fontSize = `${px}px`;
        return t.scrollWidth <= bw + 1 && t.scrollHeight <= bh + 1;
      };

      // "Aggressive largest-fit" (2026-08-10): find the TRUE largest size in
      // [floor, ceil] that fits the safe area — no longer capped at the
      // word-count band. Short text grows to the ceiling; long text shrinks
      // only as far as needed, then paginates at the floor. Cached by
      // text+box+floor/ceil so repeat slides skip the search entirely.
      const projKey = `proj|${Math.round(bw / 4) * 4}|${Math.round(bh / 4) * 4}|${floorPx}|${ceilPx}|${currentText}`;
      let best: number;
      const cachedProj = fitCacheGet(projKey);
      if (cachedProj !== undefined) {
        best = cachedProj;
      } else {
        // Seed from the word-count band (a good first guess for fast
        // convergence), then binary-search UP toward the ceiling.
        const seedBand = calculateProjectorFontSize(currentText, containerH);
        const seed = Math.min(ceilPx, Math.max(floorPx, Math.max(seedBand, Math.round(lastFittedRef.current))));
        let lo = floorPx, hi = ceilPx, found = -1;
        if (fitsAt(seed)) { found = seed; lo = seed + 1; } else { hi = seed - 1; }
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (fitsAt(mid)) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
        }
        best = found >= floorPx ? found : floorPx;
        fitCacheSet(projKey, best);
      }
      // At/under the floor a very long slide may still overflow — tighten the
      // line-height and let the safe-area padding absorb it (never shrink
      // below the readability floor).
      const overflowAtFloor = best <= floorPx && !fitsAt(best);
      if (overflowAtFloor) warnOverflowOnce(currentText, floorPx);
      // A+ already grew via the raised ceiling (best fits at the bigger size);
      // A− shrinks post-fit (min(1,scale)). Either way `shown` is a size that
      // FITS — no clipping. AUTO (1.0) → shown === best (byte-identical).
      const shown = Math.max(floorPx, Math.min(ceilPx, Math.round(best * Math.min(1, scale))));
      lastFittedRef.current = best; // seed off the UNSCALED fit
      // Pin the DOM to the shown size + line-height (the search's last probe
      // may have been a failing value, and a no-op setState wouldn't re-render).
      t.style.fontSize = `${shown}px`;
      t.style.lineHeight = overflowAtFloor ? "1.05" : "1.15";
      setTightLine(overflowAtFloor);
      setSize(shown);
      return;
    }
    setTightLine(false);

    // T3 cache hit — same text, same box → skip binary search entirely.
    // Cache key includes effectiveMinPx so grid thumbnails don't share
    // cache entries with live-projector renders of the same text (different
    // valid font sizes for different min floors).
    const cacheKey = fitCacheKey(currentText, bw, bh, maxPx) + `|${effectiveMinPx}`;
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

  useLayoutEffect(() => { fit(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [currentText, fontScale]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(box);
    return () => ro.disconnect();
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
          fontSize: `${size}px`,
          lineHeight: tightLine ? 1.05 : 1.15,
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
          wordBreak: "normal",
          textAlign: "center",
          textWrap: "balance",
          maxWidth: "100%",
          maxHeight: "100%",
          fontWeight: 700, // bold — pastor projection readability floor
          textTransform: "uppercase", // ProPresenter-style crowd readability (2026-08-11, user: always-on). The fit measures the transformed (wider) glyphs, so sizing stays correct.
          textShadow: "0 2px 8px rgba(0,0,0,0.55)", // slight halo so the text pops on busy backgrounds
        }}
      >
        {refSplit.body}
        {refSplit.ref && (
          // Secondary reference — em-relative so it tracks the verse size.
          <span style={{ fontSize: "0.5em", fontWeight: 600, opacity: 0.82 }}>{"\n\n" + refSplit.ref}</span>
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
