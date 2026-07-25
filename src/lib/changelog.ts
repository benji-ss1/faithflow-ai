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
    version: "0.1.44",
    date: "2026-07-25",
    headline: "▶ Play button now context-aware (Bible / Songs / Slides) + < Verse / Verse > give visible feedback",
    highlights: [
      "The ▶ Play button in the center header + the ▶ Show button in the top bar were silently doing nothing when you were in Bible or Songs mode. Root cause: both buttons read from `plan.items` (the playlist), so if you loaded a Bible reference or selected a song from the library WITHOUT adding it to the playlist first, they had nothing to send. Now both buttons are context-aware: in Bible mode they fire the currently selected verse card, in Songs mode they fire the selected song's slide 1, in Slides mode they fire the playlist item's slide 1 (existing behavior)",
      "< Verse / Verse > transport-bar buttons now show 'Type a Bible reference and press Lookup first' when pressed with nothing loaded, and 'Already on the first/last slide' when at the edge of a playlist item. Previously silent no-op",
      "Every play / verse-nav click is now logged in DevTools ([center-play], [topbar-play], [bottom-bar], [verse-nav], [bible-play-current], [songs-play-current] prefixes) so you can grep DevTools console to trace exactly why a button 'didn't work'",
      "Successful actions now toast — 'Luke 15:11 → LIVE', 'Playing Amazing Grace' — so you can tell at a glance the click was received even if the projector window is off-screen",
    ],
  },
  {
    version: "0.1.43",
    date: "2026-07-25",
    headline: "Song click-to-live: playlist song items now fire on click + visible toast confirmation + click tracing",
    highlights: [
      "Clicking a SONG item in the left playlist now actually sends slide 1 to the projector immediately, and shows a 'Playing \"[title]\" — slide 1' toast so you know the click was received. Previously this only fired when AUTO was on, leaving operators clicking a playlist song and seeing no visible change. Bible items still don't auto-fire on playlist click (operators pick a specific verse first)",
      "Clicking a slide in the Songs Library view (center panel) now shows a 'Sent to LIVE: \"[first words]\"' toast confirming the click reached the live pipeline. If the toast fires but nothing appears on the projector, the bug is on the projector side (check that a Live Screen is assigned in Settings › Screens)",
      "Empty song slides (no lyrics yet) now show an 'add lyrics with the pencil first' toast on click instead of silently no-op'ing — the previous behavior read as 'the button is broken'",
      "DevTools tracing added at every send-to-live entry point ([live] and [songs-browser] and [playlist] prefixes) so if a click still fails to project, opening Cmd+Opt+I → Console reveals exactly which step dropped the payload",
    ],
  },
  {
    version: "0.1.42",
    date: "2026-07-25",
    headline: "Church-mixer audio fix (DSP OFF), Mac Studio no-mic path, and visible audio-failure toasts",
    highlights: [
      "Mixer / Interface vs Microphone toggle in Settings › Audio. This is a real fix, not a preference: PresentFlow was hard-coding echo cancellation + noise suppression + auto-gain-control ON for every input, which actively DEGRADES a clean mixer feed (gates speech, pumps the level, smears consonants). The default is now Mixer / Interface (DSP OFF) — the setting churches actually need. Bare-mic-in-the-room use flips it to Microphone",
      "'No audio detected for 15s' toast now surfaces when the input is truly silent — most likely cause is the wrong device is picked or the mixer channel is muted. Previously the RMS silence was measured but never shown, so a stuck-muted volunteer stood there wondering why AI wasn't firing",
      "Audio start failures are now VISIBLE. When AI listening can't start (Mac Studio with no USB device, permission denied, device busy in another app), an actionable error toast appears with the specific fix. Previously the error state existed in the pipeline but was never rendered anywhere in the Pro shell — a silent failure",
      "Mac Studio no-mic setup flow is friendly: the audio setup wizard now specifically detects the 'zero audio inputs' case (Mac Studio + nothing plugged in) and shows a plain-English message with a Refresh button, instead of the confusing 'permission denied — click the mic icon in your address bar' message that fired before",
      "Live audio level meter now sits directly next to the AI ON pill in the top bar — a 60px green/amber/red bar that bounces with real-time input. If the bar is flat while the preacher is talking, you know immediately (without opening Settings) that PresentFlow isn't hearing your mixer",
      "Windows-specific 'device locked by another app' message now explains ASIO exclusive mode (Ableton / Reaper / Cubase / ASIO control panel → turn off Exclusive Mode) instead of the generic 'close Zoom' copy. Detected via navigator.platform so macOS still gets the macOS-appropriate copy",
      "New OverconstrainedError copy covers audio devices that refuse the requested 16kHz sample rate — most common on old FireWire interfaces + a few Bluetooth headsets. Falls back to the device's native rate transparently, with a clear message if the retry also fails",
    ],
  },
  {
    version: "0.1.41",
    date: "2026-07-25",
    headline: "Parser accent-fixes, typed shortcuts (EX 2 1 / John1010), Settings tabs no longer overlap, no interrupt while typing",
    highlights: [
      "'Route 4 is 1' now parses as Ruth 4:1 — Deepgram often mishears 'Ruth' as 'route' in African-accented speech, and it also renders the ':' between chapter and verse as the word 'is' ('4 is 1'). Both mishearings are now auto-repaired before pattern matching",
      "'DEUTEROMY' / 'DEUTERONOMAY' now detect as Deuteronomy — the transcript kept dropping the second N or drifting to '-nomay'. Both variants added to the alias table",
      "Typed 'COLO 3 1' now looks up Colossians 3:1 (added 'colo' and 'colos' as short forms). 'EXODOUS' also detects as Exodus (very common typo when in a rush)",
      "Typed 'EX 2 1', 'AM 1', 'AC 2', 'RE 21' etc. in the reference field now looks up the book — two-letter abbreviations (ex, ru, is, am, ac, re, ph, jd) are recognized in the TYPED input path only (still ignored in live speech to avoid false-firing on ordinary English)",
      "Fused-digit shortcuts now work for EVERY book, not just one — type 'john1010' and get John 10:10, 'psalm316' and get Psalm 3:16, 'matt77' skipped as too ambiguous, 'psalm119' or 'psalm150' correctly resolves to the whole chapter (Psalm 119 / Psalm 150) rather than 1:19 / 1:50. The split heuristic knows each book's max chapter and 1..176 verse range, so nonsense splits (Acts 290) are rejected instead of misfiring",
      "AI no longer projects a verse while you're typing in the search bar or reference field. If focus is inside any input, textarea, or contenteditable, the auto-approve path is held until focus leaves. Prevents the annoying interruption when you're mid-lookup and the mic hears a passing phrase",
      "Settings popover tabs (Audio / Messages / Timers / Themes / Macros) were visually crashing into each other in the narrow sidebar — the uppercase + wide letter spacing meant 5 labels didn't fit. Simplified label style and switched to natural-width tabs so they either fit comfortably or scroll cleanly",
    ],
  },
  {
    version: "0.1.40",
    date: "2026-07-25",
    headline: "Live preview locked to 220px 16:9 + grid cards readable again + ResizeObserver false-positive silenced",
    highlights: [
      "Live preview panel is now a fixed 220px-tall 16:9 box (was auto-growing to 60vh which took over the whole right sidebar on long verses). Wider than tall, matches audience projector aspect, never oscillates. Long verses paginate at the sanctuary-readability floor instead of stretching the box",
      "Slide grid cards raised the readable floor 8px → 14px and re-enabled pagination — thumbnails were unreadable at 8px. Now short verses fit whole, long ones page cleanly with a visible indicator",
      "'Runtime error: ResizeObserver loop completed with undelivered notifications' toast — this was a benign Chromium warning that fires whenever a layout callback triggers another layout callback in the same frame (AutoFitText's binary-search setState is the classic trigger). Silenced in the global error handler; the browser handles it correctly by deferring to the next frame",
    ],
  },
  {
    version: "0.1.39",
    date: "2026-07-25",
    headline: "Right-panel Phase 3: unified icon bar with popovers (proper lucide icons, no emojis)",
    highlights: [
      "The two big empty-state detection panels (Bible Detections + Song Detections, each ~200px tall showing 'no references yet…' most of the time) are GONE — replaced by a single horizontal icon toolbar at the bottom of the sidebar",
      "Six icons: Bible, Songs, Cross-references, Logs, Settings, Screens — all proper lucide-react icons, NOT emojis. Click any icon to open a scrollable popover with that section's content. Click the icon again (or the X) to close",
      "Live badge counts on Bible / Songs / Cross-refs icons — a small orange circle showing how many active detections there are, updates in real time as the AI listens",
      "Settings popover: consolidates Audio / Messages / Timers / Themes / Macros as sub-tabs. Screens popover: the per-machine resolution + display assignment + 'Configure Screens' button. Both were previously buried below the fold",
      "The old AIDetectionsPanel and RightTabs components still exist in the tree (unused) so we can roll back trivially if this regresses; will be deleted in a follow-up ship",
    ],
  },
  {
    version: "0.1.38",
    date: "2026-07-25",
    headline: "Slide grid cards + Live preview fit their full content + Cmd+R now hard-reloads",
    highlights: [
      "Slide grid cards (the thumbnails in the center panel showing each verse / stanza / section of a song) now shrink text as far as needed to fit the WHOLE content in one card — no more truncated 'I once was lost, but…' cutoff, no pagination inside a thumbnail",
      "Live preview panel dropped its 16:9 aspect constraint (was clipping longer stanzas like 'And grace will lead me hom…'). Now grows dynamically 320px→60vh so multi-line verses fit without pagination. Aspect on the actual audience projector output is unchanged — this is just the operator preview",
      "Cmd+R now force-reloads the app and clears its cache, so a fresh Vercel push always lands on the very next reload. Was previously a soft reload that reused Chromium's cached JS bytecode, which is why 'reload' sometimes didn't show new features (fix requires new .dmg — v0.1.38 or later)",
      "Phase 3 of the right-panel refactor (unified icon bar with proper lucide icons — NOT emojis — replacing the two detection panels + tabs row) coming next",
    ],
  },
  {
    version: "0.1.37",
    date: "2026-07-25",
    headline: "Right-panel Phase 2: taller transcript + scroll pause + orange trigger highlights + timestamps",
    highlights: [
      "Live transcript grew from 96px fixed → 150px min (flexes up to 280px) so multiple recent lines are visible without cycling out",
      "Scroll up to read older lines and the panel STOPS auto-scrolling — new lines land at the bottom but the view stays put. Scroll back to bottom and auto-scroll resumes automatically",
      "Detected trigger phrases (the exact words that caused a Bible / song / lyric detection) now highlight inline in orange within the transcript so you can see WHY the AI fired",
      "Each transcript line gets an mm:ss clock timestamp on the right edge — hover for the full time",
      "Dark-themed scrollbar in the transcript panel (matches the rest of the shell instead of the default OS look)",
      "Phase 3 (unified icon bar + popovers replacing the detection panels) coming next after you review this",
    ],
  },
  {
    version: "0.1.36",
    date: "2026-07-25",
    headline: "Right-panel preview: LIVE ● / IDLE ○ label, taller box, red glow when hot",
    highlights: [
      "'SCREEN 1' relabeled to LIVE ● (red pulse when something is on the projector) / IDLE ○ (grey when nothing is)",
      "Preview box grew from min 200px → 220px so verses and lyrics have visibly more breathing room without hitting the AutoFitText pagination boundary as often",
      "When live, the preview now has a subtle outer red glow (box-shadow) so you can tell at a glance from across the room that content is projecting",
      "Phase 1 of a right-panel refactor — Phase 2 (fatter scrollable transcript with pause/resume + inline highlights + timestamps) coming next after you review this",
    ],
  },
  {
    version: "0.1.35",
    date: "2026-07-25",
    headline: "Staged song 'GO LIVE' button + X really dismisses + screens config timing fix + playlist duplicate guard",
    highlights: [
      "AI-staged song banner now has an explicit orange 'GO LIVE →' button — click or press G, either works. Previously only the G keyboard shortcut worked and if focus was elsewhere the operator was stuck",
      "The X close button on the staged banner now REALLY dismisses — the same song won't re-stage for 10 minutes. Was previously bouncing back within seconds because the same lyric fragment kept firing detections",
      "'Screen configuration is available only in the PresentFlow desktop app' popup no longer appears inside the desktop app — the check now polls for the preload bridge up to 3 seconds instead of giving up on the first render (fixed a real timing race)",
      "Playlist no longer shows duplicate rows when the same song is added twice — client-side dedup mirrors the existing server-side dedup so optimistic-add doesn't stack on top of a real row",
      "Song re-stage floor bumped 15s → 60s so the banner doesn't blink back the moment you're still figuring out what to press",
    ],
  },
  {
    version: "0.1.34",
    date: "2026-07-25",
    headline: "Playlist rows are clickable + AI detections auto-highlight the sidebar item",
    highlights: [
      "Clicking a song / hymn / verse in the left sidebar playlist now actually goes somewhere — it switches the center panel to the slide grid, previews that item's slides, and (if AUTO is on) sends the first slide live immediately. Before, the click set an invisible state and looked like nothing happened",
      "When the AI auto-projects a song (worship team starts singing 'Amazing Grace...'), the sidebar's playlist row for that song now auto-scrolls into view + pulse-highlights so the operator can see at a glance which song is playing",
      "Both changes together: 'they start singing → song appears on screen → sidebar row for it pulses so I know where I am in the plan'",
    ],
  },
  {
    version: "0.1.33",
    date: "2026-07-24",
    headline: "Transcript feels snappier — finalized text lands ~50ms sooner",
    highlights: [
      "Deepgram finalization pushed 150ms → 100ms — white (final) transcript text lands ~33% sooner. The '97 What?' fragment issue was specifically at 50ms; 100ms is well past that pathological floor",
      "Interim transcript debounce 150ms → 90ms — grey partial-word text updates ~40% more frequently without the 'dancing text' jitter we saw at 40ms (that was aggravated by the fragmentation bug, now fixed)",
      "Detection latency is unchanged — both knobs only affect display cadence, not auto-fire responsiveness",
    ],
  },
  {
    version: "0.1.32",
    date: "2026-07-24",
    headline: "Live transcription never stops + song 0-slides in playlist fixed + song auto-project diagnostics",
    highlights: [
      "Live transcript panel's red 'recording' dot no longer disappears during background reconnects — it now shows whenever AI is ON, matching the binary AI ON/OFF rule. Only manually turning AI OFF removes it. Transcript content was already preserved across reconnects; only the visual dot was misleading",
      "Songs added via chip-click no longer show '0' slides in the playlist row while router.refresh() catches up — the optimistic add now seeds slides from the local library data so the count is correct immediately",
      "Added [latency] diagnostic logs for song auto-project (song-candidate arrival, autoLiveSong slide-fetch count, blocked-when-0-slides warning) so we can trace root cause when a song is detected but doesn't reach the projector",
    ],
  },
  {
    version: "0.1.31",
    date: "2026-07-24",
    headline: "Auto-fire +100ms (false-trigger floor tuning) + yellow highlight now fires on real-world book misspellings",
    highlights: [
      "Auto-fire min-gap raised 700ms → 800ms per the tuning heuristic (nudge +100ms until false triggers stop, that's the real floor for THIS mic/room). Still ~5× tighter than the original 4000ms wall",
      "Yellow correction highlight now fires on fuzzy book-name matches too — before it only triggered on rare TH-fronting number words ('tree'→'three'). Now if someone says 'filippians' or 'corintians' or 'ecclesiastis', the corrected word (Philippians / Corinthians / Ecclesiastes) shows briefly yellow in the transcript panel with the original in the hover tooltip",
    ],
  },
  {
    version: "0.1.30",
    date: "2026-07-24",
    headline: "Fixed transcript glitches ('97 What?' style) from over-aggressive endpointing",
    highlights: [
      "Deepgram finalization cadence pulled back from 50ms → 150ms. The 50ms setting was cutting utterances mid-word and Deepgram's numerals-to-digits converter was mis-reading the fragment tails as spoken numbers — that's why you'd see things like '97 What?' when someone said 'so what?'",
      "Detection latency is unchanged either way (detection uses interim results upstream, not final-emission timing)",
      "Endpointing is now 25% tighter than the pre-latency-push baseline of 200ms, without the fragment artefacts",
    ],
  },
  {
    version: "0.1.29",
    date: "2026-07-24",
    headline: "Latency pull-back — 100ms auto-fire was too twitchy, 40ms transcript was too jittery",
    highlights: [
      "Auto-fire min-gap raised 100ms → 700ms — real-service feedback showed 100ms produced visible flicker on rapid quote-then-quote stretches. Still 5-6× tighter than the original 4000ms wall; matches typical preacher cadence without the twitch",
      "Transcript panel debounce raised 40ms → 150ms — 40ms produced 'dancing text' as every partial-word interim caused a re-render. 150ms smooths that while still being 2× tighter than the original 300ms",
      "Detection latency is unchanged either way (both knobs are display/output tuning, not detection gates)",
    ],
  },
  {
    version: "0.1.28",
    date: "2026-07-24",
    headline: "Latency halved twice + fuzzy book fix + smoother slide transitions",
    highlights: [
      "Auto-fire min-gap 400ms → 100ms (10 fires/sec ceiling — sermon-rapid scripture citations project in real time)",
      "Deepgram finalization pushed to 50ms (aggressive; interim-driven detection is unaffected either way)",
      "Whisper canonical two-pass min-gap 3000ms → 750ms — Groq double-checks land twice as often on low-confidence stretches",
      "Slide transitions: text slides no longer flash at min-size before resizing (initial paint now uses last fitted size + a per-text LRU cache skips the binary search entirely on repeat slides)",
      "Image slides: every image URL in the current plan is now background-preloaded when the operator opens it — no more 'black frame then image pops in' on image-slide transitions",
      "Fuzzy book-name F1 fix: 'filippians four verse thirteen' style misspellings now correctly resolve to Philippians (previously silent-failed). Accuracy audit: 12/12 match rate, 0 silent-failures, 0 false-triggers on 17-scenario adversarial suite",
    ],
  },
  {
    version: "0.1.27",
    date: "2026-07-24",
    headline: "Latency push — auto-fire min-gap 4000ms → 400ms, Deepgram finalization 200ms → 100ms",
    highlights: [
      "The single biggest cause of 'AI feels laggy on consecutive scripture citations' was a 4-second hard wall between auto-fires. Cut to 400ms — a preacher rattling off two verses back-to-back at ~1s/verse now lands each on screen instead of blocking the second one for 4 seconds",
      "Deepgram finalization threshold pushed from 200ms → 100ms. Doesn't affect auto-live speed (interim-based detection already bypassed the finalization wait), but sermon RAG ingest / learned-vocab miner / transcript panel all now update ~100ms sooner",
      "Added [latency] auto-fire logging (visible in devtools console) that shows the delta between detection landing and slide firing — real per-fire ms number instead of just perceived feel",
      "DECISIONS.md now has a top-of-file 'current latency budget' table so future audits use live numbers not stale planning notes",
    ],
  },
  {
    version: "0.1.26",
    date: "2026-07-24",
    headline: "Songs auto-project even when Bible is currently live",
    highlights: [
      "Root-cause fix: at ≥85% detection confidence, a song will now auto-project even if Bible (or media, or anything else) is currently on screen. Previously the redetect-cooldown was only bypassed when a DIFFERENT song was live — Bible-live blocked the auto swap to song, so 'let us sing Amazing Grace' at 98% confidence just added it to the playlist instead of putting it on screen",
      "Same-song echo suppression is retained — if the song is already live, the same detection won't re-fire and cause a flicker",
      "No wake phrase needed: locked in by a new test — speaking the lyrics ('Amazing grace how sweet the sound') resolves the song without any 'let us sing' cue phrase. Content match works standalone",
      "Slide-by-slide auto-advance during a live song was already wired (matchNextSlide watches interim words against the next slide's lyrics) — should work end-to-end now that songs actually reach the LIVE state",
    ],
  },
  {
    version: "0.1.25",
    date: "2026-07-24",
    headline: "Yellow highlight now means 'AI just self-corrected' + transcript feels ~200ms snappier",
    highlights: [
      "The yellow highlight in the transcript panel is no longer a confidence indicator — it now marks words the AI initially transcribed one way but corrected using context. Example: preacher says 'James Forrest four' → transcript shows 'James three four' with 'three' briefly highlighted yellow (hover to see original 'tree' that got corrected). Fades to plain over 3 seconds",
      "Same real-time self-correcting behavior you'd expect from Claude/ChatGPT voice — approximate first pass, corrected second pass, all in-line",
      "Transcript panel debounce dropped from 300ms → 80ms so the visible transcript tracks live speech much more closely. Detection latency is unchanged — this only affects how quickly you *see* what was heard",
    ],
  },
  {
    version: "0.1.24",
    date: "2026-07-24",
    headline: "Kept reconnect awareness, killed the visual noise near the AI pill",
    highlights: [
      "Removed the manual ↻ 'Restart AI listener' button next to the AI ON pill — it was another circle-arrow icon reading as 'AI is churning'. If you want to restart, just toggle the AI pill OFF then ON — same effect",
      "Silent for the common case: brief background reconnects (< 5 seconds) produce ZERO visual noise. Pill stays green throughout",
      "If a reconnect takes 5+ seconds a discreet toast appears in the corner ('AI reconnecting… — pipeline stays ON'), auto-dismissing on recovery with a green 'AI reconnected' confirmation. Decoupled from the pill so it never reads as 'AI is off'",
      "If it drags past 20 seconds it escalates to a persistent warning suggesting toggle OFF/ON to force recovery",
      "The AI ON/AI OFF pill is now truly binary — nothing else can appear next to it",
    ],
  },
  {
    version: "0.1.23",
    date: "2026-07-24",
    headline: "Removed the reconnecting spinner — restores strictly-binary AI ON/OFF",
    highlights: [
      "The subtle amber ↻ next to the AI ON pill (added yesterday) read as 'the AI is stopping' rather than 'the socket is silently reconnecting in the background'. Removed — the pill stays green throughout any transient reconnect, exactly as the July 2026 product rule intended",
      "Underlying reconnect churn was already fixed yesterday (DG stall watchdog + KeepAlive); this just hides the last visual noise around it",
    ],
  },
  {
    version: "0.1.22",
    date: "2026-07-24",
    headline: "Silences the 'Update check failed — code signature' warning on unsigned tester builds",
    highlights: [
      "The auto-updater now only runs when the current app is signed with an Apple Developer certificate; unsigned tester builds explicitly skip it (no more failed-signature-validation banner)",
      "Once code signing is set up, auto-updates start working automatically — no code change needed",
    ],
  },
  {
    version: "0.1.21",
    date: "2026-07-23",
    headline: "Fixed the Deepgram silence-timeout reconnect churn",
    highlights: [
      "AI listener now sends a KeepAlive frame every 6 seconds during silence so Deepgram doesn't close and re-open the connection during pastoral pauses or worship transitions — cleaner logs, no more visible reconnect churn",
      "Behind the scenes: batched multi-row keyterm upsert (1 DB round trip instead of up to 40), stale-eviction pass to keep the learned-vocab table bounded over months, and adversarial tests locking the multi-tenant boundaries in place",
    ],
  },
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
