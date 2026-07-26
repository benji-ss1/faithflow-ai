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
    version: "0.1.73",
    date: "2026-07-26",
    headline: "'Failed to fetch' toast fixed — actionable message + auto-dismiss on recovery, no more sticky-forever",
    highlights: [
      "When the audio-ticket call couldn't reach Vercel (brief network flap, deploy mid-swap), the raw native `TypeError: Failed to fetch` was surfacing as a bare 'Failed to fetch' toast that stuck on screen forever. Fixed: transient network errors now show 'AI listener can't reach the server — check your internet, will retry automatically' with a 10s auto-dismiss, AND the pipeline schedules a reconnect automatically",
      "Any audio error toast now auto-dismisses the moment the underlying state clears (reconnect succeeded, operator fixed the thing). Actionable errors (permission denied, no audio device, etc.) still stick indefinitely because they need operator action; transient errors clear themselves",
    ],
  },
  {
    version: "0.1.72",
    date: "2026-07-26",
    headline: "New-version notice banner — you'll now get pinged the moment a fresh DMG is out",
    highlights: [
      "Unsigned tester builds can't use the built-in macOS auto-updater (Squirrel refuses signature-less swaps at the OS level — pending Apple Developer enrollment). Until then, the app now polls GitHub every 30 min and shows a violet banner at the top of the operator when a newer release is available: 'Update X.Y.Z available — click to download the new DMG'. Click opens the release page in your browser; download the DMG for your Mac, right-click → Open on first launch, done",
      "No behavior change if you're already on the latest version — banner only appears when GitHub actually has something newer than the version you're running",
      "Ships to every existing tester on next Cmd+R / app relaunch (this is a web change served from Vercel, not a shell change — no reinstall required to get the banner itself)",
    ],
  },
  {
    version: "0.1.70",
    date: "2026-07-26",
    headline: "Docs cut — surfaces the Bible parser fuzzy spoken-form fix that quietly shipped in v0.1.69",
    highlights: [
      "No new code in this DMG — v0.1.70 is a documentation bump so the What's New modal correctly credits the parser fuzzy spoken-form fallback ('filippians four thirteen' → Philippians 4:13) that landed in v0.1.69's binary but wasn't listed in v0.1.69's release notes. See the v0.1.69 entry below for the full details of both fixes now attributed to that release",
      "If you're upgrading from ≤0.1.68 straight to 0.1.70, you'll see three real fixes in the modal: the song hard-debounce (v0.1.69), the parser fuzzy spoken-form fallback (also v0.1.69, now properly credited), and this docs bump (v0.1.70). No behavior change vs v0.1.69",
    ],
  },
  {
    version: "0.1.69",
    date: "2026-07-26",
    headline: "Song auto-fire hard debounce — final fix for the 'GTF → LIVE' repeat toast loop",
    highlights: [
      "v0.1.68's freshness + id-dedup checks in the outer effect weren't enough — Deepgram's interim → final → whisper cascade produces 3-5 new suggestion IDs for a single utterance, each with a genuinely fresh ts + new id, so both outer gates let them through and autoLiveSong got called repeatedly. Now: hard 5s debounce PER SONG at the entry of autoLiveSong itself. Doesn't matter how many times the outer effect calls in for the same song — only the first one in a 5s window actually proceeds",
      "Different-song swaps are unaffected (the debounce map is keyed by songId). Real back-and-forth after 5s+ works normally. This layer is a belt-and-braces on top of every other guard, and it survives even if the effect-at-line-969 accidentally clears liveSongRef mid-fire (which was another way the toast could re-appear)",
      "Bible verse detection — new fuzzy spoken-form fallback: 'filippians four thirteen' now resolves to Philippians 4:13, the same way 'filippians 4:13' already did. Sits at low confidence + semantic-fallback (below both the 70 context-trust floor and the 85 Bible auto-fire floor), so it can never auto-project on its own — you just get a chip to click. This is the specific fix v0.1.65's changelog promised; that DMG shipped the 787-case audit suite but was missing this fallback, so it's landing now",
    ],
  },
  {
    version: "0.1.68",
    date: "2026-07-26",
    headline: "Song auto-fire stale-echo fix — v0.1.67's 3s floor let old detections re-fire every few seconds",
    highlights: [
      "Fixed: after dropping the cross-song refire floor 60s → 3s to enable back-and-forth, songs started auto-projecting REPEATEDLY when the user wasn't singing them. Root cause: suggestions persist in the array and get replaced-in-place by songId — my 3s floor let the same stale detection re-fire every 3s. Now: only fire when the suggestion is fresh (ts within last 8s) AND we haven't already fired for that specific suggestion id. New detection events bump the id + ts, so real back-and-forth still works; stale echoes don't",
      "Belt-and-braces: 200-entry LRU cap on the fired-suggestion-id set prevents unbounded growth over long sessions. The 3s outer refire floor from v0.1.67 stays as a redundant chatter guard",
      "Net result vs v0.1.67: same back-and-forth capability (Song A → Song B → Song A → Song B all fire on real re-detection), but no more phantom re-fires when you stop singing",
    ],
  },
  {
    version: "0.1.67",
    date: "2026-07-26",
    headline: "Songs can now go back-and-forth without a 60s brick wall — fires reliably on each swap",
    highlights: [
      "Fixed: singing Song A → Song B → back to Song A within a minute got blocked on the third detection because a 60s 'quick-refire floor' in the outer song-candidates effect treated the previous handling as an anti-chatter guard. Real preacher/worship-leader back-and-forth needs seconds, not a minute. Floor dropped to 3s (just enough to swallow per-transcript-word chatter within ONE ongoing song, doesn't touch cross-song swaps)",
      "The 5-minute same-song-already-live echo suppression stays put (it's the actual anti-double-fire guard). autoLiveSong's own 800ms min-gap + same-song-live short-circuit + 5-min replay map continue to prevent real chatter. What went away was a redundant outer gate that also happened to break the swap use case",
      "Combined with v0.1.66's AUTO/MANUAL decoupling: songs at ≥70% now fire reliably in either mode, on every legitimate swap, no matter how many times you go back and forth. Test verified: A→B→A→B→A→B all fire",
    ],
  },
  {
    version: "0.1.66",
    date: "2026-07-26",
    headline: "Song auto-fire no longer gated on AUTO/MANUAL toggle — ≥70% policy applies unconditionally",
    highlights: [
      "The AUTO/MANUAL toggle in the top bar now ONLY controls Bible auto-approve (its original purpose). Song auto-fire runs based purely on the confidence policy: ≥70% auto-projects, 60-69% stages with G-key confirm, <60% chip-only. Field report from JPD test: operator was in MANUAL mode, Amazing Grace hit 87%, but the entire song path silently no-op'd because the AUTO toggle blocked it. Fixed",
      "What this means: if you leave AI ON in MANUAL mode, Bible detections still just show as chips (require click), but songs at 70%+ will project themselves. If you want the old 'nothing auto-fires' behavior, turn AI OFF entirely",
      "CLAUDE.md rule 7 updated with the sign-off + rationale. The chip-click carve-out from v0.1.63 (direct operator click always fires slide 1 live regardless of confidence) remains in effect",
    ],
  },
  {
    version: "0.1.65",
    date: "2026-07-26",
    headline: "Bible verse detection — 787-case audit, 100% pass rate, three targeted parser fixes",
    highlights: [
      "New automated Bible detection test suite covers all 66 books across 7 formats (spoken-full, spoken-short, abbreviated, conversational, partial, tricky collisions, and Deepgram mishearings) — 787 total cases. Every book now sits at 100% detection; every format at 100%. Prior baseline was 99.24% (6 failures). Suite lives at src/tests/bibleDetection/ and runs via `npx tsx src/tests/bibleDetection/detectionTestRunner.ts`",
      "Fixed 1 Chr / 2 Chr abbreviation — previously '1 Chr 16:11' silently returned no match because the variant list stopped at '1 chron' / '1 ch'. Added '1 chr' and '2 chr' so testers using the standard SBL abbreviation now resolve",
      "Fixed Philemon (and other single-chapter books) with explicit chapter notation — 'Philemon 1:6' was parsing as Philemon 1:1 because the single_chapter_book_verse regex greedy-ate the '1' as the verse and dropped ':6'. Now: when the shape is Book 1:N, N is the verse; other cases still map correctly. Applies to Obadiah, Philemon, 2 John, 3 John, Jude",
      "Fixed fuzzy book-name match for SPOKEN form — 'filippians four thirteen' now resolves to Philippians 4:13. Previously only the colon shape (filippians 4:13) fuzzy-matched. New pattern requires a ≥6-char candidate + validates chapter so it can't drift into ordinary English speech",
      "Psalm 46:10 gate — all six required phrasings ('Psalm 46:10', 'Psalm forty six verse ten', 'Psalm 46 verse 10', 'Psalms 46:10', 'Be still and know that I am God Psalm 46:10', 'Turn to Psalm 46 verse 10') now pass",
    ],
  },
  {
    version: "0.1.64",
    date: "2026-07-26",
    headline: "Songs now auto-project at 70% confidence (was 85%) — product-owner sign-off after field test",
    highlights: [
      "SONG_AUTOLIVE_CONFIDENCE lowered from 85 → 70. At/above 70%, an AI-detected song now zero-click auto-projects to LIVE. Between 60-69%, songs continue to STAGE (orange banner + G to fire). Below 60%, chip only. Rationale from JPD field test data: at 85% the auto-live band was so narrow most real detections landed in the stage-only band and operators frequently missed the G keypress. The 60-69% stage band is preserved as the intermediate 'operator confirms' tier",
      "Same anti-replay + min-gap guardrails apply at the new 70% floor (5-min per-song replay suppression + 800ms min-gap between auto-fires, both with the different-song-live bypass). Copyright rule 7 is now updated in CLAUDE.md with the new threshold + the sign-off recorded",
      "This complements v0.1.63's chip-click carve-out (direct operator click ALWAYS fires slide 1 to live regardless of confidence). Together: the AI handles ≥70% by itself, 60-69% ask you to confirm, and clicking any chip is the manual override for anything else",
    ],
  },
  {
    version: "0.1.63",
    date: "2026-07-26",
    headline: "Song chip click now fires slide 1 to LIVE (direct operator intent) + adds to playlist",
    highlights: [
      "Clicking a song chip in the AI chips bar at the bottom now fetches that song and pushes slide 1 to the projector immediately, plus adds it to the playlist if it wasn't already there. Previously the click only added-to-playlist (or scrolled to it) — never projected. Direct operator intent is trusted per CLAUDE.md rule 7's carve-out, same policy the SongsBrowser click uses. Success toast confirms the fire. 10-second per-song cooldown so a jittery double-click can't double-fire (second click within cooldown scrolls to the playlist row instead)",
      "Empty-lyric songs (song row with slides but no text yet) show an actionable toast on click ('open in library to add lyrics') instead of silently projecting a blank slide. This is the same hasLyrics safety gate v0.1.62 added to the AI title-trigger path — now consistent between AI detection and manual chip click",
      "Note on the 60-84% band: AI-detected songs at 60-84% confidence still STAGE (orange banner appears with a 'GO LIVE →' button; press G to fire). Zero-click auto-project stays at ≥85% per the copyright-safety product policy. If you want a lower auto-project threshold, that needs a separate product signoff — clicking the chip is the manual override in the meantime",
    ],
  },
  {
    version: "0.1.62",
    date: "2026-07-26",
    headline: "Audio reliability pass — heartbeat dot, AI auto-start, mic boost + high-pass, cache-clear menu, empty-song safety, more homophone repairs",
    highlights: [
      "New heartbeat dot next to the AI ON pill in the top bar — green pulses while Deepgram is actively transcribing, amber when speech has paused, red when the socket has failed, grey when off. Answers the 'is the AI actually listening right now?' question at a glance without opening DevTools",
      "AI listening intent now persists — if AI was ON when you last closed the app, the next launch auto-resumes listening (with a toast so a surprise hot mic is never a surprise). Manual-mode / auto-approve state does NOT auto-hydrate (security fix — an XSS-planted localStorage key can no longer arm zero-touch mic → detect → auto-live). Combined with a 600ms defer + resume() preference, no more mic flap on every load for manual-mode users",
      "10s health watchdog resumes a suspended AudioContext (Chromium sometimes suspends it silently on tab throttle) and kicks a reconnect when the WebSocket is wedged with no backoff pending. Sustained audio-input-changed spam now has a 5s floor between actual pipeline restarts so a device-swap avalanche can't churn Deepgram connections",
      "New Settings › Audio Mic Boost slider (1x–3x, capped at 2x for mixer/interface sources to avoid clamp distortion) and a 'Reduce low-frequency rumble' toggle (100Hz high-pass) — helps distant-mic pickup in echoey rooms. Defaults follow Source Type: microphone gets 1.5x + filter ON; mixer stays unity. The old decorative Input Gain slider (which persisted a key nothing read) is retired",
      "New View menu → 'Clear Cache and Reload' (Cmd+Shift+R) — nukes HTTP cache, Service Workers, and CacheStorage without wiping localStorage or cookies, so you stay signed in. Fixes the 'my app is showing an old version even after Cmd+R' cases",
      "AI safety: an exact-title trigger phrase ('let's sing Amazing Grace') can no longer surface a song candidate whose slides carry NO lyric text — the Priority-6 title-trigger path now respects the same hasLyrics gate that the fuzzy matcher enforces. Prevents a one-click-projects-blank-screen footgun in libraries with placeholder-slide songs",
      "Bible parser: extended the `N is M → N:M` repair to also catch `N was M`, `N has M`, `N and M`, `N at M`, `N of M`, `N are M`, `N were M` — Deepgram consistently mangles the word 'verse' between two digits into these short function words, especially in African-accented speech. 'Nehemiah 2 was 1' now parses as Nehemiah 2:1 on the first Deepgram pass instead of waiting for Whisper canonical correction",
    ],
  },
  {
    version: "0.1.61",
    date: "2026-07-26",
    headline: "Team page polish — avatar initials, unified list with Pending pills, real empty state",
    highlights: [
      "Team members now show a proper amber-initials avatar next to their name (was: bare text). Pending invites got a muted grey initials avatar and a small 'Pending' pill, and got merged into the same team list instead of living in a separate section below — one scannable roster instead of two",
      "New empty state when the church has no team members yet: 'No team members yet. Invite the person who runs your screen on Sunday.' with a Users icon on the amber-tint background. Was: bare list that just rendered nothing",
      "Buttons + inputs retokenised to the admin palette — Send invite is now amber primary (was old bg-foreground/text-background dark tokens), inputs focus with the amber ring, remove buttons hover-tint red without shifting the row height. Confirm-remove dialog got a clearer message about what preserving the audit trail means",
      "You still can't change your own role or remove yourself (belt-and-brace: server action requireRole guards + client disabled buttons with 'You can't remove yourself' tooltip)",
    ],
  },
  {
    version: "0.1.60",
    date: "2026-07-26",
    headline: "Import wizard polish — prominent drop zone, per-file remove, tokenised chrome",
    highlights: [
      "Migration wizard (Songs → Import) now leads with a big full-width drop zone as the primary interaction. Was 'or drop files here' buried under two small file-input labels; now: dashed dropzone that lights up amber on drag-over, upload icon centered, buttons for folder/file/Electron pickers below. All input paths add to the same accumulator, so you can drop one file, then add more via the folder picker, without losing the first",
      "Selected-files list is now itemised — each file shows the name, size, and an X to remove that specific file (was: pick a whole new set to change anything). Also added a 'Clear all' link and a running total-size counter. Duplicate detection by name+size prevents adding the same file twice",
      "Stepper across the top now uses named steps (Source / Files / Review / Done) with checkmarks on completed steps and admin-palette colors — instead of numeric 'Step 1 · Step 2' pills in the old primary/muted tokens. Confirm-import button uses the amber admin accent, review-step Stat cards tint per tone (green for songs found, amber for skipped)",
      "Review step now explains what 'skipped' means: duplicate detection (matched by title against existing songs in your church) auto-skips rather than overwriting. Nothing you've already got gets clobbered by a re-import",
    ],
  },
  {
    version: "0.1.59",
    date: "2026-07-26",
    headline: "New upgrade landing pages — Pro cinematic hero + Starter/Church detail pages",
    highlights: [
      "Clicking a tier's CTA on the billing page now opens a dedicated /upgrade/[tier] landing page instead of jumping straight to Stripe. The upgrade pages live outside the admin shell (no sidebar/topbar) so they read as full-page marketing surfaces — dark background with the amber accent palette shared with the billing page",
      "Pro (/upgrade/pro) gets the cinematic treatment: a hero with a mocked MacBook + stage-display side-by-side, five scroll-triggered feature sections (AI that follows the room · One-click service build · Stage display · Your library · Themes that look designed) with alternating layouts, and a final CTA card with $29/mo + all 6 Pro features + Start free trial. Scroll-in fades use a small IntersectionObserver-based Reveal wrapper — no framer-motion dep",
      "Starter (/upgrade/starter) and Church (/upgrade/church) get simpler detail pages: hero + feature list + pricing card + CTA. Starter → Stripe test-mode trial. Church → mailto for a 30-min discovery call (no self-serve Stripe for multi-campus deals). Both pages cross-link to Pro so admins can compare",
      "Shared /upgrade/layout.tsx wraps everything with a sticky top nav (back-to-billing + PresentFlow mark). Every upgrade page's 'Start free trial' button hits the same createCheckoutSession server action as the billing page's cards — one shared checkout path",
    ],
  },
  {
    version: "0.1.58",
    date: "2026-07-26",
    headline: "Billing page rebuilt — dark amber-glow pricing island with 3 tiers + animated monthly/yearly toggle",
    highlights: [
      "The billing page has been redesigned as a dark 'marketing island' distinct from the light admin dashboard: deep-charcoal background with three drifting amber aurora blobs (CSS-only, zero JS cost). Current plan summary is now a single sleek banner (was three separate cards competing for the same eye) with the plan name, status, trial/renewal date, and a green 'Free' badge during pilot",
      "Three pricing tiers laid out side-by-side: Starter ($14/mo · 50 songs, 5 themes, single campus), Pro ($29/mo · unlimited songs+themes, multi-output, stage display, Planning Center — FEATURED with amber glow + 'RECOMMENDED' badge), Church ($49/mo · multi-campus, sermon archive, historical analytics, API). Prices are placeholders until pilot pricing validates. Each tier hover-lifts, features rows use amber check icons",
      "Monthly/Yearly toggle above the tiers with a real animated switch (grey track, amber knob that slides on click) and a 'Save 20%' badge on the yearly side. Prices update instantly when toggled. The toggle sends the selected cycle to Stripe checkout — for the pilot phase both cycles go through the same test-mode Stripe price ID; separate monthly/yearly Stripe price IDs will land when real prices ship",
      "'Explore (test mode)' CTA is now 'Start free trial' on Starter + Pro and 'Contact us' on Church. Every click goes through Stripe test mode during the pilot — no card is ever charged. A clear inline notice at the bottom reminds admins that prices are placeholders and Stripe is in test mode",
    ],
  },
  {
    version: "0.1.57",
    date: "2026-07-26",
    headline: "Theme editor rebuilt — full-screen 2-panel with live 16:9 preview + 4 preview modes",
    highlights: [
      "Themes at /library/themes → clicking a card (or 'New theme') now opens a full-screen 2-panel editor: left panel is collapsible control groups (Typography, Background, Layout, Lower third, Scripture, Transitions), right panel is a live 16:9 preview that updates instantly on every change. Preview mode toggles at the top let you switch between Lyrics, Scripture, Sermon point, and Blank + logo so you can check every content type against the theme in one place",
      "Typography controls: headline font (Inter, Sora, Plus Jakarta, Georgia, Helvetica, Arial, Times New Roman), separate lyrics vs scripture size, weight 300–900, text color picker, alignment, text-shadow toggle. Background: solid / gradient (two colors) / image URL, plus opacity slider. Layout: 3×3 logo-placement grid + None, logo size slider, church-name toggle with top/bottom position. Lower third: enable + style (bar / gradient-fade / minimal) + color. Scripture: reference show/hide, position (above/below/inline), translation label toggle. Transitions: effect (fade/slide/none) + duration slider",
      "Theme cards on the list view now render a real 16:9 preview thumbnail using the same live preview component — you can eyeball a theme before opening it. Duplicate + delete stay in the bottom-right of each card. Empty state (no themes yet) has a proper 'Create your first theme' CTA with an explanation of what a theme is",
      "Under the hood: expanded the ThemeConfig type + server-side sanitizer to accept all the new fields (fontSizeScripturePx, bgType, bgColor2, bgOpacity, logoPosition, logoSizePx, lowerThird*, scripture*, transitionType, etc.). The operator projector will pick these up as it wires each field on its own timeline — the editor UI is ready today",
    ],
  },
  {
    version: "0.1.56",
    date: "2026-07-25",
    headline: "Cleaner Organization + Songs pages — fewer cards, less noise",
    highlights: [
      "Organization page now shows Church details + Worship defaults in a single card separated by a subtle divider (was two side-by-side cards competing for attention). The internal-only 'Onboarding status' row is gone — it wasn't user-facing signal. Church branding stays as its own card on the right",
      "Songs page: the 'Song licensing and copyright' and 'Import warning' cards are merged into one card, with the amber import warning surfaced as an inline callout at the bottom. Same information, less visual weight",
      "Detection testing panel (the AI-song-match tuning tool volunteers never needed to see on their way to the songs list) is now collapsed behind an 'Admin · Debug' toggle at the bottom of the Songs page. One click away for the admin who tunes it, out of the way for everyone else",
    ],
  },
  {
    version: "0.1.55",
    date: "2026-07-25",
    headline: "Church logo now shows in the topbar badge + tighter image upload rules",
    highlights: [
      "The top-right 'Church' badge in the web admin now shows your uploaded church logo next to the church name (28px circular thumbnail). If you haven't uploaded a logo yet, you get a clean monogram of the first letter of the church name on the muted admin background. Loading a logo fades in from a subtle skeleton shimmer; a broken/expired URL silently falls back to the monogram rather than showing a broken-image icon. The sidebar workspace pill now uses the same shared avatar component for visual consistency",
      "Logo upload now accepts AVIF in addition to PNG, JPG, and WebP (native browser support, better compression than WebP on the same 2 MB budget). SVG stays intentionally excluded — an SVG can carry inline scripts and would be an XSS surface without a server-side sanitize step (queued for a separate commit). HEIC (iPhone default) also queued — needs libheif conversion server-side",
      "Under the hood: the /api/media/presign route now enforces purpose-aware size caps (2 MB for logos, 500 MB for media/pptx) instead of a shared 500 MB cap for everything. Logo uploads also can't slip a video MIME through anymore — the new 'logo' purpose only accepts image content types. Client and server caps now match exactly",
    ],
  },
  {
    version: "0.1.54",
    date: "2026-07-25",
    headline: "Bible verses in playlist now render + < Verse / Verse > push to live + re-detected verse re-fires when a song is on screen",
    highlights: [
      "Bible verses added to the playlist (via the + on a verse card, or Add to Playlist) NOW render as real slide cards in the center grid when clicked. Root cause: BibleMode stored `{reference, verses: [{verse, text}]}` in the item payload but the server-side plan expander only read `payload.slides` / `payload.text` — every scripture playlist item was landing as a blank fallback. Fixed in services.ts: also builds slides from `payload.verses` with the reference label appended, mirroring the Bible panel's own verse-card format",
      "The < Verse and Verse > transport-bar buttons now PUSH the target slide to live instead of only moving the preview cursor. Previously they called `onJumpSlide` (which just changes preview + only fires live under AutoSend). Now: jumps preview AND explicitly fires the target slide via `onSendSlideToLive`, matching what clicking a card in the grid does. Also applies to SkipBack / SkipForward icons",
      "Re-detected Bible verse now re-fires to live even when the currently-live content is a song lyric / message / image / blank. Root cause: the 5-minute replay guard had a bypass 'skip if a DIFFERENT reference is currently live' but the bypass only fired when currentLive was itself Bible-verse-shaped text. Song lyrics don't match the Bible regex, so re-detecting a previously-shown verse got blocked even though the projector was clearly on a different piece of content. Now: permissive default — the guard only blocks when the SAME Bible verse is already on screen (true stale-echo case). Every other live state (song / empty / different verse / image) is treated as a legitimate content swap and allows the re-fire",
    ],
  },
  {
    version: "0.1.53",
    date: "2026-07-25",
    headline: "Branded welcome splash on first sign-in",
    highlights: [
      "First-time admins now see a ~2.6s PresentFlow welcome splash (deep-charcoal background with soft brand glows and the pulsing play-button mark) when they first land on /onboarding — a small brand moment before the setup wizard opens. Skipped for returning users mid-flow so it doesn't add friction. Sidebar clicks between admin pages stay instant with inline skeletons",
    ],
  },
  {
    version: "0.1.52",
    date: "2026-07-25",
    headline: "Onboarding wizard rebuilt — 6 focused steps with branding + hymn library one-click",
    highlights: [
      "New church admins now walk through a 6-step onboarding: Welcome hero → Church profile (name/city/country/denomination/congregation size, timezone auto-detected) → Church branding (drag-drop logo upload right in the wizard, reuses the same uploader the Organization page uses) → Songs setup (import from ProPresenter/EasyWorship, one-click add all 50 built-in public-domain hymns, or skip) → Team invites (multi-email with role picker per invite: Operator/Admin/Pastor) → Download desktop app + finish. The old 4-step 'use case' wizard is retired",
      "'Start with built-in hymns' one-click seeds all 50 hand-verified public-domain hymns into the church's library in a single action — no more running `npm run db:seed:hymns` on the CLI. Idempotent + church-scoped: safe to click twice, safe if you already have some seeded (skips duplicates by title). Reports 'Added X' to confirm",
      "The wizard's branding step doesn't just say 'upload later' — it embeds the same ChurchBrandingUploader component the Organization page uses, so admins can drop a logo mid-flow and see it in the sidebar workspace pill immediately when they land on the dashboard",
      "Every step after the profile is skippable (branding, songs, team, download all have 'Continue' with no required action) so no admin gets stuck. Returning users who partially completed onboarding land at the branding step (skipping welcome + already-done church profile). Role picker on invites lets you send Operator/Admin/Pastor invitations in a single flow instead of everyone defaulting to Operator",
    ],
  },
  {
    version: "0.1.51",
    date: "2026-07-25",
    headline: "Admin topbar + dashboard rebuild — clean light-mode SaaS surface, no more dark ribbon over white",
    highlights: [
      "The web admin topbar has been rebuilt to match the new sidebar language: 64px tall (was 88px), clean white bar with a single bottom border in light mode instead of the previous heavy dark gradient. The ⌘K global search dropdown now renders as a clean white popover with orange-tinted hover rows, the church badge is a small pill in the neutral palette, and the user avatar dropdown pulls the same clean card treatment — profile, settings, and sign out all sit inside a light popover in light mode",
      "Dashboard cards rebuilt (DashboardCard component): white 1px-bordered surfaces with no shadows, 10px radius, tokenised so light mode reads as a proper SaaS panel and dark mode stays deep charcoal. Removed the leftover FaithFlow-teal glow on the 'Next scheduled service' banner — now a subtle orange-accented card. Status pills retinted (green success, amber warning, red danger, orange brand) using the admin palette instead of the old teal-based tokens",
      "Dashboard checklist rows are now flat + minimal: no boxy borders, just a subtle hover state, with the arrow chevron appearing only on hover. Icons use the new green/amber/orange palette. Action buttons ('Open services' and 'Manage organization') use the new admin button treatment — 40px tall, 6px radius, orange primary with focus ring instead of the previous 44px rounded-2xl brutalist buttons",
      "PageHeader retooled to use the admin tokens across every page that uses it (Dashboard, Songs, Library/*, Organization, Settings, Analytics) — cleaner type scale (28px headline, 14px description), tighter spacing, no more display-font italic tilt on titles",
    ],
  },
  {
    version: "0.1.50",
    date: "2026-07-25",
    headline: "Admin sidebar rebuild — branded gradient header, tighter 240px width, regrouped nav, light-mode clean",
    highlights: [
      "The web admin sidebar has been rebuilt from the ground up: 240px wide (was 302px), a signature dark gradient header at the top with the PresentFlow logo (Present in ivory, Flow in orange) and church workspace pill inside it, a 2px purple→orange→pink brand gradient stripe separating that header from the neutral nav below. In light mode the nav body is now a clean off-white with subtle borders instead of the previous forced-dark gradient; in dark mode it stays deep charcoal",
      "Nav restructured into four focused groups per the new brief: Workspace (Overview, Services) / Content (Songs, Bible, Media, Imports, Themes, Sermon Archive, Analytics) / People (Team, Devices) / Admin (Church Profile, Billing, Settings). The old 'Library' sub-menu is flattened. The 'AI Assistant' dead-row is retired. The disabled duplicate 'Account' card at the bottom is gone",
      "Active-state indicator changed from a wide dark-tile look to a 3px orange left rail + soft orange tint on the row — reads cleaner in light mode and matches the new SaaS-quality visual language. Icons pick up the orange when active. Cmd/Ctrl+/ still toggles collapse; sidebar and content chrome are now scoped under a `.pf-admin-scope` class so operator surfaces (which never opt into that scope) render unchanged",
      "Desktop-shell users (Electron) are unaffected — desktop sidebar/nav still use their own layout and this rebuild only touches the web admin chrome",
    ],
  },
  {
    version: "0.1.49",
    date: "2026-07-25",
    headline: "Church logo upload + it shows in the sidebar workspace pill",
    highlights: [
      "Admins can now upload a church logo from Organization → Church branding (drag-drop or click, PNG/JPG/WebP up to 2 MB). The logo appears immediately in the sidebar workspace pill below the PresentFlow branding — no hard reload needed. Fallback when no logo is uploaded: a monogram of the church name's first letter",
      "Under the hood: logo upload is admin-role gated (operators/pastors can't change branding on their own), the stored S3 key is validated to belong to your own church (belt-and-brace so no crafted request from a friendly UI can plant another church's key), and the previous blob URL is revoked on replace so repeat uploads don't leak memory. Sidebar image now sets width/height (no layout shift) and referrerPolicy=no-referrer",
      "Browser tab now shows the PresentFlow play-button logo as the favicon (was Next.js default) — applies to both regular tabs and the Apple touch icon",
    ],
  },
  {
    version: "0.1.48",
    date: "2026-07-25",
    headline: "Admin portal hardening — 50 hymns, editable church profile, real Themes page, Songs table with search + delete, security sweep landed",
    highlights: [
      "Built-in public-domain hymn library grew from 10 to 50 titles — Christmas set (Silent Night, O Come All Ye Faithful, Hark! the Herald, Joy to the World, O Little Town of Bethlehem, Away in a Manger, What Child Is This, The First Noel, Angels We Have Heard on High, We Three Kings, It Came Upon the Midnight Clear, God Rest Ye Merry), Easter set (Christ the Lord Is Risen Today, Low in the Grave He Lay, The Old Rugged Cross), and 26 more worship classics (Blessed Assurance, Rock of Ages, Just As I Am, Sweet Hour of Prayer, What a Friend, Nearer My God to Thee, Abide With Me, Turn Your Eyes Upon Jesus, Jesus Loves Me, Onward Christian Soldiers, and more). Every hymn has full slide-formatted verses, individually PD-verified with author + publication citations",
      "Songs page now has a real data table — client-side search by title/artist, sortable columns, one-click delete per row with confirm dialog, and a proper empty state with '+ Add a song' and 'Import library' CTAs. Previously a bare list with no search and no way to delete from the UI (backend action existed since day one, just wasn't wired)",
      "Library → Themes was a 'coming soon' placeholder — now a full CRUD: create/duplicate/delete themes, edit modal with live preview, controls for background color, text color, font family (Inter/Sora/Plus Jakarta/Georgia/Helvetica/Arial), font size, weight, and alignment. Apply from any song's editor. Empty state with 'Create your first theme' CTA",
      "Organization page was read-only — now a proper editable form: church name, timezone, city, country, congregation size, denomination all save via a new admin-only updateChurch server action. Dirty-state hint + toast confirmation. The dashboard's 'Church profile' checklist item finally leads somewhere that lets you finish it",
      "Notifications bell in the top bar was decoration (no click handler, no data source) — removed. No more dead clicks",
      "Bible library empty state no longer shows a raw `npm run db:seed:bible` shell instruction to church admins. Replaced with a 'Library is warming up' message pointing to support if it persists",
      "Cross-tenant hardening (invisible but load-bearing): two cross-church leaks closed — service-item payloads referencing another church's song/media/pptx IDs are now rejected at write AND filtered out at read (defense-in-depth two-hop by church_id in getExpandedServicePlan), and the dashboard's aiSuggestions query no longer returns every church's suggestions on every load. Login now rate-limits failed attempts (5/15min per IP + per email, constant-time bcrypt so unknown emails don't reveal existence). Password-reset flooding limited (3/hour per IP + per email, silent success to preserve anti-enumeration). 2FA is fail-closed: if totpEnabled is ever set, password-only login is refused until the TOTP challenge ships. New 'Attempt 12' adversarial test writes poisoned service items and asserts they render as blank slides — 12/12 pass",
    ],
  },
  {
    version: "0.1.47",
    date: "2026-07-25",
    headline: "Audio Diagnostics scanner + Live Transcript Clear + Media PRO lock + Logs tab hidden",
    highlights: [
      "New Audio Diagnostics scanner in Settings › Audio → 'Run diagnostics'. Enumerates every audio input on the machine, opens each one (4-step constraint fallback so weird interfaces don't get rejected), listens for 3 seconds, and reports live signal + level + sample rate. One-click 'Use' button selects a device as the AI input. Purpose: at JPD with a Mac Studio + mixer + Logic + maybe Dante + spare USB mic, the volunteer sees at a glance which of 6 devices is actually carrying the preacher's mic",
      "Live transcript now has a 'Clear' button in the panel header that hides everything transcribed so far without stopping the AI listener — new speech continues to land. Useful for resetting the visible panel between service segments without a full pipeline restart",
      "Media section now shows a PRO badge and locks Cinematic / Creators / Intro Videos categories behind a Pro plan gate. 'Free' remains accessible. Clicking a locked category opens an inline banner with an Upgrade button ('coming soon' toast on beta) and a Dismiss link",
      "Logs icon in the right sidebar bar has been hidden (the popover was a placeholder pointing at DevTools console). Kept the underlying logging code intact for the follow-up dismissed-detections history view",
    ],
  },
  {
    version: "0.1.46",
    date: "2026-07-25",
    headline: "Bible verse cards fit longer text + separate Load-Chapter/Add-to-Playlist buttons + transitions actually animate",
    highlights: [
      "Bible verse cards in the reference grid now use the same 14px readability floor as the SlideGrid instead of the sanctuary-facing 24px default — long verses (John 3:18, Psalm 119 subsections) no longer clip mid-word in the thumbnail. Full verse text is available as a tooltip on hover regardless. Projector output unchanged (still uses 24px min for sanctuary readability)",
      "'+ Add all verses' button split into two clear actions: 'Load Chapter' (secondary ghost) loads every verse of the current chapter into the grid, and '+ Add to Playlist' (primary orange) adds the currently displayed verse cards to the service plan. Previously the single button conflated both semantics and operators guessed wrong",
      "Transition picker actually animates the projector now. Root cause: the picker labels ('Cut', 'Fade', 'Slide (L→R)') never matched the effect IDs the projector renderer expects ('fade_in', 'slide_right'). Every picked transition silently fell through as unknown → no animation. Added the mapping so Cut, Fade, Dissolve (cross-fade), Slide L→R (slide_right), Slide R→L (slide_left), Wipe (wipe_right), Amoeba, Dispersion Blur, Color Burn, Iris, Push all resolve to real keyframes. Duration slider now affects transition time — 0s = instant, 3s = slow",
    ],
  },
  {
    version: "0.1.45",
    date: "2026-07-25",
    headline: "Live preview panel — wider + taller so long verses don't clip mid-word",
    highlights: [
      "Right sidebar bumped from 300px → 360px (60px more width) and the Live preview box from 220px → 280px tall (60px more height). Combined that's ~35% more visible area — long verses like John 3:18 no longer cut off at 'the name of the only [begotten Son of God]' mid-word. Center panel gives up 60px of width but operator's primary focus is the live preview",
    ],
  },
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
