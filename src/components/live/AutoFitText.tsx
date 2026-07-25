"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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

export function AutoFitText({ text, className, maxPx = 220, paddingRatio = 0.06, minPx, disablePagination }:
  {
    text: string;
    className?: string;
    maxPx?: number;
    paddingRatio?: number;
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
  }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
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
  const [pad, setPad] = useState(4);
  const [pageIdx, setPageIdx] = useState(0);

  // 2026-07-25: skip pagination entirely when the caller opts out (grid
  // thumbnails prefer shrink-to-fit over page-split since a page indicator
  // is illegible at glance size).
  const pages = useMemo(() => disablePagination ? [text] : paginateForFit(text), [text, disablePagination]);
  const currentText = pages[Math.min(pageIdx, pages.length - 1)] || text;

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

    // T3 cache hit — same text, same box → skip binary search entirely.
    // Cache key includes effectiveMinPx so grid thumbnails don't share
    // cache entries with live-projector renders of the same text (different
    // valid font sizes for different min floors).
    const cacheKey = fitCacheKey(currentText, bw, bh, maxPx) + `|${effectiveMinPx}`;
    const cached = fitCacheGet(cacheKey);
    if (cached !== undefined) {
      lastFittedRef.current = cached;
      setSize(cached);
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
    lastFittedRef.current = best;
    fitCacheSet(cacheKey, best);
    setSize(best);
  };

  useLayoutEffect(() => { fit(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [currentText]);

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
          lineHeight: 1.15,
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
          wordBreak: "normal",
          textAlign: "center",
          textWrap: "balance",
          maxWidth: "100%",
          maxHeight: "100%",
          fontWeight: 700, // bold — pastor projection readability floor
          textShadow: "0 2px 8px rgba(0,0,0,0.55)", // slight halo so the text pops on busy backgrounds
        }}
      >
        {currentText}
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
