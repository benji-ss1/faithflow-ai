// Version changelog — the "What's New" modal reads this at mount and shows
// any entries newer than the operator's last-seen version.
//
// Add a new entry at the TOP whenever you tag a release. Keep highlights
// operator-facing (what THEY see change), not internal refactors.

export type Highlight = string | { text: string; tryItHref?: string; tryItLabel?: string; highlightParam?: string };

export type ChangelogEntry = {
  version: string;
  date: string; // ISO YYYY-MM-DD
  headline: string;
  highlights: Highlight[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.1.20",
    date: "2026-07-23",
    headline: "Transcript panel perf + tightened learned-vocab hygiene",
    highlights: [
      "Long-service transcript panel now renders 5–10× fewer DOM nodes by grouping same-confidence-tier words into single spans — smoother scrolling on older Macs during 90-minute sermons",
      "Learned-vocab table now enforces its documented enum at the database level (source can only be 'manual' or 'learned') — hygiene, prevents a future raw SQL slip from poisoning it",
    ],
  },
  {
    version: "0.1.19",
    date: "2026-07-23",
    headline: "Reliability pass on today's shipped features",
    highlights: [
      "Auto-live: fixed a subtle case where a stale detection at the very start of a service could fire the wrong slide (the anti-replay guard now catches it correctly)",
      "Whisper double-check: added rate-limit protection, per-connection concurrency caps, and drops stale corrections older than 8 seconds so a purple chip never appears jarringly mid-sermon",
      "Learned vocabulary now filters out congregation voices (uses speaker diarization), rejects multi-word garble, and can't be double-promoted by a network retry",
      "Reconnecting spinner: only appears when a reconnect actually takes >750ms — no more single-frame flicker on quick recoveries",
      "Song auto-live: 15-second floor even when swapping between songs stops rapid worship transitions from machine-gunning slide changes",
      "All fixes are transparent — nothing to configure or change in your workflow",
    ],
  },
  {
    version: "0.1.18",
    date: "2026-07-23",
    headline: "AI learns your church's vocabulary + Whisper double-checks low-confidence scripture",
    highlights: [
      "Learned vocabulary: after every service, words the AI kept struggling with get automatically added to that church's Deepgram vocabulary — no manual config, gets smarter with every service",
      "Whisper double-check: when the AI catches a scripture reference but isn't fully sure, it silently sends the audio to Groq Whisper for a canonical second opinion. If Whisper disagrees, a purple 'Whisper says' chip appears with the corrected reference — one click to swap. Never auto-swaps a live slide during a service",
      "Both are best-effort: any failure (DB blip, Whisper API hiccup, no per-preacher data yet) silently falls back to the previous behavior — the pipeline is fail-open by design",
    ],
  },
  {
    version: "0.1.17",
    date: "2026-07-23",
    headline: "Deeper audio: word-level confidence heatmap, background-reconnect indicator, speaker diarization",
    highlights: [
      "Live transcript panel now colors low-confidence words amber (< 75%) and very-low words with a dotted underline (< 50%) — you can see exactly which words the AI is struggling with instead of only whether the whole segment was right or wrong",
      "When the AI listener is silently reconnecting in the background, a subtle spinning ↻ now appears next to the AI ON pill — the pill itself stays green so nothing changes about the binary ON/OFF you asked for",
      "Deepgram now labels each word with a speaker index (preacher vs congregation vs guest) — first pass is passthrough only; a future pass will filter congregation shouts out of detection",
    ],
  },
  {
    version: "0.1.16",
    date: "2026-07-23",
    headline: "New: LOW AUDIO chip so bad-mic misfires don't look like AI bugs",
    highlights: [
      "When transcription confidence drops over the last several segments, an amber 'LOW AUDIO' chip now appears next to the AI ON pill with the current rolling average",
      "The tooltip explains: 'AI misfires right now are likely a signal problem, not a model error' — check mic position, room echo, preacher distance",
      "Chip auto-clears once quality recovers; hysteresis stops it flapping at the boundary",
    ],
  },
  {
    version: "0.1.15",
    date: "2026-07-23",
    headline: "Transcription accuracy: full 66-book vocab + core Christian terms",
    highlights: [
      "Deepgram now knows every Bible book by name (was only 12), plus core Christian vocabulary (Jesus Christ, Holy Spirit, hallelujah, righteousness, salvation, covenant, etc.) and common preacher phrasing ('the Bible says', 'turn with me to', 'chapter', 'verse')",
      "This directly biases the transcription model against the accented / fast-speech mishearings you've been seeing — a preacher saying 'Habakkuk 3:2' or '2 Corinthians 5:17' is now much more likely to land correctly on the first try",
      "The parser's downstream repairs (TH-fronting: tree→three, tird→third, etc. and fuzzy book matching for near-miss names) still catch anything Deepgram misses",
    ],
  },
  {
    version: "0.1.14",
    date: "2026-07-23",
    headline: "AUTO now follows worship leader back and forth between songs",
    highlights: [
      "Worship team swapping Song A → Song B → back to Song A now auto-projects each swap live — previously the 3rd, 4th, Nth mention was silently blocked",
      "Same-song echo suppression is retained: if the song the AI just detected is already the slide on screen, it won't re-fire",
      "Requires AUTO ON and ≥85% detection confidence, same as before",
    ],
  },
  {
    version: "0.1.13",
    date: "2026-07-23",
    headline: "AUTO now follows the preacher back and forth between verses",
    highlights: [
      "Preacher jumping Matt 5:5 → Gen 4:4 → back to Matt 5:5 → Gen 4:4 (and so on) now auto-projects each swap — previously the 3rd, 4th, Nth mention was silently blocked by the anti-replay guard",
      "Guardrail unchanged: if the reference the preacher just said is ALREADY the slide on screen, it still won't re-fire on echo (avoids flicker)",
      "Works within a 10-minute rolling window per reference; AUTO must be ON, same as before",
    ],
  },
  {
    version: "0.1.12",
    date: "2026-07-23",
    headline: "Bible: each reference gets its own clean slide grid",
    highlights: [
      "Jumping to a new Bible reference (from an AI chip, the Bible Detections panel, or a spoken detection) now REPLACES the slide grid with just that reference — no more stale verses from an earlier passage mixed in",
      "Full history of detected references still lives in the AI chips strip and the Bible Detections panel — click any chip to swap grids cleanly",
      "Verse ▸ / ◂ nav is unchanged: walking Matthew 5:5 → 5:6 → 5:7 still builds up cards in the same section",
    ],
  },
  {
    // Content-only revision (no new shell binary — thin-client web/backend
    // fixes, always live regardless of installed app version). See R1 in
    // WhatsNewModal.tsx for why version numbering here no longer maps 1:1
    // to a released Electron build.
    version: "0.1.11",
    date: "2026-07-22",
    headline: "AI listening fixes + sermon search",
    highlights: [
      "AI Live connection no longer flickers on/off during brief network blips",
      "Scripture detection now understands more accents and mispronounced book names automatically",
      "If the preacher restates a verse, or says \"verse 7\" / \"from verse 13\" on its own, AUTO mode now catches it instantly",
      { text: "New: search past services in plain English, get an AI-composed answer with sources", tryItHref: "/archive", tryItLabel: "Try Sermon Search", highlightParam: "ask-sermon-history" },
      { text: "10 songs from recent services added to your library (titles only — add lyrics via Import Songs before using live)", tryItHref: "/library/songs", tryItLabel: "View Songs Library" },
    ],
  },
  {
    version: "0.1.10",
    date: "2026-07-18",
    headline: "AI listening fix + one-click diagnostic",
    highlights: [
      "🔴 Fixed the real reason AI wasn't connecting — corrected the audio bridge URL on the server (was silently returning a URL your browser couldn't reach)",
      "New: click the Present Flow logo (bottom-left) → 'Diagnose AI listener' to run a one-click trace of every pipeline step (session → ticket → mic → WebSocket → Deepgram) with a specific fix line on any failure",
      "New: 'Reset & re-sync' button in this modal — clears local caches + service workers + reloads with a fresh bundle from the server",
    ],
  },
  {
    version: "0.1.9",
    date: "2026-07-18",
    headline: "Reliability + safety pass",
    highlights: [
      "AI listening: end-to-end rework — new server guard, mic-mute leak fixed, retryable stall watchdog",
      "Add Song: ProPresenter-style dialog with Theme + Size + optional blank template seed",
      "Bible: new List view — compact verses on the left, big preview on the right (toggle via header List button)",
      "Auto-update: 'Undo' toast on any autopilot auto-live push (4-second window)",
      "Song editor: 1.5s debounced autosave with visible save status + unsaved-changes guard",
      "Verse ▸ button now actually walks forward through verses; toast on end-of-chapter",
      "Bible references without spaces now parse: '1john 1 1', '1cor2:1', 'psalm23:1'",
      "Every panel wrapped in a crash-recovery boundary — one broken panel no longer nukes the whole app",
      "Global error handler surfaces any silent failure as a toast so nothing hides in the console",
      "6 security headers on every response (X-Frame, HSTS, CSP report-only, Permissions-Policy, etc.)",
      "Every paid API endpoint now rate-limited (audio ticket, Bible search, PPTX convert, media presign, all AI helpers)",
    ],
  },
  {
    version: "0.1.6",
    date: "2026-07-18",
    headline: "Auto-updater fixed",
    highlights: [
      "Ad-hoc code signing so macOS Squirrel accepts unsigned updates",
      "Auto-update banner has a Retry button after a stalled download",
      "Live-service guard: never quits to install mid-service without a confirm dialog",
    ],
  },
  {
    version: "0.1.3",
    date: "2026-07-18",
    headline: "Thin-client shell",
    highlights: [
      "Desktop app now a thin client — loads hosted UI from Vercel",
      ".app dropped from 388 MB to 115 MB",
      "Zero secrets bundled in the shell (no more DB URL / API keys on tester disks)",
      "All 3-agent audit fixes landing: AI listening hardening, sandbox, navigation guards, single-instance lock",
    ],
  },
];

// WhatsNewModal.dismiss() trusts CHANGELOG[...][0] of its filtered result to
// be the NEWEST shown entry, which only holds if this array is kept
// newest-first — enforced today only by the comment above, not by any
// runtime check. A single out-of-order insert would silently record a stale
// version as "last seen" and permanently hide later entries for testers who
// already passed that point. Fail fast in dev if the ordering ever slips.
function cmpVersionForOrderCheck(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
if (process.env.NODE_ENV !== "production") {
  for (let i = 1; i < CHANGELOG.length; i++) {
    if (cmpVersionForOrderCheck(CHANGELOG[i - 1].version, CHANGELOG[i].version) < 0) {
      throw new Error(
        `CHANGELOG must be newest-first: "${CHANGELOG[i - 1].version}" (index ${i - 1}) is older than "${CHANGELOG[i].version}" (index ${i}).`,
      );
    }
  }
}
