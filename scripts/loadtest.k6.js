// PresentFlow load test (k6) — pre-launch "will 50 users break it?" check.
//
// Targets ONLY public, read-only surfaces (marketing pages + a couple of public
// GET API routes). It deliberately does NOT touch the apply form, auth, or any
// mutation/email endpoint, so running it never sends real emails, creates data,
// or trips write-side rate limits.
//
// ── Install k6 ──────────────────────────────────────────────────────────────
//   macOS:  brew install k6
//   (or see https://k6.io/docs/get-started/installation/)
//
// ── Run ─────────────────────────────────────────────────────────────────────
//   # against the live marketing site (default):
//   k6 run scripts/loadtest.k6.js
//
//   # against a Vercel preview / another base URL:
//   BASE_URL=https://faithflow-ai.vercel.app k6 run scripts/loadtest.k6.js
//
//   # quick smoke (10 VUs, 30s) instead of the full ramp:
//   k6 run --stage 30s:10 scripts/loadtest.k6.js
//
// Read the summary at the end: `http_req_failed` should stay ~0% and
// `http_req_duration p(95)` under the threshold. If either breaches, the run
// exits non-zero — that's your "it broke" signal.

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "https://presentflow.org").replace(/\/$/, "");

// Public, side-effect-free GET routes. Weighted toward the pages real visitors
// hit first. (Legal pages are cheap and confirm the new routes serve.)
const ROUTES = [
  "/",
  "/",
  "/",
  "/what-it-can-do",
  "/how-it-works",
  "/our-story",
  "/login",
  "/privacy",
  "/terms",
  "/refund",
  "/dpa",
  "/msa",
];

const errorRate = new Rate("page_errors");

export const options = {
  // Ramp to 50 concurrent virtual users (the checklist's "50 users" bar),
  // hold, then ramp down. ~3.5 min total.
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 50 },
    { duration: "1m", target: 50 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    // 99% of requests must succeed; p95 latency under 1s, p99 under 2s.
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000", "p(99)<2000"],
    page_errors: ["rate<0.01"],
  },
  // Be a good citizen: identify the load test in logs.
  userAgent: "PresentFlow-k6-loadtest/1.0",
};

export default function () {
  const path = ROUTES[Math.floor(Math.random() * ROUTES.length)];
  const res = http.get(`${BASE_URL}${path}`, {
    headers: { "Accept": "text/html" },
    tags: { path },
  });

  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "body is non-empty": (r) => !!r.body && r.body.length > 0,
  });
  errorRate.add(!ok);

  // Model a real visitor pausing between page views (1-3s).
  sleep(1 + Math.random() * 2);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration.values["p(95)"];
  const failed = data.metrics.http_req_failed.values.rate;
  const line =
    `\nPresentFlow load test — ${BASE_URL}\n` +
    `  requests:      ${data.metrics.http_reqs.values.count}\n` +
    `  failed:        ${(failed * 100).toFixed(2)}%\n` +
    `  p95 latency:   ${p95 ? p95.toFixed(0) : "?"} ms\n` +
    `  verdict:       ${failed < 0.01 && p95 < 1000 ? "PASS ✅" : "REVIEW ⚠️"}\n`;
  return { stdout: line };
}
